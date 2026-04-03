"""Global market cues using Yahoo Finance v8 API."""
from datetime import datetime, timezone, timedelta
from loguru import logger
import httpx

IST = timezone(timedelta(hours=5, minutes=30))

SYMBOLS: dict[str, tuple[str, str]] = {
    "dow":      ("^DJI",      "Dow Jones"),
    "nasdaq":   ("^IXIC",     "Nasdaq"),
    "sp500":    ("^GSPC",     "S&P 500"),
    "nikkei":   ("^N225",     "Nikkei 225"),
    "hang_seng":("^HSI",      "Hang Seng"),
    "usd_inr":  ("USDINR=X",  "USD/INR"),
    "dxy":      ("DX-Y.NYB",  "DXY Dollar Index"),
    "us10y":    ("^TNX",      "US 10Y Yield"),
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


async def _fetch_symbol(client: httpx.AsyncClient, ticker: str, name: str) -> dict:
    """Fetch a single Yahoo Finance symbol. Returns a dict with price/change data."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=2d"
    try:
        resp = await client.get(url, headers=YF_HEADERS)
        resp.raise_for_status()
        data = resp.json()
        meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
        price = meta.get("regularMarketPrice")
        prev_close = meta.get("previousClose") or meta.get("chartPreviousClose")
        high = meta.get("regularMarketDayHigh")
        low = meta.get("regularMarketDayLow")

        if price is None or prev_close is None:
            return {"price": None, "prev_close": None, "change": None, "change_pct": None,
                    "high": None, "low": None, "name": name}

        price = float(price)
        prev_close = float(prev_close)
        change = round(price - prev_close, 4)
        change_pct = round(change / prev_close * 100, 3) if prev_close else None

        return {
            "price": round(price, 4),
            "prev_close": round(prev_close, 4),
            "change": change,
            "change_pct": change_pct,
            "high": round(float(high), 4) if high else None,
            "low": round(float(low), 4) if low else None,
            "name": name,
        }
    except Exception as e:
        logger.warning(f"Yahoo Finance fetch failed for {ticker}: {e}")
        return {"price": None, "prev_close": None, "change": None, "change_pct": None,
                "high": None, "low": None, "name": name}


async def _fetch_usdinr_intraday_trend(client: httpx.AsyncClient) -> dict:
    """
    Fetch USD/INR 5-minute intraday candles and compute trend direction.
    Returns trend: 'depreciating' | 'appreciating' | 'sideways', plus magnitude and intraday stats.
    """
    url = "https://query1.finance.yahoo.com/v8/finance/chart/USDINR=X?interval=5m&range=1d"
    try:
        resp = await client.get(url, headers=YF_HEADERS)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("chart", {}).get("result", [{}])[0]
        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
        closes = [c for c in closes if c is not None]

        if len(closes) < 4:
            return {"trend": "unknown", "intraday_chg_pct": None, "note": "Insufficient intraday data"}

        open_price = closes[0]
        current = closes[-1]
        intraday_chg_pct = round((current - open_price) / open_price * 100, 3)

        # Classify: positive = USD strengthening = INR depreciating
        if intraday_chg_pct > 0.25:
            trend = "depreciating"
            severity = "sharply" if intraday_chg_pct > 0.5 else "mildly"
        elif intraday_chg_pct < -0.25:
            trend = "appreciating"
            severity = "sharply" if intraday_chg_pct < -0.5 else "mildly"
        else:
            trend = "sideways"
            severity = "flat"

        # Simple linear slope over last 12 candles (1 hour)
        recent = closes[-12:] if len(closes) >= 12 else closes
        n = len(recent)
        if n >= 2:
            slope = (recent[-1] - recent[0]) / (n - 1)
        else:
            slope = 0.0

        return {
            "trend": trend,
            "severity": severity,
            "intraday_chg_pct": intraday_chg_pct,
            "open": round(open_price, 4),
            "current": round(current, 4),
            "slope_per_candle": round(slope, 6),
            "candles": len(closes),
        }
    except Exception as e:
        logger.warning(f"USD/INR intraday trend fetch failed: {e}")
        return {"trend": "unknown", "intraday_chg_pct": None, "note": str(e)}


def _compute_sentiment(result: dict) -> str:
    """Determine US market sentiment based on Dow, Nasdaq, S&P 500 change_pct."""
    pcts = []
    for key in ("dow", "nasdaq", "sp500"):
        item = result.get(key, {})
        cp = item.get("change_pct")
        if cp is not None:
            pcts.append(cp)
    if not pcts:
        return "mixed"
    avg = sum(pcts) / len(pcts)
    if avg > 0.3:
        return "bullish"
    elif avg < -0.3:
        return "bearish"
    return "mixed"


def _em_headwind(result: dict) -> dict:
    """
    Assess EM (emerging market) headwind from DXY and US 10Y yield.
    Returns a simple signal: 'headwind' | 'tailwind' | 'neutral' with reasons.
    """
    signals = []
    pressure_score = 0  # positive = headwind, negative = tailwind

    dxy = result.get("dxy", {})
    dxy_price = dxy.get("price")
    dxy_chg = dxy.get("change_pct")
    if dxy_price is not None:
        if dxy_price > 104 and (dxy_chg or 0) > 0.2:
            signals.append(f"DXY {dxy_price:.1f} rising — EM outflows likely")
            pressure_score += 2
        elif dxy_price > 104:
            signals.append(f"DXY {dxy_price:.1f} elevated")
            pressure_score += 1
        elif dxy_price < 100 or (dxy_chg or 0) < -0.2:
            signals.append(f"DXY {dxy_price:.1f} weak — EM tailwind")
            pressure_score -= 1

    us10y = result.get("us10y", {})
    y_price = us10y.get("price")
    y_chg = us10y.get("change_pct")
    if y_price is not None:
        if y_price > 4.5 and (y_chg or 0) > 0.5:
            signals.append(f"US 10Y {y_price:.2f}% spiking — risk-off")
            pressure_score += 2
        elif y_price > 4.5:
            signals.append(f"US 10Y {y_price:.2f}% elevated")
            pressure_score += 1
        elif y_price < 4.0:
            signals.append(f"US 10Y {y_price:.2f}% — accommodative")
            pressure_score -= 1

    if pressure_score >= 3:
        signal = "strong_headwind"
    elif pressure_score >= 1:
        signal = "headwind"
    elif pressure_score <= -2:
        signal = "tailwind"
    elif pressure_score < 0:
        signal = "mild_tailwind"
    else:
        signal = "neutral"

    return {"signal": signal, "score": pressure_score, "reasons": signals}


async def get_global_cues() -> dict:
    """Fetch global market cues from Yahoo Finance."""
    result: dict = {}

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for key, (ticker, name) in SYMBOLS.items():
            result[key] = await _fetch_symbol(client, ticker, name)
        result["usd_inr_trend"] = await _fetch_usdinr_intraday_trend(client)

    result["gift_nifty"] = {"price": None, "note": "Not available — no public API"}
    result["sentiment"] = _compute_sentiment(result)
    result["em_headwind"] = _em_headwind(result)
    result["timestamp"] = datetime.now(IST).isoformat()

    return result
