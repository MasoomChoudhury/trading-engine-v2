"""
Nifty Futures Volume Analytics Service.
Fetches near-month and far-month NIFTY futures candles from Upstox
and computes volume analytics: rollover ratio, z-scores, expiry-week flags.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import math
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _last_thursday_of_month(year: int, month: int) -> datetime:
    """Return the last Thursday of the given month."""
    # Start from last day of month
    if month == 12:
        last_day = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = datetime(year, month + 1, 1) - timedelta(days=1)
    # Walk back to Thursday (weekday 3)
    days_back = (last_day.weekday() - 3) % 7
    return last_day - timedelta(days=days_back)


def is_expiry_week(date_str: str) -> bool:
    """Return True if the date falls in the same week as the last Thursday expiry."""
    try:
        dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        expiry = _last_thursday_of_month(dt.year, dt.month)
        # Expiry week = Mon–Thu of expiry week
        week_start = expiry - timedelta(days=expiry.weekday())  # Monday
        week_end = expiry
        return week_start.date() <= dt.date() <= week_end.date()
    except Exception:
        return False


async def get_active_futures() -> list[dict[str, Any]]:
    """
    Search for active NIFTY futures contracts.
    Returns list sorted by expiry ascending (near-month first).
    """
    from app.services.upstox_client import token_manager
    import httpx

    token = await token_manager.get_access_token()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "https://api.upstox.com/v2/instruments/search",
            params={"query": "NIFTYFUT"},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        contracts = data.get("data", [])
        futures = [c for c in contracts if c.get("instrument_type") == "FUT"
                   and c.get("underlying_symbol") == "NIFTY"]
        futures.sort(key=lambda x: x.get("expiry", ""))
        logger.info(f"Found {len(futures)} active NIFTY futures contracts")
        return futures


async def fetch_futures_daily_candles(
    instrument_key: str,
    days: int = 90,
) -> list[list[Any]]:
    """
    Fetch daily OHLCV candles for a futures instrument.
    Returns list of [timestamp_str, open, high, low, close, volume, oi].
    """
    from app.services.upstox_client import token_manager
    import httpx
    import urllib.parse

    token = await token_manager.get_access_token()
    to_date = ist_now().strftime("%Y-%m-%d")
    encoded_key = urllib.parse.quote(instrument_key, safe="")

    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"https://api.upstox.com/v2/historical-candle/{encoded_key}/day/{to_date}"
        resp = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        candles = data.get("data", {}).get("candles", [])
        logger.info(f"Fetched {len(candles)} daily candles for {instrument_key}")
        return candles  # already newest-first from API


def compute_futures_analytics(
    near_candles: list[list[Any]],
    far_candles: list[list[Any]],
    near_expiry: str,
    far_expiry: str,
    near_lot_size: int = 65,
    zscore_window: int = 20,
) -> dict[str, Any]:
    """
    Compute volume analytics from near and far month futures candles.

    Returns:
        {
          "chart_data": [...],      # per-date combined data for all 3 charts
          "summary": {...},          # aggregate stats
          "near_expiry": str,
          "far_expiry": str,
        }
    """
    # Build date-keyed dicts
    near_map: dict[str, dict] = {}
    for c in near_candles:
        date_str = str(c[0])[:10]
        near_map[date_str] = {
            "open": _safe_float(c[1]),
            "high": _safe_float(c[2]),
            "low": _safe_float(c[3]),
            "close": _safe_float(c[4]),
            "volume": int(c[5]) if c[5] else 0,
            "oi": int(c[6]) if len(c) > 6 and c[6] else 0,
        }

    far_map: dict[str, dict] = {}
    for c in far_candles:
        date_str = str(c[0])[:10]
        far_map[date_str] = {
            "open": _safe_float(c[1]),
            "high": _safe_float(c[2]),
            "low": _safe_float(c[3]),
            "close": _safe_float(c[4]),
            "volume": int(c[5]) if c[5] else 0,
            "oi": int(c[6]) if len(c) > 6 and c[6] else 0,
        }

    # Union of all dates, sorted ascending
    all_dates = sorted(set(near_map.keys()) | set(far_map.keys()))

    # Build per-date rows
    rows = []
    for date in all_dates:
        near = near_map.get(date, {})
        far = far_map.get(date, {})
        near_vol = near.get("volume", 0) or 0
        far_vol = far.get("volume", 0) or 0
        combined_vol = near_vol + far_vol
        rollover_pct = (far_vol / combined_vol * 100) if combined_vol > 0 else 0.0
        rows.append({
            "date": date,
            "near_volume": near_vol,
            "far_volume": far_vol,
            "combined_volume": combined_vol,
            "rollover_pct": round(rollover_pct, 2),
            "near_oi": near.get("oi", 0) or 0,
            "far_oi": far.get("oi", 0) or 0,
            "near_close": near.get("close"),
            "far_close": far.get("close"),
            "is_expiry_week": is_expiry_week(date),
        })

    # Compute rolling z-score on combined_volume
    vols = [r["combined_volume"] for r in rows]
    for i, row in enumerate(rows):
        window = vols[max(0, i - zscore_window + 1): i + 1]
        if len(window) >= 5:
            mean = sum(window) / len(window)
            variance = sum((x - mean) ** 2 for x in window) / len(window)
            std = math.sqrt(variance)
            row["volume_zscore"] = round((vols[i] - mean) / std, 2) if std > 0 else 0.0
        else:
            row["volume_zscore"] = None

    # Summary stats
    valid_vols = [r["combined_volume"] for r in rows if r["combined_volume"] > 0]
    avg_volume = int(sum(valid_vols) / len(valid_vols)) if valid_vols else 0
    spike_count = sum(1 for r in rows if (r.get("volume_zscore") or 0) > 2.0)
    latest = rows[-1] if rows else {}
    current_rollover = latest.get("rollover_pct", 0.0)
    current_near_oi = latest.get("near_oi", 0)

    # Avg rollover in last 10 days
    recent_rollovers = [r["rollover_pct"] for r in rows[-10:] if r["combined_volume"] > 0]
    avg_rollover = round(sum(recent_rollovers) / len(recent_rollovers), 1) if recent_rollovers else 0.0

    return {
        "chart_data": rows,
        "near_expiry": near_expiry,
        "far_expiry": far_expiry,
        "near_lot_size": near_lot_size,
        "summary": {
            "avg_daily_volume": avg_volume,
            "volume_spike_count": spike_count,
            "current_rollover_pct": round(current_rollover, 1),
            "avg_rollover_pct_10d": avg_rollover,
            "current_near_oi": current_near_oi,
            "total_days": len(rows),
        },
    }
