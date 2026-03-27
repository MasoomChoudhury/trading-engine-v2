"""
Technical indicator calculator for Nifty 50.
All indicators implemented in pure Python using NumPy/Pandas.
No TA-Lib dependency.
"""

from __future__ import annotations
import math
import numpy as np
import pandas as pd
from typing import TypedDict, Optional
from dataclasses import dataclass, field, asdict


# ─── Data Structures ──────────────────────────────────────────────────────────

@dataclass
class Candle:
    timestamp: pd.Timestamp
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    oi: float = 0.0


@dataclass
class RSIResult:
    value: float


@dataclass
class EMAResult:
    ema_20: float
    ema_21: float
    ema_50: float


@dataclass
class SMAResult:
    sma_200: float


@dataclass
class MACDResult:
    macd_line: float
    signal_line: float
    histogram: float


@dataclass
class BollingerResult:
    upper: float
    middle: float
    lower: float
    bandwidth: float


@dataclass
class SupertrendResult:
    value: float
    direction: str  # 'bullish' or 'bearish'


@dataclass
class StochRSIResult:
    value: float


@dataclass
class ADXResult:
    adx: float
    plus_di: float
    minus_di: float


@dataclass
class ATRResult:
    value: float


@dataclass
class VWAPResult:
    value: float


@dataclass
class AllIndicators:
    rsi: RSIResult
    ema: EMAResult
    sma: SMAResult
    macd: MACDResult
    bollinger: BollingerResult
    supertrend: SupertrendResult
    stoch_rsi: StochRSIResult
    adx: ADXResult
    atr: ATRResult
    vwap: VWAPResult

    def to_dict(self) -> dict:
        return {
            "rsi": {"value": self.rsi.value},
            "ema": {"ema_20": self.ema.ema_20, "ema_21": self.ema.ema_21, "ema_50": self.ema.ema_50},
            "sma_200": {"value": self.sma.sma_200},
            "macd": {
                "macd_line": self.macd.macd_line,
                "signal_line": self.macd.signal_line,
                "histogram": self.macd.histogram,
            },
            "bollinger": {
                "upper": self.bollinger.upper,
                "middle": self.bollinger.middle,
                "lower": self.bollinger.lower,
                "bandwidth": self.bollinger.bandwidth,
            },
            "supertrend": {"value": self.supertrend.value, "direction": self.supertrend.direction},
            "stoch_rsi": {"value": self.stoch_rsi.value},
            "adx": {"adx": self.adx.adx, "plus_di": self.adx.plus_di, "minus_di": self.adx.minus_di},
            "atr": {"value": self.atr.value},
            "vwap": {"value": self.vwap.value},
        }


# ─── Helper Functions ────────────────────────────────────────────────────────

def parse_candles(candle_data: list[list]) -> pd.DataFrame:
    """Parse raw Upstox candle data into a pandas DataFrame."""
    df = pd.DataFrame(candle_data, columns=["timestamp", "open", "high", "low", "close", "volume", "oi"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    for col in ["open", "high", "low", "close", "volume", "oi"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
    df["volume"] = df["volume"].fillna(0)
    df["oi"] = df["oi"].fillna(0)
    return df


def ema(series: pd.Series, n: int) -> pd.Series:
    """Calculate Exponential Moving Average."""
    return series.ewm(span=n, adjust=False).mean()


def sma(series: pd.Series, n: int) -> pd.Series:
    """Calculate Simple Moving Average."""
    return series.rolling(window=n).mean()


# ─── Individual Indicators ─────────────────────────────────────────────────────

def calculate_rsi(prices: pd.Series, period: int = 14) -> float:
    """Relative Strength Index."""
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1]) if not rsi.isna().iloc[-1] else 50.0


def calculate_ema(prices: pd.Series) -> EMAResult:
    """EMA for 20, 21, 50 periods."""
    ema_20 = float(ema(prices, 20).iloc[-1]) if len(prices) >= 20 else 0.0
    ema_21 = float(ema(prices, 21).iloc[-1]) if len(prices) >= 21 else 0.0
    ema_50 = float(ema(prices, 50).iloc[-1]) if len(prices) >= 50 else 0.0
    return EMAResult(ema_20=ema_20, ema_21=ema_21, ema_50=ema_50)


def calculate_sma_200(prices: pd.Series) -> SMAResult:
    """Simple Moving Average for 200 periods."""
    sma_val = float(sma(prices, 200).iloc[-1]) if len(prices) >= 200 else 0.0
    return SMAResult(sma_200=sma_val)


def calculate_macd(prices: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> MACDResult:
    """MACD (12, 26, 9)."""
    ema_fast = ema(prices, fast)
    ema_slow = ema(prices, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return MACDResult(
        macd_line=float(macd_line.iloc[-1]),
        signal_line=float(signal_line.iloc[-1]),
        histogram=float(histogram.iloc[-1]),
    )


def calculate_bollinger(prices: pd.Series, period: int = 20, std_dev: float = 2.0) -> BollingerResult:
    """Bollinger Bands (20, 2.0)."""
    middle = sma(prices, period)
    std = prices.rolling(window=period).std()
    upper = middle + (std_dev * std)
    lower = middle - (std_dev * std)
    bandwidth = (upper - lower) / middle
    return BollingerResult(
        upper=float(upper.iloc[-1]),
        middle=float(middle.iloc[-1]),
        lower=float(lower.iloc[-1]),
        bandwidth=float(bandwidth.iloc[-1]),
    )


def calculate_supertrend(
    high: pd.Series, low: pd.Series, close: pd.Series, period: int = 7, multiplier: float = 3.0
) -> SupertrendResult:
    """Supertrend (7, 3.0)."""
    tr = calculate_true_range(high, low, close)
    atr = tr.rolling(window=period).mean()

    hl2 = (high + low) / 2
    upper_band = hl2 + (multiplier * atr)
    lower_band = hl2 - (multiplier * atr)

    direction = [1]  # 1 = bullish, -1 = bearish
    st_values = [close.iloc[0]]

    for i in range(1, len(close)):
        curr_close = close.iloc[i]
        prev_st = st_values[-1]
        prev_dir = direction[-1]

        if curr_close > upper_band.iloc[i]:
            direction.append(1)
        elif curr_close < lower_band.iloc[i]:
            direction.append(-1)
        else:
            direction.append(prev_dir)

        if direction[-1] == 1:
            st_values.append(lower_band.iloc[i])
        else:
            st_values.append(upper_band.iloc[i])

    final_dir = "bullish" if direction[-1] == 1 else "bearish"
    return SupertrendResult(value=st_values[-1], direction=final_dir)


def calculate_stoch_rsi(prices: pd.Series, rsi_period: int = 14, stoch_period: int = 14, k: int = 3, d: int = 3) -> StochRSIResult:
    """Stochastic RSI (14, 14, 3, 3)."""
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=rsi_period).mean()
    avg_loss = loss.rolling(window=rsi_period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    min_rsi = rsi.rolling(window=stoch_period).min()
    max_rsi = rsi.rolling(window=stoch_period).max()

    stoch_rsi = 100 * (rsi - min_rsi) / (max_rsi - min_rsi)
    # Smooth with SMA of %K
    k_smooth = stoch_rsi.rolling(window=k).mean()
    # %D = SMA of %K
    d_smooth = k_smooth.rolling(window=d).mean()

    return StochRSIResult(value=float(d_smooth.iloc[-1]) if not pd.isna(d_smooth.iloc[-1]) else 50.0)


def calculate_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> ADXResult:
    """Average Directional Index (14)."""
    tr = calculate_true_range(high, low, close)
    atr = tr.rolling(window=period).mean()

    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)

    plus_di = 100 * (plus_dm.rolling(window=period).mean() / atr)
    minus_di = 100 * (minus_dm.rolling(window=period).mean() / atr)

    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    adx = dx.rolling(window=period).mean()

    return ADXResult(
        adx=float(adx.iloc[-1]) if not pd.isna(adx.iloc[-1]) else 0.0,
        plus_di=float(plus_di.iloc[-1]) if not pd.isna(plus_di.iloc[-1]) else 0.0,
        minus_di=float(minus_di.iloc[-1]) if not pd.isna(minus_di.iloc[-1]) else 0.0,
    )


def calculate_true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """True Range for ATR."""
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    return pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)


def calculate_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> ATRResult:
    """Average True Range (14)."""
    tr = calculate_true_range(high, low, close)
    atr = tr.rolling(window=period).mean()
    return ATRResult(value=float(atr.iloc[-1]) if not atr.isna().iloc[-1] else 0.0)


def calculate_vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> VWAPResult:
    """Volume Weighted Average Price (intraday)."""
    tp = (high + low + close) / 3
    cum_vol = volume.cumsum()
    cum_tp_vol = (tp * volume).cumsum()
    vwap = cum_tp_vol / cum_vol
    return VWAPResult(value=float(vwap.iloc[-1]))


# ─── Main Orchestrator ───────────────────────────────────────────────────────

def calculate_all_indicators(candle_data: list[list]) -> AllIndicators:
    """Calculate all technical indicators from raw candle data."""
    if not candle_data or len(candle_data) < 2:
        raise ValueError("Need at least 2 candles to calculate indicators")

    df = parse_candles(candle_data)
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    return AllIndicators(
        rsi=RSIResult(value=calculate_rsi(close, 14)),
        ema=calculate_ema(close),
        sma=calculate_sma_200(close),
        macd=calculate_macd(close),
        bollinger=calculate_bollinger(close),
        supertrend=calculate_supertrend(high, low, close),
        stoch_rsi=calculate_stoch_rsi(close),
        adx=calculate_adx(high, low, close),
        atr=calculate_atr(high, low, close),
        vwap=calculate_vwap(high, low, close, volume),
    )


def calculate_indicator_series(candle_data: list[list]) -> list[dict]:
    """Compute per-candle indicator values across the full series."""
    if not candle_data or len(candle_data) < 2:
        return []

    df = parse_candles(candle_data)
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]
    n = len(df)

    def sf(val, d=2):
        """Safe float: round and return None for NaN/Inf."""
        try:
            f = float(val)
            return None if (math.isnan(f) or math.isinf(f)) else round(f, d)
        except (TypeError, ValueError):
            return None

    # ── RSI 14 ─────────────────────────────────────────────────────────────────
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    rsi_s = 100 - (100 / (1 + gain.rolling(14).mean() / loss.rolling(14).mean()))

    # ── EMAs & SMA ──────────────────────────────────────────────────────────────
    ema20_s = ema(close, 20)
    ema21_s = ema(close, 21)
    ema50_s = ema(close, 50)
    sma200_s = sma(close, 200)

    # ── MACD (12, 26, 9) ───────────────────────────────────────────────────────
    macd_line_s = ema(close, 12) - ema(close, 26)
    macd_sig_s = ema(macd_line_s, 9)
    macd_hist_s = macd_line_s - macd_sig_s

    # ── Bollinger Bands (20, 2) ─────────────────────────────────────────────────
    bb_mid_s = sma(close, 20)
    bb_std_s = close.rolling(20).std()
    bb_up_s = bb_mid_s + 2.0 * bb_std_s
    bb_lo_s = bb_mid_s - 2.0 * bb_std_s
    bb_bw_s = (bb_up_s - bb_lo_s) / bb_mid_s

    # ── Supertrend (7, 3) ───────────────────────────────────────────────────────
    tr = calculate_true_range(high, low, close)
    atr_st = tr.rolling(7).mean()
    hl2 = (high + low) / 2
    st_up = hl2 + 3.0 * atr_st
    st_lo = hl2 - 3.0 * atr_st
    st_vals = [float(close.iloc[0])]
    st_dirs = [1]
    for i in range(1, n):
        curr = close.iloc[i]
        if curr > st_up.iloc[i]:
            st_dirs.append(1)
        elif curr < st_lo.iloc[i]:
            st_dirs.append(-1)
        else:
            st_dirs.append(st_dirs[-1])
        st_vals.append(st_lo.iloc[i] if st_dirs[-1] == 1 else st_up.iloc[i])
    st_val_s = pd.Series(st_vals, index=df.index)
    st_dir_s = pd.Series(["bullish" if d == 1 else "bearish" for d in st_dirs], index=df.index)

    # ── Stochastic RSI (14, 14, 3, 3) ──────────────────────────────────────────
    stoch_rsi_raw = 100 - (100 / (1 + gain.rolling(14).mean() / loss.rolling(14).mean()))
    stoch_min = stoch_rsi_raw.rolling(14).min()
    stoch_max = stoch_rsi_raw.rolling(14).max()
    stoch_pct = 100 * (stoch_rsi_raw - stoch_min) / (stoch_max - stoch_min)
    stoch_k_s = stoch_pct.rolling(3).mean()
    stoch_d_s = stoch_k_s.rolling(3).mean()

    # ── ADX (+DI, -DI, ADX 14) ─────────────────────────────────────────────────
    atr14_s = tr.rolling(14).mean()
    pdm = high.diff().where((high.diff() > -low.diff()) & (high.diff() > 0), 0.0)
    ndm = (-low.diff()).where((-low.diff() > high.diff()) & (-low.diff() > 0), 0.0)
    plus_di_s = 100 * (pdm.rolling(14).mean() / atr14_s)
    minus_di_s = 100 * (ndm.rolling(14).mean() / atr14_s)
    dx_s = 100 * abs(plus_di_s - minus_di_s) / (plus_di_s + minus_di_s)
    adx_s = dx_s.rolling(14).mean()

    # ── ATR 14 ─────────────────────────────────────────────────────────────────
    atr_s = atr14_s

    # ── VWAP (cumulative intraday) ──────────────────────────────────────────────
    tp = (high + low + close) / 3
    cum_vol = volume.cumsum()
    vwap_s = (tp * volume).cumsum() / cum_vol

    # ── Assemble rows ───────────────────────────────────────────────────────────
    result = []
    for i in range(n):
        vol_val = df["volume"].iloc[i]
        result.append({
            "timestamp": df["timestamp"].iloc[i].isoformat(),
            "open":  sf(df["open"].iloc[i]),
            "high":  sf(df["high"].iloc[i]),
            "low":   sf(df["low"].iloc[i]),
            "close": sf(df["close"].iloc[i]),
            "volume": int(vol_val) if not math.isnan(float(vol_val)) else 0,
            "rsi_14":        sf(rsi_s.iloc[i]),
            "ema_20":        sf(ema20_s.iloc[i]),
            "ema_21":        sf(ema21_s.iloc[i]),
            "ema_50":        sf(ema50_s.iloc[i]),
            "sma_200":       sf(sma200_s.iloc[i]),
            "macd_line":     sf(macd_line_s.iloc[i], 4),
            "macd_signal":   sf(macd_sig_s.iloc[i], 4),
            "macd_hist":     sf(macd_hist_s.iloc[i], 4),
            "bb_upper":      sf(bb_up_s.iloc[i]),
            "bb_middle":     sf(bb_mid_s.iloc[i]),
            "bb_lower":      sf(bb_lo_s.iloc[i]),
            "bb_bandwidth":  sf(bb_bw_s.iloc[i], 4),
            "supertrend":    sf(st_val_s.iloc[i]),
            "supertrend_dir": st_dir_s.iloc[i],
            "stoch_k":       sf(stoch_k_s.iloc[i]),
            "stoch_d":       sf(stoch_d_s.iloc[i]),
            "adx":           sf(adx_s.iloc[i]),
            "plus_di":       sf(plus_di_s.iloc[i]),
            "minus_di":      sf(minus_di_s.iloc[i]),
            "atr_14":        sf(atr_s.iloc[i]),
            "vwap":          sf(vwap_s.iloc[i]),
        })
    return result
