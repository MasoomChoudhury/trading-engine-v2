"""
Upstox Webhook Receiver
Receives access tokens from Upstox via their "Semi-Automated Token Generation" flow.

Configure the webhook URL in Upstox Developer Dashboard as:
  https://nifty50.masoomchoudhury.com/api/v1/webhook/upstox-token

Upstox will POST to this endpoint when the user approves the login request
triggered by our /api/v1/auth/request-token endpoint.
"""
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone
from app.db.database import get_logs_session
from app.db.models import UpstoxToken
from loguru import logger

router = APIRouter(prefix="/api/v1/webhook", tags=["Webhook"])


class UpstoxTokenPayload(BaseModel):
    """Payload Upstox sends when the user approves the login."""
    client_id: str
    user_id: str
    access_token: str
    token_type: str = "Bearer"
    expires_at: str  # Unix timestamp in ms, e.g. "1731448800000"
    issued_at: str    # Unix timestamp in ms
    message_type: str  # Should be "access_token"


@router.post("/upstox-token")
async def receive_upstox_token(request: Request):
    """
    Public webhook endpoint — receives the access_token from Upstox.

    Upstox will POST here after the user approves the login request.
    We save the token to the database so `get_access_token()` can use it.
    """
    # Read raw body first so we can log it
    raw_body = await request.body()
    logger.info(f"Upstox webhook received: {raw_body[:500]}")

    # Parse JSON
    try:
        payload = UpstoxTokenPayload.model_validate_json(raw_body)
    except Exception as e:
        logger.error(f"Failed to parse webhook payload: {e}")
        raise HTTPException(status_code=400, detail="Invalid payload")

    # Security check: validate message_type
    if payload.message_type != "access_token":
        logger.warning(f"Unexpected message_type: {payload.message_type}")
        # Still return 200 so Upstox doesn't keep retrying
        return {"status": "ignored", "reason": f"Unexpected message_type: {payload.message_type}"}

    # Convert Unix timestamps (ms) to datetime
    try:
        expires_at = datetime.fromtimestamp(
            int(payload.expires_at) / 1000, tz=timezone.utc
        )
        issued_at = datetime.fromtimestamp(
            int(payload.issued_at) / 1000, tz=timezone.utc
        )
    except (ValueError, OSError) as e:
        logger.error(f"Failed to parse timestamps: {e}")
        expires_at = datetime.now(timezone.utc)
        issued_at = datetime.now(timezone.utc)

    # Save or update token in database
    try:
        async with get_logs_session() as session:
            # Check if token for this user already exists
            from sqlalchemy import select
            stmt = select(UpstoxToken).where(UpstoxToken.user_id == payload.user_id)
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                # Update existing token
                existing.access_token = payload.access_token
                existing.token_type = payload.token_type
                existing.expires_at = expires_at
                existing.issued_at = issued_at
                existing.received_at = datetime.now(timezone.utc)
                logger.info(
                    f"Updated Upstox token for user {payload.user_id}, "
                    f"expires {expires_at.isoformat()}"
                )
            else:
                # Insert new token
                token_record = UpstoxToken(
                    user_id=payload.user_id,
                    client_id=payload.client_id,
                    access_token=payload.access_token,
                    token_type=payload.token_type,
                    expires_at=expires_at,
                    issued_at=issued_at,
                    received_at=datetime.now(timezone.utc),
                )
                session.add(token_record)
                logger.info(
                    f"Saved new Upstox token for user {payload.user_id}, "
                    f"expires {expires_at.isoformat()}"
                )

            await session.commit()

    except Exception as e:
        logger.error(f"Failed to save token to database: {e}")
        # Still return 200 so Upstox doesn't retry
        return {
            "status": "error",
            "detail": "Webhook received but token save failed",
        }

    return {
        "status": "success",
        "user_id": payload.user_id,
        "expires_at": expires_at.isoformat(),
    }
