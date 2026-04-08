"""
APScheduler-based background job scheduler for periodic data refresh.
Runs every 5 minutes during market hours and every 15 minutes outside.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta, timezone
from loguru import logger

scheduler = AsyncIOScheduler()
IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


async def refresh_job():
    """The periodic data refresh job."""
    logger.info(f"Scheduled refresh triggered at {ist_now().isoformat()}")
    try:
        await _do_refresh()
    except Exception as e:
        logger.error(f"Scheduled refresh failed: {e}")


async def _do_refresh():
    """Inline refresh logic to avoid circular imports."""
    from app.services.upstox_client import upstox_client
    from app.services.indicator_calculator import calculate_all_indicators
    from app.services.gex_calculator import calculate_gex
    from app.services.derived_metrics import calculate_derived_metrics
    from app.db.database import get_ts_session
    from app.db.models import (
        Candle as DBCandle, IndicatorSnapshot, DerivedMetricSnapshot, GexSnapshot,
    )
    from sqlalchemy import select, desc
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    import pandas as pd

    NIFTY_KEY = "NSE_INDEX|Nifty 50"
    SYMBOL = "NIFTY_50"

    intervals = [("1min", 3), ("5min", 10), ("15min", 30), ("1day", 365)]

    async def _upsert_candles(rows: list, interval: str):
        if not rows:
            return
        async with get_ts_session() as session:
            for row in rows:
                ts = pd.to_datetime(row[0], utc=True).to_pydatetime()
                ins = pg_insert(DBCandle).values(
                    timestamp=ts, symbol=SYMBOL, interval=interval,
                    open=float(row[1]), high=float(row[2]),
                    low=float(row[3]), close=float(row[4]),
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

    for interval, days in intervals:
        try:
            to_date = ist_now().strftime("%Y-%m-%d")
            from_date = (ist_now() - timedelta(days=days)).strftime("%Y-%m-%d")
            historical = await upstox_client.get_historical_candles(NIFTY_KEY, interval, to_date, from_date)
            await _upsert_candles(historical, interval)
        except Exception as e:
            logger.warning(f"Historical candle fetch failed for {interval}: {e}")

        # Today's live intraday candles (not available via historical endpoint)
        if interval != "1day":
            try:
                intraday = await upstox_client.get_intraday_candles(NIFTY_KEY, interval)
                await _upsert_candles(intraday, interval)
            except Exception as e:
                logger.warning(f"Intraday candle fetch failed for {interval}: {e}")

    # Indicators using calculate_all_indicators
    for interval in ["5min", "1day"]:
        try:
            async with get_ts_session() as session:
                stmt = (
                    select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                           DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
                    .where(DBCandle.symbol == SYMBOL, DBCandle.interval == interval)
                    .order_by(desc(DBCandle.timestamp)).limit(300)
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
                                # Skip non-numeric values (e.g. supertrend direction string)
                                try:
                                    val = float(sub_val) if sub_val is not None else None
                                except (TypeError, ValueError):
                                    continue
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
                            try:
                                val = float(value) if value is not None else None
                            except (TypeError, ValueError):
                                continue
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
        except Exception as e:
            logger.warning(f"Indicator calculation failed for {interval}: {e}")

    # GEX
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
    except Exception as e:
        logger.warning(f"GEX calculation failed: {e}")

    # Derived metrics
    try:
        async with get_ts_session() as session:
            intra_stmt = (
                select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                       DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
                .where(DBCandle.symbol == SYMBOL, DBCandle.interval == "5min")
                .order_by(desc(DBCandle.timestamp)).limit(300)
            )
            daily_stmt = (
                select(DBCandle.timestamp, DBCandle.open, DBCandle.high,
                       DBCandle.low, DBCandle.close, DBCandle.volume, DBCandle.oi)
                .where(DBCandle.symbol == SYMBOL, DBCandle.interval == "1day")
                .order_by(desc(DBCandle.timestamp)).limit(30)
            )
            intra_rows = (await session.execute(intra_stmt)).all()
            daily_rows = (await session.execute(daily_stmt)).all()

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
    except Exception as e:
        logger.warning(f"Derived metrics failed: {e}")

    # Straddle intraday snapshot
    try:
        from app.services.intraday_momentum_service import save_straddle_snapshot
        await save_straddle_snapshot()
    except Exception as e:
        logger.warning(f"Straddle snapshot failed: {e}")

    # Persist RR25 to derived_metric_snapshots for history/rank queries
    try:
        from app.services.options_service import build_iv_skew
        from app.db.database import get_ts_session
        from app.db.models import DerivedMetricSnapshot
        skew = await build_iv_skew()
        rr25_val = skew.get("rr25")
        if rr25_val is not None:
            from sqlalchemy.dialects.postgresql import insert as pg_ins
            async with get_ts_session() as session:
                ins = pg_ins(DerivedMetricSnapshot).values(
                    timestamp=ist_now(), symbol=SYMBOL,
                    metric_name="rr25", value=float(rr25_val), extra_data=None,
                )
                ins = ins.on_conflict_do_update(
                    index_elements=["timestamp", "symbol", "metric_name"],
                    set_={"value": ins.excluded.value},
                )
                await session.execute(ins)
                await session.commit()
    except Exception as e:
        logger.warning(f"RR25 snapshot failed: {e}")

    logger.info("Scheduled refresh completed")


async def _daily_token_request_job():
    """
    Trigger Upstox token request every night at 9:00 PM IST.
    Sends a push notification to the user's Upstox app.
    Once approved, the webhook stores the new token automatically.
    Tokens expire daily at ~3:30 AM IST, so 9 PM gives a 6-hour window to approve.
    """
    try:
        from app.services.upstox_client import token_manager
        result = await token_manager.initiate_token_request()
        logger.info(f"Daily Upstox token request sent — approve on Upstox app. "
                    f"Auth expires: {result.get('data', {}).get('authorization_expiry', 'unknown')}")
    except Exception as e:
        logger.error(f"Daily token request failed: {e}")


async def _breadth_refresh_job():
    """Refresh all 50 Nifty constituent candles once a day at market close."""
    try:
        from app.services.breadth_service import refresh_all_constituents
        logger.info("Breadth: starting daily constituent candle refresh")
        counts = await refresh_all_constituents()
        logger.info(f"Breadth: refreshed {sum(counts.values())} candles for {len(counts)} symbols")
    except Exception as e:
        logger.error(f"Breadth daily refresh failed: {e}")


async def _fii_deriv_refresh_job():
    """
    Daily FII/FPI derivatives refresh.
    NSE publishes participant-wise OI data after market close (~6 PM IST).
    We run at 6:30 PM IST to allow for publication lag.
    """
    try:
        from app.services.fii_deriv_service import (
            fetch_nse_participant_oi, store_fii_deriv,
        )
        logger.info("FII deriv daily refresh: fetching NSE participant OI...")
        records = await fetch_nse_participant_oi()
        if records:
            stored = await store_fii_deriv(records)
            logger.info(f"FII deriv daily refresh: stored {stored} records")
        else:
            logger.warning("FII deriv daily refresh: NSE returned no records — try again after 7 PM IST")
    except Exception as e:
        logger.error(f"FII deriv daily refresh failed: {e}")


async def _options_eod_job():
    """Save end-of-day options chain snapshot for near-month expiry + max pain trend."""
    try:
        from app.services.options_service import (
            get_active_expiries, fetch_chain, parse_chain, save_options_eod,
            compute_max_pain,
        )
        expiries = await get_active_expiries()
        if not expiries:
            logger.warning("Options EOD: no active expiries found")
            return
        expiry = expiries[0]
        logger.info(f"Options EOD snapshot: saving chain for {expiry}")
        chain = await fetch_chain(expiry)
        records = parse_chain(chain)
        await save_options_eod(expiry, records)
        logger.info(f"Options EOD snapshot: saved {len(records)} strikes")

        # Persist max pain to derived_metric_snapshots for trend chart
        try:
            max_pain = compute_max_pain(records)
            if max_pain:
                from app.db.database import get_ts_session
                from app.db.models import DerivedMetricSnapshot
                from sqlalchemy.dialects.postgresql import insert as pg_ins
                async with get_ts_session() as session:
                    ins = pg_ins(DerivedMetricSnapshot).values(
                        timestamp=ist_now(), symbol=SYMBOL,
                        metric_name="max_pain", value=float(max_pain), extra_data=None,
                    )
                    ins = ins.on_conflict_do_update(
                        index_elements=["timestamp", "symbol", "metric_name"],
                        set_={"value": ins.excluded.value},
                    )
                    await session.execute(ins)
                    await session.commit()
                logger.info(f"Max pain EOD persisted: {max_pain}")
        except Exception as e:
            logger.warning(f"Max pain persistence failed (non-critical): {e}")

    except Exception as e:
        logger.error(f"Options EOD snapshot failed: {e}")


async def _signal_log_job():
    """
    Check current signal states for each source and log any state changes.
    Event-driven: the signal_log_service only writes a row if the value changed.
    Also fills 30-min outcomes for signals that are now ≥30 min old.
    """
    try:
        from app.services.signal_log_service import log_signal, fill_outcomes

        # Get current spot for context
        spot: float | None = None
        atm_premium: float | None = None
        try:
            from app.services.upstox_client import upstox_client
            price_data = await upstox_client.get_ltp("NSE_INDEX|Nifty 50")
            if price_data:
                spot = float(price_data.get("last_price", 0)) or None
        except Exception:
            pass

        # Try to get ATM straddle premium from latest DB snapshot
        try:
            from app.db.database import get_ts_session
            from app.db.models import StraddleSnapshot
            from sqlalchemy import select, desc
            async with get_ts_session() as session:
                row = (await session.execute(
                    select(StraddleSnapshot)
                    .order_by(desc(StraddleSnapshot.timestamp))
                    .limit(1)
                )).scalar_one_or_none()
                if row:
                    ce = float(row.ce_ltp or 0)
                    pe = float(row.pe_ltp or 0)
                    if ce + pe > 0:
                        atm_premium = round(ce + pe, 2)
        except Exception:
            pass

        # ── MTF confluence ──────────────────────────────────────────────────
        try:
            from app.services.mtf_confluence_service import build_mtf_confluence
            mtf = await build_mtf_confluence()
            bias = mtf.get("confluence_bias", "neutral") or "neutral"
            level = mtf.get("confluence_level", "MIXED") or "MIXED"
            await log_signal("MTF", bias, f"{level} {bias}", spot, atm_premium)
        except Exception as e:
            logger.debug(f"signal_log MTF: {e}")

        # ── GEX regime ─────────────────────────────────────────────────────
        try:
            from app.services.gex_calculator import calculate_gex
            gex = await calculate_gex()
            regime = gex.regime if hasattr(gex, "regime") else gex.get("regime", "neutral")
            direction = "bearish" if "negative" in regime else "bullish"
            await log_signal("GEX", direction, regime, spot, atm_premium)
        except Exception as e:
            logger.debug(f"signal_log GEX: {e}")

        # ── CVD divergence ─────────────────────────────────────────────────
        try:
            from app.services.cvd_service import get_cvd
            cvd = await get_cvd()
            divergence = cvd.get("divergence", "neutral")
            if "bullish" in divergence or "confirmed_up" in divergence:
                direction = "bullish"
            elif "bearish" in divergence or "confirmed_down" in divergence:
                direction = "bearish"
            else:
                direction = "neutral"
            await log_signal("CVD", direction, divergence, spot, atm_premium)
        except Exception as e:
            logger.debug(f"signal_log CVD: {e}")

        # ── Fill 30-min outcomes ────────────────────────────────────────────
        if spot:
            await fill_outcomes(spot)

    except Exception as e:
        logger.error(f"_signal_log_job failed: {e}")


async def _signal_outcome_eod_job():
    """Fill outcome_eod for today's signals at 3:30 PM IST."""
    try:
        from app.services.signal_log_service import fill_outcomes
        from app.services.upstox_client import upstox_client
        price_data = await upstox_client.get_ltp("NSE_INDEX|Nifty 50")
        spot = float(price_data.get("last_price", 0)) if price_data else 0.0
        if spot > 0:
            await fill_outcomes(spot, is_eod=True)
    except Exception as e:
        logger.warning(f"_signal_outcome_eod_job failed: {e}")


async def _signal_outcome_next_open_job():
    """Fill outcome_next_open for yesterday's signals at 9:20 AM IST."""
    try:
        from app.services.signal_log_service import fill_outcomes
        from app.services.upstox_client import upstox_client
        price_data = await upstox_client.get_ltp("NSE_INDEX|Nifty 50")
        spot = float(price_data.get("last_price", 0)) if price_data else 0.0
        if spot > 0:
            await fill_outcomes(spot, is_next_open=True)
    except Exception as e:
        logger.warning(f"_signal_outcome_next_open_job failed: {e}")


def start_scheduler():
    """Start the background scheduler."""
    scheduler.add_job(
        refresh_job,
        IntervalTrigger(minutes=5),
        id="data_refresh",
        name="Nifty50 Data Refresh",
        replace_existing=True,
        misfire_grace_time=60,
        next_run_time=__import__('datetime').datetime.now(__import__('datetime').timezone.utc),
    )
    # EOD options snapshot: saves options chain daily at 15:40 IST (Mon-Fri)
    scheduler.add_job(
        _options_eod_job,
        CronTrigger(hour=10, minute=10, timezone=IST),  # 15:40 IST = 10:10 UTC
        id="options_eod",
        name="Options EOD Snapshot",
        replace_existing=True,
        misfire_grace_time=300,
    )
    # Constituent breadth refresh: daily at 16:00 IST (10:30 UTC)
    scheduler.add_job(
        _breadth_refresh_job,
        CronTrigger(hour=10, minute=30, timezone=IST),  # 16:00 IST = 10:30 UTC
        id="breadth_refresh",
        name="Nifty50 Constituent Breadth Refresh",
        replace_existing=True,
        misfire_grace_time=300,
    )
    # FII derivatives daily refresh: 6:30 PM IST (13:00 UTC) Mon-Fri
    # NSE publishes participant-wise OI data ~6 PM IST after market close.
    scheduler.add_job(
        _fii_deriv_refresh_job,
        CronTrigger(hour=13, minute=0, day_of_week="mon-fri", timezone="UTC"),  # 6:30 PM IST
        id="fii_deriv_refresh",
        name="FII Derivatives Daily Refresh",
        replace_existing=True,
        misfire_grace_time=3600,  # 1-hour grace — NSE publish time can vary
    )
    # Daily token request: 9:00 PM IST (15:30 UTC) Mon-Fri
    # Sends push notification to Upstox app — approve to get new token before 3:30 AM expiry
    scheduler.add_job(
        _daily_token_request_job,
        CronTrigger(hour=15, minute=30, day_of_week="mon-fri", timezone="UTC"),  # 9 PM IST
        id="daily_token_request",
        name="Daily Upstox Token Request",
        replace_existing=True,
        misfire_grace_time=600,
    )
    # Signal log: check for state changes every 5 min during market hours
    scheduler.add_job(
        _signal_log_job,
        IntervalTrigger(minutes=5),
        id="signal_log",
        name="Signal Log State Check",
        replace_existing=True,
        misfire_grace_time=60,
    )
    # Signal EOD outcomes: fill outcome_eod at 3:30 PM IST (10:00 UTC) Mon-Fri
    scheduler.add_job(
        _signal_outcome_eod_job,
        CronTrigger(hour=10, minute=0, day_of_week="mon-fri", timezone="UTC"),
        id="signal_outcome_eod",
        name="Signal Log EOD Outcomes",
        replace_existing=True,
        misfire_grace_time=300,
    )
    # Signal next-open outcomes: fill outcome_next_open at 9:20 AM IST (3:50 UTC) Mon-Fri
    scheduler.add_job(
        _signal_outcome_next_open_job,
        CronTrigger(hour=3, minute=50, day_of_week="mon-fri", timezone="UTC"),
        id="signal_outcome_next_open",
        name="Signal Log Next-Open Outcomes",
        replace_existing=True,
        misfire_grace_time=300,
    )
    scheduler.start()
    logger.info("Scheduler started — data refresh every 5 minutes")


def stop_scheduler():
    """Stop the scheduler."""
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped")
