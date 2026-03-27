import asyncio
import json
import websockets
from typing import Callable, Optional
from loguru import logger

try:
    from app.services.MarketDataFeed_pb2 import FeedResponse
    PROTOBUF_AVAILABLE = True
except ImportError:
    PROTOBUF_AVAILABLE = False
    logger.warning("Protobuf classes not found — WebSocket feed will not decode data")


class UpstoxWebSocketClient:
    """Manages Upstox V3 WebSocket connection for live market data."""

    def __init__(self):
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._subscribers: dict[str, list[Callable]] = {}
        self._reconnect_delay = 5

    async def connect(self, ws_url: str):
        """Connect to the Upstox WebSocket with auto-reconnect."""
        if self._running:
            return

        self._running = True
        logger.info(f"Connecting to Upstox WebSocket: {ws_url[:80]}...")

        while self._running:
            try:
                async with websockets.connect(ws_url, ping_interval=None) as ws:
                    self._ws = ws
                    logger.info("Upstox WebSocket connected")
                    await self._listen()
            except Exception as e:
                logger.error(f"WebSocket error: {e}. Reconnecting in {self._reconnect_delay}s...")
                self._ws = None
                await asyncio.sleep(self._reconnect_delay)

    async def _listen(self):
        """Listen for messages — V3 sends binary protobuf frames."""
        if not self._ws:
            return

        async for message in self._ws:
            if not self._running:
                break
            try:
                if isinstance(message, bytes):
                    await self._handle_protobuf(message)
                # Text frames (e.g. heartbeat pong) are ignored
            except Exception as e:
                logger.error(f"Error processing WebSocket message: {e}")

    async def _handle_protobuf(self, data: bytes):
        """Decode a binary protobuf FeedResponse and dispatch to subscribers."""
        if not PROTOBUF_AVAILABLE:
            return

        feed_response = FeedResponse()
        feed_response.ParseFromString(data)

        # type enum: initial_feed=0, live_feed=1, market_info=2
        if feed_response.type != 1:
            return

        for instrument_key, feed in feed_response.feeds.items():
            if instrument_key not in self._subscribers:
                continue

            parsed = self._extract_ltpc(instrument_key, feed)
            if parsed is None:
                continue

            for callback in self._subscribers[instrument_key]:
                try:
                    await callback(parsed)
                except Exception as e:
                    logger.error(f"Subscriber callback error: {e}")

    def _extract_ltpc(self, instrument_key: str, feed) -> dict | None:
        """Pull LTPC data out of whichever oneof branch is populated."""
        ltpc = None

        if feed.HasField("ltpc"):
            ltpc = feed.ltpc
        elif feed.HasField("fullFeed"):
            ff = feed.fullFeed
            if ff.HasField("indexFF"):
                ltpc = ff.indexFF.ltpc
            elif ff.HasField("marketFF"):
                ltpc = ff.marketFF.ltpc
        elif feed.HasField("firstLevelWithGreeks"):
            ltpc = feed.firstLevelWithGreeks.ltpc

        if ltpc is None or ltpc.ltp == 0:
            return None

        ltp = ltpc.ltp
        cp = ltpc.cp
        ltt_ms = ltpc.ltt  # Unix timestamp in milliseconds
        change = round(ltp - cp, 2) if cp else 0.0
        change_pct = round(change / cp * 100, 2) if cp else 0.0

        return {
            "type": "live_feed",
            "instrument_key": instrument_key,
            "ltp": ltp,
            "cp": cp,
            "ltt_ms": ltt_ms,
            "change": change,
            "change_pct": change_pct,
        }

    async def subscribe(self, instrument_keys: list[str], mode: str = "ltpc"):
        """Subscribe to instrument(s). Per V3 docs, message must be binary."""
        if not self._ws:
            logger.warning("WebSocket not connected, cannot subscribe")
            return

        msg = {
            "guid": f"sub-{id(instrument_keys)}",
            "method": "sub",
            "data": {
                "mode": mode,
                "instrumentKeys": instrument_keys,
            },
        }
        # V3 requires binary frame, not text
        await self._ws.send(json.dumps(msg).encode())
        logger.info(f"Subscribed to {instrument_keys} in {mode} mode")

    async def unsubscribe(self, instrument_keys: list[str]):
        """Unsubscribe from instrument(s)."""
        if not self._ws:
            return
        msg = {
            "guid": f"unsub-{id(instrument_keys)}",
            "method": "unsub",
            "data": {"instrumentKeys": instrument_keys},
        }
        await self._ws.send(json.dumps(msg).encode())

    def register_callback(self, instrument_key: str, callback: Callable):
        """Register a callback for an instrument key."""
        if instrument_key not in self._subscribers:
            self._subscribers[instrument_key] = []
        self._subscribers[instrument_key].append(callback)

    async def disconnect(self):
        """Disconnect from the WebSocket."""
        self._running = False
        if self._ws:
            await self._ws.close()
            self._ws = None
        logger.info("Upstox WebSocket disconnected")


# Global instance
ws_client = UpstoxWebSocketClient()
