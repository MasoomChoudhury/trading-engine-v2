from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from loguru import logger
from app.services.breadth_service import build_breadth_analytics, refresh_all_constituents, load_constituents, compute_advance_decline
from app.services.sector_rs_service import get_sector_rs

router = APIRouter(prefix="/api/v1/breadth", tags=["Breadth"])

_refresh_running = False


@router.get("/analytics")
async def get_breadth_analytics():
    """
    Nifty 50 constituent breadth and volume analytics.
    Returns: volume series, breadth score, sector rotation, OI heatmap, heavyweight isolation.
    Returns status=loading if constituent candles are not yet cached.
    """
    try:
        return await build_breadth_analytics()
    except Exception as e:
        logger.error(f"Breadth analytics failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/refresh")
async def refresh_breadth_data(background_tasks: BackgroundTasks):
    """
    Trigger refresh of all 50 Nifty constituent candles from Upstox.
    Runs asynchronously — returns immediately.
    """
    global _refresh_running
    if _refresh_running:
        return {"status": "already_running", "message": "Refresh already in progress"}
    _refresh_running = True

    async def _run():
        global _refresh_running
        try:
            counts = await refresh_all_constituents()
            logger.info(f"Breadth refresh complete: {sum(counts.values())} candles")
        finally:
            _refresh_running = False

    background_tasks.add_task(_run)
    return {"status": "started", "message": "Fetching candles for all 50 constituents — check /analytics in ~30s"}


@router.get("/advance-decline")
async def get_advance_decline(days: int = Query(default=30, ge=5, le=90)):
    """
    Nifty 50 Advance-Decline ratio for last N trading days.
    Returns per-day advances/declines, A-D ratio, cumulative A-D line, breadth%.
    """
    try:
        return await compute_advance_decline(days=days)
    except Exception as e:
        logger.error(f"Advance-decline failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/sector-rs")
async def get_sector_rs_route(days: int = Query(default=60, ge=10, le=252)):
    """
    FinNifty and Nifty IT relative strength vs Nifty 50.
    RS normalised to 100 at the start of the window.
    RS > 100 = sector outperformed Nifty since base date.
    """
    try:
        return await get_sector_rs(days=days)
    except Exception as e:
        logger.error(f"Sector RS failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/config")
async def get_config():
    """Return current constituent config with weights and metadata."""
    cfg = load_constituents()
    return {
        "last_updated": cfg["last_updated"],
        "weights_age_days": cfg["weights_age_days"],
        "weights_stale": cfg["weights_age_days"] > 100,
        "n_constituents": len(cfg["constituents"]),
        "heavyweights": cfg["heavyweights"],
        "constituents": cfg["constituents"],
    }
