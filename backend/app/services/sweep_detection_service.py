"""
Options Sweep & Block Trade Detection — Volume-Spike Approximation.

True sweep detection requires tick-level execution data (trades executed
across multiple price levels at the ask). Upstox V2 does not provide tick data.

This service approximates using intraday volume signatures:
  - Volume/OI ratio > 0.08 in a single session = unusual accumulation
  - CE volume >> PE volume at a strike = call sweep (directional bullish bet)
  - PE volume >> CE volume at a strike = put sweep (directional bearish / hedge)
  - Notional value > ₹50L = block trade threshold

Interpretation: Institutions leave footprints. Even without tick precision,
unusually high volume relative to OI at a specific strike — especially on one
side only — indicates directional conviction.

All outputs labelled source="volume_spike_approximation".
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

LOT_SIZE = 50
BLOCK_NOTIONAL_THRESHOLD = 5_000_000  # ₹50 lakh
SWEEP_VOL_OI_THRESHOLD = 0.08         # 8% of OI traded = unusual
DIRECTIONAL_RATIO = 3.0               # CE vol / PE vol > 3x = one-sided

NIFTY_KEY = "NSE_INDEX|Nifty 50"


async def get_sweeps(target_expiry: str | None = None) -> dict:
    """
    Scan the option chain for unusual volume patterns that indicate sweeps
    or block trades. Returns the top 10 most unusual strikes.

    Returns:
      alerts     : list of flagged strikes sorted by vol_oi_ratio descending
      summary    : overall unusual activity level
      source     : 'volume_spike_approximation'
    """
    from app.services.upstox_client import UpstoxClient

    client = UpstoxClient()

    # ── Get expiry ─────────────────────────────────────────────────────────────
    try:
        contracts = await client.get_option_contracts(NIFTY_KEY)
        expiry = target_expiry or (contracts[0].get("expiry", "") if contracts else "")
    except Exception as e:
        return {
            "error": f"Failed to get option contracts: {e}",
            "timestamp": datetime.now(IST).isoformat(),
            "source": "volume_spike_approximation",
        }

    # ── Fetch option chain ─────────────────────────────────────────────────────
    try:
        chain = await client.get_option_chain(NIFTY_KEY, expiry)
    except Exception as e:
        return {
            "error": f"Option chain fetch failed: {e}",
            "timestamp": datetime.now(IST).isoformat(),
            "source": "volume_spike_approximation",
        }

    if not chain:
        return {
            "error": "Empty option chain",
            "timestamp": datetime.now(IST).isoformat(),
            "source": "volume_spike_approximation",
        }

    # Find spot
    spot = 0.0
    for entry in chain:
        s = entry.get("underlying_spot_price") or 0
        if s:
            spot = float(s)
            break

    alerts: list[dict] = []

    for entry in chain:
        strike = float(entry.get("strike_price", 0))

        # Filter to ATM ± 1500 pts
        if spot and abs(strike - spot) > 1500:
            continue

        ce = entry.get("call_options") or {}
        pe = entry.get("put_options") or {}
        ce_md = ce.get("market_data") or {}
        pe_md = pe.get("market_data") or {}

        ce_vol = float(ce_md.get("volume") or 0)
        pe_vol = float(pe_md.get("volume") or 0)
        ce_oi  = float(ce_md.get("oi") or 0)
        pe_oi  = float(pe_md.get("oi") or 0)
        ce_ltp = float(ce_md.get("ltp") or 0)
        pe_ltp = float(pe_md.get("ltp") or 0)

        total_vol = ce_vol + pe_vol
        total_oi  = ce_oi + pe_oi

        if total_oi < 100 or total_vol < 50:
            continue

        vol_oi_ratio = total_vol / total_oi

        # Sweep direction
        sweep_direction: str = "none"
        if ce_vol > 0 and pe_vol > 0:
            ce_pe_ratio = ce_vol / pe_vol
            pe_ce_ratio = pe_vol / ce_vol
            if ce_pe_ratio >= DIRECTIONAL_RATIO:
                sweep_direction = "call_sweep"
            elif pe_ce_ratio >= DIRECTIONAL_RATIO:
                sweep_direction = "put_sweep"
        elif ce_vol > pe_vol * DIRECTIONAL_RATIO:
            sweep_direction = "call_sweep"
        elif pe_vol > ce_vol * DIRECTIONAL_RATIO:
            sweep_direction = "put_sweep"

        # Block trade (by notional)
        ce_notional = ce_vol * LOT_SIZE * ce_ltp
        pe_notional = pe_vol * LOT_SIZE * pe_ltp
        is_block = ce_notional >= BLOCK_NOTIONAL_THRESHOLD or pe_notional >= BLOCK_NOTIONAL_THRESHOLD

        if vol_oi_ratio < SWEEP_VOL_OI_THRESHOLD and not is_block:
            continue  # Not unusual

        flags: list[str] = []
        if vol_oi_ratio >= SWEEP_VOL_OI_THRESHOLD:
            flags.append("high_vol_oi")
        if sweep_direction != "none":
            flags.append("directional")
        if is_block:
            flags.append("block_trade")

        alerts.append({
            "strike": strike,
            "ce_volume": int(ce_vol),
            "pe_volume": int(pe_vol),
            "ce_oi": int(ce_oi),
            "pe_oi": int(pe_oi),
            "ce_ltp": round(ce_ltp, 2),
            "pe_ltp": round(pe_ltp, 2),
            "vol_oi_ratio": round(vol_oi_ratio, 4),
            "sweep_direction": sweep_direction,
            "is_block": is_block,
            "ce_notional_lakh": round(ce_notional / 1e5, 1),
            "pe_notional_lakh": round(pe_notional / 1e5, 1),
            "flags": flags,
            "distance_from_spot": round(strike - spot, 0) if spot else None,
        })

    # Sort by vol/OI ratio descending, show top 10
    alerts.sort(key=lambda x: x["vol_oi_ratio"], reverse=True)
    top_alerts = alerts[:10]

    # Summary
    call_sweeps = sum(1 for a in top_alerts if a["sweep_direction"] == "call_sweep")
    put_sweeps  = sum(1 for a in top_alerts if a["sweep_direction"] == "put_sweep")
    blocks      = sum(1 for a in top_alerts if a["is_block"])

    if not top_alerts:
        summary = "No unusual options activity detected — volume in line with OI across strikes."
    elif call_sweeps > put_sweeps + 1:
        summary = f"{call_sweeps} call sweep(s) detected — institutional bullish positioning activity."
    elif put_sweeps > call_sweeps + 1:
        summary = f"{put_sweeps} put sweep(s) detected — institutional bearish / hedging activity."
    else:
        summary = f"{len(top_alerts)} unusual strikes detected ({blocks} block trade(s)) — mixed directional signals."

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "expiry": expiry,
        "spot": round(spot, 2),
        "source": "volume_spike_approximation",
        "source_note": "Volume/OI spike detection — not true tick-level sweep. Approximation only.",
        "alert_count": len(top_alerts),
        "call_sweeps": call_sweeps,
        "put_sweeps": put_sweeps,
        "block_trades": blocks,
        "summary": summary,
        "alerts": top_alerts,
    }
