from fastapi import APIRouter, Query, HTTPException
from loguru import logger
from app.services.options_service import build_options_analytics, save_options_eod, fetch_chain, parse_chain

router = APIRouter(prefix="/api/v1/options", tags=["Options"])


@router.get("/analytics")
async def get_options_analytics(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    Full options OI & sentiment analytics:
    - Current PCR (OI & volume), straddle premium, OI wall, max pain
    - PCR history with 10-day EMA
    - ATM straddle volume history with 20-day MA
    - OI wall chart data
    - OI change today (from prev_oi)
    - OI change heatmap (last 10 days from DB)
    """
    try:
        return await build_options_analytics(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Options analytics failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/save-eod")
async def save_eod_snapshot(
    expiry: str = Query(..., description="Expiry date YYYY-MM-DD"),
):
    """Manually trigger EOD snapshot save for a given expiry."""
    try:
        chain = await fetch_chain(expiry)
        records = parse_chain(chain)
        await save_options_eod(expiry, records)
        return {"saved": len(records), "expiry": expiry}
    except Exception as e:
        logger.error(f"EOD snapshot save failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))
