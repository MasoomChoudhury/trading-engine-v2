"""
Historical Straddle IV Context — Gap item 7.

Answers: "Is today's ATM IV cheap or expensive given the current DTE and VIX?"

Query logic:
  Find all historical straddle snapshots where:
    DTE is within ±1 of current DTE
    VIX is within ±1.5 of current VIX
  Aggregate their atm_iv to produce:
    - historical average, median, min, max
    - percentile of current IV within that distribution
    - qualitative verdict: cheap | fair | expensive

Requires vix_at_snap and dte_at_snap columns to be populated (done from
save_straddle_snapshot as of the migration in intraday_momentum_service.py).
Returns a progress note when fewer than 30 matching sessions have been found.
"""
from datetime import datetime, timedelta, timezone
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


async def get_straddle_iv_context(
    current_dte: int,
    current_vix: float,
    current_atm_iv: float | None,
    dte_window: int = 1,
    vix_window: float = 1.5,
    min_sessions_target: int = 30,
) -> dict:
    """
    Return historical ATM IV stats for conditions similar to today's DTE/VIX.
    """
    from app.db.database import get_ts_session
    from sqlalchemy import text

    try:
        async with get_ts_session() as session:
            rows = (await session.execute(text("""
                SELECT atm_iv, vix_at_snap, dte_at_snap,
                       DATE_TRUNC('day', timestamp) AS snap_date
                FROM straddle_snapshots
                WHERE dte_at_snap BETWEEN :dte_lo AND :dte_hi
                  AND vix_at_snap BETWEEN :vix_lo AND :vix_hi
                  AND atm_iv IS NOT NULL
                  AND vix_at_snap IS NOT NULL
                  AND dte_at_snap IS NOT NULL
                ORDER BY timestamp DESC
            """), {
                "dte_lo": max(0, current_dte - dte_window),
                "dte_hi": current_dte + dte_window,
                "vix_lo": max(0.0, current_vix - vix_window),
                "vix_hi": current_vix + vix_window,
            })).fetchall()
    except Exception as e:
        logger.warning(f"straddle_iv_context query failed: {e}")
        return {"error": str(e)}

    if not rows:
        return _empty_response(current_dte, current_vix, current_atm_iv, min_sessions_target)

    ivs        = [float(r[0]) for r in rows]
    snap_dates = list({str(r[3])[:10] for r in rows})  # distinct days

    session_count = len(snap_dates)
    iv_avg    = round(sum(ivs) / len(ivs), 2)
    iv_sorted = sorted(ivs)
    n = len(iv_sorted)
    iv_med = round(iv_sorted[n // 2], 2)
    iv_min = round(min(ivs), 2)
    iv_max = round(max(ivs), 2)

    iv_pct: float | None = None
    verdict: str | None = None
    verdict_note: str | None = None

    if current_atm_iv is not None and iv_sorted:
        iv_pct = round(sum(1 for v in iv_sorted if v <= current_atm_iv) / len(iv_sorted) * 100, 1)
        if iv_pct >= 75:
            verdict = "expensive"
            verdict_note = f"Current IV {current_atm_iv}% is in the {iv_pct:.0f}th percentile — expensive vs similar conditions"
        elif iv_pct <= 25:
            verdict = "cheap"
            verdict_note = f"Current IV {current_atm_iv}% is in the {iv_pct:.0f}th percentile — cheap vs similar conditions"
        else:
            verdict = "fair"
            verdict_note = f"Current IV {current_atm_iv}% is in the {iv_pct:.0f}th percentile — fairly priced"

    sufficient = session_count >= min_sessions_target
    progress_note = None if sufficient else (
        f"Accumulating history — {session_count} of {min_sessions_target} target sessions "
        f"(DTE {current_dte}±{dte_window}, VIX {current_vix:.1f}±{vix_window})"
    )

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "query_dte":   current_dte,
        "query_vix":   current_vix,
        "current_atm_iv": current_atm_iv,
        "session_count": session_count,
        "sample_count":  len(ivs),
        "sufficient_history": sufficient,
        "progress_note": progress_note,
        "iv_avg":  iv_avg,
        "iv_med":  iv_med,
        "iv_min":  iv_min,
        "iv_max":  iv_max,
        "iv_pct":  iv_pct,
        "verdict": verdict,
        "verdict_note": verdict_note,
        "dte_window": dte_window,
        "vix_window": vix_window,
    }


def _empty_response(dte: int, vix: float, atm_iv: float | None, target: int) -> dict:
    return {
        "timestamp": datetime.now(IST).isoformat(),
        "query_dte": dte,
        "query_vix": vix,
        "current_atm_iv": atm_iv,
        "session_count": 0,
        "sample_count": 0,
        "sufficient_history": False,
        "progress_note": (
            f"No history yet for DTE≈{dte} / VIX≈{vix:.0f}. "
            f"Panel will populate after {target} matching sessions accumulate."
        ),
        "iv_avg": None, "iv_med": None, "iv_min": None, "iv_max": None,
        "iv_pct": None, "verdict": None, "verdict_note": None,
        "dte_window": 1, "vix_window": 1.5,
    }
