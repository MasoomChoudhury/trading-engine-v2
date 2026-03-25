"""
Derived metrics for Nifty 50 — all calculations that don't need option chain.
These are computed from OHLC candle data.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, time, timezone
from typing import Optional
import pandas as pd
from app.services.indicator_calculator import parse_candles, calculate_rsi, calculate_vwap, calculate_atr


@dataclass
class DerivedMetricsResult:
    timestamp: str
    spot_price: float

    # CPR
    cpr_status: str  # 'above_cpr', 'below_cpr', 'pivot_range'
    cpr_width: Optional[float]
    pivot: Optional[float]
    bc: Optional[float]  # Bottom Central
    tc: Optional[float]  # Top Central

    # Opening Range
    opening_range_status: str  # 'above_or', 'below_or', 'within_or'
    opening_range_high: Optional[float]
    opening_range_low: Optional[float]

    # VWAP
    vwap_status: str  # 'above_vwap', 'below_vwap'
    vwap_context: str  # 'bullish', 'bearish', 'neutral'
    true_vwap: float

    # Intraday Levels
    intraday_r3: Optional[float]
    intraday_r2: Optional[float]
    intraday_r1: Optional[float]
    intraday_s1: Optional[float]
    intraday_s2: Optional[float]
    intraday_s3: Optional[float]

    # Momentum Burst
    momentum_burst: str  # 'bullish_burst', 'bearish_burst', 'no_burst'
    momentum_burst_strength: float

    # Gap Analysis
    gap_up_percent: Optional[float]
    gap_down_percent: Optional[float]
    gap_status: str  # 'gap_up', 'gap_down', 'no_gap'

    # Day Phase
    day_phase: str  # 'pre_market', 'opening_auction', 'morning_trend', 'midday', 'afternoon_trend', 'close_auction', 'after_hours'

    # Volume Profile (approximation)
    volume_profile_high: Optional[float]
    volume_profile_low: Optional[float]
    volume_poc: Optional[float]  # Point of Control

    # Swing Pivots (approximation from 15-min candles)
    swing_high: Optional[float]
    swing_low: Optional[float]
    swing_pivot_r: Optional[float]
    swing_pivot_s: Optional[float]

    # Swing Bias
    swing_bias: str  # 'bullish', 'bearish', 'neutral'

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "spot_price": self.spot_price,
            "cpr": {
                "status": self.cpr_status,
                "width": self.cpr_width,
                "pivot": self.pivot,
                "bc": self.bc,
                "tc": self.tc,
            },
            "opening_range": {
                "status": self.opening_range_status,
                "high": self.opening_range_high,
                "low": self.opening_range_low,
            },
            "vwap": {
                "status": self.vwap_status,
                "context": self.vwap_context,
                "true_vwap": self.true_vwap,
            },
            "intraday_levels": {
                "r3": self.intraday_r3,
                "r2": self.intraday_r2,
                "r1": self.intraday_r1,
                "s1": self.intraday_s1,
                "s2": self.intraday_s2,
                "s3": self.intraday_s3,
            },
            "momentum_burst": {
                "type": self.momentum_burst,
                "strength": self.momentum_burst_strength,
            },
            "gap_analysis": {
                "gap_up_percent": self.gap_up_percent,
                "gap_down_percent": self.gap_down_percent,
                "status": self.gap_status,
            },
            "day_phase": self.day_phase,
            "volume_profile": {
                "high": self.volume_profile_high,
                "low": self.volume_profile_low,
                "poc": self.volume_poc,
            },
            "swing_pivots": {
                "swing_high": self.swing_high,
                "swing_low": self.swing_low,
                "pivot_r": self.swing_pivot_r,
                "pivot_s": self.swing_pivot_s,
            },
            "swing_bias": self.swing_bias,
        }


def _calculate_cpr(ohlc_df: pd.DataFrame) -> tuple[Optional[float], Optional[float], Optional[float], str, Optional[float]]:
    """Calculate Central Pivot Range from daily candles."""
    if len(ohlc_df) < 1:
        return None, None, None, "unknown", None

    row = ohlc_df.iloc[-1]
    high, low, close = float(row["high"]), float(row["low"]), float(row["close"])

    pivot = (high + low + close) / 3
    bc = (high + low) / 2
    tc = (pivot + bc) / 2

    # CPR width as % of pivot
    cpr_width = abs(tc - bc) / pivot * 100 if pivot > 0 else 0

    return pivot, bc, tc, "", cpr_width


def _calculate_intraday_levels(daily_df: pd.DataFrame) -> dict:
    """Calculate classic pivot point levels (R1, R2, R3, S1, S2, S3)."""
    if len(daily_df) < 1:
        return {"r3": None, "r2": None, "r1": None, "s1": None, "s2": None, "s3": None}

    row = daily_df.iloc[-1]
    high, low, close = float(row["high"]), float(row["low"]), float(row["close"])

    pivot = (high + low + close) / 3
    r1 = (2 * pivot) - low
    s1 = (2 * pivot) - high
    r2 = pivot + (high - low)
    s2 = pivot - (high - low)
    r3 = high + 2 * (pivot - low)
    s3 = low - 2 * (high - pivot)

    return {"r3": r3, "r2": r2, "r1": r1, "s1": s1, "s2": s2, "s3": s3}


def _calculate_opening_range(intraday_df: pd.DataFrame, num_bars: int = 3) -> tuple[str, Optional[float], Optional[float]]:
    """Opening Range from first N 5-minute candles (default: first 3 = 15 min)."""
    if len(intraday_df) < num_bars:
        return "unknown", None, None

    or_df = intraday_df.head(num_bars)
    or_high = float(or_df["high"].max())
    or_low = float(or_df["low"].min())
    current_price = float(intraday_df.iloc[-1]["close"])

    if current_price > or_high:
        status = "above_or"
    elif current_price < or_low:
        status = "below_or"
    else:
        status = "within_or"

    return status, or_high, or_low


def _calculate_momentum_burst(candle_data: list[list]) -> tuple[str, float]:
    """Momentum burst detection from RSI + MACD histogram."""
    df = parse_candles(candle_data[-60:])  # Last 60 candles for momentum
    if len(df) < 26:
        return "no_burst", 0.0

    rsi = calculate_rsi(df["close"], 14)
    tr = df["high"] - df["low"]
    atr_val = tr.rolling(14).mean().iloc[-1]
    recent_change = abs(float(df["close"].iloc[-1]) - float(df["close"].iloc[-5])) if len(df) >= 5 else 0

    # Momentum burst if recent move > 1.5x ATR and RSI is extreme
    if recent_change > 1.5 * atr_val:
        if rsi > 70:
            return "bearish_burst", min((recent_change / atr_val - 1.5) * 50, 100)
        elif rsi < 30:
            return "bullish_burst", min((recent_change / atr_val - 1.5) * 50, 100)

    return "no_burst", 0.0


def _calculate_gap_analysis(daily_candles: list[list]) -> tuple[Optional[float], Optional[float], str]:
    """Gap analysis from daily candles."""
    if len(daily_candles) < 2:
        return None, None, "no_data"

    df = parse_candles(daily_candles[-2:])
    if len(df) < 2:
        return None, None, "no_data"

    prev_close = float(df.iloc[0]["close"])
    today_open = float(df.iloc[1]["open"])

    gap_pct = (today_open - prev_close) / prev_close * 100 if prev_close > 0 else 0

    if gap_pct > 0.3:
        return gap_pct, None, "gap_up"
    elif gap_pct < -0.3:
        return None, abs(gap_pct), "gap_down"
    else:
        return None, None, "no_gap"


def _calculate_day_phase(current_time: datetime) -> str:
    """Determine current market day phase based on IST time."""
    t = current_time.time()
    if t < time(9, 0):
        return "pre_market"
    elif t < time(9, 15):
        return "opening_auction"
    elif t < time(10, 30):
        return "morning_trend"
    elif t < time(13, 0):
        return "midday"
    elif t < time(15, 0):
        return "afternoon_trend"
    elif t < time(15, 30):
        return "close_auction"
    else:
        return "after_hours"


def _calculate_swing_pivots(intraday_df: pd.DataFrame, lookback: int = 20) -> dict:
    """Approximate swing pivots from intraday candles."""
    if len(intraday_df) < lookback:
        return {"swing_high": None, "swing_low": None, "pivot_r": None, "pivot_s": None}

    df = intraday_df.tail(lookback)
    swing_high = float(df["high"].max())
    swing_low = float(df["low"].min())
    pivot_r = (swing_high + swing_low) / 2 + (swing_high - swing_low)
    pivot_s = (swing_high + swing_low) / 2 - (swing_high - swing_low)

    return {"swing_high": swing_high, "swing_low": swing_low, "pivot_r": pivot_r, "pivot_s": pivot_s}


def calculate_derived_metrics(
    intraday_candles: list[list],
    daily_candles: list[list],
    spot_price: float,
) -> DerivedMetricsResult:
    """Calculate all derived metrics from available candle data."""

    now = datetime.now(timezone.utc)
    intraday_df = parse_candles(intraday_candles)
    daily_df = parse_candles(daily_candles)

    # CPR
    pivot, bc, tc, _, cpr_width = _calculate_cpr(daily_df)
    if pivot:
        if spot_price > tc:
            cpr_status = "above_cpr"
        elif spot_price < bc:
            cpr_status = "below_cpr"
        else:
            cpr_status = "pivot_range"
    else:
        cpr_status = "unknown"

    # Opening Range
    or_status, or_high, or_low = _calculate_opening_range(intraday_df)

    # VWAP
    if len(intraday_df) > 0:
        vwap = calculate_vwap(intraday_df["high"], intraday_df["low"], intraday_df["close"], intraday_df["volume"])
        true_vwap = vwap.value
    else:
        true_vwap = spot_price

    if spot_price > true_vwap:
        vwap_status = "above_vwap"
        vwap_context = "bullish"
    elif spot_price < true_vwap:
        vwap_status = "below_vwap"
        vwap_context = "bearish"
    else:
        vwap_status = "at_vwap"
        vwap_context = "neutral"

    # Intraday Levels
    levels = _calculate_intraday_levels(daily_df)

    # Momentum Burst
    momentum_type, momentum_strength = _calculate_momentum_burst(intraday_candles)

    # Gap Analysis
    gap_up, gap_down, gap_status = _calculate_gap_analysis(daily_candles)

    # Day Phase
    day_phase = _calculate_day_phase(now)

    # Volume Profile (from intraday candles - approximate POC as VWAP area)
    vol_profile_high = float(intraday_df["high"].max()) if len(intraday_df) > 0 else None
    vol_profile_low = float(intraday_df["low"].min()) if len(intraday_df) > 0 else None
    volume_poc = true_vwap  # Approximation: POC near VWAP

    # Swing Pivots
    swing = _calculate_swing_pivots(intraday_df, 20)

    # Swing Bias
    if spot_price > true_vwap and spot_price > float(swing.get("swing_high") or 0):
        swing_bias = "bullish"
    elif spot_price < true_vwap and spot_price < float(swing.get("swing_low") or float("inf")):
        swing_bias = "bearish"
    else:
        swing_bias = "neutral"

    return DerivedMetricsResult(
        timestamp=now.isoformat(),
        spot_price=spot_price,
        cpr_status=cpr_status,
        cpr_width=cpr_width,
        pivot=pivot,
        bc=bc,
        tc=tc,
        opening_range_status=or_status,
        opening_range_high=or_high,
        opening_range_low=or_low,
        vwap_status=vwap_status,
        vwap_context=vwap_context,
        true_vwap=true_vwap,
        intraday_r3=levels["r3"],
        intraday_r2=levels["r2"],
        intraday_r1=levels["r1"],
        intraday_s1=levels["s1"],
        intraday_s2=levels["s2"],
        intraday_s3=levels["s3"],
        momentum_burst=momentum_type,
        momentum_burst_strength=momentum_strength,
        gap_up_percent=gap_up,
        gap_down_percent=gap_down,
        gap_status=gap_status,
        day_phase=day_phase,
        volume_profile_high=vol_profile_high,
        volume_profile_low=vol_profile_low,
        volume_poc=volume_poc,
        swing_high=swing["swing_high"],
        swing_low=swing["swing_low"],
        swing_pivot_r=swing["pivot_r"],
        swing_pivot_s=swing["pivot_s"],
        swing_bias=swing_bias,
    )
