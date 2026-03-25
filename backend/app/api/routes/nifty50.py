from fastapi import APIRouter, Query
from app.schemas.nifty50 import (
    IndicatorResponse,
    DerivedMetricsResponse,
    GEXResponse,
    CandleResponse,
    LivePriceResponse,
)
from app.services.upstox_client import upstox_client
from app.services.indicator_calculator import calculate_all_indicators
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


async def _fetch_candles(interval: str, days_back: int = 5) -> list:
    """Fetch candles from Upstox and store in TimescaleDB."""
    to_date = ist_now().strftime("%Y-%m-%d")
    from_date = (ist_now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    raw = await upstox_client.get_historical_candles(NIFTY_KEY, interval, to_date, from_date)

    if raw:
        async with get_ts_session() as session:
            for row in raw:
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

    return raw


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
            indicators[k.replace("stoch_rsi_", "stoch_rsi_")] = v
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

    # Ensure consistent keys for frontend
    indicators = {
        "rsi_14": indicators.get("rsi_value"),
        "ema_20": indicators.get("ema_ema_20"),
        "ema_21": indicators.get("ema_ema_21"),
        "ema_50": indicators.get("ema_ema_50"),
        "sma_200": indicators.get("sma_sma_200"),
        "macd_line": indicators.get("macd_macd_line"),
        "macd_signal": indicators.get("macd_signal_line"),
        "macd_histogram": indicators.get("macd_histogram"),
        "bb_upper": indicators.get("bollinger_upper"),
        "bb_middle": indicators.get("bollinger_middle"),
        "bb_lower": indicators.get("bollinger_lower"),
        "supertrend": indicators.get("supertrend_value"),
        "supertrend_direction": indicators.get("supertrend_direction"),
        "stoch_rsi_k": indicators.get("stoch_rsi_value"),
        "stoch_rsi_d": indicators.get("stoch_rsi_value"),
        "adx_14": indicators.get("adx_adx"),
        "plus_di_14": indicators.get("adx_plus_di"),
        "minus_di_14": indicators.get("adx_minus_di"),
        "atr_14": indicators.get("atr_value"),
        "vwap": indicators.get("vwap_value"),
    }

    return IndicatorResponse(
        timestamp=ist_now().isoformat(),
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
    if not expiry_date:
        contracts = await upstox_client.get_option_contracts(NIFTY_KEY)
        if contracts:
            expiry_date = contracts[0].get("expiry", "")
        if not expiry_date:
            expiry_date = (ist_now() + timedelta(days=7)).strftime("%Y-%m-%d")

    try:
        gex_result = await calculate_gex(expiry_date, lot_size=50)
    except Exception as e:
        logger.error(f"GEX calculation failed: {e}")
        return GEXResponse(
            timestamp=ist_now().isoformat(),
            expiry_date=expiry_date,
            spot_price=0.0,
            total_gex=0.0,
            net_gex=0.0,
            regime="unknown",
            regime_description=f"Error: {e}",
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
        zero_gamma_level=round(gex_result.zero_gamma_level, 2) if gex_result.zero_gamma_level else 0.0,
        call_wall=round(gex_result.call_wall, 2) if gex_result.call_wall else 0.0,
        put_wall=round(gex_result.put_wall, 2) if gex_result.put_wall else 0.0,
        pcr=round(gex_result.pcr_oi, 4) if gex_result.pcr_oi else 0.0,
        strike_gex=strikes,
        call_wall_distance=round((spot - (gex_result.call_wall or 0)) / spot * 100, 2) if gex_result.call_wall and spot else 0.0,
        put_wall_distance=round((spot - (gex_result.put_wall or 0)) / spot * 100, 2) if gex_result.put_wall and spot else 0.0,
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
