from pydantic import BaseModel
from typing import Optional


class StrikeGEXSchema(BaseModel):
    strike: float
    call_oi: float
    call_gamma: float
    call_gamma_exposure: float
    put_oi: float
    put_gamma: float
    put_gamma_exposure: float
    net_gex: float


class GEXSchema(BaseModel):
    timestamp: str
    expiry_date: str
    spot_price: float
    lot_size: int
    total_gex: float
    net_gex: float
    regime: str
    regime_description: str
    zero_gamma_level: float
    call_wall: float
    put_wall: float
    pcr: float
    call_oi_total: float
    put_oi_total: float
    strikes: list[StrikeGEXSchema]
