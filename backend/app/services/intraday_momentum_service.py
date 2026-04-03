"""
Intraday Momentum Proxies — surviving without Level 2 data.

Three proxy signals for the option buyer:
1. Volume-Weighted RSI + MACD  — confirms whether a price move has actual
   volume participation (filters noise; unconfirmed breakouts = potential traps)
2. ATM Straddle Premium Decay  — tracks CE+PE straddle price intraday; if Nifty
   trends up but straddle drops, IV crush is killing your calls
3. Monthly vs Weekly PCR Divergence — if weekly PCR is bullish but monthly is
   bearish, you are trading a short-term counter-trend bounce; size tight
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone, date as date_type
from typing import Any
import pandas as pd
import numpy as np
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def _ist_now() -> datetime:
    return datetime.now(IST)


def _ist_today() -> str:
    return _ist_now().strftime("%Y-%m-%d")


# ── 1. Volume-Weighted RSI + MACD ─────────────────────────────────────────────

def _compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Standard price-only RSI (fallback when volume is unavailable)."""
    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean().replace(0, 1e-9)
    rs = avg_gain / avg_loss
    return (100 - (100 / (1 + rs))).round(2)


def _compute_vrsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """
    Volume-weighted RSI.
    Each bar's gain/loss is scaled by its volume relative to a rolling average.
    High-volume price moves register strongly; low-volume moves (noise) are muted.
    Falls back to standard RSI if all volumes are zero (e.g., index instruments).
    """
    if df["volume"].max() == 0:  # noqa: SIM108
        return _compute_rsi(df, period)

    delta = df["close"].diff()
    vol_mean = df["volume"].rolling(period).mean().replace(0, 1)
    vol_factor = (df["volume"] / vol_mean).clip(upper=3.0)  # cap at 3× to avoid outlier spikes

    gain = delta.clip(lower=0) * vol_factor
    loss = (-delta).clip(lower=0) * vol_factor

    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean().replace(0, 1e-9)

    rs = avg_gain / avg_loss
    return (100 - (100 / (1 + rs))).round(2)


def _compute_vwmacd(
    df: pd.DataFrame,
    vwap_window: int = 20,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    MACD applied to rolling VWAP instead of raw close price.
    Rolling VWAP = sum(close × volume, n) / sum(volume, n)
    This means price-EMAs respond to where price traded with volume, not just
    the last print — giving a cleaner momentum reading.
    """
    # If all volumes are zero (index instruments like NIFTY_50), use close price directly
    if df["volume"].max() == 0:
        vwap = df["close"]
    else:
        pv = df["close"] * df["volume"]
        rolling_vol = df["volume"].rolling(vwap_window).sum().replace(0, 1e-9)
        vwap = (pv.rolling(vwap_window).sum() / rolling_vol)

    ema_fast = vwap.ewm(span=fast, adjust=False).mean()
    ema_slow = vwap.ewm(span=slow, adjust=False).mean()
    macd_line = (ema_fast - ema_slow).round(4)
    signal_line = macd_line.ewm(span=signal, adjust=False).mean().round(4)
    histogram = (macd_line - signal_line).round(4)

    return macd_line, signal_line, histogram


async def get_vol_weighted_indicators(
    interval: str = "5min",
    limit: int = 100,
) -> dict:
    """
    Return last `limit` bars of intraday data with VW-RSI and VW-MACD.
    Reads from TimescaleDB candles table (symbol=NIFTY_50).
    """
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from sqlalchemy import select, desc

    SYMBOL = "NIFTY_50"

    # Fetch extra bars to warm up indicators (we need period + slow + signal heads)
    fetch_limit = limit + 60

    async with get_ts_session() as session:
        stmt = (
            select(
                DBCandle.timestamp, DBCandle.open, DBCandle.high,
                DBCandle.low, DBCandle.close, DBCandle.volume,
            )
            .where(DBCandle.symbol == SYMBOL, DBCandle.interval == interval)
            .order_by(desc(DBCandle.timestamp))
            .limit(fetch_limit)
        )
        rows = (await session.execute(stmt)).all()

    if not rows:
        return {"series": [], "interval": interval, "signal": "no_data"}

    df = pd.DataFrame(rows[::-1], columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0)

    if len(df) < 30:
        return {"series": [], "interval": interval, "signal": "insufficient_data"}

    price_only_mode = bool(df["volume"].max() == 0)  # True for NIFTY_50 index (no volume data)
    vrsi = _compute_vrsi(df)
    vwmacd_line, vwmacd_signal, vwmacd_hist = _compute_vwmacd(df)

    # Trim to last `limit` bars
    df = df.tail(limit).copy()
    vrsi = vrsi.tail(limit)
    vwmacd_line = vwmacd_line.tail(limit)
    vwmacd_signal = vwmacd_signal.tail(limit)
    vwmacd_hist = vwmacd_hist.tail(limit)

    series = []
    for i in range(len(df)):
        ts = df["timestamp"].iloc[i]
        ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        series.append({
            "timestamp": ts_str,
            "close": round(float(df["close"].iloc[i]), 2),
            "volume": int(df["volume"].iloc[i]),
            "vrsi": round(float(vrsi.iloc[i]), 2) if not pd.isna(vrsi.iloc[i]) else None,
            "vwmacd": round(float(vwmacd_line.iloc[i]), 4) if not pd.isna(vwmacd_line.iloc[i]) else None,
            "vwmacd_signal": round(float(vwmacd_signal.iloc[i]), 4) if not pd.isna(vwmacd_signal.iloc[i]) else None,
            "vwmacd_hist": round(float(vwmacd_hist.iloc[i]), 4) if not pd.isna(vwmacd_hist.iloc[i]) else None,
        })

    # Current signal interpretation
    last = series[-1] if series else {}
    vrsi_val = last.get("vrsi")
    hist_val = last.get("vwmacd_hist")
    signal = _interpret_vol_signal(vrsi_val, hist_val)

    return {
        "series": series,
        "interval": interval,
        "current": last,
        "signal": signal,
        "price_only_mode": price_only_mode,
        "price_only_note": (
            "Volume data unavailable for index instruments — showing price-based RSI & MACD (no volume weighting)."
            if price_only_mode else None
        ),
        "timestamp": _ist_now().isoformat(),
    }


def _interpret_vol_signal(vrsi: float | None, hist: float | None) -> str:
    if vrsi is None or hist is None:
        return "no_data"
    if vrsi > 65 and hist > 0:
        return "bullish_confirmed"    # Momentum + volume participation
    if vrsi > 65 and hist <= 0:
        return "bullish_unconfirmed"  # Price up but MACD lagging — potential trap
    if vrsi < 35 and hist < 0:
        return "bearish_confirmed"
    if vrsi < 35 and hist >= 0:
        return "bearish_unconfirmed"
    if 35 <= vrsi <= 55:
        return "neutral"
    return "mixed"


# ── 2. ATM Straddle Premium Decay ─────────────────────────────────────────────

async def save_straddle_snapshot() -> None:
    """
    Fetch live ATM straddle from Upstox option chain and persist to DB.
    Called by the 5-minute scheduler during market hours.
    """
    from app.services.options_service import get_active_expiries, days_to_expiry
    from app.services.upstox_client import upstox_client
    from app.db.database import get_ts_session
    from app.db.models import StraddleSnapshot
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    try:
        expiries = await get_active_expiries()
        if not expiries:
            return

        near = expiries[0]
        dte = days_to_expiry(near)
        expiry = expiries[1] if dte <= 3 and len(expiries) > 1 else near

        raw_chain = await upstox_client.get_option_chain("NSE_INDEX|Nifty 50", expiry)
        if isinstance(raw_chain, dict):
            raw_chain = raw_chain.get("data", [])
        if not raw_chain:
            return

        spot = 0.0
        for item in raw_chain:
            sp = float(item.get("underlying_spot_price") or 0)
            if sp > 0:
                spot = sp
                break

        atm = round(spot / 50) * 50
        atm_item = next((i for i in raw_chain if float(i.get("strike_price") or 0) == atm), None)
        if not atm_item:
            return

        ce_md = (atm_item.get("call_options") or {}).get("market_data") or {}
        pe_md = (atm_item.get("put_options") or {}).get("market_data") or {}
        ce_g  = (atm_item.get("call_options") or {}).get("option_greeks") or {}
        pe_g  = (atm_item.get("put_options") or {}).get("option_greeks") or {}

        ce_ltp = float(ce_md.get("ltp") or 0)
        pe_ltp = float(pe_md.get("ltp") or 0)
        straddle = round(ce_ltp + pe_ltp, 2)
        ce_iv = float(ce_g.get("iv") or 0) or None
        pe_iv = float(pe_g.get("iv") or 0) or None
        atm_iv = round((ce_iv + pe_iv) / 2, 2) if ce_iv and pe_iv else (ce_iv or pe_iv)

        async with get_ts_session() as session:
            ins = pg_insert(StraddleSnapshot).values(
                timestamp=_ist_now(),
                expiry=expiry,
                spot=round(spot, 2),
                atm_strike=atm,
                ce_ltp=round(ce_ltp, 2),
                pe_ltp=round(pe_ltp, 2),
                straddle_price=straddle,
                ce_iv=ce_iv,
                pe_iv=pe_iv,
                atm_iv=atm_iv,
            ).on_conflict_do_update(
                index_elements=["timestamp"],
                set_={"straddle_price": straddle, "spot": round(spot, 2)},
            )
            await session.execute(ins)
            await session.commit()

        logger.debug(f"Straddle snapshot saved: spot={spot:.0f} atm={atm} straddle={straddle}")

    except Exception as e:
        logger.warning(f"Straddle snapshot failed: {e}")


async def ensure_straddle_table() -> None:
    """Create straddle_snapshots table if it doesn't exist."""
    from app.db.database import get_ts_session
    from sqlalchemy import text
    async with get_ts_session() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS straddle_snapshots (
                timestamp   TIMESTAMPTZ PRIMARY KEY,
                expiry      TEXT        NOT NULL,
                spot        NUMERIC,
                atm_strike  NUMERIC,
                ce_ltp      NUMERIC,
                pe_ltp      NUMERIC,
                straddle_price NUMERIC,
                ce_iv       NUMERIC,
                pe_iv       NUMERIC,
                atm_iv      NUMERIC
            )
        """))
        await session.commit()
    logger.info("straddle_snapshots table ensured")


async def get_straddle_intraday() -> dict:
    """
    Return today's intraday straddle snapshots for the Premium Decay chart.
    If straddle falls while spot rises → IV crush → call buyers losing ground.
    """
    from app.db.database import get_ts_session
    from app.db.models import StraddleSnapshot
    from sqlalchemy import select

    today_start = _ist_now().replace(hour=0, minute=0, second=0, microsecond=0)

    async with get_ts_session() as session:
        stmt = (
            select(StraddleSnapshot)
            .where(StraddleSnapshot.timestamp >= today_start)
            .order_by(StraddleSnapshot.timestamp)
        )
        rows = (await session.execute(stmt)).scalars().all()

    snapshots = []
    for r in rows:
        snapshots.append({
            "timestamp": r.timestamp.isoformat(),
            "spot": float(r.spot) if r.spot else None,
            "atm_strike": float(r.atm_strike) if r.atm_strike else None,
            "ce_ltp": float(r.ce_ltp) if r.ce_ltp else None,
            "pe_ltp": float(r.pe_ltp) if r.pe_ltp else None,
            "straddle_price": float(r.straddle_price) if r.straddle_price else None,
            "atm_iv": float(r.atm_iv) if r.atm_iv else None,
        })

    # Divergence signal: if last 3 spots all went up but straddle went down
    decay_signal = "no_data"
    if len(snapshots) >= 3:
        recent = snapshots[-3:]
        spot_change = (recent[-1]["spot"] or 0) - (recent[0]["spot"] or 0)
        str_change = (recent[-1]["straddle_price"] or 0) - (recent[0]["straddle_price"] or 0)
        if spot_change > 20 and str_change < -5:
            decay_signal = "iv_crush_warning"   # Spot up, straddle down → IV crush
        elif spot_change < -20 and str_change < -5:
            decay_signal = "iv_crush_warning"   # Spot down, straddle down too
        elif abs(spot_change) < 10 and str_change > 5:
            decay_signal = "iv_expansion"       # Spot flat but straddle expanding → fear
        else:
            decay_signal = "normal"

    return {
        "snapshots": snapshots,
        "count": len(snapshots),
        "decay_signal": decay_signal,
        "note": (
            "IV crush detected: Nifty moved but straddle price fell. Your option premium is "
            "being crushed by IV collapse — correct direction is not enough." if decay_signal == "iv_crush_warning"
            else "Straddle price expanding — IV rising, option buyers have tailwind." if decay_signal == "iv_expansion"
            else "Accumulating intraday snapshots. Check back during market hours." if not snapshots
            else "Normal straddle behaviour."
        ),
        "timestamp": _ist_now().isoformat(),
    }


# ── 3. Monthly vs Weekly PCR Divergence ───────────────────────────────────────

async def get_pcr_divergence() -> dict:
    """
    Compare PCR OI of near (weekly) expiry vs further (monthly) expiry.

    If weekly PCR > 1.0 (put-heavy = market expects bounce/support) but
    monthly PCR < 0.8 (call-heavy = longer-term bearish), you are trading
    a short-term counter-trend bounce in a bearish market structure.
    Hold time matters: size small, take profits fast.
    """
    from app.services.options_service import get_active_expiries, fetch_chain, parse_chain

    expiries = await get_active_expiries()
    if len(expiries) < 2:
        return {"error": "Need at least 2 active expiries"}

    near_expiry = expiries[0]

    # Monthly expiry: pick the one 3-5 weeks out; fallback to last available
    monthly_expiry = None
    for e in expiries[1:]:
        expiry_date = datetime.strptime(e, "%Y-%m-%d").date()
        days_out = (expiry_date - _ist_now().date()).days
        if days_out >= 21:
            monthly_expiry = e
            break
    if not monthly_expiry:
        monthly_expiry = expiries[-1]

    # Fetch both chains concurrently
    import asyncio
    near_chain_raw, monthly_chain_raw = await asyncio.gather(
        fetch_chain(near_expiry),
        fetch_chain(monthly_expiry),
    )

    def _chain_pcr(raw_chain: list) -> dict:
        records = parse_chain(raw_chain)
        total_ce = sum(r["ce_oi"] for r in records)
        total_pe = sum(r["pe_oi"] for r in records)
        total_ce_vol = sum(r["ce_volume"] for r in records)
        total_pe_vol = sum(r["pe_volume"] for r in records)
        pcr_oi = round(total_pe / total_ce, 3) if total_ce else 0.0
        pcr_vol = round(total_pe_vol / total_ce_vol, 3) if total_ce_vol else 0.0
        spot = next((float(r["spot"]) for r in records if r["spot"] > 0), 0.0)
        return {"pcr_oi": pcr_oi, "pcr_vol": pcr_vol, "total_ce_oi": total_ce, "total_pe_oi": total_pe, "spot": spot}

    near_data = _chain_pcr(near_chain_raw)
    monthly_data = _chain_pcr(monthly_chain_raw)

    near_pcr = near_data["pcr_oi"]
    monthly_pcr = monthly_data["pcr_oi"]

    # Divergence classification
    near_bias = _pcr_bias(near_pcr)
    monthly_bias = _pcr_bias(monthly_pcr)
    divergence = near_bias != monthly_bias

    if near_bias == "bullish" and monthly_bias == "bearish":
        signal = "counter_trend_bounce"
        note = (
            f"Weekly PCR {near_pcr:.2f} (put-heavy = short-term support) but "
            f"monthly PCR {monthly_pcr:.2f} (call-heavy = longer-term bears in control). "
            "You may be buying a short-term bounce in a bear market. "
            "Reduce hold time, take profits early."
        )
    elif near_bias == "bearish" and monthly_bias == "bullish":
        signal = "short_term_pullback"
        note = (
            f"Weekly PCR {near_pcr:.2f} (call-heavy = short-term bearish pressure) but "
            f"monthly PCR {monthly_pcr:.2f} (put-heavy = longer-term bulls). "
            "Short-term dip within a longer bullish structure. Buying puts = fading the trend."
        )
    elif near_bias == "bullish" and monthly_bias == "bullish":
        signal = "aligned_bullish"
        note = f"Weekly ({near_pcr:.2f}) and monthly ({monthly_pcr:.2f}) both put-heavy. Broader bullish structure supports call buying."
    elif near_bias == "bearish" and monthly_bias == "bearish":
        signal = "aligned_bearish"
        note = f"Weekly ({near_pcr:.2f}) and monthly ({monthly_pcr:.2f}) both call-heavy. Bears have broad control — caution on call buying."
    else:
        signal = "neutral"
        note = f"Weekly PCR {near_pcr:.2f}, monthly PCR {monthly_pcr:.2f}. No strong divergence signal."

    return {
        "near_expiry": near_expiry,
        "monthly_expiry": monthly_expiry,
        "near_pcr_oi": near_pcr,
        "near_pcr_vol": near_data["pcr_vol"],
        "near_bias": near_bias,
        "monthly_pcr_oi": monthly_pcr,
        "monthly_pcr_vol": monthly_data["pcr_vol"],
        "monthly_bias": monthly_bias,
        "divergence": divergence,
        "signal": signal,
        "note": note,
        "timestamp": _ist_now().isoformat(),
    }


def _pcr_bias(pcr: float) -> str:
    if pcr >= 1.0:
        return "bullish"   # Put writers dominate = floor support
    if pcr <= 0.75:
        return "bearish"   # Call writers dominate = ceiling resistance
    return "neutral"
