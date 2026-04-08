"""
Signal Log — Gap 18.

Event-driven: a row is written only when a signal's state changes from the
last logged value for that source.  Repeated identical states are silently
skipped (no flooding).

Sources tracked: GEX, MTF, FII, CVD, Sweep
Directions:      bullish | bearish | neutral

Confluence: when 3+ distinct (non-confluence) sources agree on direction
within a 15-minute rolling window, a single CONFLUENCE row is inserted.

Outcomes: outcome_30m, outcome_eod, outcome_next_open
  — filled by the scheduler at the appropriate times.
"""
from datetime import datetime, timedelta, timezone
import json
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

# In-process state: last logged value per source (survives within a container
# restart session; re-hydrated from DB on first call).
_last_logged: dict[str, dict] = {}
_hydrated = False


async def ensure_signal_log_table() -> None:
    """Create signal_log table in the logs DB if it does not exist."""
    from app.db.database import get_logs_session
    import sqlalchemy
    try:
        async with get_logs_session() as session:
            await session.execute(sqlalchemy.text("""
                CREATE TABLE IF NOT EXISTS signal_log (
                    id              BIGSERIAL PRIMARY KEY,
                    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    source          VARCHAR(50)  NOT NULL,
                    direction       VARCHAR(20)  NOT NULL,
                    signal_value    TEXT         NOT NULL,
                    spot            NUMERIC,
                    atm_premium     NUMERIC,
                    is_confluence   BOOLEAN      DEFAULT FALSE,
                    confluence_count INTEGER     DEFAULT 1,
                    confluence_sources TEXT,
                    outcome_30m     NUMERIC,
                    outcome_eod     NUMERIC,
                    outcome_next_open NUMERIC
                )
            """))
            await session.execute(sqlalchemy.text("""
                CREATE INDEX IF NOT EXISTS signal_log_ts_idx
                ON signal_log (timestamp DESC)
            """))
            await session.commit()
        logger.info("signal_log table ready")
    except Exception as e:
        logger.warning(f"ensure_signal_log_table: {e}")
        raise


async def _hydrate_last_logged() -> None:
    """On first call, populate _last_logged from the most recent DB rows per source."""
    global _hydrated
    if _hydrated:
        return
    from app.db.database import get_logs_session
    import sqlalchemy
    try:
        async with get_logs_session() as session:
            result = await session.execute(sqlalchemy.text("""
                SELECT DISTINCT ON (source) source, direction, signal_value
                FROM signal_log
                WHERE is_confluence = FALSE
                ORDER BY source, timestamp DESC
            """))
            for row in result.fetchall():
                _last_logged[row[0]] = {"direction": row[1], "signal_value": row[2]}
        _hydrated = True
    except Exception as e:
        logger.debug(f"_hydrate_last_logged: {e}")
        _hydrated = True  # don't retry on failure


async def log_signal(
    source: str,
    direction: str,
    signal_value: str,
    spot: float | None = None,
    atm_premium: float | None = None,
) -> bool:
    """
    Write a signal row only if the state changed from last logged value.
    Returns True if a row was written, False if skipped (no change).
    """
    await _hydrate_last_logged()

    last = _last_logged.get(source)
    if last and last["direction"] == direction and last["signal_value"] == signal_value:
        return False  # no change

    from app.db.database import get_logs_session
    import sqlalchemy
    try:
        async with get_logs_session() as session:
            await session.execute(sqlalchemy.text("""
                INSERT INTO signal_log (source, direction, signal_value, spot, atm_premium)
                VALUES (:source, :direction, :signal_value, :spot, :atm_premium)
            """), {
                "source": source,
                "direction": direction,
                "signal_value": signal_value,
                "spot": spot,
                "atm_premium": atm_premium,
            })
            await session.commit()

        _last_logged[source] = {"direction": direction, "signal_value": signal_value}
        logger.info(f"Signal logged: [{source}] {direction} — {signal_value}")

        # After each new signal, check for confluence
        await _check_confluence(spot=spot, atm_premium=atm_premium)
        return True
    except Exception as e:
        logger.warning(f"log_signal failed ({source}): {e}")
        return False


async def _check_confluence(
    window_minutes: int = 15,
    min_sources: int = 3,
    spot: float | None = None,
    atm_premium: float | None = None,
) -> None:
    """
    Look at non-confluence signals in the last `window_minutes`.
    If 3+ distinct sources agree on a non-neutral direction, log a confluence row.
    Deduplicates: same source-set + direction within the window is only logged once.
    """
    from app.db.database import get_logs_session
    import sqlalchemy
    cutoff = datetime.now(IST) - timedelta(minutes=window_minutes)
    try:
        async with get_logs_session() as session:
            result = await session.execute(sqlalchemy.text("""
                SELECT DISTINCT ON (source) source, direction, signal_value
                FROM signal_log
                WHERE timestamp >= :cutoff
                  AND is_confluence = FALSE
                ORDER BY source, timestamp DESC
            """), {"cutoff": cutoff})
            rows = result.fetchall()
    except Exception as e:
        logger.debug(f"_check_confluence query failed: {e}")
        return

    if not rows:
        return

    # Group by direction
    by_dir: dict[str, list[str]] = {}
    for source, direction, _ in rows:
        if direction != "neutral":
            by_dir.setdefault(direction, []).append(source)

    for direction, sources in by_dir.items():
        if len(sources) < min_sources:
            continue

        sorted_sources = sorted(sources)
        sig_key = f"{direction}:{sorted_sources}"

        # Dedup: skip if the same confluence was already logged recently
        last_conf = _last_logged.get("__confluence__")
        if last_conf and last_conf.get("sig_key") == sig_key:
            return

        sources_str = " + ".join(sorted_sources)
        value = f"{sources_str} — {len(sources)}/{len(sources)} {direction}"
        if spot:
            value += f" @ {spot:,.0f}"

        from app.db.database import get_logs_session
        import sqlalchemy
        try:
            async with get_logs_session() as session:
                await session.execute(sqlalchemy.text("""
                    INSERT INTO signal_log
                      (source, direction, signal_value, spot, atm_premium,
                       is_confluence, confluence_count, confluence_sources)
                    VALUES
                      ('CONFLUENCE', :direction, :signal_value, :spot, :atm_premium,
                       TRUE, :count, :sources_json)
                """), {
                    "direction": direction,
                    "signal_value": value,
                    "spot": spot,
                    "atm_premium": atm_premium,
                    "count": len(sorted_sources),
                    "sources_json": json.dumps(sorted_sources),
                })
                await session.commit()

            _last_logged["__confluence__"] = {"sig_key": sig_key}
            logger.info(f"Confluence event logged: {value}")
        except Exception as e:
            logger.warning(f"_check_confluence insert failed: {e}")
        break  # only log the first qualifying direction


async def get_signal_log(limit: int = 50) -> list[dict]:
    """Return last `limit` signal log entries, newest first."""
    from app.db.database import get_logs_session
    import sqlalchemy
    try:
        async with get_logs_session() as session:
            result = await session.execute(sqlalchemy.text("""
                SELECT id, timestamp, source, direction, signal_value,
                       spot, atm_premium, is_confluence, confluence_count,
                       confluence_sources, outcome_30m, outcome_eod, outcome_next_open
                FROM signal_log
                ORDER BY timestamp DESC
                LIMIT :limit
            """), {"limit": limit})
            rows = result.fetchall()

        return [
            {
                "id": r[0],
                "timestamp": r[1].isoformat() if r[1] else None,
                "source": r[2],
                "direction": r[3],
                "signal_value": r[4],
                "spot": float(r[5]) if r[5] is not None else None,
                "atm_premium": float(r[6]) if r[6] is not None else None,
                "is_confluence": bool(r[7]),
                "confluence_count": r[8],
                "confluence_sources": json.loads(r[9]) if r[9] else None,
                "outcome_30m": float(r[10]) if r[10] is not None else None,
                "outcome_eod": float(r[11]) if r[11] is not None else None,
                "outcome_next_open": float(r[12]) if r[12] is not None else None,
            }
            for r in rows
        ]
    except Exception as e:
        logger.warning(f"get_signal_log failed: {e}")
        return []


async def fill_outcomes(
    spot_now: float,
    is_eod: bool = False,
    is_next_open: bool = False,
) -> None:
    """
    Fill outcome columns where enough time has elapsed and the column is NULL.

    Called by scheduler:
      - Every refresh cycle → fills outcome_30m for signals ≥30 min old
      - At 3:30 PM IST     → fills outcome_eod for today's signals
      - At 9:20 AM IST     → fills outcome_next_open for yesterday's signals
    """
    if spot_now <= 0:
        return
    from app.db.database import get_logs_session
    import sqlalchemy
    try:
        async with get_logs_session() as session:
            # 30-min outcome: any signal at least 30 min old with no 30m outcome yet
            cutoff_30m = datetime.now(IST) - timedelta(minutes=30)
            await session.execute(sqlalchemy.text("""
                UPDATE signal_log
                SET outcome_30m = ROUND(CAST((:spot - spot) / spot * 100 AS NUMERIC), 3)
                WHERE outcome_30m IS NULL
                  AND spot IS NOT NULL AND spot > 0
                  AND timestamp <= :cutoff
            """), {"spot": spot_now, "cutoff": cutoff_30m})

            if is_eod:
                today_start = datetime.now(IST).replace(
                    hour=0, minute=0, second=0, microsecond=0
                )
                await session.execute(sqlalchemy.text("""
                    UPDATE signal_log
                    SET outcome_eod = ROUND(CAST((:spot - spot) / spot * 100 AS NUMERIC), 3)
                    WHERE outcome_eod IS NULL
                      AND spot IS NOT NULL AND spot > 0
                      AND timestamp >= :today_start
                """), {"spot": spot_now, "today_start": today_start})

            if is_next_open:
                yesterday_start = (datetime.now(IST) - timedelta(days=1)).replace(
                    hour=0, minute=0, second=0, microsecond=0
                )
                yesterday_end = yesterday_start + timedelta(days=1)
                await session.execute(sqlalchemy.text("""
                    UPDATE signal_log
                    SET outcome_next_open = ROUND(CAST((:spot - spot) / spot * 100 AS NUMERIC), 3)
                    WHERE outcome_next_open IS NULL
                      AND spot IS NOT NULL AND spot > 0
                      AND timestamp >= :yesterday_start
                      AND timestamp < :yesterday_end
                """), {
                    "spot": spot_now,
                    "yesterday_start": yesterday_start,
                    "yesterday_end": yesterday_end,
                })

            await session.commit()
    except Exception as e:
        logger.warning(f"fill_outcomes failed: {e}")
