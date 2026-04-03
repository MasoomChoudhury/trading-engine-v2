"""
Nifty50 Analytics Platform — FastAPI Backend
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import sys

# Configure Loguru
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> — <level>{message}</level>",
    level="INFO",
)

# Import routes after logger is configured
from app.api.middleware import log_api_call
from app.services.upstox_client import upstox_client
from app.api.routes import nifty50, logs, admin, websocket, auth, webhook, futures, options, breadth, macro, banknifty


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Nifty50 Analytics Platform...")

    # Wire up API logger to Upstox client
    upstox_client.set_api_logger(log_api_call)

    # Ensure macro_events table exists and seed it
    try:
        from app.services.macro_service import ensure_macro_table, seed_macro_events
        await ensure_macro_table()
        await seed_macro_events()
    except Exception as e:
        logger.warning(f"Macro calendar setup failed (non-critical): {e}")

    # Ensure FII data table exists
    try:
        from app.services.fii_service import ensure_fii_table
        await ensure_fii_table()
    except Exception as e:
        logger.warning(f"FII table setup failed (non-critical): {e}")

    # Ensure FII derivatives table exists
    try:
        from app.services.fii_deriv_service import ensure_fii_deriv_table
        await ensure_fii_deriv_table()
    except Exception as e:
        logger.warning(f"FII deriv table setup failed (non-critical): {e}")

    # Ensure straddle snapshots table exists
    try:
        from app.services.intraday_momentum_service import ensure_straddle_table
        await ensure_straddle_table()
    except Exception as e:
        logger.warning(f"Straddle table setup failed (non-critical): {e}")

    # Start background scheduler
    try:
        from app.services.scheduler import start_scheduler
        start_scheduler()
    except Exception as e:
        logger.warning(f"Scheduler start failed (non-critical): {e}")

    logger.info("Nifty50 Analytics Platform started successfully")
    yield

    # Shutdown
    logger.info("Shutting down...")
    try:
        from app.services.scheduler import stop_scheduler
        from app.services.websocket_client import ws_client
        stop_scheduler()
        await ws_client.disconnect()
    except Exception as e:
        logger.warning(f"Shutdown error: {e}")


app = FastAPI(
    title="Nifty50 Analytics API",
    description="Technical indicators, GEX, and derived metrics for Nifty 50",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow React dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(nifty50.router)
app.include_router(logs.router)
app.include_router(admin.router)
app.include_router(websocket.router)
app.include_router(auth.router)
app.include_router(webhook.router)
app.include_router(futures.router)
app.include_router(options.router)
app.include_router(breadth.router)
app.include_router(macro.router)
app.include_router(banknifty.router)


@app.get("/")
async def root():
    return {
        "name": "Nifty50 Analytics Platform",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/api/v1/admin/health",
    }


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}
