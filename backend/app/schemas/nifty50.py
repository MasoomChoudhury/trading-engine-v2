from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    database: str
    websocket: str


class CandleResponse(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    oi: float


class IndicatorResponse(BaseModel):
    timestamp: str
    symbol: str
    indicators: dict[str, float | str | dict | None]
    spot_price: Optional[float] = None
    approximation_note: Optional[str] = None


class DerivedMetricsResponse(BaseModel):
    timestamp: str
    symbol: str
    spot_price: float
    metrics: dict
    approximation_note: Optional[str] = None


class GEXResponse(BaseModel):
    timestamp: str
    expiry_date: str
    spot_price: float
    total_gex: float
    net_gex: float
    regime: str
    regime_description: str
    zero_gamma_level: float | None = None
    call_wall: float
    put_wall: float
    pcr: float
    strike_gex: list[dict]
    call_wall_distance: float
    put_wall_distance: float


class LivePriceResponse(BaseModel):
    symbol: str
    ltp: float
    change: float
    change_pct: float
    ltt: Optional[str] = None
    cp: Optional[float] = None


class ApiLogEntry(BaseModel):
    id: int
    timestamp: str
    endpoint: str
    method: str
    request_params: Optional[dict] = None
    response_status: Optional[int] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None


class ApiLogResponse(BaseModel):
    total: int
    page: int
    page_size: int
    entries: list[ApiLogEntry]


class MarketStatusResponse(BaseModel):
    status: str
    segment: str
    timestamp: str


class RefreshResponse(BaseModel):
    status: str
    message: str
    candles_fetched: int
    indicators_calculated: int
    gex_calculated: bool
    derived_calculated: int
