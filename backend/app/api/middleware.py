import time
import json
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from loguru import logger
from app.db.database import get_logs_session
from app.db.models import ApiLog
from sqlalchemy import insert


class ApiLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs every Upstox API request made by the application."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        return response


async def log_api_call(
    req_id: str,
    endpoint: str,
    method: str,
    params: dict | None,
    status: int | None,
    response: dict | None,
    duration_ms: int,
    error: str | None,
) -> None:
    """Called by UpstoxClient._request to log every API call to PostgreSQL."""
    try:
        async with get_logs_session() as session:
            log_entry = ApiLog(
                endpoint=endpoint,
                method=method,
                request_params=params,
                response_status=status,
                response_body=_truncate_response(response),
                duration_ms=duration_ms,
                error=error,
            )
            session.add(log_entry)
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to log API call: {e}")


def _truncate_response(response: dict | None) -> dict | None:
    """Truncate response to avoid huge DB entries."""
    if not response:
        return None
    s = json.dumps(response)
    if len(s) > 2000:
        return {"_truncated": True, "_preview": s[:500]}
    return response
