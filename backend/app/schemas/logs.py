from pydantic import BaseModel
from typing import Optional


class ApiLogSchema(BaseModel):
    id: int
    timestamp: str
    endpoint: str
    method: str
    request_params: Optional[dict] = None
    response_status: Optional[int] = None
    response_body: Optional[dict] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None


class MarketStatusSchema(BaseModel):
    id: int
    timestamp: str
    status: str
    segment: str
