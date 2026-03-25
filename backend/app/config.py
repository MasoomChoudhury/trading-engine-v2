from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Upstox credentials
    upstox_api_key: str = ""
    upstox_api_secret: str = ""
    upstox_totp_secret: str = ""

    # Database
    database_url: str = "postgresql+asyncpg://nifty50:nifty50pass@localhost:5432/nifty50_timeseries"
    logs_database_url: str = "postgresql+asyncpg://nifty50logs:nifty50logspass@localhost:5433/nifty50_logs"

    # App settings
    log_level: str = "INFO"
    tz: str = "Asia/Kolkata"
    refresh_interval_seconds: int = 300
    websocket_enabled: bool = True

    # Upstox API
    upstox_base_url: str = "https://api.upstox.com"
    upstox_ws_url: str = "wss://api.upstox.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
