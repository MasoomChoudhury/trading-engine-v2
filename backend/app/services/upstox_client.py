import httpx
import pyotp
import time
import asyncio
from typing import Any, Optional
from datetime import datetime, timezone, timedelta
from app.config import get_settings
from app.db.database import get_logs_session
from app.db.models import UpstoxToken
from sqlalchemy import select
from loguru import logger

settings = get_settings()
BASE_URL = "https://api.upstox.com"


class UpstoxTokenManager:
    """Manages Upstox OAuth2 tokens.

    Priority:
    1. In-memory cache (fastest)
    2. Database (persisted via webhook)
    3. TOTP flow (manual fallback)
    """

    def __init__(self):
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.token_expiry: float = 0
        self._lock = asyncio.Lock()

    def _generate_totp(self) -> str:
        """Generate TOTP code from secret."""
        if not settings.upstox_totp_secret:
            raise ValueError("UPSTOX_TOTP_SECRET not configured")
        totp = pyotp.TOTP(settings.upstox_totp_secret)
        return totp.now()

    async def get_access_token(self) -> str:
        """Get a valid access token, trying DB first, then TOTP fallback."""
        async with self._lock:
            now = time.time()

            # 1. Always check database for the newest valid token (handles webhook refresh)
            db_token = await self._get_token_from_db()

            if db_token and db_token.get("expires_at_timestamp", 0) > now + 60:
                # DB has a valid token — use it, even if cache has one
                if self.access_token != db_token["access_token"]:
                    logger.info(
                        f"Using Upstox token from database (webhook), "
                        f"expires at {datetime.fromtimestamp(db_token['expires_at_timestamp'], tz=timezone.utc)}"
                    )
                    self.access_token = db_token["access_token"]
                    self.token_expiry = db_token["expires_at_timestamp"]
                else:
                    # Same token, check if cache expiry is reasonable
                    if self.token_expiry < db_token["expires_at_timestamp"]:
                        self.token_expiry = db_token["expires_at_timestamp"]
                return self.access_token

            # 2. Check in-memory cache (fallback for when DB is unavailable)
            if self.access_token and now < self.token_expiry - 60:
                return self.access_token

            # 3. Fall back to TOTP flow
            logger.warning("No valid token in DB, falling back to TOTP flow")
            await self._refresh_token()
            return self.access_token

    async def _get_token_from_db(self) -> Optional[dict[str, Any]]:
        """Fetch the latest token from the database."""
        try:
            async with get_logs_session() as session:
                stmt = select(UpstoxToken).order_by(UpstoxToken.received_at.desc()).limit(1)
                result = await session.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    return {
                        "access_token": row.access_token,
                        "expires_at_timestamp": row.expires_at.timestamp() if row.expires_at else 0,
                        "issued_at": row.issued_at,
                        "user_id": row.user_id,
                    }
        except Exception as e:
            logger.warning(f"Failed to read token from DB: {e}")
        return None

    async def initiate_token_request(self) -> dict[str, Any]:
        """Initiate Semi-Automated Token Request via Upstox.

        This sends a push notification to the user's Upstox app.
        Once they approve, Upstox sends the token via webhook to our server.

        Returns the API response from Upstox.
        """
        if not settings.upstox_api_key or not settings.upstox_api_secret:
            raise ValueError("Upstox API credentials not configured")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BASE_URL}/v3/login/auth/token/request/{settings.upstox_api_key}",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json={
                    "client_secret": settings.upstox_api_secret,
                },
            )
            response.raise_for_status()
            data = response.json()
            logger.info(f"Upstox token request initiated: {data}")
            return data

    async def _refresh_token(self):
        """Use TOTP to get a new access token via the challenge flow."""
        if not settings.upstox_api_key or not settings.upstox_api_secret:
            raise ValueError("Upstox API credentials not configured")

        totp_code = self._generate_totp()

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: Get a fresh request ID and session token
            session_resp = await client.post(
                f"{BASE_URL}/v2/login/authorization/session",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-api-key": settings.upstox_api_key,
                },
                json={
                    "apiSecret": settings.upstox_api_secret,
                },
            )
            session_resp.raise_for_status()
            session_data = session_resp.json()
            request_id = session_data.get("data", {}).get("request_id")

            # Step 2: Complete TOTP verification
            verify_resp = await client.post(
                f"{BASE_URL}/v2/login/authorization/totp-verified",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-api-key": settings.upstox_api_key,
                    "x-request-id": request_id,
                },
                json={
                    "totp": totp_code,
                },
            )
            verify_resp.raise_for_status()
            verify_data = verify_resp.json()

            token_data = verify_data.get("data", {})
            self.access_token = token_data.get("access_token")
            self.refresh_token = token_data.get("refresh_token")
            # Access tokens from session/TOTP flow are typically long-lived
            self.token_expiry = time.time() + (24 * 60 * 60)  # Assume 24h validity

            if not self.access_token:
                raise ValueError("Failed to obtain access token from Upstox")

            logger.info("Upstox access token refreshed successfully")


# Global token manager instance
token_manager = UpstoxTokenManager()


class UpstoxClient:
    """Async HTTP client for Upstox REST API with full request logging."""

    def __init__(self):
        self.base_url = BASE_URL
        self._request_id = 0
        self._log_api_call = None  # Will be set by the API logger

    def set_api_logger(self, log_func):
        """Inject the API logging function from the main app."""
        self._log_api_call = log_func

    async def _request(
        self,
        method: str,
        path: str,
        authenticated: bool = False,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
        headers: Optional[dict] = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        """Make an HTTP request with full logging."""
        self._request_id += 1
        req_id = f"upstox-{self._request_id}"
        url = f"{self.base_url}{path}"

        req_headers = dict(headers or {})
        if authenticated:
            access_token = await token_manager.get_access_token()
            req_headers["Authorization"] = f"Bearer {access_token}"
        req_headers["Content-Type"] = "application/json"
        req_headers["Accept"] = "application/json"

        start_time = time.perf_counter()
        error_msg = None
        status_code = None
        response_data = None

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_data,
                    headers=req_headers,
                )
                status_code = response.status_code
                response_data = response.json()

                if response.status_code >= 400:
                    error_msg = str(response_data)

                response.raise_for_status()
                return response_data.get("data", response_data)

        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP {e.response.status_code}: {e.response.text}"
            raise
        except Exception as e:
            error_msg = str(e)
            raise
        finally:
            duration_ms = int((time.perf_counter() - start_time) * 1000)

            if self._log_api_call:
                await self._log_api_call(
                    req_id=req_id,
                    endpoint=path,
                    method=method,
                    params=params or json_data,
                    status=status_code,
                    response=response_data,
                    duration_ms=duration_ms,
                    error=error_msg,
                )

    # ─── Historical Candles (Public, no auth) ────────────────────────────────

    async def get_historical_candles(
        self,
        instrument_key: str,
        interval: str,
        to_date: str,
        from_date: str,
    ) -> list[list[Any]]:
        """Fetch historical OHLC candles from V2 endpoint (public).
        Note: V3 historical-candle does NOT support index instruments (Nifty 50).
        V2 URL format: /v2/historical-candle/{key}/{interval}/{to_date}/{from_date}
        """
        interval_map = {
            "1min": "1minute",
            "5min": "1minute",
            "15min": "1minute",
            "1hour": "1minute",
            "1day": "day",
        }
        v2_interval = interval_map.get(interval, interval)
        # V2 index endpoint only supports /{to_date} — from_date is ignored by the API
        path = f"/v2/historical-candle/{instrument_key}/{v2_interval}/{to_date}"
        data = await self._request("GET", path, authenticated=False, params={})
        candles = data.get("candles", [])
        logger.debug(f"Fetched {len(candles)} historical candles for {instrument_key} ({interval})")
        return candles

    async def get_intraday_candles(
        self,
        instrument_key: str,
        interval: str,
    ) -> list[list[Any]]:
        """Fetch today's intraday candles from V2 intraday endpoint (authenticated).
        Required for live session data — the historical endpoint only covers completed sessions.
        """
        interval_map = {
            "1min": "1minute",
            "5min": "1minute",
            "15min": "1minute",
            "1hour": "1minute",
            "1day": "day",
        }
        v2_interval = interval_map.get(interval, interval)
        path = f"/v2/historical-candle/intraday/{instrument_key}/{v2_interval}"
        data = await self._request("GET", path, authenticated=True, params={})
        candles = data.get("candles", [])
        logger.debug(f"Fetched {len(candles)} intraday candles for {instrument_key} ({interval})")
        return candles

    # ─── Option Chain (Authenticated) ────────────────────────────────────────

    async def get_option_chain(
        self,
        instrument_key: str,
        expiry_date: str,
    ) -> dict[str, Any]:
        """Fetch full option chain with Greeks for an underlying."""
        path = "/v2/option/chain"
        data = await self._request(
            "GET",
            path,
            authenticated=True,
            params={"instrument_key": instrument_key, "expiry_date": expiry_date},
        )
        return data

    # ─── Option Contracts (Authenticated) ────────────────────────────────────

    async def get_option_contracts(
        self,
        instrument_key: str,
        expiry_date: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Get option contract details for an underlying."""
        path = "/v2/option/contract"
        params = {"instrument_key": instrument_key}
        if expiry_date:
            params["expiry_date"] = expiry_date
        data = await self._request("GET", path, authenticated=True, params=params)
        return data if isinstance(data, list) else data.get("data", [])

    # ─── Market Quote (Public) ───────────────────────────────────────────────

    async def get_ltp_quote(self, instrument_key: str) -> dict[str, Any]:
        """Get last-traded price quote (requires auth)."""
        path = "/v3/market-quote/ltp"
        data = await self._request(
            "GET", path, authenticated=True, params={"instrument_key": instrument_key}
        )
        # Response key uses ":" separator (e.g. "NSE_INDEX:Nifty 50"), not "|"
        return data.get(instrument_key.replace("|", ":"), {})

    async def get_ohlc_quote(self, instrument_key: str) -> dict[str, Any]:
        """Get OHLC quote (public)."""
        path = "/v3/market-quote/ohlc"
        data = await self._request(
            "GET", path, authenticated=False, params={"instrument_key": instrument_key}
        )
        return data.get(instrument_key, {})

    async def get_full_quote(self, instrument_key: str) -> dict[str, Any]:
        """Get full market quote with depth (public)."""
        path = "/v2/market-quote/quotes"
        data = await self._request(
            "GET", path, authenticated=False, params={"instrument_key": instrument_key}
        )
        return data.get(instrument_key, {})

    # ─── Market Status ────────────────────────────────────────────────────────

    async def get_market_status(self, exchange: str = "NSE") -> dict[str, Any]:
        """Get market status for a specific exchange (requires auth)."""
        access_token = await token_manager.get_access_token()
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{self.base_url}/v2/market/status/{exchange}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            return response.json()

    # ─── Market Holidays ────────────────────────────────────────────────────

    async def get_market_holidays(self, date: str | None = None) -> dict[str, Any]:
        """Fetch market holidays. If date is provided, returns holiday info for that date.

        Args:
            date: Date string in 'YYYY-MM-DD' format. If None, returns all holidays for current year.

        Returns:
            Full API response dict with 'status' and 'data' keys.
            data is a list of holiday objects.
        """
        path = "/v2/market/holidays"
        if date:
            path = f"/v2/market/holidays/{date}"
        # Use low-level httpx to get raw JSON (bypassing _request's data-unwrapping)
        access_token = await token_manager.get_access_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}{path}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            return response.json()

    def is_nse_closed_on_date(
        self, holidays_data: dict[str, Any], date: str
    ) -> bool:
        """Check if NSE is closed on a given date based on holidays API response.

        Returns True if NSE (or NFO) is explicitly in closed_exchanges,
        or if the holiday_type is TRADING_HOLIDAY and NSE is not in open_exchanges.
        """
        if holidays_data.get("status") != "success":
            return False

        holidays = holidays_data.get("data") or []
        for holiday in holidays:
            if holiday.get("date") != date:
                continue

            holiday_type = holiday.get("holiday_type", "")
            closed_exchanges: list = holiday.get("closed_exchanges") or []
            open_exchanges: list = holiday.get("open_exchanges") or []

            # TRADING_HOLIDAY means no equity/derivative trading
            if holiday_type == "TRADING_HOLIDAY":
                nse_closed = "NSE" in closed_exchanges
                nfo_closed = "NFO" in closed_exchanges
                # Also check if NSE is not in open_exchanges (explicitly closed)
                nse_open = any(
                    e.get("exchange") == "NSE" for e in open_exchanges
                )
                if nse_closed or nfo_closed or not nse_open:
                    return True
        return False

    # ─── WebSocket Authorization ──────────────────────────────────────────────

    async def get_websocket_url(self) -> str:
        """Get authorized WebSocket URL for market data feed."""
        data = await self._request("GET", "/v3/feed/market-data-feed/authorize", authenticated=True)
        return data.get("authorized_redirect_uri", "") or data.get("authorizedRedirectUri", "")


# Global client instance
upstox_client = UpstoxClient()
