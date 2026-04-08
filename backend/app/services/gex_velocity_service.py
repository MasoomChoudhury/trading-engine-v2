"""
Intraday GEX Velocity Service.

GEX is stored every 5 minutes in the gex_snapshots table. This service
computes how fast GEX is changing (velocity) and in which direction (building/decaying).

A building GEX at a strike means market makers are accumulating Gamma exposure there
and will be increasingly forced to hedge — acting as a price magnet or wall.

A decaying GEX means hedging pressure at that level is unwinding —
previous support/resistance from MM hedging is dissolving.

Velocity = Δ(net_gex) per hour
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


async def get_gex_velocity(target_expiry: str | None = None) -> dict:
    """
    Compute intraday GEX velocity from stored snapshots.

    Returns:
      velocity       : net_gex change per hour (positive = building, negative = decaying)
      acceleration   : velocity trend (speeding up / slowing down)
      direction      : 'building' | 'decaying' | 'stable' | 'accelerating_build' | 'accelerating_decay'
      gex_series     : last 24 snapshots [{time, net_gex, total_gex}]
      strike_movers  : top 5 strikes with largest GEX change in last 30 min
    """
    from app.db.database import get_ts_session
    from app.db.models import GexSnapshot
    from sqlalchemy import select, desc

    # ── Determine target expiry ─────────────────────────────────────────────────
    if not target_expiry:
        try:
            from app.services.upstox_client import UpstoxClient
            client = UpstoxClient()
            contracts = await client.get_option_contracts("NSE_INDEX|Nifty 50")
            target_expiry = contracts[0].get("expiry", "") if contracts else None
        except Exception as e:
            logger.warning(f"GEX velocity: expiry lookup failed: {e}")

    # ── Load last 24 snapshots from DB (2 hours of 5-min data) ─────────────────
    async with get_ts_session() as session:
        stmt = select(GexSnapshot).order_by(desc(GexSnapshot.timestamp)).limit(24)
        if target_expiry:
            stmt = select(GexSnapshot).where(
                GexSnapshot.expiry_date == target_expiry
            ).order_by(desc(GexSnapshot.timestamp)).limit(24)

        rows = (await session.execute(stmt)).scalars().all()

    if len(rows) < 2:
        return {
            "error": "Insufficient GEX snapshots (need 2+; snapshots saved every 5 min during market hours)",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # Chronological order (oldest first)
    rows_asc = list(reversed(rows))

    # ── Build GEX time series ───────────────────────────────────────────────────
    gex_series: list[dict] = []
    for row in rows_asc:
        ts_ist = row.timestamp.astimezone(IST)
        gex_series.append({
            "time": ts_ist.strftime("%H:%M"),
            "timestamp_iso": ts_ist.isoformat(),
            "net_gex": float(row.net_gex or 0),
            "total_gex": float(row.total_gex or 0),
            "zero_gamma": float(row.zero_gamma_level or 0) if row.zero_gamma_level else None,
            "call_wall": float(row.call_wall or 0) if row.call_wall else None,
            "put_wall": float(row.put_wall or 0) if row.put_wall else None,
        })

    # ── Compute velocity ────────────────────────────────────────────────────────
    oldest = rows_asc[0]
    latest = rows_asc[-1]

    t_oldest = oldest.timestamp.astimezone(IST)
    t_latest = latest.timestamp.astimezone(IST)
    elapsed_hours = (t_latest - t_oldest).total_seconds() / 3600

    net_gex_old = float(oldest.net_gex or 0)
    net_gex_new = float(latest.net_gex or 0)
    total_gex_old = float(oldest.total_gex or 0)
    total_gex_new = float(latest.total_gex or 0)

    velocity = round((net_gex_new - net_gex_old) / elapsed_hours, 2) if elapsed_hours > 0.01 else 0.0
    total_gex_velocity = round((total_gex_new - total_gex_old) / elapsed_hours, 2) if elapsed_hours > 0.01 else 0.0

    # Acceleration: compare velocity of first half vs second half
    mid = len(rows_asc) // 2
    if mid >= 2:
        first_half = rows_asc[:mid]
        second_half = rows_asc[mid:]
        v1_net = float(first_half[-1].net_gex or 0) - float(first_half[0].net_gex or 0)
        v2_net = float(second_half[-1].net_gex or 0) - float(second_half[0].net_gex or 0)
        accelerating = abs(v2_net) > abs(v1_net) * 1.3
    else:
        accelerating = False
        v1_net, v2_net = 0.0, 0.0

    # Direction label
    VELOCITY_THRESHOLD = abs(net_gex_old) * 0.02 if net_gex_old else 1.0
    if abs(velocity) < VELOCITY_THRESHOLD:
        direction = "stable"
        direction_note = "GEX is stable — dealer hedging flows are balanced. Market likely range-bound at current levels."
    elif velocity > 0:
        direction = "accelerating_build" if accelerating else "building"
        direction_note = (
            f"GEX {'rapidly ' if accelerating else ''}building ({velocity:+.1f} GEX/hr). "
            "Market makers accumulating Gamma — hedging flows increasing. "
            "Call wall may strengthen; expect mean-reversion behaviour near peak gamma strikes."
        )
    else:
        direction = "accelerating_decay" if accelerating else "decaying"
        direction_note = (
            f"GEX {'rapidly ' if accelerating else ''}decaying ({velocity:+.1f} GEX/hr). "
            "Market maker hedging pressure unwinding. "
            "Previous GEX-based support/resistance levels may dissolve — watch for directional breakouts."
        )

    # ── Strike-level movers (compare latest vs 30 min ago) ─────────────────────
    strike_movers: list[dict] = []
    try:
        # Find snapshot ~30 min ago
        cutoff_time = t_latest - timedelta(minutes=30)
        ref_row = min(
            (r for r in rows_asc if r.timestamp.astimezone(IST) <= cutoff_time),
            key=lambda r: abs((r.timestamp.astimezone(IST) - cutoff_time).total_seconds()),
            default=rows_asc[0],
        )

        latest_strikes: dict[float, dict] = {}
        ref_strikes: dict[float, dict] = {}

        for strike_entry in (latest.strike_gex or []):
            k = float(strike_entry.get("strike", 0))
            latest_strikes[k] = strike_entry

        for strike_entry in (ref_row.strike_gex or []):
            k = float(strike_entry.get("strike", 0))
            ref_strikes[k] = strike_entry

        movers = []
        for strike, s_new in latest_strikes.items():
            if strike in ref_strikes:
                s_old = ref_strikes[strike]
                net_gex_change = float(s_new.get("net_gex", 0)) - float(s_old.get("net_gex", 0))
                movers.append({
                    "strike": strike,
                    "net_gex_change": round(net_gex_change, 2),
                    "direction": "building" if net_gex_change > 0 else "decaying",
                    "current_net_gex": round(float(s_new.get("net_gex", 0)), 2),
                })

        movers.sort(key=lambda x: abs(x["net_gex_change"]), reverse=True)
        strike_movers = movers[:5]
    except Exception as e:
        logger.debug(f"GEX velocity strike movers failed: {e}")

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "expiry": target_expiry,
        "snapshot_count": len(rows_asc),
        "elapsed_hours": round(elapsed_hours, 2),
        "net_gex_start": round(net_gex_old, 2),
        "net_gex_current": round(net_gex_new, 2),
        "total_gex_current": round(total_gex_new, 2),
        "velocity": velocity,
        "total_gex_velocity": total_gex_velocity,
        "accelerating": accelerating,
        "direction": direction,
        "direction_note": direction_note,
        "gex_series": gex_series,
        "strike_movers": strike_movers,
    }
