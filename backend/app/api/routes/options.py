from fastapi import APIRouter, Query, HTTPException
from loguru import logger
from app.services.options_service import build_options_analytics, save_options_eod, fetch_chain, parse_chain, build_iv_skew, load_oi_trend
from app.services.option_greeks_service import get_buyers_edge, get_chain_greeks
from app.services.intraday_momentum_service import (
    get_vol_weighted_indicators,
    get_straddle_intraday,
    get_pcr_divergence,
)

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


@router.get("/iv-skew")
async def get_iv_skew(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    IV Skew analytics: volatility smile, 25-delta risk reversal, butterfly spread.
    25d RR > 0 = put vol premium = downside fear.
    """
    try:
        return await build_iv_skew(target_expiry=expiry)
    except Exception as e:
        logger.error(f"IV skew failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/oi-trend")
async def get_oi_trend(
    expiry: str | None = Query(default=None),
    days: int = Query(default=10, ge=3, le=30),
):
    """
    10-day per-strike OI trend (build vs unwind) for ATM ± 250 strikes.
    """
    try:
        return await load_oi_trend(expiry=expiry, days=days)
    except Exception as e:
        logger.error(f"OI trend failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/chain-greeks")
async def get_chain_greeks_route(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    Full option chain snapshot with per-strike Greeks (ATM ± 500 pts):
    LTP, Volume, OI, IV, Delta, Theta, Vega, Gamma — CE and PE side.
    """
    try:
        return await get_chain_greeks(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Chain greeks failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/buyers-edge")
async def get_buyers_edge_route(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    Buyer's Toolkit: full chain + Buyer's Edge ratio (ATR×|Delta|/|Theta|) per strike
    + DTE decay curve showing theta acceleration.
    """
    try:
        return await get_buyers_edge(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Buyers edge failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/vol-indicators")
async def get_vol_indicators(
    interval: str = Query(default="5min", description="Candle interval: 1min or 5min"),
    limit: int = Query(default=100, ge=20, le=300),
):
    """
    Volume-Weighted RSI + MACD series.
    VW-RSI mutes low-volume noise; VW-MACD uses rolling VWAP instead of close.
    Unconfirmed breakout = price moved but volume didn't follow = potential trap.
    """
    try:
        return await get_vol_weighted_indicators(interval=interval, limit=limit)
    except Exception as e:
        logger.error(f"Vol indicators failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/straddle-intraday")
async def get_straddle_intraday_route():
    """
    Today's intraday ATM straddle price snapshots (saved every 5 minutes).
    If spot trends up but straddle falls → IV crush is eating your calls.
    """
    try:
        return await get_straddle_intraday()
    except Exception as e:
        logger.error(f"Straddle intraday failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/pcr-divergence")
async def get_pcr_divergence_route():
    """
    Monthly vs weekly PCR comparison.
    Divergence = short-term counter-trend move inside opposite longer-term structure.
    """
    try:
        return await get_pcr_divergence()
    except Exception as e:
        logger.error(f"PCR divergence failed: {e}")
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
