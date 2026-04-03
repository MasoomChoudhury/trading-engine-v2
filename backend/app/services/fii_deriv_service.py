"""NSE FII/FPI derivatives positioning (index futures net long/short)."""
from datetime import datetime, timezone, timedelta, date
import csv
import io
from loguru import logger
import httpx

IST = timezone(timedelta(hours=5, minutes=30))

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.nseindia.com",
}


async def ensure_fii_deriv_table() -> None:
    """Create fii_deriv_data table in the logs DB if it doesn't exist."""
    from app.db.database import get_logs_session
    try:
        async with get_logs_session() as session:
            await session.execute(__import__("sqlalchemy").text("""
                CREATE TABLE IF NOT EXISTS fii_deriv_data (
                    trade_date DATE PRIMARY KEY,
                    future_index_long NUMERIC,
                    future_index_short NUMERIC,
                    future_index_net NUMERIC,
                    option_index_calls_long NUMERIC,
                    option_index_calls_short NUMERIC,
                    option_index_puts_long NUMERIC,
                    option_index_puts_short NUMERIC
                )
            """))
            await session.commit()
        logger.info("fii_deriv_data table ready")
    except Exception as e:
        logger.warning(f"ensure_fii_deriv_table: {e}")
        raise


def _last_n_trading_days(n: int) -> list[date]:
    """Return last N calendar days excluding weekends (no holiday logic)."""
    days: list[date] = []
    dt = datetime.now(IST).date()
    while len(days) < n:
        dt -= timedelta(days=1)
        if dt.weekday() < 5:  # Mon–Fri
            days.append(dt)
    return days


def _parse_numeric(val: str) -> float:
    """Parse a numeric CSV value, stripping commas."""
    try:
        return float(val.replace(",", "").strip())
    except (ValueError, AttributeError):
        return 0.0


def _parse_fii_row(reader_rows: list[list[str]]) -> dict | None:
    """Find the FII / FPI row in participant OI CSV rows and extract fields."""
    # Determine header row index
    header_idx = None
    headers: list[str] = []
    for i, row in enumerate(reader_rows):
        if row and any("client" in c.lower() for c in row):
            header_idx = i
            headers = [c.strip().lower() for c in row]
            break

    if header_idx is None:
        return None

    data_rows = reader_rows[header_idx + 1:]
    for row in data_rows:
        if not row:
            continue
        client_type = row[0].strip() if row else ""
        if "fii" in client_type.lower() or "fpi" in client_type.lower():
            try:
                # Columns (0-indexed after client type):
                # 0: Client Type
                # 1: Fut Index Long, 2: Fut Index Short
                # 3: Fut Stock Long, 4: Fut Stock Short
                # 5: Opt Index Call Long, 6: Opt Index Call Short
                # 7: Opt Index Put Long, 8: Opt Index Put Short
                # Totals columns follow — we only need first 9
                values = [_parse_numeric(v) for v in row[1:9]] if len(row) >= 9 else []
                if len(values) < 8:
                    return None
                return {
                    "future_index_long": values[0],
                    "future_index_short": values[1],
                    "future_index_net": values[0] - values[1],
                    "option_index_calls_long": values[4],
                    "option_index_calls_short": values[5],
                    "option_index_puts_long": values[6],
                    "option_index_puts_short": values[7],
                }
            except Exception as e:
                logger.warning(f"FII row parse error: {e}")
                return None
    return None


async def fetch_nse_participant_oi() -> list[dict]:
    """Try last 5 trading days and return parsed FII derivative records."""
    records: list[dict] = []
    days_to_try = _last_n_trading_days(5)

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        for d in days_to_try:
            ddmmyyyy = d.strftime("%d%m%Y")
            url = f"https://nsearchives.nseindia.com/content/nsccl/nse_fo_participant_oi_{ddmmyyyy}.csv"
            try:
                resp = await client.get(url, headers=NSE_HEADERS)
                if resp.status_code == 404:
                    logger.debug(f"NSE participant OI 404 for {ddmmyyyy}")
                    continue
                resp.raise_for_status()
                text = resp.text
                reader = csv.reader(io.StringIO(text))
                all_rows = list(reader)
                parsed = _parse_fii_row(all_rows)
                if parsed:
                    records.append({"trade_date": d.isoformat(), **parsed})
            except Exception as e:
                logger.warning(f"NSE participant OI fetch failed for {ddmmyyyy}: {e}")
                continue

    return records


async def store_fii_deriv(records: list[dict]) -> int:
    """Upsert FII derivative records into fii_deriv_data. Returns count stored."""
    if not records:
        return 0

    from app.db.database import get_logs_session
    from sqlalchemy import text

    stored = 0
    async with get_logs_session() as session:
        for rec in records:
            try:
                await session.execute(text("""
                    INSERT INTO fii_deriv_data
                        (trade_date, future_index_long, future_index_short, future_index_net,
                         option_index_calls_long, option_index_calls_short,
                         option_index_puts_long, option_index_puts_short)
                    VALUES
                        (:trade_date, :future_index_long, :future_index_short, :future_index_net,
                         :option_index_calls_long, :option_index_calls_short,
                         :option_index_puts_long, :option_index_puts_short)
                    ON CONFLICT (trade_date) DO UPDATE SET
                        future_index_long = EXCLUDED.future_index_long,
                        future_index_short = EXCLUDED.future_index_short,
                        future_index_net = EXCLUDED.future_index_net,
                        option_index_calls_long = EXCLUDED.option_index_calls_long,
                        option_index_calls_short = EXCLUDED.option_index_calls_short,
                        option_index_puts_long = EXCLUDED.option_index_puts_long,
                        option_index_puts_short = EXCLUDED.option_index_puts_short
                """), rec)
                stored += 1
            except Exception as e:
                logger.warning(f"store_fii_deriv upsert failed for {rec.get('trade_date')}: {e}")
        await session.commit()
    return stored


async def get_fii_derivatives(days: int = 20) -> dict:
    """Query fii_deriv_data for last N days and return summary."""
    from app.db.database import get_logs_session
    from sqlalchemy import text

    try:
        async with get_logs_session() as session:
            result = await session.execute(text("""
                SELECT trade_date, future_index_long, future_index_short, future_index_net,
                       option_index_calls_long, option_index_calls_short,
                       option_index_puts_long, option_index_puts_short
                FROM fii_deriv_data
                ORDER BY trade_date DESC
                LIMIT :days
            """), {"days": days})
            rows = result.fetchall()
    except Exception as e:
        logger.warning(f"get_fii_derivatives query failed: {e}")
        return {
            "series": [],
            "latest": None,
            "net_position": "unknown",
            "latest_date": None,
            "index_fut_net": None,
            "total_options_net": None,
            "note": "No data — NSE publishes this after market close",
        }

    if not rows:
        return {
            "series": [],
            "latest": None,
            "net_position": "unknown",
            "latest_date": None,
            "index_fut_net": None,
            "total_options_net": None,
            "note": "No data — NSE publishes this after market close",
        }

    series = []
    for row in reversed(rows):  # chronological order
        trade_date, fil, fis, fin, oicl, oics, oipl, oips = row
        series.append({
            "trade_date": str(trade_date),
            "future_index_long": float(fil or 0),
            "future_index_short": float(fis or 0),
            "future_index_net": float(fin or 0),
            "option_index_calls_long": float(oicl or 0),
            "option_index_calls_short": float(oics or 0),
            "option_index_puts_long": float(oipl or 0),
            "option_index_puts_short": float(oips or 0),
        })

    latest = series[-1] if series else None
    index_fut_net = latest["future_index_net"] if latest else None
    total_options_net = None
    if latest:
        calls_net = latest["option_index_calls_long"] - latest["option_index_calls_short"]
        puts_net = latest["option_index_puts_long"] - latest["option_index_puts_short"]
        total_options_net = round(calls_net + puts_net, 0)

    net_position = "unknown"
    if index_fut_net is not None:
        net_position = "net_long" if index_fut_net > 0 else "net_short"

    return {
        "series": series,
        "latest": latest,
        "net_position": net_position,
        "latest_date": latest["trade_date"] if latest else None,
        "index_fut_net": round(index_fut_net, 0) if index_fut_net is not None else None,
        "total_options_net": total_options_net,
        "note": "FII/FPI index futures positioning from NSE participant-wise OI data",
    }
