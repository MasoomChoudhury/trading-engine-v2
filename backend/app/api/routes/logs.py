from fastapi import APIRouter, Query
from app.schemas.nifty50 import ApiLogResponse, ApiLogEntry, MarketStatusResponse
from app.db.database import get_logs_session
from app.db.models import ApiLog, MarketStatusLog
from sqlalchemy import select, desc, func, and_
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/api/v1/logs", tags=["Logs"])

IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


@router.get("/api", response_model=ApiLogResponse)
async def get_api_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    endpoint: str | None = None,
    method: str | None = None,
    status: int | None = None,
    hours: int = Query(default=24, ge=1, le=168),
):
    """Get paginated API logs with optional filters."""
    async with get_logs_session() as session:
        conditions = [
            ApiLog.timestamp >= ist_now() - timedelta(hours=hours)
        ]
        if endpoint:
            conditions.append(ApiLog.endpoint.contains(endpoint))
        if method:
            conditions.append(ApiLog.method == method.upper())
        if status:
            conditions.append(ApiLog.response_status == status)

        count_stmt = select(func.count(ApiLog.id)).where(and_(*conditions))
        total_result = await session.execute(count_stmt)
        total = total_result.scalar() or 0

        offset = (page - 1) * page_size
        stmt = (
            select(ApiLog)
            .where(and_(*conditions))
            .order_by(desc(ApiLog.timestamp))
            .offset(offset)
            .limit(page_size)
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()

        entries = [
            ApiLogEntry(
                id=row.id,
                timestamp=row.timestamp.isoformat() if row.timestamp else "",
                endpoint=row.endpoint,
                method=row.method,
                request_params=row.request_params,
                response_status=row.response_status,
                duration_ms=row.duration_ms,
                error=row.error,
            )
            for row in rows
        ]

        return ApiLogResponse(
            total=total,
            page=page,
            page_size=page_size,
            entries=entries,
        )


@router.get("/market-status")
async def get_market_status(
    hours: int = Query(default=24, ge=1, le=168),
):
    """Get recent market status history."""
    async with get_logs_session() as session:
        stmt = (
            select(MarketStatusLog)
            .where(MarketStatusLog.timestamp >= ist_now() - timedelta(hours=hours))
            .order_by(desc(MarketStatusLog.timestamp))
            .limit(100)
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()

        return [
            MarketStatusResponse(
                status=row.status,
                segment=getattr(row, 'segment', ''),
                timestamp=row.timestamp.isoformat() if row.timestamp else "",
            )
            for row in rows
        ]
