"""
Upstox Authentication Routes
Handles Semi-Automated Token Generation — the modern way to get Upstox tokens daily.

Flow:
1. User (or cron) calls POST /api/v1/auth/request-token
2. Our backend calls Upstox's token request API
3. User gets a push notification on their Upstox app
4. User approves in the Upstox app
5. Upstox sends the token to our webhook: POST /api/v1/webhook/upstox-token
6. Token is saved to DB and used automatically by the rest of the app

This replaces the old TOTP-based flow which required manual code entry.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.upstox_client import token_manager, upstox_client
from loguru import logger

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


class TokenRequestResponse(BaseModel):
    status: str
    message: str
    authorization_expiry: str | None = None
    notifier_url: str | None = None


class MarketOpenCheckResponse(BaseModel):
    status: str
    next_trading_day: str
    is_market_open: bool
    holiday_description: str | None = None
    token_triggered: bool
    message: str


@router.post("/request-token", response_model=TokenRequestResponse)
async def request_upstox_token():
    """
    Initiate the Semi-Automated Token Request.

    This sends a push notification to the user's Upstox app.
    Once they approve, Upstox delivers the access_token to our webhook.

    Upstox tokens expire daily at ~3:30 AM IST. Call this once per day.

    You can also set up a cron job to call this automatically:
      curl -X POST https://nifty50.masoomchoudhury.com/api/v1/auth/request-token
    """
    try:
        result = await token_manager.initiate_token_request()
        auth_expiry = result.get("data", {}).get("authorization_expiry")
        notifier_url = result.get("data", {}).get("notifier_url")

        return TokenRequestResponse(
            status="success",
            message="Token request sent. Check your Upstox app to approve the login. "
                    "The token will be received automatically via webhook once approved.",
            authorization_expiry=auth_expiry,
            notifier_url=notifier_url,
        )

    except Exception as e:
        logger.error(f"Token request failed: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to initiate Upstox token request: {str(e)}",
        )


@router.get("/status")
async def token_status():
    """
    Check the current token status — whether we have a valid token
    and when it expires.
    """
    from app.db.database import get_logs_session
    from app.db.models import UpstoxToken
    from sqlalchemy import select

    async with get_logs_session() as session:
        stmt = select(UpstoxToken).order_by(UpstoxToken.received_at.desc()).limit(1)
        result = await session.execute(stmt)
        row = result.scalar_one_or_none()

    if not row:
        return {
            "has_token": False,
            "source": None,
            "expires_at": None,
            "message": "No token found. Call POST /api/v1/auth/request-token first.",
        }

    return {
        "has_token": True,
        "source": "webhook",
        "user_id": row.user_id,
        "issued_at": row.issued_at.isoformat() if row.issued_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "received_at": row.received_at.isoformat() if row.received_at else None,
    }


def _next_trading_day() -> str:
    """Return the next trading day (tomorrow, or Monday if today is Fri/Sat/Sun).

    IST is UTC+5:30. Cron runs at 9:00 PM IST = 15:30 UTC.
    "Tomorrow" in IST terms is what we check.
    """
    now_utc = datetime.now(timezone.utc)
    # Convert to IST for date arithmetic
    ist_offset = timedelta(hours=5, minutes=30)
    now_ist = now_utc + ist_offset
    tomorrow_ist = now_ist + timedelta(days=1)
    weekday = tomorrow_ist.weekday()

    if weekday == 5:  # Saturday → next Monday
        return (tomorrow_ist + timedelta(days=2)).strftime("%Y-%m-%d")
    if weekday == 6:  # Sunday → next Monday
        return (tomorrow_ist + timedelta(days=1)).strftime("%Y-%m-%d")
    return tomorrow_ist.strftime("%Y-%m-%d")


@router.post("/check-and-trigger", response_model=MarketOpenCheckResponse)
async def check_market_and_trigger():
    """
    Check if the next trading day is a market holiday. If the market is open,
    automatically trigger the Upstox token request.

    This endpoint is designed to be called by a cron job at 9:00 PM IST daily.
    It prevents wasted push notifications on holidays.
    """
    next_day = _next_trading_day()
    logger.info(f"Checking market holiday for next trading day: {next_day}")

    try:
        holidays_data = await upstox_client.get_market_holidays(next_day)
    except Exception as e:
        logger.error(f"Failed to fetch market holidays: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch market holidays from Upstox: {str(e)}",
        )

    is_closed = upstox_client.is_nse_closed_on_date(holidays_data, next_day)
    holiday_desc: str | None = None

    if is_closed:
        holidays = holidays_data.get("data") or []
        for h in holidays:
            if h.get("date") == next_day:
                holiday_desc = h.get("description")
                break

        logger.info(f"Market closed on {next_day}: {holiday_desc}. Skipping token request.")
        return MarketOpenCheckResponse(
            status="success",
            next_trading_day=next_day,
            is_market_open=False,
            holiday_description=holiday_desc,
            token_triggered=False,
            message=f"Market holiday on {next_day}: {holiday_desc}. Token request skipped.",
        )

    # Market is open — trigger token
    logger.info(f"Market open on {next_day}. Triggering token request.")
    try:
        await token_manager.initiate_token_request()
    except Exception as e:
        logger.error(f"Token request failed after holiday check: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Market is open but token request failed: {str(e)}",
        )

    return MarketOpenCheckResponse(
        status="success",
        next_trading_day=next_day,
        is_market_open=True,
        holiday_description=None,
        token_triggered=True,
        message=f"Market open on {next_day}. Token request sent. Approve the Upstox push notification.",
    )
