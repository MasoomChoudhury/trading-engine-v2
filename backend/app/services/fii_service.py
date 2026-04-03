"""
NSE FII/DII daily equity flow data.
Fetches from NSE's public CSV endpoint and stores in PostgreSQL logs DB.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone, date as date_type
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


# ── Table DDL ─────────────────────────────────────────────────────────────────

_CREATE_FII_TABLE = """
CREATE TABLE IF NOT EXISTS fii_daily_data (
    trade_date   DATE        NOT NULL,
    category     VARCHAR(10) NOT NULL,   -- 'FII' or 'DII'
    buy_value    NUMERIC(18, 2),
    sell_value   NUMERIC(18, 2),
    net_value    NUMERIC(18, 2),
    PRIMARY KEY (trade_date, category)
);
"""


async def ensure_fii_table() -> None:
    """Create fii_daily_data table if it doesn't exist."""
    from app.db.database import get_logs_session
    from sqlalchemy import text
    async with get_logs_session() as session:
        await session.execute(text(_CREATE_FII_TABLE))
        await session.commit()


# ── NSE fetch ─────────────────────────────────────────────────────────────────

_NSE_FII_URL = "https://www.nseindia.com/api/fiidiiTradeReact"
_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Referer": "https://www.nseindia.com/reports/fii-dii",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


async def fetch_nse_fii_dii() -> list[dict]:
    """
    Fetch FII/DII data from NSE API.
    Returns list of {trade_date, category, buy_value, sell_value, net_value}.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            # First hit homepage to get cookies
            await client.get("https://www.nseindia.com", headers=_NSE_HEADERS)
            r = await client.get(_NSE_FII_URL, headers=_NSE_HEADERS)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning(f"NSE FII fetch failed: {e}")
        return []

    records = []
    for row in (data if isinstance(data, list) else []):
        try:
            raw_date = row.get("date") or row.get("tradeDate") or ""
            # NSE dates come as "01-Jan-2026" or "2026-01-01"
            if not raw_date:
                continue
            try:
                trade_dt = datetime.strptime(raw_date, "%d-%b-%Y").date()
            except ValueError:
                trade_dt = date_type.fromisoformat(raw_date[:10])

            def _parse(val) -> float:
                if val is None or val == "":
                    return 0.0
                return float(str(val).replace(",", ""))

            # FII row
            fii_buy  = _parse(row.get("fiiBuyValue")  or row.get("FII_BUY_VALUE"))
            fii_sell = _parse(row.get("fiiSellValue") or row.get("FII_SELL_VALUE"))
            fii_net  = _parse(row.get("fiiNetValue")  or row.get("FII_NET_VALUE"))

            # DII row
            dii_buy  = _parse(row.get("diiBuyValue")  or row.get("DII_BUY_VALUE"))
            dii_sell = _parse(row.get("diiSellValue") or row.get("DII_SELL_VALUE"))
            dii_net  = _parse(row.get("diiNetValue")  or row.get("DII_NET_VALUE"))

            if fii_buy or fii_sell:
                records.append({
                    "trade_date": trade_dt,
                    "category": "FII",
                    "buy_value": fii_buy,
                    "sell_value": fii_sell,
                    "net_value": fii_net if fii_net else round(fii_buy - fii_sell, 2),
                })
            if dii_buy or dii_sell:
                records.append({
                    "trade_date": trade_dt,
                    "category": "DII",
                    "buy_value": dii_buy,
                    "sell_value": dii_sell,
                    "net_value": dii_net if dii_net else round(dii_buy - dii_sell, 2),
                })
        except Exception as e:
            logger.debug(f"Skipping FII row: {e}")

    return records


async def store_fii_records(records: list[dict]) -> int:
    """Upsert FII/DII records into fii_daily_data."""
    if not records:
        return 0
    from app.db.database import get_logs_session
    from sqlalchemy import text
    count = 0
    async with get_logs_session() as session:
        for r in records:
            await session.execute(text("""
                INSERT INTO fii_daily_data (trade_date, category, buy_value, sell_value, net_value)
                VALUES (:trade_date, :category, :buy_value, :sell_value, :net_value)
                ON CONFLICT (trade_date, category) DO UPDATE SET
                    buy_value=EXCLUDED.buy_value,
                    sell_value=EXCLUDED.sell_value,
                    net_value=EXCLUDED.net_value
            """), r)
            count += 1
        await session.commit()
    return count


async def fetch_and_store_fii() -> int:
    """Fetch from NSE and persist. Returns rows stored."""
    records = await fetch_nse_fii_dii()
    if not records:
        return 0
    return await store_fii_records(records)


# ── Query ─────────────────────────────────────────────────────────────────────

async def get_fii_history(days: int = 30) -> dict:
    """
    Return FII/DII flows for last N trading days.
    Also computes rolling 5-day net and cumulative net.
    """
    from app.db.database import get_logs_session
    from sqlalchemy import text

    cutoff = ist_now().date() - timedelta(days=days * 2)  # buffer for weekends
    async with get_logs_session() as session:
        rows = (await session.execute(text("""
            SELECT trade_date, category, buy_value, sell_value, net_value
            FROM fii_daily_data
            WHERE trade_date >= :cutoff
            ORDER BY trade_date ASC
        """), {"cutoff": cutoff})).mappings().all()

    # Separate FII and DII
    fii_map: dict[str, dict] = {}
    dii_map: dict[str, dict] = {}
    for r in rows:
        d = str(r["trade_date"])
        entry = {
            "buy": float(r["buy_value"] or 0),
            "sell": float(r["sell_value"] or 0),
            "net": float(r["net_value"] or 0),
        }
        if r["category"] == "FII":
            fii_map[d] = entry
        else:
            dii_map[d] = entry

    all_dates = sorted(set(list(fii_map.keys()) + list(dii_map.keys())))[-days:]

    series = []
    cum_fii = 0.0
    cum_dii = 0.0
    for d in all_dates:
        fii = fii_map.get(d, {"buy": 0, "sell": 0, "net": 0})
        dii = dii_map.get(d, {"buy": 0, "sell": 0, "net": 0})
        cum_fii += fii["net"]
        cum_dii += dii["net"]
        series.append({
            "date": d,
            "fii_buy": round(fii["buy"] / 100, 2),   # ₹Cr → ₹100Cr
            "fii_sell": round(fii["sell"] / 100, 2),
            "fii_net": round(fii["net"] / 100, 2),
            "dii_buy": round(dii["buy"] / 100, 2),
            "dii_sell": round(dii["sell"] / 100, 2),
            "dii_net": round(dii["net"] / 100, 2),
            "combined_net": round((fii["net"] + dii["net"]) / 100, 2),
            "cum_fii": round(cum_fii / 100, 2),
            "cum_dii": round(cum_dii / 100, 2),
        })

    # Latest summary
    latest = series[-1] if series else {}
    fii_5d = sum(s["fii_net"] for s in series[-5:]) if len(series) >= 5 else None
    dii_5d = sum(s["dii_net"] for s in series[-5:]) if len(series) >= 5 else None

    return {
        "series": series,
        "latest_date": latest.get("date"),
        "latest_fii_net": latest.get("fii_net"),
        "latest_dii_net": latest.get("dii_net"),
        "fii_5d_net": round(fii_5d, 2) if fii_5d is not None else None,
        "dii_5d_net": round(dii_5d, 2) if dii_5d is not None else None,
        "fii_trend": "buying" if (fii_5d or 0) > 0 else "selling",
        "dii_trend": "buying" if (dii_5d or 0) > 0 else "selling",
        "data_points": len(series),
        "unit": "₹100Cr",
        "note": "Values in ₹100 Crore units. Source: NSE India.",
    }
