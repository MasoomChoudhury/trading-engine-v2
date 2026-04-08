"""
Futures Basis / Cost of Carry Service.

Computes the price basis (futures LTP − spot) which encodes institutional intent:
  Rising basis  → longs paying up; bullish carry; institutions adding futures
  Falling basis → unwinding or short buildup
  Negative basis → discount; short pressure or dividend expectations

Also computes:
  - Annualised cost of carry (basis as % annualised over DTE)
  - Theoretical fair basis via risk-free rate model: F = S × (1 + r × T)
  - Basis vs fair: mispricing spread (positive = expensive, negative = cheap futures)
  - 30-day historical basis chart
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
RBI_REPO_RATE = 0.065  # ~6.5% risk-free rate (update periodically)


def _ist_now() -> datetime:
    return datetime.now(IST)


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def _days_to_date(date_str: str) -> int:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return (dt.date() - _ist_now().date()).days


async def get_futures_basis() -> dict[str, Any]:
    """
    Compute live futures basis and 30-day historical basis for the near-month contract.
    """
    from app.services.futures_service import get_active_futures, fetch_futures_daily_candles
    from app.services.upstox_client import upstox_client

    # ── Get near futures contract ──────────────────────────────────────────────
    try:
        contracts = await get_active_futures()
    except Exception as e:
        return {"error": f"Could not fetch futures contracts: {e}"}

    if not contracts:
        return {"error": "No active futures contracts found"}

    near = contracts[0]
    near_key = near.get("instrument_key", "")
    near_expiry = near.get("expiry", "")
    lot_size = int(near.get("lot_size") or 75)

    # ── Spot price ─────────────────────────────────────────────────────────────
    try:
        spot_data = await upstox_client.get_live_price("NSE_INDEX|Nifty 50")
        spot = float(spot_data.get("last_price") or spot_data.get("ltp") or 0)
    except Exception as e:
        logger.warning(f"Futures basis: could not get spot price: {e}")
        spot = 0.0

    # ── Live futures LTP via daily candles (latest close) ─────────────────────
    try:
        near_candles = await fetch_futures_daily_candles(near_key, days=30)
    except Exception as e:
        return {"error": f"Could not fetch futures candles: {e}"}

    if not near_candles:
        return {"error": "No candle data for near futures"}

    # Candles: newest first from Upstox → sort ascending for chart
    candles_asc = sorted(near_candles, key=lambda c: str(c[0]))

    futures_ltp = _safe_float(candles_asc[-1][4]) if candles_asc else None  # close of latest bar

    if not futures_ltp or not spot:
        return {
            "error": "Insufficient price data for basis calculation",
            "near_expiry": near_expiry,
            "spot_price": round(spot, 2),
            "futures_ltp": futures_ltp,
        }

    # ── Current basis metrics ──────────────────────────────────────────────────
    dte = max(_days_to_date(near_expiry), 1)  # prevent division by zero

    basis_pts = round(futures_ltp - spot, 2)
    basis_pct = round(basis_pts / spot * 100, 4) if spot else 0.0

    # Annualised carry = basis_pct × (365 / DTE)
    annualised_carry_pct = round(basis_pct * 365 / dte, 2)

    # Theoretical fair basis: F_fair = S × (1 + r × T) where T = DTE / 365
    T = dte / 365.0
    fair_futures = spot * (1 + RBI_REPO_RATE * T)
    fair_basis_pts = round(fair_futures - spot, 2)
    basis_vs_fair = round(basis_pts - fair_basis_pts, 2)  # positive = expensive futures

    # Regime interpretation
    if basis_pts > fair_basis_pts + 20:
        regime = "premium_elevated"
        regime_note = (
            f"Futures trading at a ₹{basis_pts:.0f} premium to spot "
            f"(fair basis: ₹{fair_basis_pts:.0f}). "
            "Longs are paying up — bullish carry; institutional accumulation likely."
        )
    elif basis_pts < 0:
        regime = "discount"
        regime_note = (
            f"Futures trading at a ₹{abs(basis_pts):.0f} DISCOUNT to spot. "
            "Short pressure or aggressive unwinding in the futures market."
        )
    elif basis_pts < fair_basis_pts - 20:
        regime = "premium_compressed"
        regime_note = (
            f"Futures basis below fair value (actual: ₹{basis_pts:.0f}, fair: ₹{fair_basis_pts:.0f}). "
            "Possible short buildup or rollover-driven compression."
        )
    else:
        regime = "normal"
        regime_note = (
            f"Basis (₹{basis_pts:.0f}) is near fair value (₹{fair_basis_pts:.0f}). "
            "Normal cost of carry — no strong institutional signal."
        )

    # ── Historical basis chart ─────────────────────────────────────────────────
    # Use spot proxy: we don't have daily spot in this service, so we reconstruct
    # basis from candles and the closing spot via open-interest weighted proxy.
    # For historical chart we show futures close directly and annotate basis as
    # (futures_close - previous_futures_close) since we lack daily spot history.
    # A proper implementation would join with the Nifty spot candle history.
    # For now, we expose raw futures close and annotate the current basis only.
    # Fetch Nifty 50 spot daily candles for true historical carry computation
    try:
        spot_candles = await fetch_futures_daily_candles("NSE_INDEX|Nifty 50", days=30)
        spot_by_date: dict[str, float] = {}
        for sc in spot_candles:
            d = str(sc[0])[:10]
            s_close = _safe_float(sc[4])
            if s_close:
                spot_by_date[d] = s_close
    except Exception as e:
        logger.warning(f"Futures basis: spot candle fetch failed (no historical carry): {e}")
        spot_by_date = {}

    near_expiry_dt = datetime.strptime(near_expiry, "%Y-%m-%d").date()
    history: list[dict] = []
    hist_carry_series: list[float] = []

    for c in candles_asc[-30:]:
        date_str = str(c[0])[:10]
        fut_close = _safe_float(c[4])
        vol = int(c[5]) if c[5] else 0
        oi = int(c[6]) if len(c) > 6 and c[6] else 0

        hist_carry_pct: Optional[float] = None
        spot_close_h = spot_by_date.get(date_str)
        if fut_close and spot_close_h and spot_close_h > 0:
            try:
                hist_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                dte_h = max((near_expiry_dt - hist_date).days, 1)
                basis_pct_h = (fut_close - spot_close_h) / spot_close_h * 100
                hist_carry_pct = round(basis_pct_h * 365 / dte_h, 2)
                hist_carry_series.append(hist_carry_pct)
            except Exception:
                pass

        history.append({
            "date": date_str,
            "futures_close": round(fut_close, 2) if fut_close else None,
            "volume": vol,
            "oi": oi,
            "annualised_carry_pct": hist_carry_pct,
        })

    # Rollover unwinding signal: compare current carry to 10-day average
    carry_10d = hist_carry_series[-10:] if hist_carry_series else []
    avg_carry_10d: Optional[float] = round(sum(carry_10d) / len(carry_10d), 2) if carry_10d else None

    rollover_alert: Optional[str] = None
    rollover_note: Optional[str] = None
    if avg_carry_10d is not None and avg_carry_10d != 0:
        if annualised_carry_pct < avg_carry_10d * 0.70:
            rollover_alert = "bearish_unwinding"
            rollover_note = (
                f"Current carry ({annualised_carry_pct:.1f}%) is well below the 10-day average "
                f"({avg_carry_10d:.1f}%). Long positions being rolled at a discount — "
                "bearish unwinding signal. Reduce long futures exposure."
            )
        elif annualised_carry_pct > avg_carry_10d * 1.30:
            rollover_alert = "aggressive_accumulation"
            rollover_note = (
                f"Current carry ({annualised_carry_pct:.1f}%) well above the 10-day average "
                f"({avg_carry_10d:.1f}%). Longs paying elevated premium — "
                "aggressive accumulation. Bullish bias confirmed."
            )

    return {
        "timestamp": _ist_now().isoformat(),
        "near_expiry": near_expiry,
        "dte": dte,
        "spot_price": round(spot, 2),
        "futures_ltp": round(futures_ltp, 2),
        "basis_pts": basis_pts,
        "basis_pct": basis_pct,
        "annualised_carry_pct": annualised_carry_pct,
        "avg_carry_10d": avg_carry_10d,
        "fair_basis_pts": fair_basis_pts,
        "basis_vs_fair": basis_vs_fair,
        "risk_free_rate_used": RBI_REPO_RATE,
        "regime": regime,
        "regime_note": regime_note,
        "rollover_alert": rollover_alert,
        "rollover_note": rollover_note,
        "lot_size": lot_size,
        "history": history,
    }
