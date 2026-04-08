from fastapi import APIRouter, HTTPException
from loguru import logger
from app.services.futures_service import (
    get_active_futures,
    fetch_futures_daily_candles,
    compute_futures_analytics,
)
from app.services.futures_basis_service import get_futures_basis

router = APIRouter(prefix="/api/v1/futures", tags=["Futures"])


@router.get("/volume")
async def get_futures_volume():
    """
    Get Nifty futures volume analytics: near+far month candles,
    rollover ratio, volume z-score, expiry-week flags.
    """
    try:
        contracts = await get_active_futures()
    except Exception as e:
        logger.error(f"Failed to fetch futures contracts: {e}")
        raise HTTPException(status_code=502, detail=f"Upstox API error: {e}")

    if len(contracts) < 2:
        raise HTTPException(
            status_code=503,
            detail=f"Not enough active NIFTY futures contracts (found {len(contracts)})",
        )

    near = contracts[0]
    far = contracts[1]
    near_key = near["instrument_key"]
    far_key = far["instrument_key"]
    near_expiry = near["expiry"]
    far_expiry = far["expiry"]
    near_lot_size = near.get("lot_size", 65)

    try:
        near_candles = await fetch_futures_daily_candles(near_key, days=90)
    except Exception as e:
        logger.error(f"Failed to fetch near-month candles ({near_key}): {e}")
        raise HTTPException(status_code=502, detail=f"Near-month candle fetch failed: {e}")

    try:
        far_candles = await fetch_futures_daily_candles(far_key, days=90)
    except Exception as e:
        logger.warning(f"Far-month candle fetch failed ({far_key}): {e}")
        far_candles = []

    result = compute_futures_analytics(
        near_candles=near_candles,
        far_candles=far_candles,
        near_expiry=near_expiry,
        far_expiry=far_expiry,
        near_lot_size=near_lot_size,
    )
    return result


@router.get("/contracts")
async def get_futures_contracts():
    """List active NIFTY futures contracts with metadata."""
    try:
        contracts = await get_active_futures()
        return {"contracts": contracts}
    except Exception as e:
        logger.error(f"Failed to fetch futures contracts: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/basis")
async def get_basis():
    """
    Futures basis (futures LTP − spot) and cost of carry.
    - Rising basis: longs paying up → bullish carry, institutional accumulation
    - Falling basis: unwinding or short buildup
    - Negative basis: short pressure or discount due to aggressive selling
    Includes annualised carry %, fair basis from risk-free rate model, and 30-day history.
    """
    try:
        return await get_futures_basis()
    except Exception as e:
        logger.error(f"Futures basis failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))

