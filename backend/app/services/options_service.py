"""
Options OI & Sentiment Analytics Service.

Computes PCR trend, ATM straddle analysis, OI wall, OI change heatmap,
and max pain — with expiry-week noise suppression.
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone, date as date_type
from typing import Any, Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


def ist_today() -> str:
    return ist_now().strftime("%Y-%m-%d")


def atm_strike(spot: float, step: int = 50) -> float:
    return round(spot / step) * step


def days_to_expiry(expiry_str: str) -> int:
    expiry = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    today = ist_now().date()
    return (expiry - today).days


def is_expiry_week_date(date_str: str) -> bool:
    from app.services.futures_service import is_expiry_week
    return is_expiry_week(date_str)


# ── Expiry discovery ──────────────────────────────────────────────────────────

async def get_active_expiries() -> list[str]:
    """Return sorted upcoming Nifty option expiry dates."""
    from app.services.upstox_client import upstox_client
    contracts = await upstox_client.get_option_contracts("NSE_INDEX|Nifty 50")
    today = ist_today()
    expiries = sorted(set(
        c["expiry"] for c in contracts if c.get("expiry", "") >= today
    ))
    return expiries


# ── Chain fetch & parse ───────────────────────────────────────────────────────

async def fetch_chain(expiry: str) -> list[dict]:
    from app.services.upstox_client import upstox_client
    raw = await upstox_client.get_option_chain("NSE_INDEX|Nifty 50", expiry)
    return raw if isinstance(raw, list) else raw.get("data", [])


def _parse_md(md: dict) -> dict:
    return {
        "ltp": float(md.get("ltp") or 0),
        "volume": int(md.get("volume") or 0),
        "oi": int(md.get("oi") or 0),
        "prev_oi": int(md.get("prev_oi") or 0),
    }


def parse_chain(chain: list[dict]) -> list[dict]:
    records = []
    for item in chain:
        ce_md = _parse_md(item.get("call_options", {}).get("market_data", {}))
        pe_md = _parse_md(item.get("put_options", {}).get("market_data", {}))
        records.append({
            "strike": float(item.get("strike_price", 0)),
            "spot": float(item.get("underlying_spot_price") or 0),
            "ce_oi": ce_md["oi"],
            "pe_oi": pe_md["oi"],
            "ce_prev_oi": ce_md["prev_oi"],
            "pe_prev_oi": pe_md["prev_oi"],
            "ce_volume": ce_md["volume"],
            "pe_volume": pe_md["volume"],
            "ce_ltp": ce_md["ltp"],
            "pe_ltp": pe_md["ltp"],
        })
    return records


# ── Analytics computations ────────────────────────────────────────────────────

def compute_max_pain(records: list[dict]) -> float:
    strikes = [r["strike"] for r in records]
    if not strikes:
        return 0.0
    min_pain = float("inf")
    result = strikes[0]
    for s in strikes:
        pain = sum(
            r["ce_oi"] * max(0.0, s - r["strike"]) +
            r["pe_oi"] * max(0.0, r["strike"] - s)
            for r in records
        )
        if pain < min_pain:
            min_pain = pain
            result = s
    return result


def _ema(values: list[float], period: int) -> list[Optional[float]]:
    result: list[Optional[float]] = [None] * len(values)
    k = 2 / (period + 1)
    ema_val: Optional[float] = None
    for i, v in enumerate(values):
        if v is None:
            continue
        if ema_val is None:
            ema_val = v
        else:
            ema_val = v * k + ema_val * (1 - k)
        result[i] = round(ema_val, 4)
    return result


def compute_current_analytics(records: list[dict], expiry: str) -> dict:
    """Compute all analytics from today's parsed chain snapshot."""
    if not records:
        return {}

    spot = next((r["spot"] for r in records if r["spot"] > 0), 0.0)
    atm = atm_strike(spot)
    dte = days_to_expiry(expiry)

    total_ce_oi = sum(r["ce_oi"] for r in records)
    total_pe_oi = sum(r["pe_oi"] for r in records)
    total_ce_vol = sum(r["ce_volume"] for r in records)
    total_pe_vol = sum(r["pe_volume"] for r in records)

    pcr_oi = round(total_pe_oi / total_ce_oi, 4) if total_ce_oi > 0 else 0.0
    pcr_vol = round(total_pe_vol / total_ce_vol, 4) if total_ce_vol > 0 else 0.0

    # Prev-day PCR from prev_oi
    total_ce_prev_oi = sum(r["ce_prev_oi"] for r in records)
    total_pe_prev_oi = sum(r["pe_prev_oi"] for r in records)
    pcr_oi_prev = round(total_pe_prev_oi / total_ce_prev_oi, 4) if total_ce_prev_oi > 0 else None

    # ATM straddle
    atm_recs = [r for r in records if r["strike"] == atm]
    atm_rec = atm_recs[0] if atm_recs else {}
    straddle_premium = round(
        (atm_rec.get("ce_ltp") or 0) + (atm_rec.get("pe_ltp") or 0), 2
    )
    atm_ce_vol = atm_rec.get("ce_volume") or 0
    atm_pe_vol = atm_rec.get("pe_volume") or 0

    # OI wall (ATM ± 500 pts)
    atm_range = [r for r in records if abs(r["strike"] - atm) <= 500]
    if atm_range:
        oi_wall_rec = max(atm_range, key=lambda r: r["ce_oi"] + r["pe_oi"])
        oi_wall_strike = oi_wall_rec["strike"]
    else:
        oi_wall_strike = atm

    max_pain = compute_max_pain(records)

    # OI wall chart data (ATM ± 500 pts), sorted by strike
    oi_wall_data = sorted(
        [
            {
                "strike": r["strike"],
                "ce_oi": r["ce_oi"],
                "pe_oi": r["pe_oi"],
                "total_oi": r["ce_oi"] + r["pe_oi"],
            }
            for r in records
            if abs(r["strike"] - atm) <= 500
        ],
        key=lambda x: x["strike"],
    )

    # Today's OI change from prev_oi (ATM ± 500 pts)
    oi_change_today = sorted(
        [
            {
                "strike": r["strike"],
                "ce_change": r["ce_oi"] - r["ce_prev_oi"],
                "pe_change": r["pe_oi"] - r["pe_prev_oi"],
            }
            for r in records
            if abs(r["strike"] - atm) <= 500
        ],
        key=lambda x: x["strike"],
    )

    today = ist_today()
    return {
        "spot_price": spot,
        "atm_strike": atm,
        "expiry": expiry,
        "days_to_expiry": dte,
        "is_expiry_week": is_expiry_week_date(today),
        "pcr_oi": pcr_oi,
        "pcr_vol": pcr_vol,
        "pcr_oi_prev": pcr_oi_prev,
        "straddle_premium": straddle_premium,
        "atm_ce_vol": atm_ce_vol,
        "atm_pe_vol": atm_pe_vol,
        "oi_wall_strike": oi_wall_strike,
        "max_pain": max_pain,
        "oi_wall_data": oi_wall_data,
        "oi_change_today": oi_change_today,
    }


# ── DB: save & load EOD snapshots ─────────────────────────────────────────────

async def save_options_eod(expiry: str, records: list[dict]) -> None:
    """Persist today's options EOD snapshot to the database."""
    from app.db.database import get_ts_session
    from sqlalchemy import text

    today = ist_today()
    if not records:
        return

    spot = next((r["spot"] for r in records if r["spot"] > 0), 0.0)

    async with get_ts_session() as session:
        for r in records:
            from datetime import date as date_type
            await session.execute(
                text("""
                    INSERT INTO options_eod_snapshots
                        (date, expiry, strike, ce_oi, pe_oi, ce_volume, pe_volume, ce_ltp, pe_ltp, spot_price)
                    VALUES
                        (:date, :expiry, :strike, :ce_oi, :pe_oi, :ce_vol, :pe_vol, :ce_ltp, :pe_ltp, :spot)
                    ON CONFLICT (date, expiry, strike) DO UPDATE SET
                        ce_oi = EXCLUDED.ce_oi,
                        pe_oi = EXCLUDED.pe_oi,
                        ce_volume = EXCLUDED.ce_volume,
                        pe_volume = EXCLUDED.pe_volume,
                        ce_ltp = EXCLUDED.ce_ltp,
                        pe_ltp = EXCLUDED.pe_ltp,
                        spot_price = EXCLUDED.spot_price
                """),
                {
                    "date": date_type.fromisoformat(today),
                    "expiry": date_type.fromisoformat(expiry),
                    "strike": r["strike"],
                    "ce_oi": r["ce_oi"],
                    "pe_oi": r["pe_oi"],
                    "ce_vol": r["ce_volume"],
                    "pe_vol": r["pe_volume"],
                    "ce_ltp": r["ce_ltp"],
                    "pe_ltp": r["pe_ltp"],
                    "spot": spot,
                },
            )
        await session.commit()
    logger.info(f"Saved {len(records)} options EOD rows for {expiry} on {today}")


async def load_options_history(expiry: str, days: int = 60) -> list[dict]:
    """
    Load historical daily PCR, straddle, ATM strike from DB.
    Returns list of dicts ordered by date ascending.
    Each dict: date, pcr_oi, pcr_vol, atm_strike, straddle_vol_ce, straddle_vol_pe,
                total_straddle_vol, is_expiry_week, spot_price
    """
    from app.db.database import get_ts_session
    from sqlalchemy import text

    from datetime import date as date_type
    expiry_date = date_type.fromisoformat(expiry)
    cutoff = ist_now().date() - timedelta(days=days)

    async with get_ts_session() as session:
        result = await session.execute(
            text("""
                SELECT
                    date,
                    SUM(ce_oi)      AS total_ce_oi,
                    SUM(pe_oi)      AS total_pe_oi,
                    SUM(ce_volume)  AS total_ce_vol,
                    SUM(pe_volume)  AS total_pe_vol,
                    MAX(spot_price) AS spot_price
                FROM options_eod_snapshots
                WHERE expiry = :expiry
                  AND date >= :cutoff
                GROUP BY date
                ORDER BY date ASC
            """),
            {"expiry": expiry_date, "cutoff": cutoff},
        )
        rows = result.mappings().all()

    if not rows:
        return []

    # Compute ATM straddle vol per day from stored per-strike data
    async with get_ts_session() as session:
        atm_result = await session.execute(
            text("""
                SELECT
                    o.date,
                    o.spot_price,
                    o.strike,
                    o.ce_volume,
                    o.pe_volume
                FROM options_eod_snapshots o
                WHERE o.expiry = :expiry
                  AND o.date >= :cutoff
                ORDER BY o.date ASC, o.strike ASC
            """),
            {"expiry": expiry_date, "cutoff": cutoff},
        )
        strike_rows = atm_result.mappings().all()

    # Build per-date strike lookup for ATM straddle vol
    from collections import defaultdict
    date_strikes: dict[str, list] = defaultdict(list)
    for sr in strike_rows:
        date_str = str(sr["date"])
        date_strikes[date_str].append(sr)

    history = []
    for row in rows:
        date_str = str(row["date"])
        ce_oi = int(row["total_ce_oi"] or 0)
        pe_oi = int(row["total_pe_oi"] or 0)
        ce_vol = int(row["total_ce_vol"] or 0)
        pe_vol = int(row["total_pe_vol"] or 0)
        spot = float(row["spot_price"] or 0)
        pcr_oi = round(pe_oi / ce_oi, 4) if ce_oi > 0 else 0.0
        pcr_vol = round(pe_vol / ce_vol, 4) if ce_vol > 0 else 0.0

        # Find ATM strike for this day
        day_atm = atm_strike(spot) if spot > 0 else 0
        ce_straddle_vol = 0
        pe_straddle_vol = 0
        for sr in date_strikes.get(date_str, []):
            if float(sr["strike"]) == day_atm:
                ce_straddle_vol = int(sr["ce_volume"] or 0)
                pe_straddle_vol = int(sr["pe_volume"] or 0)
                break

        history.append({
            "date": date_str,
            "pcr_oi": pcr_oi,
            "pcr_vol": pcr_vol,
            "atm_strike": day_atm,
            "ce_straddle_vol": ce_straddle_vol,
            "pe_straddle_vol": pe_straddle_vol,
            "total_straddle_vol": ce_straddle_vol + pe_straddle_vol,
            "spot_price": spot,
            "is_expiry_week": is_expiry_week_date(date_str),
        })

    return history


async def load_oi_heatmap(expiry: str, days: int = 10) -> dict:
    """
    Load per-strike OI change data for last N days (ATM ± 500 pts).
    Returns { dates, strikes, rows: [{strike, ce_changes, pe_changes}] }
    """
    from app.db.database import get_ts_session
    from sqlalchemy import text

    from datetime import date as date_type
    expiry_date = date_type.fromisoformat(expiry)
    heatmap_cutoff = ist_now().date() - timedelta(days=days * 3)

    async with get_ts_session() as session:
        # Get the distinct dates first
        date_result = await session.execute(
            text("""
                SELECT DISTINCT date FROM options_eod_snapshots
                WHERE expiry = :expiry AND date >= :cutoff
                ORDER BY date DESC LIMIT :days
            """),
            {"expiry": expiry_date, "cutoff": heatmap_cutoff, "days": days},
        )
        raw_dates = [str(r[0]) for r in date_result.all()]
        raw_dates.sort()

        if not raw_dates:
            return {"dates": [], "strikes": [], "rows": []}

        # Get strike data for those dates
        parsed_dates = [date_type.fromisoformat(d) for d in raw_dates]
        rows_result = await session.execute(
            text("""
                SELECT date, strike, ce_oi, pe_oi, spot_price
                FROM options_eod_snapshots
                WHERE expiry = :expiry
                  AND date = ANY(:dates)
                ORDER BY date ASC, strike ASC
            """),
            {"expiry": expiry_date, "dates": parsed_dates},
        )
        data = rows_result.mappings().all()

    # Build date × strike matrix
    from collections import defaultdict
    matrix: dict[str, dict[float, dict]] = defaultdict(dict)
    for row in data:
        matrix[str(row["date"])][float(row["strike"])] = {
            "ce_oi": int(row["ce_oi"] or 0),
            "pe_oi": int(row["pe_oi"] or 0),
        }

    # Determine ATM from latest date's spot price, filter ±500 pts
    latest_date = raw_dates[-1] if raw_dates else ""
    latest_strikes = matrix.get(latest_date, {})
    all_strikes_set = set()
    for d in raw_dates:
        all_strikes_set.update(matrix[d].keys())

    # Infer approximate ATM from most recent date
    spots_result: list[float] = []
    for d in reversed(raw_dates):
        strikes_in_day = matrix[d]
        if strikes_in_day:
            # Use midpoint of available strikes as rough ATM
            ks = sorted(strikes_in_day.keys())
            spots_result.append(ks[len(ks) // 2])
            break
    rough_atm = spots_result[0] if spots_result else 0
    relevant_strikes = sorted(
        s for s in all_strikes_set if abs(s - rough_atm) <= 500
    )

    # Compute day-over-day OI change
    rows_out = []
    for strike in relevant_strikes:
        ce_changes = []
        pe_changes = []
        for i, d in enumerate(raw_dates):
            curr_ce = matrix[d].get(strike, {}).get("ce_oi", 0)
            curr_pe = matrix[d].get(strike, {}).get("pe_oi", 0)
            if i == 0:
                ce_changes.append(0)
                pe_changes.append(0)
            else:
                prev_d = raw_dates[i - 1]
                prev_ce = matrix[prev_d].get(strike, {}).get("ce_oi", 0)
                prev_pe = matrix[prev_d].get(strike, {}).get("pe_oi", 0)
                ce_changes.append(curr_ce - prev_ce)
                pe_changes.append(curr_pe - prev_pe)
        rows_out.append({
            "strike": strike,
            "ce_changes": ce_changes,
            "pe_changes": pe_changes,
        })

    return {"dates": raw_dates, "strikes": relevant_strikes, "rows": rows_out}


# ── Main analytics builder ────────────────────────────────────────────────────

async def build_options_analytics(target_expiry: Optional[str] = None) -> dict:
    """
    Build the full options analytics payload for the API response.
    Auto-selects expiry (switches to next if < 3 DTE).
    """
    expiries = await get_active_expiries()
    if not expiries:
        return {"error": "No active expiries found"}

    near_expiry = expiries[0]
    next_expiry = expiries[1] if len(expiries) > 1 else None
    dte = days_to_expiry(near_expiry)

    # Auto-switch: use next expiry if < 3 days to near expiry
    use_next = dte <= 3 and next_expiry is not None
    active_expiry = target_expiry or (next_expiry if use_next else near_expiry)

    raw_chain = await fetch_chain(active_expiry)
    records = parse_chain(raw_chain)

    current = compute_current_analytics(records, active_expiry)
    current.update({
        "near_expiry": near_expiry,
        "next_expiry": next_expiry,
        "active_expiry": active_expiry,
        "use_next_expiry": use_next,
    })

    # Load DB history
    history = await load_options_history(active_expiry, days=60)
    heatmap = await load_oi_heatmap(active_expiry, days=10)

    # Build PCR history with EMA
    pcr_vals = [h["pcr_oi"] for h in history]
    pcr_emas = _ema(pcr_vals, period=10)
    for i, h in enumerate(history):
        h["pcr_oi_ema10"] = pcr_emas[i]

    # Straddle 20-day MA
    straddle_vols = [h["total_straddle_vol"] for h in history]
    for i, h in enumerate(history):
        window = straddle_vols[max(0, i - 19): i + 1]
        valid = [v for v in window if v > 0]
        h["straddle_ma20"] = int(sum(valid) / len(valid)) if valid else None

    # Enrich today's data with synthesized "yesterday" from prev_oi if no history yet
    today = ist_today()
    if not any(h["date"] == today for h in history):
        spot = current.get("spot_price", 0)
        total_ce_prev_oi = sum(r["ce_prev_oi"] for r in records)
        total_pe_prev_oi = sum(r["pe_prev_oi"] for r in records)
        total_ce_vol = sum(r["ce_volume"] for r in records)
        total_pe_vol = sum(r["pe_volume"] for r in records)

        # Inject today's live data as the latest point
        history.append({
            "date": today,
            "pcr_oi": current["pcr_oi"],
            "pcr_vol": current["pcr_vol"],
            "pcr_oi_ema10": None,
            "atm_strike": current["atm_strike"],
            "ce_straddle_vol": current["atm_ce_vol"],
            "pe_straddle_vol": current["atm_pe_vol"],
            "total_straddle_vol": current["atm_ce_vol"] + current["atm_pe_vol"],
            "straddle_ma20": None,
            "spot_price": spot,
            "is_expiry_week": current["is_expiry_week"],
        })

    return {
        "current": current,
        "pcr_history": history,
        "oi_wall": current.pop("oi_wall_data", []),
        "oi_change_today": current.pop("oi_change_today", []),
        "oi_heatmap": heatmap,
    }
