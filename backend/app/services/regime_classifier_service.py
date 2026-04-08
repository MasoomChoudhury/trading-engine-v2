"""
Market Regime Classifier Service.

Synthesises ADX, Bollinger Band width, ATR (relative to its 20-day average),
and VIX trend into a single actionable regime label:

  trending_bullish    → ADX > 25, +DI dominant; bias calls, avoid put buys into strength
  trending_bearish    → ADX > 25, -DI dominant; bias puts, avoid chasing call bounces
  breakout_imminent   → ADX < 20, Bollinger squeeze (width in bottom 20th pct), low ATR
  mean_reverting      → ADX < 20, ATR low, no directional pressure
  choppy              → ADX < 20, wide Bollinger, ATR elevated — avoid directional buys

Inputs (all computed from 1day candles already in DB):
  ADX, +DI, -DI   — from indicator_calculator
  Bollinger upper/lower/middle — for bandwidth
  ATR — current vs rolling 20-day avg ATR
  VIX trend — rising/falling/flat

The regime is re-derived live on each request; no DB storage needed.
"""
from __future__ import annotations
import math
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def _compute_bb_width(candles: list) -> tuple[Optional[float], Optional[float]]:
    """
    Compute Bollinger Band width (bandwidth) and its 20-day rolling average.
    Returns (current_width, avg_width).
    bandwidth = (upper - lower) / middle × 100
    """
    if len(candles) < 25:
        return None, None

    closes = [float(c.close) for c in candles]

    def bb_at(idx: int) -> Optional[float]:
        if idx < 19:
            return None
        window = closes[idx - 19: idx + 1]
        mean = sum(window) / 20
        std = math.sqrt(sum((x - mean) ** 2 for x in window) / 20)
        upper = mean + 2 * std
        lower = mean - 2 * std
        if mean == 0:
            return None
        return (upper - lower) / mean * 100

    widths = [bb_at(i) for i in range(19, len(closes))]
    widths = [w for w in widths if w is not None]
    if not widths:
        return None, None

    current = widths[-1]
    avg = sum(widths[-20:]) / len(widths[-20:]) if len(widths) >= 5 else current
    return round(current, 3), round(avg, 3)


def _compute_atr_ratio(candles: list) -> Optional[float]:
    """ATR(14) / 20-day rolling average of ATR(14). > 1.2 = elevated, < 0.8 = suppressed."""
    if len(candles) < 35:
        return None

    def true_range(c, prev) -> float:
        return max(
            float(c.high) - float(c.low),
            abs(float(c.high) - float(prev.close)),
            abs(float(c.low) - float(prev.close)),
        )

    trs = [true_range(candles[i], candles[i - 1]) for i in range(1, len(candles))]

    def atr_at(idx: int, period: int = 14) -> Optional[float]:
        if idx < period - 1:
            return None
        return sum(trs[idx - period + 1: idx + 1]) / period

    atrs = [atr_at(i) for i in range(13, len(trs))]
    atrs = [a for a in atrs if a is not None]
    if not atrs:
        return None

    current_atr = atrs[-1]
    avg_atr = sum(atrs[-20:]) / len(atrs[-20:])
    return round(current_atr / avg_atr, 3) if avg_atr > 0 else None


def _percentile_rank(value: float, series: list[float]) -> float:
    """What percentile is value in series?"""
    if not series:
        return 50.0
    return round(sum(1 for v in series if v <= value) / len(series) * 100, 1)


async def classify_market_regime() -> dict:
    """
    Classify the current market regime by computing indicators from 1day candles.
    Returns regime label, signal inputs, and trader guidance.
    """
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from app.services.indicator_calculator import calculate_all_indicators
    from sqlalchemy import select, desc

    # ── Load daily candles ──────────────────────────────────────────────────
    async with get_ts_session() as session:
        rows = (await session.execute(
            select(DBCandle)
            .where(DBCandle.symbol == "NIFTY_50", DBCandle.interval == "1day")
            .order_by(desc(DBCandle.timestamp))
            .limit(250)
        )).scalars().all()

    if len(rows) < 30:
        return {
            "error": "Insufficient daily candle data (need 30+)",
            "timestamp": datetime.now(IST).isoformat(),
        }

    candles = list(reversed(rows))  # chronological

    # ── Compute indicators ──────────────────────────────────────────────────
    raw = [
        [c.timestamp.isoformat(), float(c.open), float(c.high), float(c.low),
         float(c.close), float(c.volume), float(c.oi)]
        for c in candles
    ]

    try:
        ind_result = calculate_all_indicators(raw)
        ind = ind_result.to_dict()
    except Exception as e:
        return {"error": f"Indicator computation failed: {e}", "timestamp": datetime.now(IST).isoformat()}

    adx_data = ind.get("adx") or {}
    adx = float(adx_data.get("adx") or 0)
    plus_di = float(adx_data.get("plus_di") or 0)
    minus_di = float(adx_data.get("minus_di") or 0)

    bb_data = ind.get("bollinger") or {}
    bb_upper = float(bb_data.get("upper") or 0)
    bb_lower = float(bb_data.get("lower") or 0)
    bb_middle = float(bb_data.get("middle") or 0)
    bb_width_current = round((bb_upper - bb_lower) / bb_middle * 100, 3) if bb_middle > 0 else None

    atr_val = float((ind.get("atr") or {}).get("value") or 0) or None
    close_val = float(candles[-1].close)

    # ── Bollinger width historical context ─────────────────────────────────
    bb_current, bb_avg = _compute_bb_width(candles)
    atr_ratio = _compute_atr_ratio(candles)

    # BB squeeze: current width < 20th percentile of recent widths?
    bb_squeeze = False
    if bb_current is not None and bb_avg is not None:
        bb_squeeze = bb_current < bb_avg * 0.7  # significantly below average → squeeze

    # ── VIX trend (optional, non-blocking) ─────────────────────────────────
    vix: Optional[float] = None
    vix_regime: Optional[str] = None
    try:
        from app.services.vix_service import get_india_vix
        vix_data = await get_india_vix()
        vix = vix_data.get("vix")
        vix_regime = vix_data.get("regime")
    except Exception:
        pass

    vix_elevated = (vix or 0) > 20

    # ── Classify regime ─────────────────────────────────────────────────────
    #
    # Decision tree:
    #  1. ADX > 25 (trending) → direction from DI
    #  2. ADX 20–25 (mild trend) → same but weaker
    #  3. ADX < 20 → ranging
    #     a. BB squeeze → breakout_imminent
    #     b. ATR elevated + VIX elevated → choppy_volatile
    #     c. otherwise → mean_reverting

    if adx >= 25:
        if plus_di > minus_di:
            regime = "trending_bullish"
            strength = "strong" if adx > 35 else "moderate"
            guidance = (
                f"ADX {adx:.1f} — strong uptrend confirmed (+DI {plus_di:.1f} > −DI {minus_di:.1f}). "
                "Bias call options and call spreads. Avoid naked put buys."
            )
        else:
            regime = "trending_bearish"
            strength = "strong" if adx > 35 else "moderate"
            guidance = (
                f"ADX {adx:.1f} — strong downtrend confirmed (−DI {minus_di:.1f} > +DI {plus_di:.1f}). "
                "Bias put options and bear call spreads. Avoid chasing call bounces."
            )
    elif adx >= 20:
        # Mild trend developing
        if plus_di > minus_di:
            regime = "trending_bullish"
            strength = "mild"
            guidance = (
                f"ADX {adx:.1f} — mild bullish bias. "
                "Prefer calls with defined risk. Confirm with price above key EMAs."
            )
        else:
            regime = "trending_bearish"
            strength = "mild"
            guidance = (
                f"ADX {adx:.1f} — mild bearish bias. "
                "Prefer puts with defined risk. Watch for support levels."
            )
    elif bb_squeeze and (atr_ratio is None or atr_ratio < 0.9):
        regime = "breakout_imminent"
        strength = "high"
        guidance = (
            f"ADX {adx:.1f} (ranging) + Bollinger squeeze (width {bb_current:.2f}% vs avg {bb_avg:.2f}%). "
            "Breakout conditions forming. Size up with defined-risk spreads — direction TBD. "
            "Buy straddle/strangle near the squeeze level."
        )
    elif vix_elevated or (atr_ratio is not None and atr_ratio > 1.3):
        regime = "choppy"
        strength = "high_volatility"
        guidance = (
            f"ADX {adx:.1f} (low trend) with elevated ATR/VIX "
            f"({'VIX ' + str(round(vix, 1)) + '%' if vix else ''}, "
            f"ATR ratio {f'{atr_ratio:.2f}' if atr_ratio is not None else 'N/A'}). "
            "Avoid directional buys — premium is rich. "
            "Favour iron condors, strangles, or credit spreads."
        )
    else:
        regime = "mean_reverting"
        strength = "normal"
        guidance = (
            f"ADX {adx:.1f} — low trend strength. Bollinger width normal. "
            "Range-bound conditions. Favour selling premium at extremes (e.g. short strangles). "
            "Wait for ADX > 20 before taking directional trades."
        )

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "regime": regime,
        "strength": strength,
        "guidance": guidance,
        "inputs": {
            "adx": round(adx, 2),
            "plus_di": round(plus_di, 2),
            "minus_di": round(minus_di, 2),
            "bb_width_current": bb_current,
            "bb_width_avg": bb_avg,
            "bb_squeeze": bb_squeeze,
            "atr_ratio": atr_ratio,
            "vix": vix,
            "vix_regime": vix_regime,
        },
        "spot_price": round(close_val, 2),
    }
