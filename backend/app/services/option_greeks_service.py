"""
Option Execution & Greeks — Buyer's Survival Toolkit.

Provides:
- Full option chain snapshot with LTP / Volume / IV / Greeks per strike
- Nifty 14-day ATR from daily candles
- Buyer's Edge ratio: (ATR × |Delta|) / |Theta| — does the expected move
  outpace daily theta decay?
- DTE decay curve: theoretical theta acceleration as expiry approaches
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def _ist_today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


# ── ATR Calculation ───────────────────────────────────────────────────────────

async def _get_nifty_atr(period: int = 14) -> float | None:
    """Compute Nifty 14-day ATR from daily historical candles.

    Candle format from Upstox V2: [timestamp, open, high, low, close, volume, oi]
    Candles are returned newest-first; we sort to chronological order.
    """
    from app.services.upstox_client import upstox_client
    try:
        to_date = _ist_today()
        candles = await upstox_client.get_historical_candles(
            instrument_key="NSE_INDEX|Nifty 50",
            interval="1day",
            to_date=to_date,
            from_date=to_date,  # ignored by V2 index endpoint
        )
        if not candles or len(candles) < period + 1:
            logger.warning(f"Not enough candles for ATR: got {len(candles) if candles else 0}")
            return None

        # Sort chronologically (V2 returns newest-first)
        candles_sorted = sorted(candles, key=lambda c: c[0])
        # Take the last (period + 1) candles
        tail = candles_sorted[-(period + 1):]

        trs = []
        for i in range(1, len(tail)):
            high = float(tail[i][2])
            low = float(tail[i][3])
            prev_close = float(tail[i - 1][4])
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
            trs.append(tr)

        atr = round(sum(trs[-period:]) / len(trs[-period:]), 2)
        return atr
    except Exception as e:
        logger.warning(f"ATR calculation failed: {e}")
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _atm_strike(spot: float, step: int = 50) -> float:
    return round(spot / step) * step


def _days_to_expiry(expiry_str: str) -> int:
    expiry = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    today = datetime.now(IST).date()
    return max(0, (expiry - today).days)


def _edge_label(ratio: float | None) -> str:
    """Classify Buyer's Edge ratio into actionable tiers."""
    if ratio is None:
        return "no_data"
    if ratio >= 3.0:
        return "strong"       # Expected delta gain ≥ 3× theta cost
    if ratio >= 1.5:
        return "edge"         # Delta gain > theta cost — viable
    if ratio >= 0.8:
        return "tight"        # Marginal; needs good entry
    return "no_edge"          # Theta eating more than expected gain


# ── DTE Decay Curve ───────────────────────────────────────────────────────────

def _dte_decay_curve(current_dte: int, atm_theta_abs: float) -> list[dict]:
    """Theoretical theta decay curve from current DTE down to 0.

    Uses simplified Black-Scholes approximation:
        theta ∝ 1/√DTE  (constant IV & spot assumption)

    So  theta_d = atm_theta_abs × √(current_dte / d)

    Returns list of {dte, theta_per_day, is_current, zone}.
    """
    if current_dte <= 0 or atm_theta_abs <= 0:
        return []

    # Build a dense set of DTE points
    dte_points: list[float] = list(range(max(current_dte, 30), 0, -1))
    # Add fractional DTE points near expiry
    for frac in [0.5, 0.25]:
        if frac < current_dte:
            dte_points.append(frac)
    dte_points = sorted(set(dte_points), reverse=True)

    result = []
    for d in dte_points:
        theta_d = atm_theta_abs * math.sqrt(current_dte / d)
        if d <= 1:
            zone = "danger"          # 0DTE / 1DTE — extreme decay
        elif d <= 3:
            zone = "warning"         # Expiry week
        elif d <= 7:
            zone = "caution"         # Final week
        else:
            zone = "normal"
        result.append({
            "dte": round(d, 2),
            "theta_per_day": round(theta_d, 2),
            "is_current": d == current_dte,
            "zone": zone,
        })

    return result


# ── Chain Greeks ─────────────────────────────────────────────────────────────

async def get_chain_greeks(target_expiry: str | None = None) -> dict:
    """Full option chain with per-strike Greeks (ATM ± 500 pts).

    Returns:
        expiry, spot, atm_strike, dte, chain: list of strike rows
    """
    from app.services.options_service import get_active_expiries, days_to_expiry
    from app.services.upstox_client import upstox_client

    expiries = await get_active_expiries()
    if not expiries:
        raise ValueError("No active expiries found")

    near = expiries[0]
    next_e = expiries[1] if len(expiries) > 1 else None
    dte_near = days_to_expiry(near)
    # Auto-roll to next expiry if <= 3 DTE on near
    use_next = dte_near <= 3 and next_e is not None
    expiry = target_expiry or (next_e if use_next else near)
    dte = days_to_expiry(expiry)

    raw_chain = await upstox_client.get_option_chain("NSE_INDEX|Nifty 50", expiry)
    if isinstance(raw_chain, dict):
        raw_chain = raw_chain.get("data", [])

    spot = 0.0
    rows = []
    for item in raw_chain:
        strike = float(item.get("strike_price") or 0)
        if not strike:
            continue
        if not spot:
            spot = float(item.get("underlying_spot_price") or 0)

        ce = item.get("call_options") or {}
        pe = item.get("put_options") or {}
        ce_md = ce.get("market_data") or {}
        pe_md = pe.get("market_data") or {}
        ce_g = ce.get("option_greeks") or {}
        pe_g = pe.get("option_greeks") or {}

        rows.append({
            "strike": strike,
            # Market data
            "ce_ltp":    round(float(ce_md.get("ltp") or 0), 2),
            "pe_ltp":    round(float(pe_md.get("ltp") or 0), 2),
            "ce_volume": int(ce_md.get("volume") or 0),
            "pe_volume": int(pe_md.get("volume") or 0),
            "ce_oi":     int(ce_md.get("oi") or 0),
            "pe_oi":     int(pe_md.get("oi") or 0),
            # Greeks (Upstox: IV in %, theta in ₹/day, delta 0-1, vega ₹/1%IV)
            "ce_iv":     round(float(ce_g.get("iv") or 0), 2) or None,
            "pe_iv":     round(float(pe_g.get("iv") or 0), 2) or None,
            "ce_delta":  round(float(ce_g.get("delta") or 0), 4) or None,
            "pe_delta":  round(float(pe_g.get("delta") or 0), 4) or None,
            "ce_theta":  round(float(ce_g.get("theta") or 0), 2) or None,
            "pe_theta":  round(float(pe_g.get("theta") or 0), 2) or None,
            "ce_vega":   round(float(ce_g.get("vega") or 0), 2) or None,
            "pe_vega":   round(float(pe_g.get("vega") or 0), 2) or None,
            "ce_gamma":  round(float(ce_g.get("gamma") or 0), 6) or None,
            "pe_gamma":  round(float(pe_g.get("gamma") or 0), 6) or None,
        })

    rows.sort(key=lambda r: r["strike"])

    atm = _atm_strike(spot) if spot else 0.0
    # Mark ATM and filter to ATM ± 500 pts
    filtered = []
    for r in rows:
        r["is_atm"] = r["strike"] == atm
        if abs(r["strike"] - atm) <= 500:
            filtered.append(r)

    return {
        "expiry": expiry,
        "spot": round(spot, 2),
        "atm_strike": atm,
        "dte": dte,
        "chain": filtered,
        "timestamp": datetime.now(IST).isoformat(),
    }


# ── Buyer's Edge (Full Toolkit) ───────────────────────────────────────────────

async def get_buyers_edge(target_expiry: str | None = None) -> dict:
    """Full Buyer's Toolkit: chain + ATR + Buyer's Edge + DTE decay curve.

    Buyer's Edge = (ATR × |delta|) / |theta|
    - > 1.5 → Expected delta gain outpaces theta decay → viable to buy
    - < 0.8 → Theta dominant → avoid unless high-conviction directional

    DTE Decay Curve: theoretical theta vs DTE, showing acceleration near expiry.
    """
    chain_data = await get_chain_greeks(target_expiry)
    atr = await _get_nifty_atr(period=14)

    chain = chain_data["chain"]
    dte = chain_data["dte"]
    atm = chain_data["atm_strike"]

    # Annotate each strike with Buyer's Edge
    for row in chain:
        for side in ("ce", "pe"):
            delta = row.get(f"{side}_delta")
            theta = row.get(f"{side}_theta")
            if atr and delta is not None and theta is not None and theta != 0:
                ratio = round((atr * abs(delta)) / abs(theta), 2)
                row[f"{side}_buyers_edge"] = ratio
                row[f"{side}_edge_label"] = _edge_label(ratio)
            else:
                row[f"{side}_buyers_edge"] = None
                row[f"{side}_edge_label"] = "no_data"

    # ATM row for summary cards
    atm_row = next((r for r in chain if r["is_atm"]), None)
    atm_theta_abs = 0.0
    if atm_row:
        # Use average of CE/PE theta for decay curve seed
        thetas = [abs(atm_row["ce_theta"] or 0), abs(atm_row["pe_theta"] or 0)]
        valid = [t for t in thetas if t > 0]
        atm_theta_abs = sum(valid) / len(valid) if valid else 0.0

    decay_curve = _dte_decay_curve(dte, atm_theta_abs)

    # ATM summary (for the stat cards)
    atm_summary = None
    if atm_row:
        atm_summary = {
            "strike": atm,
            "ce_ltp":   atm_row.get("ce_ltp"),
            "pe_ltp":   atm_row.get("pe_ltp"),
            "ce_iv":    atm_row.get("ce_iv"),
            "pe_iv":    atm_row.get("pe_iv"),
            "ce_delta": atm_row.get("ce_delta"),
            "pe_delta": atm_row.get("pe_delta"),
            "ce_theta": atm_row.get("ce_theta"),
            "pe_theta": atm_row.get("pe_theta"),
            "ce_vega":  atm_row.get("ce_vega"),
            "pe_vega":  atm_row.get("pe_vega"),
            "ce_buyers_edge": atm_row.get("ce_buyers_edge"),
            "pe_buyers_edge": atm_row.get("pe_buyers_edge"),
            "ce_edge_label": atm_row.get("ce_edge_label"),
            "pe_edge_label": atm_row.get("pe_edge_label"),
        }

    # DTE zone description
    if dte == 0:
        dte_note = "0DTE — EXTREME theta decay. Micro-sizing only."
    elif dte == 1:
        dte_note = "1DTE — Theta is brutal. Only high-conviction trades."
    elif dte <= 3:
        dte_note = "Expiry week — theta accelerating. Reduce size vs normal."
    elif dte <= 7:
        dte_note = "Final week — theta noticeable. Tight stops required."
    else:
        dte_note = f"{dte} DTE — Normal theta environment."

    return {
        "expiry": chain_data["expiry"],
        "spot": chain_data["spot"],
        "atm_strike": atm,
        "dte": dte,
        "dte_note": dte_note,
        "atr_14": atr,
        "atm": atm_summary,
        "chain": chain,
        "decay_curve": decay_curve,
        "timestamp": chain_data["timestamp"],
    }
