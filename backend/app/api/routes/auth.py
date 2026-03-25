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
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.upstox_client import token_manager
from loguru import logger

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


class TokenRequestResponse(BaseModel):
    status: str
    message: str
    authorization_expiry: str | None = None
    notifier_url: str | None = None


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
