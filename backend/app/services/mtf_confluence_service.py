"""
Multi-Timeframe (MTF) Confluence Score Service.

Synthesises indicator signals across 5min and 1day timeframes into a single
0–100 confluence score that tells the trader whether timeframes are aligned:

  80–100 → HIGH confluence (strongly aligned)
  60–79  → MODERATE (mostly aligned)
  40–59  → MIXED (no edge — do not enter)
  20–39  → OPPOSING (signal fading against daily)
  0–19   → INVERSE (strong counter-trend)

Scoring per indicator:
  Bullish signal  = +1
  Neutral/weak    =  0
  Bearish signal  = −1

Indicators evaluated:
  RSI14         — value vs 50 (>55 bullish, <45 bearish)
  MACD hist     — sign of histogram
  EMA trend     — close vs EMA20
  Supertrend    — direction
  ADX           — trend strength (>20 = trending, otherwise flat)
  Bollinger pos — close position relative to bands
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

INDICATORS = ["rsi", "macd", "ema_trend", "supertrend", "adx", "bb_position"]


def _ist_now() -> datetime:
    return datetime.now(IST)


def _score_rsi(value: Optional[float]) -> tuple[str, int]:
    if value is None:
        return "no_data", 0
    if value > 55:
        return "bullish", 1
    if value < 45:
        return "bearish", -1
    return "neutral", 0


def _score_macd_hist(hist: Optional[float]) -> tuple[str, int]:
    if hist is None:
        return "no_data", 0
    if hist > 0:
        return "bullish", 1
    if hist < 0:
        return "bearish", -1
    return "neutral", 0


def _score_ema_trend(close: Optional[float], ema20: Optional[float]) -> tuple[str, int]:
    if close is None or ema20 is None or ema20 == 0:
        return "no_data", 0
    diff_pct = (close - ema20) / ema20 * 100
    if diff_pct > 0.1:
        return "bullish", 1
    if diff_pct < -0.1:
        return "bearish", -1
    return "neutral", 0


def _score_supertrend(direction: Optional[str]) -> tuple[str, int]:
    if not direction:
        return "no_data", 0
    d = str(direction).lower()
    if "bull" in d or d == "1" or d == "up":
        return "bullish", 1
    if "bear" in d or d == "-1" or d == "down":
        return "bearish", -1
    return "neutral", 0


def _score_adx(adx: Optional[float], plus_di: Optional[float], minus_di: Optional[float]) -> tuple[str, int]:
    if adx is None:
        return "no_data", 0
    if adx < 20:
        return "flat", 0  # no trend — don't score direction
    if plus_di is not None and minus_di is not None:
        if plus_di > minus_di:
            return "strong_bullish_trend", 1
        return "strong_bearish_trend", -1
    return "trending", 0


def _score_bb_position(close: Optional[float], upper: Optional[float], lower: Optional[float], middle: Optional[float]) -> tuple[str, int]:
    if close is None or upper is None or lower is None:
        return "no_data", 0
    band_range = upper - lower
    if band_range <= 0:
        return "neutral", 0
    pos = (close - lower) / band_range  # 0 = at lower band, 1 = at upper band
    if pos > 0.65:
        return "bullish", 1
    if pos < 0.35:
        return "bearish", -1
    return "neutral", 0


def _score_timeframe(indicators: dict[str, Any], close: Optional[float]) -> dict:
    """
    Score all indicators for a single timeframe.
    Expects the nested dict format from AllIndicators.to_dict():
      indicators["rsi"]["value"], indicators["macd"]["histogram"],
      indicators["ema"]["ema_20"], indicators["supertrend"]["direction"],
      indicators["adx"]["adx"], indicators["bollinger"]["upper"], etc.
    """
    ind = indicators

    rsi_val = (ind.get("rsi") or {}).get("value")
    macd_hist = (ind.get("macd") or {}).get("histogram")
    ema20 = (ind.get("ema") or {}).get("ema_20")
    st_dir = (ind.get("supertrend") or {}).get("direction")
    adx_val = (ind.get("adx") or {}).get("adx")
    plus_di = (ind.get("adx") or {}).get("plus_di")
    minus_di = (ind.get("adx") or {}).get("minus_di")
    bb_upper = (ind.get("bollinger") or {}).get("upper")
    bb_lower = (ind.get("bollinger") or {}).get("lower")
    bb_middle = (ind.get("bollinger") or {}).get("middle")

    rsi_label, rsi_score = _score_rsi(rsi_val)
    macd_label, macd_score = _score_macd_hist(macd_hist)
    ema_label, ema_score = _score_ema_trend(close, ema20)
    st_label, st_score = _score_supertrend(st_dir)
    adx_label, adx_score = _score_adx(adx_val, plus_di, minus_di)
    bb_label, bb_score = _score_bb_position(close, bb_upper, bb_lower, bb_middle)

    scores = [rsi_score, macd_score, ema_score, st_score, adx_score, bb_score]
    labels = {
        "rsi": {"signal": rsi_label, "value": rsi_val, "score": rsi_score},
        "macd": {"signal": macd_label, "value": macd_hist, "score": macd_score},
        "ema_trend": {"signal": ema_label, "value": ema20, "score": ema_score},
        "supertrend": {"signal": st_label, "value": st_dir, "score": st_score},
        "adx": {"signal": adx_label, "value": adx_val, "score": adx_score},
        "bb_position": {"signal": bb_label, "value": None, "score": bb_score},
    }

    bullish = sum(1 for s in scores if s == 1)
    bearish = sum(1 for s in scores if s == -1)
    neutral = sum(1 for s in scores if s == 0)

    return {
        "signals": labels,
        "bullish_count": bullish,
        "bearish_count": bearish,
        "neutral_count": neutral,
        "total": len(scores),
    }


def _compute_confluence_score(tf5: dict, tf1d: dict) -> tuple[int, str, str]:
    """
    Combine two timeframe scores into a 0–100 confluence number.
    Both timeframes have equal weight (50% each).
    """
    def tf_score(tf: dict) -> float:
        total = tf["total"]
        if total == 0:
            return 0.5  # neutral
        # Normalize to 0–1: all bullish = 1, all bearish = 0
        return (tf["bullish_count"] / total)

    s5 = tf_score(tf5)
    s1d = tf_score(tf1d)

    # Average and convert to 0–100
    raw_score = (s5 + s1d) / 2 * 100
    score = int(round(raw_score))

    # Alignment bias: direction of each timeframe
    dir5 = "bullish" if tf5["bullish_count"] > tf5["bearish_count"] else (
        "bearish" if tf5["bearish_count"] > tf5["bullish_count"] else "neutral"
    )
    dir1d = "bullish" if tf1d["bullish_count"] > tf1d["bearish_count"] else (
        "bearish" if tf1d["bearish_count"] > tf1d["bullish_count"] else "neutral"
    )

    if dir5 == dir1d and dir5 != "neutral":
        bias = dir5
    elif dir5 == "neutral" and dir1d != "neutral":
        bias = dir1d
    elif dir1d == "neutral" and dir5 != "neutral":
        bias = dir5
    else:
        bias = "mixed"

    # Confluence label
    if score >= 80:
        level = "HIGH"
    elif score >= 60:
        level = "MODERATE"
    elif score >= 40:
        level = "MIXED"
    elif score >= 20:
        level = "OPPOSING"
    else:
        level = "INVERSE"

    return score, bias, level


async def build_mtf_confluence() -> dict:
    """
    Fetch 5min and 1day indicators, score each, compute MTF confluence.
    """
    from app.services.indicator_calculator import calculate_all_indicators
    from app.services.upstox_client import upstox_client
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from sqlalchemy import select, desc

    # ── Load candles from DB for each interval ─────────────────────────────────
    SYMBOL = "NIFTY_50"

    async def load_candles(interval: str, limit: int = 250) -> list:
        async with get_ts_session() as session:
            rows = (await session.execute(
                select(DBCandle)
                .where(DBCandle.symbol == SYMBOL, DBCandle.interval == interval)
                .order_by(desc(DBCandle.timestamp))
                .limit(limit)
            )).scalars().all()
            # Return oldest-first for indicator calculation
            return list(reversed(rows))

    candles_5min = await load_candles("5min", 250)
    candles_1day = await load_candles("1day", 250)

    if not candles_5min and not candles_1day:
        return {"error": "No candle data available", "timestamp": _ist_now().isoformat()}

    def candles_to_raw(candles: list) -> list[list]:
        return [
            [
                c.timestamp.isoformat(),
                float(c.open), float(c.high), float(c.low), float(c.close),
                float(c.volume), float(c.oi),
            ]
            for c in candles
        ]

    spot = 0.0
    ind_5min: dict = {}
    ind_1day: dict = {}
    close_5min: Optional[float] = None
    close_1day: Optional[float] = None

    if candles_5min:
        raw5 = candles_to_raw(candles_5min)
        try:
            result5 = calculate_all_indicators(raw5)
            ind_5min = result5.to_dict()  # AllIndicators.to_dict() → nested dict
            close_5min = float(candles_5min[-1].close)
            if not spot:
                spot = close_5min
        except Exception as e:
            logger.warning(f"MTF: 5min indicator calc failed: {e}")

    if candles_1day:
        raw1d = candles_to_raw(candles_1day)
        try:
            result1d = calculate_all_indicators(raw1d)
            ind_1day = result1d.to_dict()
            close_1day = float(candles_1day[-1].close)
        except Exception as e:
            logger.warning(f"MTF: 1day indicator calc failed: {e}")

    # ── Score each timeframe ───────────────────────────────────────────────────
    tf5 = _score_timeframe(ind_5min, close_5min) if ind_5min else {
        "signals": {}, "bullish_count": 0, "bearish_count": 0, "neutral_count": 0, "total": 0
    }
    tf1d = _score_timeframe(ind_1day, close_1day) if ind_1day else {
        "signals": {}, "bullish_count": 0, "bearish_count": 0, "neutral_count": 0, "total": 0
    }

    score, bias, level = _compute_confluence_score(tf5, tf1d)

    # ── Build human-readable summary ───────────────────────────────────────────
    dir5 = "Bullish" if tf5["bullish_count"] > tf5["bearish_count"] else (
        "Bearish" if tf5["bearish_count"] > tf5["bullish_count"] else "Neutral"
    )
    dir1d = "Bullish" if tf1d["bullish_count"] > tf1d["bearish_count"] else (
        "Bearish" if tf1d["bearish_count"] > tf1d["bullish_count"] else "Neutral"
    )

    aligned = level in ("HIGH", "MODERATE")
    if aligned:
        recommendation = f"Strong {bias} confluence on both 5min and 1day — high-confidence entry zone."
    elif level == "MIXED":
        recommendation = (
            f"5min: {dir5} | 1day: {dir1d} — timeframes not aligned. "
            "Avoid new entries; wait for resolution."
        )
    else:
        recommendation = (
            f"5min: {dir5} | 1day: {dir1d} — opposing signals. "
            "Counter-trend risk is elevated."
        )

    return {
        "timestamp": _ist_now().isoformat(),
        "spot_price": round(spot, 2) if spot else None,
        "score": score,
        "bias": bias,
        "confluence_level": level,
        "recommendation": recommendation,
        "timeframes": {
            "5min": tf5,
            "1day": tf1d,
        },
        "summary": {
            "bullish_5min": tf5["bullish_count"],
            "bearish_5min": tf5["bearish_count"],
            "bullish_1day": tf1d["bullish_count"],
            "bearish_1day": tf1d["bearish_count"],
            "direction_5min": dir5,
            "direction_1day": dir1d,
        },
    }
