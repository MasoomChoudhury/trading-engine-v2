"""India VIX service — fetch current VIX and compute HV20 (historical volatility) from Nifty candles."""
import math
from datetime import datetime, timezone, timedelta
from loguru import logger
import httpx

NSE_ALL_INDICES_URL = "https://www.nseindia.com/api/allIndices"
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}
IST = timezone(timedelta(hours=5, minutes=30))


def _compute_hv20(closes: list[float]) -> float | None:
    """Compute 20-day historical volatility (annualised %) from list of closing prices."""
    if len(closes) < 2:
        return None
    log_returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    n = len(log_returns)
    if n < 2:
        return None
    mean = sum(log_returns) / n
    variance = sum((r - mean) ** 2 for r in log_returns) / (n - 1)
    hv = math.sqrt(variance) * math.sqrt(252) * 100
    return round(hv, 2)


async def _get_hv20() -> float | None:
    """Query last 25 daily Nifty candles from DB and compute HV20."""
    try:
        from app.db.database import get_ts_session
        from app.db.models import Candle as DBCandle
        from sqlalchemy import select, desc

        async with get_ts_session() as session:
            stmt = (
                select(DBCandle.close)
                .where(DBCandle.symbol == "NIFTY_50", DBCandle.interval == "1day")
                .order_by(desc(DBCandle.timestamp))
                .limit(25)
            )
            result = await session.execute(stmt)
            rows = result.all()

        if not rows or len(rows) < 5:
            return None

        # rows are newest-first; reverse to chronological order
        closes = [float(r[0]) for r in rows][::-1]
        return _compute_hv20(closes)
    except Exception as e:
        logger.warning(f"HV20 computation failed: {e}")
        return None


def _get_regime(vix: float) -> tuple[str, str]:
    if vix > 25:
        return "extreme_fear", "VIX>25: Options very expensive — sell premium or avoid buying calls"
    elif vix > 20:
        return "fear", "VIX 20–25: Elevated risk — prefer defined-risk strategies"
    elif vix > 15:
        return "caution", "VIX 15–20: Moderate — balanced approach"
    else:
        return "calm", "VIX≤15: Options cheap — good time to buy premium/hedge"


async def get_india_vix() -> dict:
    """Fetch India VIX from NSE allIndices and compute derived metrics."""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(NSE_ALL_INDICES_URL, headers=NSE_HEADERS)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        logger.error(f"NSE allIndices fetch failed: {e}")
        raise RuntimeError(f"Failed to fetch India VIX from NSE: {e}")

    indices = payload.get("data", [])
    vix_entry = next(
        (idx for idx in indices if idx.get("indexSymbol") == "INDIA VIX"),
        None,
    )
    if not vix_entry:
        raise RuntimeError("INDIA VIX entry not found in NSE allIndices response")

    vix = float(vix_entry.get("last", 0))
    vix_prev_close = float(vix_entry.get("previousClose", 0))
    vix_change = float(vix_entry.get("variation", vix - vix_prev_close))
    vix_change_pct = float(vix_entry.get("percentChange", 0))
    vix_high = float(vix_entry.get("high", 0))
    vix_low = float(vix_entry.get("low", 0))
    vix_52w_high = float(vix_entry.get("yearHigh", 0))
    vix_52w_low = float(vix_entry.get("yearLow", 0))
    vix_1w_ago = float(vix_entry.get("oneWeekAgoVal")) if vix_entry.get("oneWeekAgoVal") else None
    vix_1m_ago = float(vix_entry.get("oneMonthAgoVal")) if vix_entry.get("oneMonthAgoVal") else None
    vix_1y_ago = float(vix_entry.get("oneYearAgoVal")) if vix_entry.get("oneYearAgoVal") else None

    # Percentile: position of current VIX between 52w_low and 52w_high
    range_52w = vix_52w_high - vix_52w_low
    if range_52w > 0:
        vix_percentile = round((vix - vix_52w_low) / range_52w * 100, 1)
        vix_percentile = max(0.0, min(100.0, vix_percentile))
    else:
        vix_percentile = 50.0

    regime, regime_note = _get_regime(vix)

    hv20 = await _get_hv20()
    iv_rv_ratio = round(vix / hv20, 3) if hv20 and hv20 > 0 else None

    return {
        "vix": round(vix, 2),
        "vix_prev_close": round(vix_prev_close, 2),
        "vix_change": round(vix_change, 2),
        "vix_change_pct": round(vix_change_pct, 2),
        "vix_high": round(vix_high, 2),
        "vix_low": round(vix_low, 2),
        "vix_52w_high": round(vix_52w_high, 2),
        "vix_52w_low": round(vix_52w_low, 2),
        "vix_1w_ago": round(vix_1w_ago, 2) if vix_1w_ago else None,
        "vix_1m_ago": round(vix_1m_ago, 2) if vix_1m_ago else None,
        "vix_1y_ago": round(vix_1y_ago, 2) if vix_1y_ago else None,
        "vix_percentile": vix_percentile,
        "regime": regime,
        "regime_note": regime_note,
        "hv20": hv20,
        "iv_rv_ratio": iv_rv_ratio,
        "timestamp": datetime.now(IST).isoformat(),
    }
