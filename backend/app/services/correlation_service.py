"""
Rolling Correlation Matrix Service.

Computes rolling Pearson correlations between Nifty 50 daily returns
and global indices (S&P 500, Nikkei 225, Hang Seng) over 10, 20, 30-day windows.

Interpretation:
  Correlation > 0.7  → Nifty is moving with the global index (globally driven)
  Correlation 0.3–0.7 → Moderate coupling
  Correlation < 0.3  → Decoupling — either domestic resilience or lagged catch-up

A RISING correlation on a down day = global sell-off dragging Nifty down (hard to fade)
A FALLING correlation on a down day = domestic strength / idiosyncratic move (more tradeable)
"""
from __future__ import annotations
import math
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

GLOBAL_SYMBOLS = {
    "sp500":    ("^GSPC", "S&P 500"),
    "nikkei":   ("^N225", "Nikkei 225"),
    "hang_seng": ("^HSI", "Hang Seng"),
}

WINDOWS = [10, 20, 30]

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


def _pearson(xs: list[float], ys: list[float]) -> Optional[float]:
    """Pearson correlation coefficient between two equal-length lists."""
    n = len(xs)
    if n < 4:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return round(num / (dx * dy), 4)


def _log_returns(prices: list[float]) -> list[float]:
    return [math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices))]


def _align_series(
    nifty_dates: list[str],
    nifty_closes: list[float],
    global_dates: list[str],
    global_closes: list[float],
) -> tuple[list[float], list[float]]:
    """
    Align Nifty and global series on common dates (inner join on date strings).
    Returns (nifty_closes_aligned, global_closes_aligned).
    """
    global_dict = dict(zip(global_dates, global_closes))
    nifty_aligned = []
    global_aligned = []
    for d, c in zip(nifty_dates, nifty_closes):
        d_short = d[:10]  # YYYY-MM-DD
        if d_short in global_dict:
            nifty_aligned.append(c)
            global_aligned.append(global_dict[d_short])
    return nifty_aligned, global_aligned


async def _fetch_yf_daily(ticker: str, days: int = 60) -> tuple[list[str], list[float]]:
    """
    Fetch daily closing prices from Yahoo Finance for the last `days` calendar days.
    Returns (dates_list, closes_list) in chronological order.
    """
    import httpx
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range={days}d"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=YF_HEADERS)
            resp.raise_for_status()
            data = resp.json()
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            return [], []
        r = result[0]
        timestamps = r.get("timestamp") or []
        closes = (r.get("indicators") or {}).get("quote", [{}])[0].get("close") or []
        # Convert Unix timestamps to date strings
        dates = [datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") for ts in timestamps]
        # Zip and filter out None closes
        pairs = [(d, c) for d, c in zip(dates, closes) if c is not None]
        if not pairs:
            return [], []
        return [p[0] for p in pairs], [float(p[1]) for p in pairs]
    except Exception as e:
        logger.warning(f"Yahoo Finance fetch failed for {ticker}: {e}")
        return [], []


async def get_correlation_matrix() -> dict:
    """
    Compute rolling correlations between Nifty 50 and global indices.
    """
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from sqlalchemy import select, desc

    # ── Load Nifty daily closes from DB ──────────────────────────────────────
    async with get_ts_session() as session:
        rows = (await session.execute(
            select(DBCandle.timestamp, DBCandle.close)
            .where(DBCandle.symbol == "NIFTY_50", DBCandle.interval == "1day")
            .order_by(desc(DBCandle.timestamp))
            .limit(70)
        )).all()

    if len(rows) < 12:
        return {
            "error": "Insufficient Nifty daily candle data (need 12+)",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # Chronological order
    rows_asc = list(reversed(rows))
    nifty_dates = [str(r[0])[:10] for r in rows_asc]
    nifty_closes = [float(r[1]) for r in rows_asc]

    # ── Fetch global indices from Yahoo Finance ───────────────────────────────
    global_data: dict[str, tuple[list[str], list[float]]] = {}
    for key, (ticker, _) in GLOBAL_SYMBOLS.items():
        dates, closes = await _fetch_yf_daily(ticker, days=60)
        global_data[key] = (dates, closes)

    # ── Compute correlations for each window ─────────────────────────────────
    matrix: dict[str, dict] = {}

    for key, (ticker, display_name) in GLOBAL_SYMBOLS.items():
        g_dates, g_closes = global_data[key]
        if not g_closes:
            matrix[key] = {
                "name": display_name,
                "correlations": {str(w): None for w in WINDOWS},
                "note": "Data unavailable",
            }
            continue

        # Align on common dates
        n_aligned, g_aligned = _align_series(nifty_dates, nifty_closes, g_dates, g_closes)
        if len(n_aligned) < 5:
            matrix[key] = {
                "name": display_name,
                "correlations": {str(w): None for w in WINDOWS},
                "note": "Insufficient overlapping dates",
            }
            continue

        # Log returns on aligned series
        n_returns = _log_returns(n_aligned)
        g_returns = _log_returns(g_aligned)

        corrs: dict[str, Optional[float]] = {}
        for w in WINDOWS:
            if len(n_returns) < w:
                corrs[str(w)] = None
                continue
            r = _pearson(n_returns[-w:], g_returns[-w:])
            corrs[str(w)] = r

        # Trend: is correlation rising or falling? Compare 10d vs 20d
        corr_10 = corrs.get("10")
        corr_20 = corrs.get("20")
        if corr_10 is not None and corr_20 is not None:
            if corr_10 > corr_20 + 0.1:
                trend = "rising"
            elif corr_10 < corr_20 - 0.1:
                trend = "falling"
            else:
                trend = "stable"
        else:
            trend = "unknown"

        # Interpretation
        c30 = corrs.get("30")
        if c30 is not None:
            if c30 > 0.7:
                interp = "high_coupling"
                interp_note = f"Nifty highly correlated with {display_name} (30d: {c30:.2f}) — moves globally driven, harder to fade"
            elif c30 > 0.4:
                interp = "moderate_coupling"
                interp_note = f"Moderate correlation with {display_name} (30d: {c30:.2f})"
            elif c30 > 0.1:
                interp = "mild_coupling"
                interp_note = f"Weak correlation — Nifty partially decoupled from {display_name}"
            else:
                interp = "decoupled"
                interp_note = f"Nifty decoupled from {display_name} — move is idiosyncratic, more tradeable"
        else:
            interp = "unknown"
            interp_note = "Insufficient data"

        matrix[key] = {
            "name": display_name,
            "ticker": ticker,
            "correlations": corrs,
            "trend": trend,
            "interpretation": interp,
            "note": interp_note,
            "aligned_count": len(n_aligned),
        }

    # ── Summary signal ────────────────────────────────────────────────────────
    high_corr = [k for k, v in matrix.items() if (v.get("correlations") or {}).get("10") and (v["correlations"]["10"] or 0) > 0.6]
    decoupled = [k for k, v in matrix.items() if (v.get("correlations") or {}).get("10") and (v["correlations"]["10"] or 1) < 0.2]

    if high_corr:
        summary = f"Nifty highly correlated with {', '.join(high_corr)} at 10d window — current moves globally driven."
    elif decoupled:
        summary = f"Nifty decoupled from {', '.join(decoupled)} — domestic/idiosyncratic move in play."
    else:
        summary = "Moderate global correlation — neither fully coupled nor fully decoupled."

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "nifty_close": round(nifty_closes[-1], 2) if nifty_closes else None,
        "windows": WINDOWS,
        "matrix": matrix,
        "summary": summary,
    }
