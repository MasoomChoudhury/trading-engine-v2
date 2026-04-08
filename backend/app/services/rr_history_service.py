"""
25-Delta Risk Reversal History + Skew Rank — Gap items 3 & 4.

Reads rr25 snapshots from derived_metric_snapshots (written every 5 min
by the scheduler) and computes:

  RR Rank (like IVR):
    rr_rank = (current - min_252d) / (max_252d - min_252d) × 100

  RR Percentile (like IVP):
    rr_pct = count(history ≤ current) / len(history) × 100

  Interpretation:
    High RR (put skew heavy) = market paying a lot for downside protection
    → rising RR during a bounce = smart money still hedging = bearish signal
    Low RR                    = put/call premium nearly equal
    Negative RR               = call skew (market pricing upside surprise)
"""
from datetime import datetime, timedelta, timezone
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
SYMBOL = "NIFTY50"


async def get_rr_history(days: int = 60) -> dict:
    """
    Return rr25 history, current rank, and percentile.
    `days` controls chart window; rank/percentile always use 252-day window.
    """
    from app.db.database import get_ts_session
    from sqlalchemy import text

    now = datetime.now(IST)
    chart_cutoff = now - timedelta(days=days)
    rank_cutoff  = now - timedelta(days=252)

    try:
        async with get_ts_session() as session:
            # Chart data (last `days` worth of RR snapshots)
            chart_rows = (await session.execute(text("""
                SELECT timestamp, value
                FROM derived_metric_snapshots
                WHERE symbol = :sym AND metric_name = 'rr25'
                  AND timestamp >= :cutoff
                  AND value IS NOT NULL
                ORDER BY timestamp ASC
            """), {"sym": SYMBOL, "cutoff": chart_cutoff})).fetchall()

            # 252-day history for rank/percentile
            rank_rows = (await session.execute(text("""
                SELECT value
                FROM derived_metric_snapshots
                WHERE symbol = :sym AND metric_name = 'rr25'
                  AND timestamp >= :cutoff
                  AND value IS NOT NULL
                ORDER BY timestamp ASC
            """), {"sym": SYMBOL, "cutoff": rank_cutoff})).fetchall()

    except Exception as e:
        logger.warning(f"rr_history query failed: {e}")
        return {"error": str(e), "history": [], "rr_rank": None, "rr_pct": None}

    history = [
        {
            "timestamp": row[0].isoformat(),
            "rr25": round(float(row[1]), 2),
        }
        for row in chart_rows
    ]

    current_rr = history[-1]["rr25"] if history else None
    all_vals   = [float(r[0]) for r in rank_rows]

    rr_rank = None
    rr_pct  = None
    rr_min  = None
    rr_max  = None

    if all_vals and current_rr is not None:
        rr_min = min(all_vals)
        rr_max = max(all_vals)
        span   = rr_max - rr_min
        rr_rank = round((current_rr - rr_min) / span * 100, 1) if span > 0 else 50.0
        rr_pct  = round(sum(1 for v in all_vals if v <= current_rr) / len(all_vals) * 100, 1)

    # Signal interpretation
    signal = None
    signal_note = None
    if current_rr is not None:
        if rr_rank is not None and rr_rank >= 75:
            signal = "put_skew_extreme"
            signal_note = f"RR rank {rr_rank:.0f}th — put premium unusually high; market hedging aggressively"
        elif rr_rank is not None and rr_rank >= 50:
            signal = "put_skew_elevated"
            signal_note = f"RR rank {rr_rank:.0f}th — above-average put premium; stay cautious on call buying"
        elif current_rr < 0:
            signal = "call_skew"
            signal_note = "Negative RR — call IV > put IV; market pricing upside surprise"
        else:
            signal = "neutral"
            signal_note = "Skew near historical average"

    return {
        "timestamp": now.isoformat(),
        "current_rr25": current_rr,
        "rr_rank": rr_rank,
        "rr_pct": rr_pct,
        "rr_min_252d": round(rr_min, 2) if rr_min is not None else None,
        "rr_max_252d": round(rr_max, 2) if rr_max is not None else None,
        "history_count": len(all_vals),
        "signal": signal,
        "signal_note": signal_note,
        "history": history,
    }
