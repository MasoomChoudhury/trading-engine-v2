"""
Cumulative Volume Delta (CVD) Service — Candle-Based Approximation.

True CVD requires tick-by-tick trade direction data (buy-initiated vs sell-initiated).
Upstox V2 does not provide tick data. This service approximates using the standard
candle tick rule:

    buy_volume  = volume × (close - low)  / (high - low)   [if range > 0]
    sell_volume = volume × (high - close) / (high - low)
    delta       = buy_volume - sell_volume

Cumulating delta over the trading session gives the CVD — a proxy for aggressive
buying vs selling pressure. LABEL ALL OUTPUTS with source="candle_approximation".

Divergences:
  Price rising + CVD falling → distribution (bearish, fade rallies)
  Price falling + CVD rising → accumulation (bullish, buy dips)
  Price + CVD aligned        → confirmation (follow trend)
"""
from __future__ import annotations
import math
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def _tick_rule_delta(o: float, h: float, l: float, c: float, vol: float) -> tuple[float, float, float]:
    """
    Apply candle tick rule. Returns (buy_vol, sell_vol, delta).
    """
    rng = h - l
    if rng < 0.01:
        # Doji / no range — split evenly
        return vol * 0.5, vol * 0.5, 0.0
    buy_vol = vol * (c - l) / rng
    sell_vol = vol * (h - c) / rng
    return round(buy_vol), round(sell_vol), round(buy_vol - sell_vol)


def _slope(values: list[float]) -> float:
    """Linear regression slope of a list."""
    n = len(values)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mx = sum(xs) / n
    my = sum(values) / n
    num = sum((xs[i] - mx) * (values[i] - my) for i in range(n))
    denom = sum((x - mx) ** 2 for x in xs)
    return num / denom if denom else 0.0


async def get_cvd() -> dict:
    """
    Compute intraday Cumulative Volume Delta for Nifty 50 from 1-min candles.

    Returns:
      cvd_series    : [{time, price, cvd, buy_vol, sell_vol}] for today's session
      current_cvd   : latest CVD value
      divergence    : 'bullish_divergence' | 'bearish_divergence' | 'confirmed_up' | 'confirmed_down' | 'neutral'
      depth_imbalance: bid_qty / ask_qty from live market depth (real-time overlay)
      source        : 'candle_approximation'
    """
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from sqlalchemy import select, desc

    # ── Load today's 1-min candles from DB ─────────────────────────────────────
    today_ist = datetime.now(IST).date()

    async with get_ts_session() as session:
        rows = (await session.execute(
            select(
                DBCandle.timestamp,
                DBCandle.open,
                DBCandle.high,
                DBCandle.low,
                DBCandle.close,
                DBCandle.volume,
            )
            .where(
                DBCandle.symbol == "NIFTY_50",
                DBCandle.interval == "1minute",
            )
            .order_by(DBCandle.timestamp)
        )).all()

    if not rows:
        return {
            "error": "No intraday 1-min candle data for today",
            "timestamp": datetime.now(IST).isoformat(),
            "source": "candle_approximation",
        }

    # Filter to today's IST date (candles are stored in UTC, convert)
    today_rows = [
        r for r in rows
        if r[0].astimezone(IST).date() == today_ist
    ]

    if len(today_rows) < 5:
        return {
            "error": f"Insufficient intraday candles (have {len(today_rows)}, need 5+)",
            "timestamp": datetime.now(IST).isoformat(),
            "source": "candle_approximation",
        }

    # ── Compute CVD ────────────────────────────────────────────────────────────
    cumulative_cvd = 0.0
    cvd_series: list[dict] = []

    for ts, o, h, l, c, vol in today_rows:
        o_, h_, l_, c_, v_ = float(o), float(h), float(l), float(c), float(vol or 0)
        buy_vol, sell_vol, delta = _tick_rule_delta(o_, h_, l_, c_, v_)
        cumulative_cvd += delta
        cvd_series.append({
            "time": ts.astimezone(IST).strftime("%H:%M"),
            "price": round(c_, 2),
            "cvd": round(cumulative_cvd),
            "buy_vol": round(buy_vol),
            "sell_vol": round(sell_vol),
            "delta": round(delta),
        })

    # Keep last 60 candles for chart
    cvd_series_display = cvd_series[-60:]

    # ── Divergence detection (last 20 candles) ─────────────────────────────────
    lookback = min(20, len(cvd_series))
    recent = cvd_series[-lookback:]
    price_slope = _slope([x["price"] for x in recent])
    cvd_slope = _slope([x["cvd"] for x in recent])

    if price_slope > 0 and cvd_slope > 0:
        divergence = "confirmed_up"
        divergence_note = "Price rising with CVD rising — buying pressure confirmed. Trend has genuine volume support."
    elif price_slope < 0 and cvd_slope < 0:
        divergence = "confirmed_down"
        divergence_note = "Price falling with CVD falling — selling pressure confirmed. Avoid long entries."
    elif price_slope > 0 and cvd_slope < 0:
        divergence = "bearish_divergence"
        divergence_note = "Price rising but CVD falling — distribution in progress. Rally may be a trap; avoid buying breakouts."
    elif price_slope < 0 and cvd_slope > 0:
        divergence = "bullish_divergence"
        divergence_note = "Price falling but CVD rising — accumulation in progress. Dip may be a buying opportunity."
    else:
        divergence = "neutral"
        divergence_note = "No clear divergence — price and CVD are flat/neutral. Wait for directional signal."

    # ── Depth imbalance (live bid vs ask qty) ──────────────────────────────────
    depth_imbalance: Optional[float] = None
    depth_note: str = ""
    try:
        from app.services.upstox_client import UpstoxClient
        client = UpstoxClient()
        depth_data = await client.get_full_quote("NSE_INDEX|Nifty 50")
        depth = (depth_data.get("data") or {})
        # Full quote depth: {depth: {buy: [{quantity, price}...], sell: [...]}}
        depth_detail = depth.get("depth") or {}
        buy_entries = depth_detail.get("buy") or []
        sell_entries = depth_detail.get("sell") or []
        total_bid = sum(int(e.get("quantity") or 0) for e in buy_entries)
        total_ask = sum(int(e.get("quantity") or 0) for e in sell_entries)
        if total_ask > 0:
            depth_imbalance = round(total_bid / total_ask, 2)
            if depth_imbalance > 1.5:
                depth_note = f"Bid/Ask ratio {depth_imbalance:.2f} — aggressive buying at ask (buy-side dominant)."
            elif depth_imbalance < 0.67:
                depth_note = f"Bid/Ask ratio {depth_imbalance:.2f} — selling pressure dominates (ask absorption)."
            else:
                depth_note = f"Bid/Ask ratio {depth_imbalance:.2f} — balanced order book."
    except Exception as e:
        logger.debug(f"CVD depth imbalance fetch failed: {e}")

    current_cvd = cvd_series[-1]["cvd"] if cvd_series else 0
    session_high_cvd = max(x["cvd"] for x in cvd_series) if cvd_series else 0
    session_low_cvd = min(x["cvd"] for x in cvd_series) if cvd_series else 0

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "source": "candle_approximation",
        "source_note": "Approximated from 1-min OHLCV candles using tick rule. Not true tick-level CVD.",
        "candle_count": len(today_rows),
        "current_cvd": current_cvd,
        "session_high_cvd": round(session_high_cvd),
        "session_low_cvd": round(session_low_cvd),
        "divergence": divergence,
        "divergence_note": divergence_note,
        "depth_imbalance": depth_imbalance,
        "depth_note": depth_note,
        "cvd_series": cvd_series_display,
    }
