import asyncio
import json
import websockets
from typing import Callable, Optional
from loguru import logger


class UpstoxWebSocketClient:
    """Manages Upstox V3 WebSocket connection for live market data."""

    def __init__(self):
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._subscribers: dict[str, list[Callable]] = {}
        self._reconnect_delay = 5

    async def connect(self, ws_url: str):
        """Connect to the Upstox WebSocket."""
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
                await asyncio.sleep(self._reconnect_delay)

    async def _listen(self):
        """Listen for messages from Upstox WebSocket."""
        if not self._ws:
            return

        async for message in self._ws:
            if not self._running:
                break
            try:
                data = json.loads(message)
                await self._dispatch(data)
            except Exception as e:
                logger.error(f"Error processing WebSocket message: {e}")

    async def _dispatch(self, data: dict):
        """Dispatch message to registered subscribers."""
        msg_type = data.get("type", "")
        instrument_key = ""

        if msg_type == "live_feed":
            instrument_key = data.get("instrument_key", "")
        elif msg_type == "subscription":
            instrument_key = data.get("instrument_key", "")

        if instrument_key in self._subscribers:
            for callback in self._subscribers[instrument_key]:
                try:
                    await callback(data)
                except Exception as e:
                    logger.error(f"Subscriber error: {e}")

    async def subscribe(self, instrument_keys: list[str], mode: str = "ltpc"):
        """Subscribe to instrument(s) on the active WebSocket."""
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
        await self._ws.send(json.dumps(msg))
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
        await self._ws.send(json.dumps(msg))

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
