from sqlalchemy import Column, String, Numeric, BigInteger, Date, Text, Integer, DateTime, Index, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func
from datetime import datetime


class Base(DeclarativeBase):
    pass


class Candle(Base):
    __tablename__ = "candles"
    __table_args__ = (
        PrimaryKeyConstraint("timestamp", "symbol", "interval"),
    )

    timestamp = Column(DateTime(timezone=True), primary_key=True)
    symbol = Column(String, primary_key=True)
    interval = Column(String, primary_key=True)
    open = Column(Numeric, nullable=False)
    high = Column(Numeric, nullable=False)
    low = Column(Numeric, nullable=False)
    close = Column(Numeric, nullable=False)
    volume = Column(BigInteger, default=0)
    oi = Column(BigInteger, default=0)


class IndicatorSnapshot(Base):
    __tablename__ = "indicator_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("timestamp", "symbol", "indicator_name"),
    )

    timestamp = Column(DateTime(timezone=True), primary_key=True)
    symbol = Column(String, primary_key=True)
    indicator_name = Column(String, primary_key=True)
    value = Column(Numeric)
    extra = Column(JSONB)


class DerivedMetricSnapshot(Base):
    __tablename__ = "derived_metric_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("timestamp", "symbol", "metric_name"),
    )

    timestamp = Column(DateTime(timezone=True), primary_key=True)
    symbol = Column(String, primary_key=True)
    metric_name = Column(String, primary_key=True)
    value = Column(Numeric)
    extra_data = Column(JSONB)


class GexSnapshot(Base):
    __tablename__ = "gex_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("timestamp", "expiry_date"),
    )

    timestamp = Column(DateTime(timezone=True), primary_key=True)
    expiry_date = Column(Date, primary_key=True)
    spot_price = Column(Numeric, nullable=False)
    total_gex = Column(Numeric)
    net_gex = Column(Numeric)
    zero_gamma_level = Column(Numeric)
    call_wall = Column(Numeric)
    put_wall = Column(Numeric)
    pcr = Column(Numeric)
    strike_gex = Column(JSONB)


class PriceTick(Base):
    __tablename__ = "price_ticks"
    __table_args__ = (
        PrimaryKeyConstraint("timestamp", "symbol"),
    )

    timestamp = Column(DateTime(timezone=True), primary_key=True)
    symbol = Column(String, primary_key=True)
    ltp = Column(Numeric, nullable=False)
    ltt = Column(DateTime(timezone=True))
    volume = Column(BigInteger, default=0)
    oi = Column(BigInteger, default=0)
    cp = Column(Numeric)


class ApiLog(Base):
    __tablename__ = "api_logs"
    __table_args__ = (
        Index("idx_api_logs_timestamp", "timestamp", postgresql_using="btree"),
        Index("idx_api_logs_endpoint", "endpoint"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=func.now())
    endpoint = Column(String, nullable=False)
    method = Column(String, nullable=False)
    request_params = Column(JSONB)
    response_status = Column(Integer)
    response_body = Column(JSONB)
    duration_ms = Column(Integer)
    error = Column(Text)


class MarketStatusLog(Base):
    __tablename__ = "market_status_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=func.now())
    status = Column(String, nullable=False)
    segment = Column(String, nullable=False)


class AppConfig(Base):
    __tablename__ = "app_config"

    key = Column(String, primary_key=True)
    value = Column(JSONB)
    updated_at = Column(DateTime(timezone=True), default=func.now())


class UpstoxToken(Base):
    """Stores Upstox access tokens received via webhook."""
    __tablename__ = "upstox_tokens"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, unique=True)  # Upstox UCC
    client_id = Column(String, nullable=False)
    access_token = Column(Text, nullable=False)
    token_type = Column(String, default="Bearer")
    expires_at = Column(DateTime(timezone=True))
    issued_at = Column(DateTime(timezone=True))
    received_at = Column(DateTime(timezone=True), nullable=False, default=func.now())


class StraddleSnapshot(Base):
    """Intraday ATM straddle price snapshots (saved every 5 minutes by scheduler)."""
    __tablename__ = "straddle_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("timestamp"),
    )

    timestamp = Column(DateTime(timezone=True), primary_key=True)
    expiry = Column(String, nullable=False)
    spot = Column(Numeric)
    atm_strike = Column(Numeric)
    ce_ltp = Column(Numeric)
    pe_ltp = Column(Numeric)
    straddle_price = Column(Numeric)
    ce_iv = Column(Numeric)
    pe_iv = Column(Numeric)
    atm_iv = Column(Numeric)
