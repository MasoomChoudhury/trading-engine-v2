"""
IV Rank (IVR) & IV Percentile (IVP) Service.

IVR = (current_IV - min_252d) / (max_252d - min_252d) × 100
      Measures position in the 52-week range. Fast but ignores distribution shape.

IVP = count(daily_IV_252d <= current_IV) / 252 × 100
      True percentile rank in the historical distribution. Answers:
      "What % of the past 252 trading days had IV BELOW today's level?"
      IVP 85 means IV was lower than today on 85% of recent days → expensive.

Both use 252-day India VIX history fetched from Yahoo Finance (^INDIAVIX).
Strike-specific IVR/IVP scales ATM values by current IV skew per strike.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

LOT_SIZE = 50
NIFTY_KEY = "NSE_INDEX|Nifty 50"

YF_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


async def _fetch_vix_history_252() -> list[float]:
    """
    Fetch 252 trading days of India VIX daily closes from Yahoo Finance (^INDIAVIX).
    Returns closes in chronological order, newest last.
    Falls back to empty list on failure (caller uses vix_service 52w range instead).
    """
    import httpx
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=1d&range=400d"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=YF_HEADERS)
            resp.raise_for_status()
            data = resp.json()
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            return []
        closes = (result[0].get("indicators") or {}).get("quote", [{}])[0].get("close") or []
        closes = [float(c) for c in closes if c is not None]
        return closes[-252:]  # last 252 trading days
    except Exception as e:
        logger.warning(f"IVR/IVP: VIX history fetch failed: {e}")
        return []


def _compute_ivr_ivp(current: float, history: list[float]) -> tuple[float, float]:
    """
    Returns (IVR, IVP) given current IV and sorted history list.
    IVR = range-normalised position (fast).
    IVP = true percentile rank in distribution (precise).
    """
    if not history:
        return 50.0, 50.0
    h_min = min(history)
    h_max = max(history)
    ivr = round((current - h_min) / (h_max - h_min) * 100, 1) if h_max > h_min else 50.0
    ivr = max(0.0, min(100.0, ivr))
    ivp = round(sum(1 for v in history if v <= current) / len(history) * 100, 1)
    return ivr, ivp


async def get_ivr_ivp(target_expiry: str | None = None) -> dict:
    """
    Compute IV Rank and IV Percentile for Nifty ATM and surrounding strikes.

    Returns:
      atm_ivr       : IV Rank at ATM (0–100) — position in 252d range
      atm_ivp       : IV Percentile at ATM (0–100) — true distribution rank
      signal        : 'buy_debit_spread' | 'neutral' | 'buy_viable'
      restrict_naked: True when IVR > 50 (Vega crush risk)
      strikes       : per-strike ivr, ivp, iv, signal
    """
    from app.services.vix_service import get_india_vix
    from app.services.upstox_client import UpstoxClient

    # ── VIX snapshot for current value and 52w bounds (fallback) ─────────────
    vix_data = await get_india_vix()
    current_vix: float = vix_data.get("vix") or 0.0
    vix_52w_high: float = vix_data.get("vix_52w_high") or 0.0
    vix_52w_low: float = vix_data.get("vix_52w_low") or 0.0

    # ── Fetch 252-day VIX history for true IVP ─────────────────────────────────
    vix_history = await _fetch_vix_history_252()
    history_days = len(vix_history)

    if vix_history:
        atm_ivr, atm_ivp = _compute_ivr_ivp(current_vix, vix_history)
    else:
        # Fallback: use NSE 52w range (IVR only; IVP approximated same as IVR)
        logger.warning("IVR/IVP: no VIX history — falling back to 52w range IVR")
        vix_range = vix_52w_high - vix_52w_low
        atm_ivr = round((current_vix - vix_52w_low) / vix_range * 100, 1) if vix_range > 0 else 50.0
        atm_ivr = max(0.0, min(100.0, atm_ivr))
        atm_ivp = atm_ivr  # can't distinguish without history

    # ── Fetch option chain for strike-level IVs ────────────────────────────────
    client = UpstoxClient()
    strikes_out: list[dict] = []

    try:
        contracts = await client.get_option_contracts(NIFTY_KEY)
        if not contracts:
            raise ValueError("No option contracts")

        expiry = target_expiry or contracts[0].get("expiry", "")
        chain = await client.get_option_chain(NIFTY_KEY, expiry)

        if not chain:
            raise ValueError("Empty option chain")

        # Find ATM: closest strike to spot
        spot: float = 0.0
        for entry in chain:
            s = entry.get("underlying_spot_price") or 0.0
            if s:
                spot = float(s)
                break

        if spot == 0:
            raise ValueError("No spot price from chain")

        atm_strike = min(chain, key=lambda x: abs(float(x.get("strike_price", 0)) - spot))
        atm_iv_ce = float((atm_strike.get("call_options") or {}).get("option_greeks", {}).get("iv") or current_vix)
        atm_iv_pe = float((atm_strike.get("put_options") or {}).get("option_greeks", {}).get("iv") or current_vix)
        atm_iv = (atm_iv_ce + atm_iv_pe) / 2 if atm_iv_ce and atm_iv_pe else current_vix

        # Build per-strike table (ATM ± 5 strikes = 11 rows)
        sorted_chain = sorted(chain, key=lambda x: float(x.get("strike_price", 0)))
        atm_idx = next((i for i, x in enumerate(sorted_chain)
                        if abs(float(x.get("strike_price", 0)) - spot) <= 75), len(sorted_chain) // 2)
        window = sorted_chain[max(0, atm_idx - 5): atm_idx + 6]

        for entry in window:
            strike = float(entry.get("strike_price", 0))
            ce_iv = float((entry.get("call_options") or {}).get("option_greeks", {}).get("iv") or 0)
            pe_iv = float((entry.get("put_options") or {}).get("option_greeks", {}).get("iv") or 0)
            avg_iv = (ce_iv + pe_iv) / 2 if ce_iv and pe_iv else (ce_iv or pe_iv or current_vix)

            # Scale IVR/IVP by moneyness (how much higher/lower is this strike's IV vs ATM IV)
            moneyness_ratio = avg_iv / atm_iv if atm_iv > 0 else 1.0
            s_ivr = round(atm_ivr * moneyness_ratio, 1)
            s_ivr = max(0.0, min(100.0, s_ivr))
            s_ivp = round(atm_ivp * moneyness_ratio, 1)
            s_ivp = max(0.0, min(100.0, s_ivp))

            if s_ivr > 50:
                s_signal = "buy_debit_spread"
            elif s_ivr < 30:
                s_signal = "buy_viable"
            else:
                s_signal = "neutral"

            strikes_out.append({
                "strike": strike,
                "ce_iv": round(ce_iv, 2),
                "pe_iv": round(pe_iv, 2),
                "avg_iv": round(avg_iv, 2),
                "ivr": s_ivr,
                "ivp": s_ivp,
                "signal": s_signal,
                "is_atm": abs(strike - spot) <= 75,
            })

    except Exception as e:
        logger.warning(f"IVR/IVP strike-level fetch failed: {e} — returning ATM-only result")

    # ── Overall signal ─────────────────────────────────────────────────────────
    if atm_ivr > 50:
        signal = "buy_debit_spread"
        restrict_naked = True
        guidance = (
            f"IVR {atm_ivr:.0f} — IV is historically elevated (top {atm_ivp:.0f}th percentile). "
            "Vega crush risk on naked options. Use Bull/Bear Call or Put Spreads to neutralise Vega."
        )
    elif atm_ivr < 30:
        signal = "buy_viable"
        restrict_naked = False
        guidance = (
            f"IVR {atm_ivr:.0f} — IV is historically cheap (bottom {100 - atm_ivp:.0f}th percentile). "
            "Vega tailwind for buyers. Naked ATM calls/puts viable if direction is confirmed."
        )
    else:
        signal = "neutral"
        restrict_naked = False
        guidance = (
            f"IVR {atm_ivr:.0f} — IV in mid-range. "
            "Neither strongly cheap nor expensive. Debit spreads reduce cost without excessive Vega leakage."
        )

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "current_vix": round(current_vix, 2),
        "vix_52w_high": round(vix_52w_high, 2),
        "vix_52w_low": round(vix_52w_low, 2),
        "atm_ivr": atm_ivr,
        "atm_ivp": atm_ivp,
        "signal": signal,
        "restrict_naked": restrict_naked,
        "guidance": guidance,
        "strikes": strikes_out,
        "expiry": target_expiry,
    }
