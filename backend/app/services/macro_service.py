"""
Macro Calendar service — RBI MPC, US FOMC, US CPI, quarterly earnings events.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from loguru import logger
from sqlalchemy import text
from app.db.database import get_logs_session

IST = timezone(timedelta(hours=5, minutes=30))

SEED_EVENTS = [
    # RBI MPC
    {"event_date": "2025-04-09", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2025-06-06", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2025-08-08", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2025-10-09", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2025-12-06", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2026-02-07", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2026-04-09", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2026-06-06", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2026-08-07", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2026-10-08", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    {"event_date": "2026-12-05", "event_type": "rbi_mpc", "title": "RBI MPC Decision", "description": "RBI Monetary Policy Committee rate decision", "is_approximate": False},
    # US FOMC
    {"event_date": "2025-03-19", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2025-05-07", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2025-06-18", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2025-07-30", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2025-09-17", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2025-11-05", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2025-12-17", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-01-29", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-03-18", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-05-06", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-06-17", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-07-29", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-09-16", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-11-04", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    {"event_date": "2026-12-16", "event_type": "fomc", "title": "US FOMC Decision", "description": "Federal Open Market Committee rate decision and press conference", "is_approximate": False},
    # US CPI
    {"event_date": "2025-04-10", "event_type": "us_cpi", "title": "US CPI (Mar 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-05-13", "event_type": "us_cpi", "title": "US CPI (Apr 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-06-11", "event_type": "us_cpi", "title": "US CPI (May 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-07-15", "event_type": "us_cpi", "title": "US CPI (Jun 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-08-12", "event_type": "us_cpi", "title": "US CPI (Jul 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-09-10", "event_type": "us_cpi", "title": "US CPI (Aug 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-10-14", "event_type": "us_cpi", "title": "US CPI (Sep 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-11-12", "event_type": "us_cpi", "title": "US CPI (Oct 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2025-12-10", "event_type": "us_cpi", "title": "US CPI (Nov 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2026-01-14", "event_type": "us_cpi", "title": "US CPI (Dec 2025)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2026-02-11", "event_type": "us_cpi", "title": "US CPI (Jan 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2026-03-11", "event_type": "us_cpi", "title": "US CPI (Feb 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2026-04-10", "event_type": "us_cpi", "title": "US CPI (Mar 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": False},
    {"event_date": "2026-05-13", "event_type": "us_cpi", "title": "US CPI (Apr 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-06-10", "event_type": "us_cpi", "title": "US CPI (May 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-07-14", "event_type": "us_cpi", "title": "US CPI (Jun 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-08-12", "event_type": "us_cpi", "title": "US CPI (Jul 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-09-09", "event_type": "us_cpi", "title": "US CPI (Aug 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-10-14", "event_type": "us_cpi", "title": "US CPI (Sep 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-11-11", "event_type": "us_cpi", "title": "US CPI (Oct 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    {"event_date": "2026-12-09", "event_type": "us_cpi", "title": "US CPI (Nov 2026)", "description": "US Consumer Price Index — high impact on global risk sentiment and FII flows", "is_approximate": True},
    # Q4 FY2026 Earnings (Jan–Mar quarter results, Apr–May 2026)
    {"event_date": "2026-04-10", "event_type": "earnings", "title": "TCS Q4 FY26 Results", "description": "Tata Consultancy Services — bellwether for IT sector", "is_approximate": True},
    {"event_date": "2026-04-17", "event_type": "earnings", "title": "Infosys Q4 FY26 Results", "description": "Infosys earnings + FY27 guidance — major IT index mover", "is_approximate": True},
    {"event_date": "2026-04-18", "event_type": "earnings", "title": "Wipro Q4 FY26 Results", "description": "Wipro quarterly earnings", "is_approximate": True},
    {"event_date": "2026-04-19", "event_type": "earnings", "title": "HDFC Bank Q4 FY26 Results", "description": "Largest private bank — high Nifty weight", "is_approximate": True},
    {"event_date": "2026-04-23", "event_type": "earnings", "title": "Axis Bank Q4 FY26 Results", "description": "Axis Bank quarterly earnings", "is_approximate": True},
    {"event_date": "2026-04-25", "event_type": "earnings", "title": "Reliance Q4 FY26 Results", "description": "Reliance Industries — top Nifty weight", "is_approximate": True},
    {"event_date": "2026-04-26", "event_type": "earnings", "title": "ICICI Bank Q4 FY26 Results", "description": "ICICI Bank — major financials weight", "is_approximate": True},
    {"event_date": "2026-04-29", "event_type": "earnings", "title": "Bajaj Finance Q4 FY26 Results", "description": "Bajaj Finance quarterly earnings", "is_approximate": True},
    {"event_date": "2026-05-03", "event_type": "earnings", "title": "Kotak Mahindra Q4 FY26 Results", "description": "Kotak Mahindra Bank quarterly earnings", "is_approximate": True},
    {"event_date": "2026-05-10", "event_type": "earnings", "title": "SBI Q4 FY26 Results", "description": "State Bank of India quarterly earnings", "is_approximate": True},
    {"event_date": "2026-05-14", "event_type": "earnings", "title": "L&T Q4 FY26 Results", "description": "Larsen & Toubro quarterly earnings", "is_approximate": True},
    # Q1 FY2027 Earnings (Apr–Jun quarter, Jul–Aug 2026)
    {"event_date": "2026-07-10", "event_type": "earnings", "title": "TCS Q1 FY27 Results", "description": "TCS quarterly earnings", "is_approximate": True},
    {"event_date": "2026-07-17", "event_type": "earnings", "title": "Infosys Q1 FY27 Results", "description": "Infosys earnings + guidance update", "is_approximate": True},
    {"event_date": "2026-07-19", "event_type": "earnings", "title": "HDFC Bank Q1 FY27 Results", "description": "HDFC Bank quarterly earnings", "is_approximate": True},
    {"event_date": "2026-07-26", "event_type": "earnings", "title": "ICICI Bank Q1 FY27 Results", "description": "ICICI Bank quarterly earnings", "is_approximate": True},
]


async def ensure_macro_table():
    """Create macro_events table if it doesn't exist."""
    async with get_logs_session() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS macro_events (
                id SERIAL PRIMARY KEY,
                event_date DATE NOT NULL,
                event_type VARCHAR(32) NOT NULL,
                title VARCHAR(256) NOT NULL,
                description TEXT,
                is_approximate BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_macro_events_date ON macro_events(event_date)"
        ))
        await session.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_events_unique "
            "ON macro_events(event_date, event_type, title)"
        ))
        await session.commit()
    logger.info("macro_events table ensured")


async def seed_macro_events():
    """Upsert known events — new entries in SEED_EVENTS are always added, no duplicates."""
    inserted = 0
    async with get_logs_session() as session:
        for ev in SEED_EVENTS:
            result = await session.execute(text("""
                INSERT INTO macro_events (event_date, event_type, title, description, is_approximate)
                VALUES (:event_date, :event_type, :title, :description, :is_approximate)
                ON CONFLICT (event_date, event_type, title) DO NOTHING
            """), {
                "event_date": date.fromisoformat(ev["event_date"]),
                "event_type": ev["event_type"],
                "title": ev["title"],
                "description": ev.get("description", ""),
                "is_approximate": ev.get("is_approximate", False),
            })
            inserted += result.rowcount
        await session.commit()
    if inserted:
        logger.info(f"Seeded {inserted} new macro events")


async def get_events(days_back: int = 14, days_forward: int = 90) -> list[dict]:
    """Fetch macro events in a date window around today."""
    today = datetime.now(IST).date()
    from_date = today - timedelta(days=days_back)
    to_date = today + timedelta(days=days_forward)

    async with get_logs_session() as session:
        result = await session.execute(text("""
            SELECT id, event_date, event_type, title, description, is_approximate
            FROM macro_events
            WHERE event_date BETWEEN :from_date AND :to_date
            ORDER BY event_date ASC
        """), {"from_date": from_date, "to_date": to_date})
        rows = result.fetchall()

    events = []
    for row in rows:
        ev_date = row[1]
        if isinstance(ev_date, str):
            ev_date = date.fromisoformat(ev_date)
        days_to = (ev_date - today).days
        events.append({
            "id": row[0],
            "event_date": ev_date.isoformat(),
            "event_type": row[2],
            "title": row[3],
            "description": row[4] or "",
            "is_approximate": bool(row[5]),
            "days_to_event": days_to,
            "is_past": days_to < 0,
            "is_today": days_to == 0,
        })
    return events


async def add_event(event_date: str, event_type: str, title: str,
                    description: str = "", is_approximate: bool = False) -> dict:
    """Add a custom macro event."""
    async with get_logs_session() as session:
        result = await session.execute(text("""
            INSERT INTO macro_events (event_date, event_type, title, description, is_approximate)
            VALUES (:event_date, :event_type, :title, :description, :is_approximate)
            RETURNING id
        """), {
            "event_date": date.fromisoformat(event_date),
            "event_type": event_type,
            "title": title,
            "description": description,
            "is_approximate": is_approximate,
        })
        row = result.fetchone()
        await session.commit()
    return {"id": row[0], "event_date": event_date, "event_type": event_type, "title": title}
