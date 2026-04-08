"""NSE FII/FPI derivatives positioning (index futures net long/short)."""
from datetime import datetime, timezone, timedelta, date
import csv
import io
from loguru import logger
import httpx

IST = timezone(timedelta(hours=5, minutes=30))

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.nseindia.com",
    "Cache-Control": "no-cache",
}

NSE_API_HEADERS = {
    **NSE_HEADERS,
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
}


async def _warm_nse_session(client: httpx.AsyncClient) -> bool:
    """
    Establish an NSE session by hitting multiple pages to seed cookies.
    NSE requires a real browsing sequence to issue valid session cookies.
    Returns True if session was established.
    """
    import asyncio
    try:
        # Step 1: Homepage seeds the main cookies (nsit, nseappid)
        r1 = await client.get(
            "https://www.nseindia.com/",
            headers=NSE_HEADERS,
            timeout=15,
        )
        if r1.status_code not in (200, 301, 302):
            logger.debug(f"NSE homepage returned {r1.status_code}")
            return False

        await asyncio.sleep(1.5)  # mimic human browsing delay

        # Step 2: Market data page seeds nseQuoteSymbols / bm_* cookies
        await client.get(
            "https://www.nseindia.com/market-data/securities-available-for-trading",
            headers=NSE_HEADERS,
            timeout=10,
        )
        await asyncio.sleep(1.0)

        # Step 3: The FII/DII activity page specifically — seeds path-specific cookies
        await client.get(
            "https://www.nseindia.com/market-data/fii-dii-activity",
            headers=NSE_HEADERS,
            timeout=10,
        )
        await asyncio.sleep(0.8)

        # Step 4: Hit the derivatives-market page — primes cookies for fnoparticipants API
        await client.get(
            "https://www.nseindia.com/market-data/derivatives-market",
            headers={**NSE_HEADERS, "Referer": "https://www.nseindia.com/market-data/fii-dii-activity"},
            timeout=10,
        )
        logger.debug("NSE session warmed successfully (4-step)")
        return True
    except Exception as e:
        logger.warning(f"NSE session warm failed: {e}")
        return False


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


def _parse_fii_row_json(data: list[dict]) -> dict | None:
    """
    Parse FII/FPI row from NSE JSON API response.
    NSE JSON format: list of dicts with keys like 'clientType', 'futIndexLong', etc.
    """
    for row in data:
        ct = str(row.get("clientType") or row.get("client_type") or "").strip().upper()
        if "FII" not in ct and "FPI" not in ct:
            continue
        try:
            fil = float(row.get("futIndexLong") or row.get("future_index_long") or 0)
            fis = float(row.get("futIndexShort") or row.get("future_index_short") or 0)
            oicl = float(row.get("optIndexCallsLong") or row.get("option_index_calls_long") or 0)
            oics = float(row.get("optIndexCallsShort") or row.get("option_index_calls_short") or 0)
            oipl = float(row.get("optIndexPutsLong") or row.get("option_index_puts_long") or 0)
            oips = float(row.get("optIndexPutsShort") or row.get("option_index_puts_short") or 0)
            return {
                "future_index_long": fil,
                "future_index_short": fis,
                "future_index_net": fil - fis,
                "option_index_calls_long": oicl,
                "option_index_calls_short": oics,
                "option_index_puts_long": oipl,
                "option_index_puts_short": oips,
            }
        except Exception as e:
            logger.warning(f"FII JSON row parse error: {e}")
    return None


async def _fetch_via_json_api(client: httpx.AsyncClient, d: date) -> dict | None:
    """
    Try NSE JSON API: /api/historical/fnoparticipants?trade_date=DD-Mon-YYYY
    This is more reliable than CSV if cookies are set.
    """
    date_str = d.strftime("%d-%b-%Y")  # e.g. "07-Apr-2026"
    url = f"https://www.nseindia.com/api/historical/fnoparticipants?trade_date={date_str}"
    try:
        resp = await client.get(url, headers=NSE_API_HEADERS, timeout=15)
        if resp.status_code == 401 or resp.status_code == 403:
            logger.debug(f"NSE JSON API auth failed for {date_str}: {resp.status_code}")
            return None
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        payload = resp.json()
        # Response can be {"data": [...]} or a direct list
        rows = payload.get("data") if isinstance(payload, dict) else payload
        if rows:
            return _parse_fii_row_json(rows)
    except Exception as e:
        logger.debug(f"NSE JSON API fetch failed for {date_str}: {e}")
    return None


async def _fetch_via_csv(client: httpx.AsyncClient, d: date) -> dict | None:
    """
    Fetch NSE archives CSV for participant OI on a given date.
    nsearchives.nseindia.com is a CDN — no cookies required, but needs a valid Referer.
    """
    ddmmyyyy = d.strftime("%d%m%Y")
    url = f"https://nsearchives.nseindia.com/content/nsccl/nse_fo_participant_oi_{ddmmyyyy}.csv"
    csv_headers = {
        "User-Agent": NSE_HEADERS["User-Agent"],
        "Accept": "text/csv,text/plain,*/*",
        "Referer": "https://www.nseindia.com/market-data/fii-dii-activity",
        "Accept-Encoding": "gzip, deflate, br",
    }
    try:
        resp = await client.get(url, headers=csv_headers, timeout=20)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        reader = csv.reader(io.StringIO(resp.text))
        rows = list(reader)
        if len(rows) < 2:
            logger.debug(f"NSE CSV for {ddmmyyyy}: response too short ({len(rows)} rows)")
            return None
        return _parse_fii_row(rows)
    except Exception as e:
        logger.debug(f"NSE CSV fetch failed for {ddmmyyyy}: {e}")
    return None


async def fetch_nse_participant_oi() -> list[dict]:
    """
    Try last 5 trading days and return parsed FII derivative records.

    Strategy:
      1. Warm NSE session (hit homepage to get cookies)
      2. Try NSE JSON API first (more reliable, uses cookies)
      3. Fall back to NSE archives CSV for any day that JSON API misses
    """
    records: list[dict] = []
    days_to_try = _last_n_trading_days(5)

    async with httpx.AsyncClient(
        timeout=20,
        follow_redirects=True,
        headers=NSE_HEADERS,
    ) as client:
        # Warm session — critical for NSE cookie auth
        session_ok = await _warm_nse_session(client)
        if not session_ok:
            logger.warning("NSE session warm failed — FII data fetch may be blocked")

        for d in days_to_try:
            # Try JSON API first (requires cookies)
            parsed = await _fetch_via_json_api(client, d)

            # If JSON API returns nothing, fall back to CSV archive
            if not parsed:
                parsed = await _fetch_via_csv(client, d)

            if parsed:
                records.append({"trade_date": d.isoformat(), **parsed})
                logger.info(f"FII deriv record fetched for {d.isoformat()}")
            else:
                logger.debug(f"No FII data available for {d.isoformat()} (market holiday or data not yet published)")

    if not records:
        logger.warning(
            "fetch_nse_participant_oi: no records retrieved. "
            "Possible causes: NSE blocking (cookies), data not yet published, or market holidays. "
            "Check backend logs and try the /fii-derivatives/refresh endpoint after 6 PM IST."
        )

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
