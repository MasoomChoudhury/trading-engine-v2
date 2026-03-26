from fastapi import APIRouter
from app.schemas.nifty50 import RefreshResponse, HealthResponse
from app.services.upstox_client import upstox_client
from app.services.indicator_calculator import calculate_all_indicators
from app.services.gex_calculator import calculate_gex
from app.services.derived_metrics import calculate_derived_metrics
from app.db.database import get_ts_session, get_logs_session
from app.db.models import (
    Candle as DBCandle, IndicatorSnapshot, DerivedMetricSnapshot,
    GexSnapshot, MarketStatusLog,
)
from sqlalchemy import select, desc
from sqlalchemy.dialects.postgresql import insert as pg_insert
from datetime import datetime, timedelta, timezone
from loguru import logger
import pandas as pd

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])

NIFTY_KEY = "NSE_INDEX|Nifty 50"
SYMBOL = "NIFTY_50"
IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


@router.post("/refresh", response_model=RefreshResponse)
async def trigger_refresh():
    """Manually trigger a full data refresh."""
    try:
        logger.info("Starting manual data refresh...")

        # Fetch and store candles across intervals
        intervals = [("1min", 3), ("5min", 10), ("15min", 30), ("1day", 365)]
        total_candles = 0

        for interval, days in intervals:
            try:
                to_date = ist_now().strftime("%Y-%m-%d")
                from_date = (ist_now() - timedelta(days=days)).strftime("%Y-%m-%d")
                raw = await upstox_client.get_historical_candles(NIFTY_KEY, interval, to_date, from_date)
                if raw:
                    async with get_ts_session() as session:
                        for row in raw:
                            ts = pd.to_datetime(row[0], utc=True).to_pydatetime()
                            ins = pg_insert(DBCandle).values(
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
                            ins = ins.on_conflict_do_update(
                                index_elements=["timestamp", "symbol", "interval"],
                                set_={"open": ins.excluded.open, "high": ins.excluded.high,
                                      "low": ins.excluded.low, "close": ins.excluded.close,
                                      "volume": ins.excluded.volume, "oi": ins.excluded.oi},
                            )
                            await session.execute(ins)
                        await session.commit()
                    total_candles += len(raw)
            except Exception as e:
                logger.warning(f"Candle fetch failed for {interval}: {e}")

        # Market status
        try:
            market_data = await upstox_client.get_market_status("NSE")
            status_item = market_data.get("data") or {}
            async with get_logs_session() as session:
                entry = MarketStatusLog(
                    status=status_item.get("status", ""),
                    segment="NSE",
                )
                session.add(entry)
                await session.commit()
        except Exception as e:
            logger.warning(f"Market status fetch failed: {e}")

        # Indicators (using the service's calculate_all_indicators)
        indicator_count = 0
        for interval in ["5min", "1day"]:
            try:
                async with get_ts_session() as session:
                    stmt = (
                        select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                               DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
                        .where(DBCandle.symbol == SYMBOL, DBCandle.interval == interval)
                        .order_by(desc(DBCandle.timestamp))
                        .limit(300)
                    )
                    result = await session.execute(stmt)
                    rows = result.all()
                    candles = [[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in rows][::-1]

                if len(candles) >= 50:
                    all_ind = calculate_all_indicators(candles)
                    flat = all_ind.to_dict()
                    async with get_ts_session() as session:
                        now = ist_now()
                        for key, value in flat.items():
                            if isinstance(value, dict):
                                for sub_key, sub_val in value.items():
                                    name = f"{interval}_{key}_{sub_key}"
                                    val = float(sub_val) if sub_val is not None else None
                                    ins = pg_insert(IndicatorSnapshot).values(
                                        timestamp=now, symbol=SYMBOL,
                                        indicator_name=name, value=val, extra=None,
                                    )
                                    ins = ins.on_conflict_do_update(
                                        index_elements=["timestamp", "symbol", "indicator_name"],
                                        set_={"value": ins.excluded.value},
                                    )
                                    await session.execute(ins)
                            else:
                                name = f"{interval}_{key}"
                                val = float(value) if value is not None else None
                                ins = pg_insert(IndicatorSnapshot).values(
                                    timestamp=now, symbol=SYMBOL,
                                    indicator_name=name, value=val, extra=None,
                                )
                                ins = ins.on_conflict_do_update(
                                    index_elements=["timestamp", "symbol", "indicator_name"],
                                    set_={"value": ins.excluded.value},
                                )
                                await session.execute(ins)
                        await session.commit()
                    indicator_count += len(flat)
            except Exception as e:
                logger.warning(f"Indicator calculation failed for {interval}: {e}")

        # GEX
        gex_ok = False
        try:
            contracts = await upstox_client.get_option_contracts(NIFTY_KEY)
            expiry = contracts[0].get("expiry", "") if contracts else None
            if expiry:
                gex_result = await calculate_gex(expiry, lot_size=50)
                async with get_ts_session() as session:
                    ins = pg_insert(GexSnapshot).values(
                        timestamp=datetime.now(IST),
                        expiry_date=datetime.strptime(gex_result.expiry_date, "%Y-%m-%d").date(),
                        spot_price=gex_result.spot_price,
                        total_gex=gex_result.total_gex,
                        net_gex=gex_result.net_gex,
                        zero_gamma_level=gex_result.zero_gamma_level,
                        call_wall=gex_result.call_wall,
                        put_wall=gex_result.put_wall,
                        pcr=gex_result.pcr_oi,
                        strike_gex=gex_result.strike_gex,
                    )
                    ins = ins.on_conflict_do_update(
                        index_elements=["timestamp", "expiry_date"],
                        set_={"spot_price": ins.excluded.spot_price,
                              "total_gex": ins.excluded.total_gex,
                              "net_gex": ins.excluded.net_gex,
                              "zero_gamma_level": ins.excluded.zero_gamma_level,
                              "call_wall": ins.excluded.call_wall,
                              "put_wall": ins.excluded.put_wall,
                              "pcr": ins.excluded.pcr,
                              "strike_gex": ins.excluded.strike_gex},
                    )
                    await session.execute(ins)
                    await session.commit()
                gex_ok = True
        except Exception as e:
            logger.warning(f"GEX calculation failed: {e}")

        # Derived metrics
        derived_count = 0
        try:
            async with get_ts_session() as session:
                stmt_intra = (
                    select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                           DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
                    .where(DBCandle.symbol == SYMBOL, DBCandle.interval == "5min")
                    .order_by(desc(DBCandle.timestamp)).limit(300)
                )
                stmt_daily = (
                    select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                           DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
                    .where(DBCandle.symbol == SYMBOL, DBCandle.interval == "1day")
                    .order_by(desc(DBCandle.timestamp)).limit(30)
                )
                intra_rows = (await session.execute(stmt_intra)).all()
                daily_rows = (await session.execute(stmt_daily)).all()

            intraday = [[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in intra_rows][::-1]
            daily = [[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in daily_rows][::-1]

            if intraday and daily and len(intraday) >= 50:
                spot = float(intraday[-1][4])
                result = calculate_derived_metrics(intraday, daily, spot)
                d = result.to_dict()
                async with get_ts_session() as session:
                    now = ist_now()
                    for name, value in d.items():
                        if isinstance(value, dict):
                            extra_data = value
                            val = None
                        else:
                            extra_data = None
                            val = float(value) if value is not None else None
                        ins = pg_insert(DerivedMetricSnapshot).values(
                            timestamp=now, symbol=SYMBOL, metric_name=name,
                            value=val, extra_data=extra_data,
                        )
                        ins = ins.on_conflict_do_update(
                            index_elements=["timestamp", "symbol", "metric_name"],
                            set_={"value": ins.excluded.value, "extra_data": ins.excluded.extra_data},
                        )
                        await session.execute(ins)
                    await session.commit()
                derived_count = len(d)
        except Exception as e:
            logger.warning(f"Derived metrics failed: {e}")

        logger.info(f"Refresh: {total_candles} candles, {indicator_count} indicators, GEX={'ok' if gex_ok else 'fail'}, {derived_count} derived")

        return RefreshResponse(
            status="success",
            message="Data refresh completed",
            candles_fetched=total_candles,
            indicators_calculated=indicator_count,
            gex_calculated=gex_ok,
            derived_calculated=derived_count,
        )

    except Exception as e:
        logger.error(f"Refresh failed: {e}")
        return RefreshResponse(
            status="error",
            message=str(e),
            candles_fetched=0,
            indicators_calculated=0,
            gex_calculated=False,
            derived_calculated=0,
        )


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Check health of all services."""
    db_status = "unknown"
    ws_status = "disconnected"

    try:
        async with get_ts_session() as session:
            await session.execute(select(1))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    try:
        from app.services.websocket_client import ws_client
        ws_status = "connected" if ws_client._running else "disconnected"
    except Exception:
        pass

    return HealthResponse(
        status="ok" if db_status == "ok" else "degraded",
        timestamp=ist_now().isoformat(),
        database=db_status,
        websocket=ws_status,
    )
