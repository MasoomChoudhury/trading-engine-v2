"""
Weekly & Monthly Pivot Levels — Gap item 5.

Fetches the last 45 days of Nifty 50 daily candles, aggregates into
last-closed-week and last-closed-month OHLC, then computes standard
CPR + R1/R2/R3 / S1/S2/S3 pivot levels for each timeframe.

Pivot formulas (classic):
  PP  = (H + L + C) / 3
  R1  = 2·PP − L
  R2  = PP + (H − L)
  R3  = H + 2·(PP − L)
  S1  = 2·PP − H
  S2  = PP − (H − L)
  S3  = L − 2·(H − PP)
  BC  = (H + L) / 2          ← CPR bottom
  TC  = (PP − BC) + PP       ← CPR top
"""
from datetime import datetime, timedelta, timezone, date as date_type
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
NIFTY_KEY = "NSE_INDEX|Nifty 50"


def _ist_today() -> date_type:
    return datetime.now(IST).date()


def _pivot_levels(h: float, l: float, c: float, label: str) -> dict:
    """Compute full pivot level set for given H/L/C."""
    pp  = (h + l + c) / 3
    r1  = 2 * pp - l
    r2  = pp + (h - l)
    r3  = h + 2 * (pp - l)
    s1  = 2 * pp - h
    s2  = pp - (h - l)
    s3  = l - 2 * (h - pp)
    bc  = (h + l) / 2
    tc  = (pp - bc) + pp

    def r(v: float) -> float:
        return round(v, 2)

    return {
        "label": label,
        "high": r(h),
        "low":  r(l),
        "close": r(c),
        "pp":  r(pp),
        "r1":  r(r1),
        "r2":  r(r2),
        "r3":  r(r3),
        "s1":  r(s1),
        "s2":  r(s2),
        "s3":  r(s3),
        "bc":  r(bc),
        "tc":  r(tc),
    }


async def get_pivot_levels() -> dict:
    """
    Return weekly and monthly pivot levels for Nifty 50.
    Aggregates last 45 days of daily candles into weekly/monthly OHLC,
    then uses the last CLOSED week / month for calculation.
    """
    from app.services.upstox_client import upstox_client

    today = _ist_today()
    from_date = (today - timedelta(days=45)).isoformat()
    to_date   = today.isoformat()

    try:
        candles = await upstox_client.get_historical_candles(
            NIFTY_KEY, "1day", to_date, from_date
        )
    except Exception as e:
        logger.warning(f"pivot_service: candle fetch failed — {e}")
        return {"error": str(e), "weekly": None, "monthly": None}

    if not candles:
        return {"error": "no candle data", "weekly": None, "monthly": None}

    # Parse candles: [ts, open, high, low, close, volume, oi]
    daily: list[dict] = []
    for c in candles:
        try:
            ts   = c[0][:10]          # "YYYY-MM-DD"
            d    = date_type.fromisoformat(ts)
            daily.append({
                "date":  d,
                "open":  float(c[1]),
                "high":  float(c[2]),
                "low":   float(c[3]),
                "close": float(c[4]),
            })
        except Exception:
            continue

    if not daily:
        return {"error": "candle parse failed", "weekly": None, "monthly": None}

    daily.sort(key=lambda x: x["date"])

    # ── Weekly aggregation ────────────────────────────────────────────────────
    from collections import defaultdict
    import calendar

    def iso_week(d: date_type) -> str:
        yr, wk, _ = d.isocalendar()
        return f"{yr}-W{wk:02d}"

    weeks: dict[str, list[dict]] = defaultdict(list)
    for row in daily:
        weeks[iso_week(row["date"])].append(row)

    # Sort week keys; the last closed week is the most recent one that ended before today
    current_week = iso_week(today)
    closed_weeks = sorted([k for k in weeks if k < current_week])
    last_week = closed_weeks[-1] if closed_weeks else None

    weekly_pivot = None
    if last_week:
        wd = weeks[last_week]
        wh = max(r["high"]  for r in wd)
        wl = min(r["low"]   for r in wd)
        wc = wd[-1]["close"]
        wo = wd[0]["open"]
        first_day = wd[0]["date"]
        last_day  = wd[-1]["date"]
        weekly_pivot = {
            **_pivot_levels(wh, wl, wc, "Weekly"),
            "period_open": wo,
            "period_start": first_day.isoformat(),
            "period_end":   last_day.isoformat(),
        }

    # ── Monthly aggregation ───────────────────────────────────────────────────
    def month_key(d: date_type) -> str:
        return f"{d.year}-{d.month:02d}"

    months: dict[str, list[dict]] = defaultdict(list)
    for row in daily:
        months[month_key(row["date"])].append(row)

    current_month = month_key(today)
    closed_months = sorted([k for k in months if k < current_month])
    last_month = closed_months[-1] if closed_months else None

    monthly_pivot = None
    if last_month:
        md = months[last_month]
        mh = max(r["high"]  for r in md)
        ml = min(r["low"]   for r in md)
        mc = md[-1]["close"]
        mo = md[0]["open"]
        first_day = md[0]["date"]
        last_day  = md[-1]["date"]
        monthly_pivot = {
            **_pivot_levels(mh, ml, mc, "Monthly"),
            "period_open": mo,
            "period_start": first_day.isoformat(),
            "period_end":   last_day.isoformat(),
        }

    # ── Current spot for context ──────────────────────────────────────────────
    spot = None
    try:
        price_data = await upstox_client.get_ltp(NIFTY_KEY)
        spot = float(price_data.get("last_price", 0)) or None
    except Exception:
        pass

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "spot": spot,
        "weekly":  weekly_pivot,
        "monthly": monthly_pivot,
    }
