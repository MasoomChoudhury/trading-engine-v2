"""
Heavyweight VWAP Divergence Service.

Nifty 50 is heavily skewed. HDFC Bank, Reliance, ICICI, Infosys, and TCS
collectively account for ~41% of the index. General breadth metrics miss
divergences where heavyweights are bleeding while mid-tier stocks hold up.

Signal logic:
  ≥ 3 of 5 heavyweights above VWAP + ≥ 2 with expanding volume
    → VALID — confirms Nifty upside has heavyweight support
  < 3 above VWAP OR all volumes contracting
    → INVALID — index move likely unsupported; avoid call buys

VWAP formula: Σ(typical_price × volume) / Σ(volume)
  where typical_price = (high + low + close) / 3
"""
from __future__ import annotations
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

# Top 5 heavyweights hard-coded as fallback; overridden from JSON
_DEFAULT_HW = [
    {"symbol": "HDFCBANK",  "name": "HDFC Bank",            "weight": 13.5, "instrument_key": "NSE_EQ|INE040A01034"},
    {"symbol": "RELIANCE",  "name": "Reliance Industries",  "weight": 8.9,  "instrument_key": "NSE_EQ|INE002A01018"},
    {"symbol": "ICICIBANK", "name": "ICICI Bank",           "weight": 7.5,  "instrument_key": "NSE_EQ|INE090A01021"},
    {"symbol": "INFY",      "name": "Infosys",              "weight": 6.5,  "instrument_key": "NSE_EQ|INE009A01021"},
    {"symbol": "TCS",       "name": "TCS",                  "weight": 4.8,  "instrument_key": "NSE_EQ|INE467B01029"},
]


def _load_heavyweights() -> list[dict]:
    try:
        data_path = Path(__file__).parent.parent / "data" / "nifty50_constituents.json"
        raw = json.loads(data_path.read_text())
        # File format: [date_str, desc, [symbols...], [{symbol, name, sector, weight, is_hw, instrument_key}...]]
        constituents = raw[3] if isinstance(raw, list) and len(raw) > 3 else []
        hw = [c for c in constituents if c.get("is_hw")]
        return hw[:5] if hw else _DEFAULT_HW
    except Exception as e:
        logger.debug(f"HW VWAP: constituents load failed: {e} — using defaults")
        return _DEFAULT_HW


def _compute_vwap(candles: list[list]) -> Optional[float]:
    """
    Compute VWAP from candle list [[ts, o, h, l, c, v, oi], ...].
    """
    pv_sum = 0.0
    v_sum = 0.0
    for c in candles:
        try:
            h, l, cl, vol = float(c[2]), float(c[3]), float(c[4]), float(c[5] or 0)
            tp = (h + l + cl) / 3
            pv_sum += tp * vol
            v_sum += vol
        except (IndexError, ValueError, TypeError):
            continue
    return round(pv_sum / v_sum, 2) if v_sum > 0 else None


def _volume_trend(candles: list[list]) -> str:
    """Compare recent volume vs session average."""
    if len(candles) < 10:
        return "neutral"
    vols = [float(c[5] or 0) for c in candles]
    session_avg = sum(vols) / len(vols)
    recent_avg = sum(vols[-5:]) / 5
    if recent_avg > session_avg * 1.2:
        return "expanding"
    if recent_avg < session_avg * 0.8:
        return "contracting"
    return "neutral"


async def get_heavyweight_vwap() -> dict:
    """
    Fetch intraday 1-min candles for the top 5 Nifty heavyweights and compute
    VWAP + volume trend for each. Return confirmation signal for Nifty call buys.
    """
    from app.services.upstox_client import UpstoxClient

    heavyweights = _load_heavyweights()
    client = UpstoxClient()
    results: list[dict] = []

    for hw in heavyweights:
        symbol = hw["symbol"]
        ikey = hw["instrument_key"]
        name = hw["name"]
        weight = hw["weight"]

        try:
            candles = await client.get_intraday_candles(ikey, "1minute")
        except Exception as e:
            logger.warning(f"HW VWAP: intraday candles failed for {symbol}: {e}")
            results.append({
                "symbol": symbol,
                "name": name,
                "weight": weight,
                "error": str(e),
                "vs_vwap": "unknown",
                "vol_trend": "unknown",
            })
            continue

        if not candles:
            results.append({
                "symbol": symbol,
                "name": name,
                "weight": weight,
                "error": "No intraday candles",
                "vs_vwap": "unknown",
                "vol_trend": "unknown",
            })
            continue

        vwap = _compute_vwap(candles)
        current_price = float(candles[-1][4]) if candles else None  # last close

        if vwap is None or current_price is None:
            vs_vwap = "unknown"
        elif current_price > vwap * 1.001:
            vs_vwap = "above"
        elif current_price < vwap * 0.999:
            vs_vwap = "below"
        else:
            vs_vwap = "at"

        vol_trend = _volume_trend(candles)
        vwap_gap_pct = round((current_price - vwap) / vwap * 100, 2) if vwap and current_price else None

        results.append({
            "symbol": symbol,
            "name": name,
            "weight": weight,
            "current_price": current_price,
            "vwap": vwap,
            "vwap_gap_pct": vwap_gap_pct,
            "vs_vwap": vs_vwap,
            "vol_trend": vol_trend,
            "candle_count": len(candles),
        })

    # ── Signal synthesis ────────────────────────────────────────────────────────
    valid_results = [r for r in results if r.get("vs_vwap") != "unknown"]
    above_count = sum(1 for r in valid_results if r["vs_vwap"] == "above")
    expanding_count = sum(1 for r in valid_results if r.get("vol_trend") == "expanding")
    below_count = sum(1 for r in valid_results if r["vs_vwap"] == "below")

    # Weighted above score
    weighted_above = sum(r["weight"] for r in valid_results if r["vs_vwap"] == "above")
    total_weight = sum(r["weight"] for r in valid_results) or 1

    signal_valid = above_count >= 3 and expanding_count >= 2
    weighted_valid = weighted_above / total_weight >= 0.55  # ≥55% index weight above VWAP

    if signal_valid or weighted_valid:
        signal = "confirmed"
        signal_note = (
            f"{above_count}/5 heavyweights above VWAP ({weighted_above:.1f}% index weight). "
            f"{expanding_count} with expanding volume. "
            "Heavyweight support confirms Nifty call buy signal."
        )
    elif above_count == 2:
        signal = "weak"
        signal_note = (
            f"Only {above_count}/5 heavyweights above VWAP. "
            "Insufficient confirmation — calls carry higher failure risk. Consider waiting."
        )
    else:
        signal = "invalid"
        signal_note = (
            f"{below_count}/5 heavyweights below VWAP. "
            "Index move lacks heavyweight support — likely to reverse. "
            "Avoid call buys; bearish bias on bounces."
        )

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "above_count": above_count,
        "below_count": below_count,
        "expanding_volume_count": expanding_count,
        "weighted_above_pct": round(weighted_above / total_weight * 100, 1),
        "signal": signal,
        "signal_valid": signal_valid or weighted_valid,
        "signal_note": signal_note,
        "heavyweights": results,
    }
