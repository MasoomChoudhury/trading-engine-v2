from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from loguru import logger
from app.services.macro_service import get_events, add_event
from app.services.fii_service import get_fii_history, fetch_and_store_fii
from app.services import global_cues_service, fii_deriv_service
from app.services.premarket_service import get_premarket_bias
from app.services.correlation_service import get_correlation_matrix

router = APIRouter(prefix="/api/v1/macro", tags=["Macro Calendar"])


class AddEventRequest(BaseModel):
    event_date: str      # YYYY-MM-DD
    event_type: str      # rbi_mpc | fomc | us_cpi | earnings | custom
    title: str
    description: str = ""
    is_approximate: bool = False


@router.get("/events")
async def list_events(
    days_back: int = Query(default=14, ge=0, le=90),
    days_forward: int = Query(default=90, ge=1, le=365),
):
    """Return macro events in a window around today."""
    try:
        events = await get_events(days_back=days_back, days_forward=days_forward)
        today_events = [e for e in events if e["is_today"]]
        upcoming = [e for e in events if not e["is_past"] and not e["is_today"]]
        past = [e for e in events if e["is_past"]]
        next_event = upcoming[0] if upcoming else None
        return {
            "today": today_events,
            "upcoming": upcoming,
            "past": past,
            "next_event": next_event,
            "total": len(events),
        }
    except Exception as e:
        logger.error(f"Macro events fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fii-flows")
async def get_fii_flows(
    days: int = Query(default=30, ge=5, le=90),
    refresh: bool = Query(default=False),
):
    """FII/DII equity flow history from NSE. Values in ₹100 Crore units."""
    try:
        if refresh:
            await fetch_and_store_fii()
        return await get_fii_history(days=days)
    except Exception as e:
        logger.error(f"FII flows fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/global-cues")
async def get_global_cues():
    """Global market cues: Dow, Nasdaq, S&P 500, Nikkei, Hang Seng, USD/INR."""
    try:
        return await global_cues_service.get_global_cues()
    except Exception as e:
        logger.error(f"Global cues fetch failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/fii-derivatives")
async def get_fii_derivatives(days: int = Query(default=20, ge=1, le=90)):
    """FII/FPI index futures net positioning from NSE participant-wise OI."""
    try:
        return await fii_deriv_service.get_fii_derivatives(days=days)
    except Exception as e:
        logger.error(f"FII derivatives fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fii-derivatives/refresh")
async def refresh_fii_derivatives():
    """Fetch latest NSE participant OI CSV, store, and return updated data."""
    try:
        records = await fii_deriv_service.fetch_nse_participant_oi()
        stored = await fii_deriv_service.store_fii_deriv(records)
        logger.info(f"FII derivatives refresh: {stored} records stored")
        return await fii_deriv_service.get_fii_derivatives(days=20)
    except Exception as e:
        logger.error(f"FII derivatives refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/premarket-bias")
async def get_premarket_bias_endpoint():
    """
    Pre-market bias aggregator: Gift Nifty proxy, DXY/US10Y EM signal,
    USD/INR intraday trend, FII cash flows, FII F&O positioning.
    Returns a bias score and per-signal breakdown.
    """
    try:
        return await get_premarket_bias()
    except Exception as e:
        logger.error(f"Premarket bias failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/events")
async def create_event(body: AddEventRequest):
    """Add a custom macro event."""
    try:
        result = await add_event(
            event_date=body.event_date,
            event_type=body.event_type,
            title=body.title,
            description=body.description,
            is_approximate=body.is_approximate,
        )
        return result
    except Exception as e:
        logger.error(f"Macro event add failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/correlation")
async def get_correlation():
    """
    Rolling Pearson correlation between Nifty 50 and global indices (S&P 500, Nikkei, Hang Seng)
    over 10, 20, 30-day windows of daily log returns.
    - High correlation (>0.7): moves are globally driven, harder to fade
    - Decoupling (<0.2): idiosyncratic domestic move — more tradeable / divergence signal
    - Rising correlation on a down day: global sell-off dragging Nifty down
    """
    try:
        return await get_correlation_matrix()
    except Exception as e:
        logger.error(f"Correlation matrix failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))
