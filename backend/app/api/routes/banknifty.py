from fastapi import APIRouter, HTTPException
from loguru import logger
from app.services.banknifty_service import build_banknifty_analytics

router = APIRouter(prefix="/api/v1/banknifty", tags=["BankNifty"])


@router.get("/analytics")
async def get_banknifty_analytics():
    """
    BankNifty GEX, PCR, gamma walls, zero-gamma level and regime.
    BankNifty often leads Nifty — negative GEX here can preempt Nifty moves.
    """
    try:
        return await build_banknifty_analytics()
    except Exception as e:
        logger.error(f"BankNifty analytics failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))
