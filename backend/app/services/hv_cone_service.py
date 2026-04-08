"""
Historical Volatility (HV) Cone Service.

Plots realized volatility at 5d, 10d, 20d, 30d, 60d lookback horizons
alongside percentile bands (10th, 25th, 50th, 75th, 90th) computed from
the past 252 trading days of rolling HV history.

Why this matters:
  A single HV reading (e.g. HV20 = 24%) is insufficient context.
  The cone shows whether current IV is expensive or cheap at each horizon.
  Example: VIX at 25.1% vs HV5 of 18% during a trending day →
    IV/RV ratio of 1.40 at the 5-day horizon → buying weeklies is expensive.
"""
from __future__ import annotations
import math
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
LOOKBACKS = [5, 10, 20, 30, 60]  # days


def _hv(closes: list[float], n: int) -> Optional[float]:
    """Annualised HV for a given lookback n from a list of closing prices."""
    if len(closes) < n + 1:
        return None
    window = closes[-(n + 1):]
    log_returns = [math.log(window[i] / window[i - 1]) for i in range(1, len(window))]
    m = len(log_returns)
    if m < 2:
        return None
    mean = sum(log_returns) / m
    variance = sum((r - mean) ** 2 for r in log_returns) / (m - 1)
    return round(math.sqrt(variance) * math.sqrt(252) * 100, 2)


def _percentile(sorted_vals: list[float], p: float) -> float:
    """Linear interpolation percentile."""
    if not sorted_vals:
        return 0.0
    idx = (p / 100.0) * (len(sorted_vals) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return round(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac, 2)


async def get_hv_cone() -> dict:
    """
    Compute the HV cone for Nifty 50.

    Returns:
      cone: list of points per lookback:
        { lookback, current_hv, p10, p25, p50, p75, p90, pct_rank, iv_rv_ratio }
      current_vix: India VIX (for overlay)
      spot_price, timestamp, candle_count
    """
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from sqlalchemy import select, desc

    # Need 252 + max(LOOKBACKS) + 1 buffer = 252 + 60 + 5 = 317 candles
    REQUIRED = 320

    async with get_ts_session() as session:
        rows = (await session.execute(
            select(DBCandle.close, DBCandle.timestamp)
            .where(DBCandle.symbol == "NIFTY_50", DBCandle.interval == "1day")
            .order_by(desc(DBCandle.timestamp))
            .limit(REQUIRED)
        )).all()

    if not rows:
        return {
            "error": "No daily candle data available",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # Chronological order (oldest first)
    closes = [float(r[0]) for r in reversed(rows)]
    spot_price = closes[-1]

    if len(closes) < 70:
        return {
            "error": f"Insufficient data — need 70+ daily candles, have {len(closes)}",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # ── Try to get live VIX ──────────────────────────────────────────────────
    current_vix: Optional[float] = None
    try:
        from app.services.vix_service import get_india_vix
        vix_data = await get_india_vix()
        current_vix = vix_data.get("vix")
    except Exception as e:
        logger.debug(f"HV cone: VIX fetch failed (non-critical): {e}")

    # ── Build cone ───────────────────────────────────────────────────────────
    cone = []

    for L in LOOKBACKS:
        if len(closes) < L + 2:
            cone.append({"lookback": L})
            continue

        # Rolling HV series over the available history
        # Start from position where we have at least 1 full lookback window
        hv_series: list[float] = []
        for end in range(L, len(closes)):
            window = closes[end - L: end + 1]
            hv = _hv(window, L)
            if hv is not None:
                hv_series.append(hv)

        if not hv_series:
            cone.append({"lookback": L})
            continue

        current_hv = hv_series[-1]
        sorted_hv = sorted(hv_series)

        # Percentile rank of current HV in its own history
        rank_count = sum(1 for v in sorted_hv if v <= current_hv)
        pct_rank = round(rank_count / len(sorted_hv) * 100, 1)

        # IV/RV ratio using current VIX as IV proxy (meaningful at 20–30d horizon)
        iv_rv_ratio = round(current_vix / current_hv, 3) if current_vix and current_hv > 0 else None

        cone.append({
            "lookback": L,
            "current_hv": round(current_hv, 2),
            "p10": _percentile(sorted_hv, 10),
            "p25": _percentile(sorted_hv, 25),
            "p50": _percentile(sorted_hv, 50),
            "p75": _percentile(sorted_hv, 75),
            "p90": _percentile(sorted_hv, 90),
            "pct_rank": pct_rank,
            "iv_rv_ratio": iv_rv_ratio,
            "sample_count": len(hv_series),
        })

    # ── Interpretation ───────────────────────────────────────────────────────
    # Check if current IV (VIX) is above the 75th percentile of HV at each horizon
    expensive_at = []
    cheap_at = []
    for pt in cone:
        if "p75" not in pt or pt.get("iv_rv_ratio") is None:
            continue
        ratio = pt["iv_rv_ratio"]
        if ratio > 1.3:
            expensive_at.append(pt["lookback"])
        elif ratio < 0.85:
            cheap_at.append(pt["lookback"])

    if expensive_at:
        note = (
            f"IV (VIX {current_vix:.1f}%) is expensive vs realized vol at "
            f"{', '.join(str(d)+'d' for d in expensive_at)} horizons (IV/RV > 1.3x). "
            "Favour selling premium or using spreads."
        ) if current_vix else ""
    elif cheap_at:
        note = (
            f"IV (VIX {current_vix:.1f}%) is cheap vs realized vol at "
            f"{', '.join(str(d)+'d' for d in cheap_at)} horizons (IV/RV < 0.85x). "
            "Favourable conditions for buying premium."
        ) if current_vix else ""
    else:
        note = "IV is trading near fair value relative to realized volatility across horizons." if current_vix else ""

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "spot_price": round(spot_price, 2),
        "candle_count": len(closes),
        "current_vix": current_vix,
        "cone": cone,
        "lookbacks": LOOKBACKS,
        "note": note,
    }
