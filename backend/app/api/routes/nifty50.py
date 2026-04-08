from fastapi import APIRouter, Query
from app.schemas.nifty50 import (
    IndicatorResponse,
    DerivedMetricsResponse,
    GEXResponse,
    CandleResponse,
    LivePriceResponse,
)
from app.services.upstox_client import upstox_client
from app.services.indicator_calculator import calculate_all_indicators, calculate_indicator_series
from app.services.mtf_confluence_service import build_mtf_confluence
from app.services.hv_cone_service import get_hv_cone
from app.services.regime_classifier_service import classify_market_regime
from app.services.gex_calculator import calculate_gex
from app.services.derived_metrics import calculate_derived_metrics
from app.db.database import get_ts_session
from app.db.models import Candle as DBCandle, IndicatorSnapshot, DerivedMetricSnapshot, GexSnapshot
from sqlalchemy import select, desc
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime, timedelta, timezone
from loguru import logger
import pandas as pd

router = APIRouter(prefix="/api/v1/nifty50", tags=["Nifty50"])

NIFTY_KEY = "NSE_INDEX|Nifty 50"
SYMBOL = "NIFTY_50"
IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


def _candles_to_raw(candles: list) -> list[list]:
    """Convert Candle objects to raw list[list] for indicator calculators."""
    return [
        [
            c.timestamp.isoformat() if hasattr(c, "timestamp") else str(c),
            float(c.open),
            float(c.high),
            float(c.low),
            float(c.close),
            float(c.volume),
            float(c.oi),
        ]
        for c in candles
    ]


async def _store_candles(rows: list, interval: str):
    """Upsert a list of raw candle rows into TimescaleDB."""
    if not rows:
        return
    async with get_ts_session() as session:
        for row in rows:
            ts = pd.to_datetime(row[0], utc=True).to_pydatetime()
            stmt = insert(DBCandle).values(
                timestamp=ts,
                symbol=SYMBOL,
                interval=interval,
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=int(row[5]) if len(row) > 5 else 0,
                oi=int(row[6]) if len(row) > 6 else 0,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["timestamp", "symbol", "interval"],
                set_={
                    "open": stmt.excluded.open,
                    "high": stmt.excluded.high,
                    "low": stmt.excluded.low,
                    "close": stmt.excluded.close,
                    "volume": stmt.excluded.volume,
                    "oi": stmt.excluded.oi,
                },
            )
            await session.execute(stmt)
        await session.commit()


async def _fetch_candles(interval: str, days_back: int = 5) -> list:
    """Fetch historical + today's intraday candles from Upstox and store in TimescaleDB."""
    to_date = ist_now().strftime("%Y-%m-%d")
    from_date = (ist_now() - timedelta(days=days_back)).strftime("%Y-%m-%d")

    # Historical completed sessions
    historical = await upstox_client.get_historical_candles(NIFTY_KEY, interval, to_date, from_date)
    await _store_candles(historical, interval)

    # Today's intraday candles (live session — not in historical endpoint)
    try:
        intraday = await upstox_client.get_intraday_candles(NIFTY_KEY, interval)
        await _store_candles(intraday, interval)
    except Exception as e:
        logger.warning(f"Intraday candle fetch failed for {interval}: {e}")

    return historical


async def _get_candles_from_db(interval: str, limit: int = 300) -> list:
    """Get raw candle data list[list] from TimescaleDB."""
    async with get_ts_session() as session:
        stmt = (
            select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                   DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
            .where(DBCandle.symbol == SYMBOL, DBCandle.interval == interval)
            .order_by(desc(DBCandle.timestamp))
            .limit(limit)
        )
        result = await session.execute(stmt)
        rows = result.all()
        # Return as [[timestamp, open, high, low, close, volume, oi], ...] in chronological order
        return [[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in rows][::-1]


import math

def _to_json_safe(val):
    """Convert a value to JSON-safe (no NaN, no Inf)."""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _flatten_indicators(d: dict) -> dict:
    """Flatten AllIndicators.to_dict() for the API response."""
    flat = {}
    for key, value in d.items():
        if isinstance(value, dict):
            for sub_key, sub_val in value.items():
                name = f"{key}_{sub_key}" if key != "rsi" else f"rsi_{sub_key}"
                flat[name] = _to_json_safe(sub_val)
        else:
            flat[key] = _to_json_safe(value)
    return flat


@router.get("/indicators", response_model=IndicatorResponse)
async def get_indicators(
    interval: str = Query(default="5min", pattern="^(1min|5min|15min|1hour|1day)$"),
):
    """Get latest technical indicators for Nifty 50."""
    candles = await _get_candles_from_db(interval, limit=300)
    if len(candles) < 50:
        candles = await _fetch_candles(interval, days_back=30)

    spot_price = candles[-1][4] if candles else None

    if not candles or len(candles) < 50:
        return IndicatorResponse(
            timestamp=ist_now().isoformat(),
            symbol=SYMBOL,
            indicators={},
            spot_price=spot_price,
        )

    # Use the service's calculate_all_indicators (takes list[list])
    all_ind = calculate_all_indicators(candles)
    flat = _flatten_indicators(all_ind.to_dict())

    # Rename keys to match what frontend expects
    indicators = {}
    for k, v in flat.items():
        if k.startswith("ema_ema_"):
            # ema dict: ema_ema_20 → ema_20, etc.
            indicators[k.replace("ema_ema_", "ema_")] = v
        elif k.startswith("sma_sma_"):
            indicators[k.replace("sma_sma_", "sma_")] = v
        elif k.startswith("bollinger_"):
            indicators[k] = v  # keep nested
        elif k.startswith("macd_macd_"):
            indicators[k.replace("macd_macd_", "macd_")] = v
        elif k.startswith("macd_signal_"):
            indicators["macd_signal"] = v
        elif k.startswith("macd_histogram_"):
            indicators["macd_histogram"] = v
        elif k.startswith("macd_macd"):
            indicators["macd_line"] = v
        elif k.startswith("supertrend_"):
            if k == "supertrend_direction":
                indicators[k] = v
            else:
                indicators[k] = v
        elif k.startswith("stoch_rsi_"):
            # flat keys: stoch_rsi_k, stoch_rsi_d, stoch_rsi_value → keep as-is
            indicators[k] = v
        elif k.startswith("adx_"):
            indicators[k] = v
        elif k.startswith("atr_"):
            indicators[k] = v
        elif k.startswith("vwap_"):
            indicators[k] = v
        elif k.startswith("rsi_"):
            indicators["rsi_14"] = v
        else:
            indicators[k] = v

    # Ensure consistent keys for frontend — use keys actually set in the loop above
    indicators = {
        "rsi_14":             indicators.get("rsi_14"),
        "ema_20":             indicators.get("ema_20"),
        "ema_21":             indicators.get("ema_21"),
        "ema_50":             indicators.get("ema_50"),
        "sma_200":            indicators.get("sma_200"),
        "macd_line":          indicators.get("macd_line"),
        "macd_signal":        indicators.get("macd_signal"),
        "macd_histogram":     indicators.get("macd_histogram"),
        "bb_upper":           indicators.get("bollinger_upper"),
        "bb_middle":          indicators.get("bollinger_middle"),
        "bb_lower":           indicators.get("bollinger_lower"),
        "supertrend":         indicators.get("supertrend_value"),
        "supertrend_direction": indicators.get("supertrend_direction"),
        # StochRSI: K is smoothed %K, D is signal (SMA of K) — they differ
        "stoch_rsi_k":        indicators.get("stoch_rsi_k"),
        "stoch_rsi_d":        indicators.get("stoch_rsi_d"),
        "adx_14":             indicators.get("adx_adx"),
        "plus_di_14":         indicators.get("adx_plus_di"),
        "minus_di_14":        indicators.get("adx_minus_di"),
        "atr_14":             indicators.get("atr_value"),
        "vwap":               indicators.get("vwap_value"),
    }

    # Use the last candle's timestamp as the actual data time
    last_candle_time = candles[-1][0] if candles else None
    if last_candle_time:
        data_timestamp = last_candle_time.isoformat()
    else:
        data_timestamp = ist_now().isoformat()

    return IndicatorResponse(
        timestamp=data_timestamp,
        symbol=SYMBOL,
        indicators={k: v for k, v in indicators.items() if v is not None},
        spot_price=spot_price,
    )


@router.get("/derived-metrics", response_model=DerivedMetricsResponse)
async def get_derived_metrics(
    interval: str = Query(default="5min", pattern="^(1min|5min|15min|1hour|1day)$"),
):
    """Get all derived metrics for Nifty 50."""
    intraday = await _get_candles_from_db(interval, limit=300)
    daily = await _get_candles_from_db("1day", limit=30)

    spot_price = float(intraday[-1][4]) if intraday else None

    if not spot_price:
        return DerivedMetricsResponse(
            timestamp=ist_now().isoformat(),
            symbol=SYMBOL,
            spot_price=0.0,
            metrics={},
            approximation_note="No candle data available",
        )

    if len(intraday) < 50:
        await _fetch_candles(interval, days_back=30)
        intraday = await _get_candles_from_db(interval, limit=300)

    if len(daily) < 2:
        await _fetch_candles("1day", days_back=30)
        daily = await _get_candles_from_db("1day", limit=30)

    result = calculate_derived_metrics(intraday, daily, spot_price)
    d = result.to_dict()

    return DerivedMetricsResponse(
        timestamp=d.get("timestamp", ist_now().isoformat()),
        symbol=SYMBOL,
        spot_price=spot_price,
        metrics=d,
        approximation_note="Some metrics are approximations — see design spec",
    )


@router.get("/gex", response_model=GEXResponse)
async def get_gex(expiry_date: str | None = Query(default=None)):
    """Get latest GEX data from Upstox option chain."""
    # Build sorted list of upcoming expiries so we can fall through to the next one
    # if a given expiry returns an empty chain (all-zero Greeks = dead chain).
    expiry_candidates: list[str] = []
    if not expiry_date:
        contracts = await upstox_client.get_option_contracts(NIFTY_KEY)
        if contracts:
            today_str = ist_now().strftime("%Y-%m-%d")
            valid_expiries = sorted(
                c.get("expiry", "") for c in contracts
                if c.get("expiry", "") and c.get("expiry", "") >= today_str
            )
            expiry_candidates = valid_expiries or [contracts[0].get("expiry", "")]
        if not expiry_candidates:
            expiry_candidates = [(ist_now() + timedelta(days=7)).strftime("%Y-%m-%d")]
    else:
        expiry_candidates = [expiry_date]

    gex_result = None
    last_error: Exception | None = None
    used_expiry = expiry_candidates[0]

    for candidate in expiry_candidates[:3]:   # try up to 3 expiries before giving up
        try:
            result = await calculate_gex(candidate, lot_size=50)
            # A dead chain (Upstox returning all-zero Greeks) produces total_gex == 0
            # and no meaningful strike data. Fall through to next expiry in that case.
            has_data = result.total_gex > 0 or any(
                (s.get('call_gex', 0) or 0) != 0 or (s.get('put_gex', 0) or 0) != 0
                for s in result.strike_gex
            )
            if has_data:
                gex_result = result
                used_expiry = candidate
                if candidate != expiry_candidates[0]:
                    logger.warning(
                        f"Nifty GEX: {expiry_candidates[0]} returned empty chain "
                        f"(all-zero Greeks) — using {candidate} instead"
                    )
                break
            else:
                logger.warning(f"Nifty GEX: {candidate} returned all-zero Greeks, trying next expiry")
        except Exception as e:
            logger.error(f"GEX calculation failed for expiry {candidate}: {e}")
            last_error = e

    if gex_result is None:
        err_msg = str(last_error) if last_error else "All attempted expiries returned empty chains"
        logger.error(f"Nifty GEX: no usable expiry found — {err_msg}")
        return GEXResponse(
            timestamp=ist_now().isoformat(),
            expiry_date=used_expiry,
            spot_price=0.0,
            total_gex=0.0,
            net_gex=0.0,
            regime="unknown",
            regime_description=f"Error: {err_msg}",
            zero_gamma_level=0.0,
            call_wall=0.0,
            put_wall=0.0,
            pcr=0.0,
            strike_gex=[],
            call_wall_distance=0.0,
            put_wall_distance=0.0,
        )

    spot = gex_result.spot_price
    # Convert StrikeGEX objects to dicts for storage
    strikes = []
    for s in gex_result.strike_gex:
        if isinstance(s, dict):
            strikes.append(s)
        else:
            strikes.append({
                "strike": float(s.strike),
                "call_gex": float(s.call_gamma_exposure),
                "put_gex": float(s.put_gamma_exposure),
                "net_gex": float(s.net_gex),
            })

    return GEXResponse(
        timestamp=gex_result.timestamp,
        expiry_date=gex_result.expiry_date,
        spot_price=spot,
        total_gex=round(gex_result.total_gex, 2),
        net_gex=round(gex_result.net_gex, 2),
        regime=gex_result.regime,
        regime_description=gex_result.regime_description,
        # zero_gamma_level: None when no zero crossing (uniformly negative GEX) — keep as None, not 0
        zero_gamma_level=round(gex_result.zero_gamma_level, 2) if gex_result.zero_gamma_level is not None else None,
        call_wall=round(gex_result.call_wall, 2) if gex_result.call_wall else 0.0,
        put_wall=round(gex_result.put_wall, 2) if gex_result.put_wall else 0.0,
        pcr=round(gex_result.pcr_oi, 4) if gex_result.pcr_oi else 0.0,
        strike_gex=strikes,
        # Distance: positive = wall ABOVE spot, negative = wall BELOW spot
        call_wall_distance=round((gex_result.call_wall - spot) / spot * 100, 2) if gex_result.call_wall and spot else 0.0,
        put_wall_distance=round((gex_result.put_wall - spot) / spot * 100, 2) if gex_result.put_wall and spot else 0.0,
    )


@router.get("/candles")
async def get_candles(
    interval: str = Query(default="5min", pattern="^(1min|5min|15min|1hour|1day)$"),
    limit: int = Query(default=100, ge=1, le=1000),
):
    """Get OHLC candles from TimescaleDB."""
    candles = await _get_candles_from_db(interval, limit=limit)
    return [
        CandleResponse(
            timestamp=pd.to_datetime(row[0], utc=True).isoformat(),
            open=round(float(row[1]), 2),
            high=round(float(row[2]), 2),
            low=round(float(row[3]), 2),
            close=round(float(row[4]), 2),
            volume=int(row[5]) if len(row) > 5 else 0,
            oi=int(row[6]) if len(row) > 6 else 0,
        )
        for row in candles[-limit:]
    ]


@router.get("/indicator-series")
async def get_indicator_series(
    interval: str = Query(default="5min", pattern="^(1min|5min|15min|1hour|1day)$"),
    limit: int = Query(default=100, ge=1, le=500),
):
    """Get per-candle indicator values for the time-series table."""
    fetch_limit = max(limit + 300, 400)
    candles = await _get_candles_from_db(interval, limit=fetch_limit)
    if len(candles) < 50:
        candles = await _fetch_candles(interval, days_back=30)
        candles = await _get_candles_from_db(interval, limit=fetch_limit)

    series = calculate_indicator_series(candles)
    return series[-limit:]


@router.get("/gex-history")
async def get_gex_history(days: int = Query(default=90, ge=7, le=180)):
    """
    Return daily GEX history (one value per day, EOD snapshot) and a
    percentile rank of the current total_gex vs the historical window.
    """
    from sqlalchemy import func as sqlfunc, cast
    from sqlalchemy.types import Date

    cutoff = ist_now() - timedelta(days=days)

    async with get_ts_session() as session:
        # One value per calendar day: last snapshot of day, nearest expiry only
        # Group by IST date and take max(total_gex) (all snapshots same day should agree)
        stmt = (
            select(
                cast(GexSnapshot.timestamp.op("AT TIME ZONE")("Asia/Kolkata"), Date).label("day"),
                sqlfunc.max(GexSnapshot.total_gex).label("total_gex"),
                sqlfunc.max(GexSnapshot.net_gex).label("net_gex"),
                sqlfunc.max(GexSnapshot.spot_price).label("spot_price"),
                sqlfunc.max(GexSnapshot.zero_gamma_level).label("zero_gamma_level"),
            )
            .where(GexSnapshot.timestamp >= cutoff)
            .group_by("day")
            .order_by("day")
        )
        detail_rows = (await session.execute(stmt)).all()

        if not detail_rows:
            return {"history": [], "percentile_rank": None, "days": days, "current_gex": None,
                    "percentile_label": None, "data_points": 0}

    history = []
    gex_values = []
    for row in detail_rows:
        # row: (day:date, total_gex, net_gex, spot_price, zero_gamma_level)
        day_val = row[0]
        date_str = day_val.isoformat() if hasattr(day_val, 'isoformat') else str(day_val)
        total_gex = float(row[1]) if row[1] is not None else None
        if total_gex is not None:
            gex_values.append(total_gex)
        history.append({
            "date": date_str,
            "total_gex": round(total_gex, 2) if total_gex is not None else None,
            "net_gex": round(float(row[2]), 2) if row[2] is not None else None,
            "spot_price": round(float(row[3]), 2) if row[3] is not None else None,
            "zero_gamma_level": round(float(row[4]), 2) if row[4] is not None else None,
        })

    # Percentile rank: what fraction of historical values is <= current
    percentile_rank = None
    current_gex = None
    if history and gex_values:
        current_gex = history[-1]["total_gex"]
        if current_gex is not None and len(gex_values) > 1:
            below = sum(1 for v in gex_values if v <= current_gex)
            percentile_rank = round(below / len(gex_values) * 100, 1)

    # Descriptive label for the percentile
    label = None
    if percentile_rank is not None:
        if percentile_rank <= 10:
            label = "Extreme negative — rare low"
        elif percentile_rank <= 25:
            label = "Low quartile — elevated vol risk"
        elif percentile_rank <= 50:
            label = "Below median — mildly negative"
        elif percentile_rank <= 75:
            label = "Above median — moderate positive"
        elif percentile_rank <= 90:
            label = "High quartile — vol suppressed"
        else:
            label = "Extreme positive — very range-bound"

    return {
        "history": history,
        "current_gex": current_gex,
        "percentile_rank": percentile_rank,
        "percentile_label": label,
        "days": days,
        "data_points": len(history),
    }


@router.get("/depth")
async def get_market_depth():
    """
    Market depth (Level 2) for Nifty 50 index.
    Returns top 5 bid/ask levels with quantities and cumulative totals.
    Derived from Upstox full market quote.
    """
    try:
        quote = await upstox_client.get_full_quote(NIFTY_KEY)
        depth = quote.get("depth") or {}
        bids_raw = depth.get("buy") or []
        asks_raw = depth.get("sell") or []

        def _parse_levels(raw: list) -> list[dict]:
            out = []
            for lvl in raw[:5]:
                price = float(lvl.get("price") or 0)
                qty   = int(lvl.get("quantity") or 0)
                orders = int(lvl.get("orders") or 0)
                if price:
                    out.append({"price": price, "quantity": qty, "orders": orders})
            return out

        bids = _parse_levels(bids_raw)
        asks = _parse_levels(asks_raw)

        total_bid_qty = sum(b["quantity"] for b in bids)
        total_ask_qty = sum(a["quantity"] for a in asks)
        total_qty = total_bid_qty + total_ask_qty

        ltp = float(quote.get("last_price") or 0)
        spread = round(asks[0]["price"] - bids[0]["price"], 2) if bids and asks else None
        spread_pct = round(spread / ltp * 100, 4) if spread and ltp else None

        return {
            "timestamp": ist_now().isoformat(),
            "symbol": SYMBOL,
            "ltp": ltp,
            "bids": bids,
            "asks": asks,
            "total_bid_qty": total_bid_qty,
            "total_ask_qty": total_ask_qty,
            "bid_ask_ratio": round(total_bid_qty / max(total_ask_qty, 1), 3),
            "buy_pressure_pct": round(total_bid_qty / max(total_qty, 1) * 100, 1),
            "spread": spread,
            "spread_pct": spread_pct,
            "note": quote.get("instrument_token") and "live" or "stale",
        }
    except Exception as e:
        logger.error(f"Market depth failed: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/vix")
async def get_india_vix():
    """Get India VIX, regime classification, and HV20 from NSE."""
    from app.services.vix_service import get_india_vix as _get_india_vix
    try:
        return await _get_india_vix()
    except Exception as e:
        logger.error(f"India VIX fetch failed: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/price")
async def get_live_price():
    """Get live LTP from Upstox."""
    quote = await upstox_client.get_ltp_quote(NIFTY_KEY)
    ltp = float(quote.get("last_price", 0.0))
    cp = float(quote.get("cp", 0.0) or 0)
    change = ltp - cp if ltp and cp else 0.0
    change_pct = (change / cp * 100) if cp else 0.0
    ltt = quote.get("ltt", None)

    return LivePriceResponse(
        symbol=SYMBOL,
        ltp=round(ltp, 2),
        change=round(change, 2),
        change_pct=round(change_pct, 2),
        ltt=ltt,
        cp=round(cp, 2) if cp else None,
    )


@router.get("/mtf-confluence")
async def get_mtf_confluence():
    """
    Multi-timeframe confluence score (0–100) synthesising 5min and 1day indicator signals.
    Indicators: RSI, MACD histogram, EMA trend, Supertrend, ADX/DI, Bollinger position.
    - 80–100: HIGH confluence — aligned across both timeframes
    - 60–79:  MODERATE — mostly aligned
    - 40–59:  MIXED — no edge, wait for resolution
    - 0–39:   OPPOSING / INVERSE — counter-trend risk
    """
    from fastapi import HTTPException
    from loguru import logger
    try:
        return await build_mtf_confluence()
    except Exception as e:
        logger.error(f"MTF confluence failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/hv-cone")
async def get_hv_cone_route():
    """
    Historical Volatility Cone — HV at 5d, 10d, 20d, 30d, 60d lookbacks with
    10th/25th/50th/75th/90th percentile bands from the past 252 trading days.
    Overlay with current VIX to see whether IV is cheap or expensive at each horizon.
    """
    from fastapi import HTTPException
    from loguru import logger
    try:
        return await get_hv_cone()
    except Exception as e:
        logger.error(f"HV cone failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/market-regime")
async def get_market_regime():
    """
    Market regime classifier synthesising ADX, Bollinger bandwidth, ATR ratio, and VIX.
    Output: trending_bullish | trending_bearish | breakout_imminent | mean_reverting | choppy
    Each label carries actionable trader guidance.
    """
    from fastapi import HTTPException
    from loguru import logger
    try:
        return await classify_market_regime()
    except Exception as e:
        logger.error(f"Market regime classification failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/cvd")
async def get_cvd_route():
    """
    Cumulative Volume Delta (candle-based approximation).
    Tracks intraday buying vs selling pressure from 1-min OHLCV candles.
    Detects price/CVD divergences (distribution vs accumulation).
    NOTE: Approximation — tick-level data unavailable via Upstox V2.
    """
    from app.services.cvd_service import get_cvd
    try:
        return await get_cvd()
    except Exception as e:
        logger.error(f"CVD failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/gex-velocity")
async def get_gex_velocity_route(
    expiry: str | None = Query(default=None, description="Target expiry YYYY-MM-DD"),
):
    """
    Intraday GEX velocity — how fast is Gamma Exposure building or decaying?
    Reads the last 2 hours of 5-min GEX snapshots and computes rate of change.
    Rising GEX = MM hedging pressure increasing; Falling = hedging flows unwinding.
    """
    from app.services.gex_velocity_service import get_gex_velocity
    try:
        return await get_gex_velocity(target_expiry=expiry)
    except Exception as e:
        logger.error(f"GEX velocity failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/heavyweight-vwap")
async def get_heavyweight_vwap_route():
    """
    Real-time VWAP divergence for Nifty's top 5 heavyweights
    (HDFCBANK, RELIANCE, ICICIBANK, INFY, TCS — ~41% of index).
    Signal valid if ≥3 of 5 trade above VWAP with expanding volume.
    """
    from app.services.heavyweight_vwap_service import get_heavyweight_vwap
    try:
        return await get_heavyweight_vwap()
    except Exception as e:
        logger.error(f"Heavyweight VWAP failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/signal-log")
async def get_signal_log_route(
    limit: int = Query(default=50, description="Max rows to return (newest first)"),
):
    """
    Event-driven signal log. One row per state-change per source.
    Includes CONFLUENCE rows (is_confluence=true) when 3+ sources align.
    Outcome columns (30m, EOD, next_open) filled retroactively by the scheduler.
    """
    from app.services.signal_log_service import get_signal_log
    try:
        return await get_signal_log(limit=limit)
    except Exception as e:
        logger.error(f"Signal log failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/pivots")
async def get_pivot_levels_route():
    """
    Weekly and monthly pivot levels for Nifty 50 (classic CPR + R1/R2/R3 / S1/S2/S3).
    Uses last closed week and last closed month OHLC aggregated from daily candles.
    """
    from app.services.pivot_service import get_pivot_levels
    try:
        return await get_pivot_levels()
    except Exception as e:
        logger.error(f"Pivot levels failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))
