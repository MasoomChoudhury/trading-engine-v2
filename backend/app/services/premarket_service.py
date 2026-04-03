"""
Pre-market bias aggregator.

Combines:
  - DXY / US 10Y (EM headwind/tailwind)
  - USD/INR intraday trend (FII algo trigger risk)
  - Gift Nifty proxy via Upstox near-month Nifty futures LTP vs prev close
  - FII F&O net positioning (prior EOD)
  - FII/DII cash equity flows (prior EOD)

Returns a single bias dict with a score and per-signal breakdown.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def _ist_now() -> datetime:
    return datetime.now(IST)


# ── Gift Nifty proxy ──────────────────────────────────────────────────────────

async def get_gift_nifty_proxy() -> dict:
    """
    Use Upstox near-month Nifty futures LTP as a Gift Nifty proxy.
    Gap% = (futures_ltp - nifty_prev_close) / nifty_prev_close * 100
    Useful pre-9:15 AM IST to estimate opening gap magnitude.
    """
    try:
        from app.services.futures_service import get_active_futures
        from app.services.upstox_client import upstox_client
        import httpx

        contracts = await get_active_futures()
        if not contracts:
            return {"ltp": None, "gap_pct": None, "note": "No active futures contracts found"}

        near = contracts[0]
        instrument_key = near["instrument_key"]
        expiry = near.get("expiry", "")

        # Get futures LTP via Upstox OHLC quote (public endpoint)
        try:
            quote = await upstox_client.get_ohlc_quote(instrument_key)
            ltp = quote.get("last_price") or (quote.get("ohlc") or {}).get("close")
        except Exception:
            ltp = None

        if not ltp:
            return {"ltp": None, "gap_pct": None, "expiry": expiry,
                    "note": "Futures LTP unavailable — market may be closed"}

        # Get Nifty spot previous close from Yahoo Finance for gap calculation
        try:
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://query1.finance.yahoo.com/v8/finance/chart/^NSEI?interval=1d&range=2d",
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                resp.raise_for_status()
                meta = resp.json().get("chart", {}).get("result", [{}])[0].get("meta", {})
                prev_close = float(meta.get("previousClose") or meta.get("chartPreviousClose") or 0)
                spot = float(meta.get("regularMarketPrice") or 0)
        except Exception:
            prev_close = 0.0
            spot = 0.0

        ltp = float(ltp)
        gap_pct = round((ltp - prev_close) / prev_close * 100, 2) if prev_close > 0 else None
        basis_pct = round((ltp - spot) / spot * 100, 2) if spot > 0 else None

        return {
            "ltp": round(ltp, 2),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "spot": round(spot, 2) if spot else None,
            "gap_pct": gap_pct,
            "basis_pct": basis_pct,
            "expiry": expiry,
            "note": "Nifty near-month futures LTP (Upstox) vs NSE prev close",
        }
    except Exception as e:
        logger.warning(f"Gift Nifty proxy failed: {e}")
        return {"ltp": None, "gap_pct": None, "note": str(e)}


# ── FII summary helpers ───────────────────────────────────────────────────────

async def _get_fii_cash_summary() -> dict:
    """Latest FII cash market flow (last stored day)."""
    try:
        from app.services.fii_service import get_fii_history
        data = await get_fii_history(days=5)
        if not data["series"]:
            return {"fii_net": None, "dii_net": None, "date": None}
        latest = data["series"][-1]
        return {
            "fii_net": latest["fii_net"],
            "dii_net": latest["dii_net"],
            "combined_net": latest["combined_net"],
            "date": latest["date"],
            "fii_5d_net": data.get("fii_5d_net"),
            "fii_trend": data.get("fii_trend"),
        }
    except Exception as e:
        logger.warning(f"FII cash summary failed: {e}")
        return {"fii_net": None, "dii_net": None, "date": None}


async def _get_fii_deriv_summary() -> dict:
    """Latest FII F&O index futures net positioning."""
    try:
        from app.services.fii_deriv_service import get_fii_derivatives
        data = await get_fii_derivatives(days=3)
        if not data["series"]:
            return {"index_fut_net": None, "net_position": "unknown", "date": None}
        return {
            "index_fut_net": data.get("index_fut_net"),
            "total_options_net": data.get("total_options_net"),
            "net_position": data.get("net_position", "unknown"),
            "date": data.get("latest_date"),
        }
    except Exception as e:
        logger.warning(f"FII deriv summary failed: {e}")
        return {"index_fut_net": None, "net_position": "unknown", "date": None}


# ── Bias aggregator ───────────────────────────────────────────────────────────

def _score_to_bias(score: int) -> str:
    if score >= 4:
        return "strong_bullish"
    elif score >= 2:
        return "bullish"
    elif score <= -4:
        return "strong_bearish"
    elif score <= -2:
        return "bearish"
    return "neutral"


async def get_premarket_bias() -> dict:
    """
    Aggregate all pre-market signals into a single bias dict.

    Scoring (+ve = bullish, -ve = bearish):
      Gift Nifty gap:  >+0.5% = +2, >0% = +1, <-0.5% = -2, <0% = -1
      EM headwind:     tailwind = +2, neutral = 0, headwind = -1, strong = -2
      USD/INR trend:   appreciating = +1, sideways = 0, depreciating = -1, sharply = -2
      FII cash:        net buying = +1, net selling = -1
      FII F&O:         net_long = +1, net_short = -1
    """
    import asyncio
    from app.services.global_cues_service import get_global_cues

    global_cues, gift_nifty, fii_cash, fii_deriv = await asyncio.gather(
        get_global_cues(),
        get_gift_nifty_proxy(),
        _get_fii_cash_summary(),
        _get_fii_deriv_summary(),
        return_exceptions=True,
    )

    # Safely unwrap (gather with return_exceptions can return Exception objects)
    if isinstance(global_cues, Exception):
        global_cues = {}
    if isinstance(gift_nifty, Exception):
        gift_nifty = {"ltp": None, "gap_pct": None}
    if isinstance(fii_cash, Exception):
        fii_cash = {}
    if isinstance(fii_deriv, Exception):
        fii_deriv = {}

    score = 0
    signals: list[dict] = []

    # ── Gift Nifty gap
    gap_pct = gift_nifty.get("gap_pct")
    if gap_pct is not None:
        if gap_pct >= 0.5:
            score += 2
            signals.append({"key": "gift_nifty", "label": "Gift Nifty", "value": f"+{gap_pct:.2f}%", "sentiment": "bullish", "note": "Strong gap-up signal"})
        elif gap_pct > 0:
            score += 1
            signals.append({"key": "gift_nifty", "label": "Gift Nifty", "value": f"+{gap_pct:.2f}%", "sentiment": "mild_bullish", "note": "Mild gap-up"})
        elif gap_pct <= -0.5:
            score -= 2
            signals.append({"key": "gift_nifty", "label": "Gift Nifty", "value": f"{gap_pct:.2f}%", "sentiment": "bearish", "note": "Strong gap-down signal"})
        else:
            score -= 1
            signals.append({"key": "gift_nifty", "label": "Gift Nifty", "value": f"{gap_pct:.2f}%", "sentiment": "mild_bearish", "note": "Mild gap-down"})
    else:
        signals.append({"key": "gift_nifty", "label": "Gift Nifty", "value": "N/A", "sentiment": "neutral", "note": gift_nifty.get("note", "")})

    # ── EM headwind (DXY + US10Y)
    em = global_cues.get("em_headwind", {})
    em_signal = em.get("signal", "neutral")
    em_reasons = em.get("reasons", [])
    if em_signal in ("tailwind", "mild_tailwind"):
        sc = 2 if em_signal == "tailwind" else 1
        score += sc
        signals.append({"key": "em_headwind", "label": "DXY / US10Y", "value": em_signal.replace("_", " ").title(), "sentiment": "bullish", "note": "; ".join(em_reasons) or "EM tailwind"})
    elif em_signal == "neutral":
        signals.append({"key": "em_headwind", "label": "DXY / US10Y", "value": "Neutral", "sentiment": "neutral", "note": "; ".join(em_reasons) or "No strong EM signal"})
    elif em_signal == "headwind":
        score -= 1
        signals.append({"key": "em_headwind", "label": "DXY / US10Y", "value": "Headwind", "sentiment": "bearish", "note": "; ".join(em_reasons)})
    else:  # strong_headwind
        score -= 2
        signals.append({"key": "em_headwind", "label": "DXY / US10Y", "value": "Strong Headwind", "sentiment": "bearish", "note": "; ".join(em_reasons)})

    # ── USD/INR intraday trend
    inr = global_cues.get("usd_inr_trend", {})
    inr_trend = inr.get("trend", "unknown")
    inr_chg = inr.get("intraday_chg_pct")
    inr_sev = inr.get("severity", "")
    if inr_trend == "appreciating":
        score += 1
        signals.append({"key": "usd_inr", "label": "USD/INR Trend", "value": f"INR ↑ ({inr_chg:+.2f}%)" if inr_chg else "Appreciating", "sentiment": "bullish", "note": "Rupee strengthening — FII algo flows likely positive"})
    elif inr_trend == "depreciating" and inr_sev == "sharply":
        score -= 2
        signals.append({"key": "usd_inr", "label": "USD/INR Trend", "value": f"INR ↓↓ ({inr_chg:+.2f}%)" if inr_chg else "Depreciating sharply", "sentiment": "bearish", "note": "Sharp rupee depreciation — FII algorithmic selling risk"})
    elif inr_trend == "depreciating":
        score -= 1
        signals.append({"key": "usd_inr", "label": "USD/INR Trend", "value": f"INR ↓ ({inr_chg:+.2f}%)" if inr_chg else "Depreciating", "sentiment": "mild_bearish", "note": "Mild rupee weakness"})
    else:
        signals.append({"key": "usd_inr", "label": "USD/INR Trend", "value": "Sideways", "sentiment": "neutral", "note": "Rupee stable intraday"})

    # ── FII cash flow
    fii_net = fii_cash.get("fii_net")
    fii_5d = fii_cash.get("fii_5d_net")
    if fii_net is not None:
        if fii_net > 0:
            score += 1
            signals.append({"key": "fii_cash", "label": "FII Cash Flow", "value": f"+₹{fii_net:.0f} (×100Cr)", "sentiment": "bullish", "note": f"5d net: {fii_5d:+.0f}" if fii_5d else "FII buying"})
        else:
            score -= 1
            signals.append({"key": "fii_cash", "label": "FII Cash Flow", "value": f"₹{fii_net:.0f} (×100Cr)", "sentiment": "bearish", "note": f"5d net: {fii_5d:+.0f}" if fii_5d else "FII selling"})
    else:
        signals.append({"key": "fii_cash", "label": "FII Cash Flow", "value": "No data", "sentiment": "neutral", "note": "Run refresh to load FII flows"})

    # ── FII F&O positioning
    net_pos = fii_deriv.get("net_position", "unknown")
    fut_net = fii_deriv.get("index_fut_net")
    if net_pos == "net_long":
        score += 1
        signals.append({"key": "fii_fo", "label": "FII F&O Position", "value": f"Net Long ({fut_net:+.0f} lots)" if fut_net else "Net Long", "sentiment": "bullish", "note": "FII long index futures — institutional bullish bias"})
    elif net_pos == "net_short":
        score -= 1
        signals.append({"key": "fii_fo", "label": "FII F&O Position", "value": f"Net Short ({fut_net:+.0f} lots)" if fut_net else "Net Short", "sentiment": "bearish", "note": "FII short index futures — institutional bearish/hedge bias"})
    else:
        signals.append({"key": "fii_fo", "label": "FII F&O Position", "value": "No data", "sentiment": "neutral", "note": "Run refresh to load F&O positioning"})

    bias = _score_to_bias(score)

    return {
        "bias": bias,
        "score": score,
        "signals": signals,
        "global_cues": global_cues,
        "gift_nifty": gift_nifty,
        "fii_cash": fii_cash,
        "fii_deriv": fii_deriv,
        "timestamp": _ist_now().isoformat(),
    }
