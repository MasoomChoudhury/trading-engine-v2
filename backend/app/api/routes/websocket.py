from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.upstox_client import upstox_client
from app.services.websocket_client import ws_client
from app.db.database import get_ts_session
from app.db.models import PriceTick
import asyncio
from datetime import datetime, timedelta, timezone
from loguru import logger

router = APIRouter()
NIFTY_KEY = "NSE_INDEX|Nifty 50"
SYMBOL = "NIFTY_50"
IST = timezone(timedelta(hours=5, minutes=30))


class DashboardWebSocketManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._lock = asyncio.Lock()
        self._upstox_ws_running = False

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)
        if not self._upstox_ws_running:
            await self._start_upstox_stream()

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        async with self._lock:
            for connection in self.active_connections[:]:
                try:
                    await connection.send_json(message)
                except Exception:
                    try:
                        self.active_connections.remove(connection)
                    except ValueError:
                        pass

    async def _start_upstox_stream(self):
        if self._upstox_ws_running:
            return
        self._upstox_ws_running = True

        async def on_live_feed(data: dict):
            if data.get("type") == "live_feed":
                ltp = float(data.get("ltp", 0))
                cp = float(data.get("cp", 0) or 0)
                ltt_ms = data.get("ltt_ms", 0)
                change = data.get("change", 0.0)
                change_pct = data.get("change_pct", 0.0)

                # Convert ms timestamp to ISO string
                ltt_str = None
                if ltt_ms:
                    ltt_str = datetime.fromtimestamp(ltt_ms / 1000, tz=IST).isoformat()

                msg = {
                    "type": "price_update",
                    "symbol": SYMBOL,
                    "ltp": ltp,
                    "ltt": ltt_str,
                    "volume": 0,
                    "oi": 0,
                    "cp": cp,
                    "change": change,
                    "change_pct": change_pct,
                }

                try:
                    async with get_ts_session() as session:
                        tick = PriceTick(
                            timestamp=datetime.now(IST),
                            symbol=SYMBOL,
                            ltp=float(ltp),
                            ltt=datetime.fromtimestamp(ltt_ms / 1000, tz=IST) if ltt_ms else None,
                            volume=0,
                            oi=0,
                            cp=float(cp) if cp else None,
                        )
                        session.add(tick)
                        await session.commit()
                except Exception as e:
                    logger.warning(f"Failed to store price tick: {e}")

                await self.broadcast(msg)

        ws_client.register_callback(NIFTY_KEY, on_live_feed)

        try:
            ws_url = await upstox_client.get_websocket_url()
            asyncio.create_task(ws_client.connect(ws_url))
            await asyncio.sleep(2)
            await ws_client.subscribe([NIFTY_KEY], "ltpc")
        except Exception as e:
            logger.error(f"Failed to start Upstox WebSocket: {e}")


ws_manager = DashboardWebSocketManager()


@router.websocket("/ws/live")
async def dashboard_websocket(websocket: WebSocket):
    """WebSocket endpoint for the React dashboard to receive live price updates."""
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
