from fastapi import APIRouter, Query, HTTPException
from loguru import logger
from app.services.options_service import build_options_analytics, save_options_eod, fetch_chain, parse_chain, build_iv_skew, load_oi_trend
from app.services.option_greeks_service import get_buyers_edge, get_chain_greeks
from app.services.intraday_momentum_service import (
    get_vol_weighted_indicators,
    get_straddle_intraday,
    get_pcr_divergence,
)
from app.services.iv_term_structure_service import build_iv_term_structure
from app.services.dealer_delta_service import build_dealer_delta_exposure
from app.services.pnl_simulator_service import compute_pnl_scenarios
from app.services.ivr_ivp_service import get_ivr_ivp
from app.services.sweep_detection_service import get_sweeps
from app.services.bid_ask_tracker_service import get_bid_ask_spread
from app.services.position_sizing_service import calculate_position_size

router = APIRouter(prefix="/api/v1/options", tags=["Options"])


@router.get("/analytics")
async def get_options_analytics(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    Full options OI & sentiment analytics:
    - Current PCR (OI & volume), straddle premium, OI wall, max pain
    - PCR history with 10-day EMA
    - ATM straddle volume history with 20-day MA
    - OI wall chart data
    - OI change today (from prev_oi)
    - OI change heatmap (last 10 days from DB)
    """
    try:
        return await build_options_analytics(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Options analytics failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/iv-skew")
async def get_iv_skew(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    IV Skew analytics: volatility smile, 25-delta risk reversal, butterfly spread.
    25d RR > 0 = put vol premium = downside fear.
    """
    try:
        return await build_iv_skew(target_expiry=expiry)
    except Exception as e:
        logger.error(f"IV skew failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/oi-trend")
async def get_oi_trend(
    expiry: str | None = Query(default=None),
    days: int = Query(default=10, ge=3, le=30),
):
    """
    10-day per-strike OI trend (build vs unwind) for ATM ± 250 strikes.
    """
    try:
        return await load_oi_trend(expiry=expiry, days=days)
    except Exception as e:
        logger.error(f"OI trend failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/chain-greeks")
async def get_chain_greeks_route(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    Full option chain snapshot with per-strike Greeks (ATM ± 500 pts):
    LTP, Volume, OI, IV, Delta, Theta, Vega, Gamma — CE and PE side.
    """
    try:
        return await get_chain_greeks(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Chain greeks failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/buyers-edge")
async def get_buyers_edge_route(
    expiry: str | None = Query(default=None, description="Override expiry date YYYY-MM-DD"),
):
    """
    Buyer's Toolkit: full chain + Buyer's Edge ratio (ATR×|Delta|/|Theta|) per strike
    + DTE decay curve showing theta acceleration.
    """
    try:
        return await get_buyers_edge(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Buyers edge failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/vol-indicators")
async def get_vol_indicators(
    interval: str = Query(default="5min", description="Candle interval: 1min or 5min"),
    limit: int = Query(default=100, ge=20, le=300),
):
    """
    Volume-Weighted RSI + MACD series.
    VW-RSI mutes low-volume noise; VW-MACD uses rolling VWAP instead of close.
    Unconfirmed breakout = price moved but volume didn't follow = potential trap.
    """
    try:
        return await get_vol_weighted_indicators(interval=interval, limit=limit)
    except Exception as e:
        logger.error(f"Vol indicators failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/straddle-intraday")
async def get_straddle_intraday_route():
    """
    Today's intraday ATM straddle price snapshots (saved every 5 minutes).
    If spot trends up but straddle falls → IV crush is eating your calls.
    """
    try:
        return await get_straddle_intraday()
    except Exception as e:
        logger.error(f"Straddle intraday failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/pcr-divergence")
async def get_pcr_divergence_route():
    """
    Monthly vs weekly PCR comparison.
    Divergence = short-term counter-trend move inside opposite longer-term structure.
    """
    try:
        return await get_pcr_divergence()
    except Exception as e:
        logger.error(f"PCR divergence failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/save-eod")
async def save_eod_snapshot(
    expiry: str = Query(..., description="Expiry date YYYY-MM-DD"),
):
    """Manually trigger EOD snapshot save for a given expiry."""
    try:
        chain = await fetch_chain(expiry)
        records = parse_chain(chain)
        await save_options_eod(expiry, records)
        return {"saved": len(records), "expiry": expiry}
    except Exception as e:
        logger.error(f"EOD snapshot save failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/iv-term-structure")
async def get_iv_term_structure():
    """
    IV term structure across all active Nifty expiries.
    Returns ATM IV per expiry plotted as a curve.
    - Contango (normal): far IV > near IV
    - Backwardation (fear spike): near IV > far IV — likely to mean-revert
    - near_far_ratio > 1.4 → weekly options 40%+ expensive vs monthly
    """
    try:
        return await build_iv_term_structure()
    except Exception as e:
        logger.error(f"IV term structure failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/dealer-delta-exposure")
async def get_dealer_delta_exposure(
    expiry: str | None = Query(default=None, description="Override expiry YYYY-MM-DD"),
):
    """
    Dealer (market maker) net delta exposure derived from options chain.
    Dealers take the opposite side of customer aggregate delta.
    - Dealers net short delta → buy into rallies (self-reinforcing)
    - Dealers net long delta → sell into rallies (capping effect)
    """
    try:
        return await build_dealer_delta_exposure(expiry)
    except Exception as e:
        logger.error(f"Dealer delta exposure failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/pnl-simulator")
async def get_pnl_simulator(
    strike: float = Query(..., description="Long-leg strike price"),
    option_type: str = Query(..., description="'call' or 'put'"),
    expiry: str | None = Query(default=None, description="Expiry YYYY-MM-DD"),
    entry_price: float | None = Query(default=None, description="Entry price (default: current LTP)"),
    quantity: int = Query(default=1, description="Number of lots"),
    spread_strike: float | None = Query(default=None, description="Short-leg strike for debit spread"),
    spread_option_type: str | None = Query(default=None, description="Short-leg type (defaults to same as long)"),
):
    """
    Greeks-based P&L scenario simulator.
    Returns a grid of P&L values across:
    - Spot moves (−600 to +600 in 100-pt increments)
    - IV changes (−5 to +5 in 1-point steps)
    For today / +1d / +2d / +3d / at-expiry (intrinsic value).
    Supports single-leg and debit-spread mode.
    """
    try:
        return await compute_pnl_scenarios(
            strike=strike,
            option_type=option_type.lower(),
            expiry=expiry,
            entry_price=entry_price,
            quantity=quantity,
            spread_strike=spread_strike,
            spread_option_type=spread_option_type.lower() if spread_option_type else None,
        )
    except Exception as e:
        logger.error(f"P&L simulator failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/ivr-ivp")
async def get_ivr_ivp_route(
    expiry: str | None = Query(default=None, description="Target expiry YYYY-MM-DD"),
):
    """
    IV Rank (IVR) and IV Percentile (IVP) for Nifty ATM and surrounding strikes.
    IVR > 50 → premiums bloated → restrict naked buying, use debit spreads.
    IVR < 30 → premiums cheap   → naked ATM buying has Vega tailwind.
    """
    try:
        return await get_ivr_ivp(target_expiry=expiry)
    except Exception as e:
        logger.error(f"IVR/IVP failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/sweeps")
async def get_sweeps_route(
    expiry: str | None = Query(default=None, description="Target expiry YYYY-MM-DD"),
):
    """
    Options sweep and block trade detection (volume-spike approximation).
    Scans option chain for unusually high Volume/OI ratios and one-sided directional
    volume that indicates institutional sweep activity.
    NOTE: Approximation — tick-level data unavailable via Upstox V2.
    """
    try:
        return await get_sweeps(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Sweep detection failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/bid-ask-spread")
async def get_bid_ask_spread_route(
    expiry: str | None = Query(default=None, description="Target expiry YYYY-MM-DD"),
):
    """
    Live bid-ask spread tracking for ATM ± 5 strikes.
    Flags strikes as liquid / acceptable / wide / un-executable based on spread %.
    Wide spreads (> 3%) mean every market order puts the position in immediate deficit.
    """
    try:
        return await get_bid_ask_spread(target_expiry=expiry)
    except Exception as e:
        logger.error(f"Bid-ask spread tracker failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/position-sizing")
async def get_position_sizing_route(
    capital: float = Query(..., description="Account capital in ₹"),
    risk_pct: float = Query(2.0, description="Max risk per trade as % of capital (1–5)"),
    mode: str = Query("naked", description="'naked' (full premium at risk) or 'spread' (net debit at risk)"),
    entry_premium: float = Query(0.0, description="Entry premium per unit (naked or long leg)"),
    net_debit: float | None = Query(default=None, description="Net debit per unit (spread mode only)"),
    max_gain: float | None = Query(default=None, description="Max gain per unit (spread mode, for Kelly)"),
):
    """
    Position Sizing Engine.

    Returns raw_lots (pre-VIX), adjusted_lots (post-VIX haircut), capital at risk,
    and a greyed Kelly fraction.  VIX adjustment: 20–25 → 75%, 25+ → 50%.
    """
    try:
        risk_pct = max(0.1, min(risk_pct, 10.0))
        return await calculate_position_size(
            capital=capital,
            risk_pct=risk_pct,
            mode=mode,
            entry_premium=entry_premium,
            net_debit=net_debit,
            max_gain=max_gain,
        )
    except Exception as e:
        logger.error(f"Position sizing failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/rr-history")
async def get_rr_history_route(
    days: int = Query(default=60, description="Chart window in days (rank always uses 252d)"),
):
    """
    25-delta risk reversal history with skew rank and percentile.
    RR rank mirrors IVR — shows whether current put skew is high/low vs 252-day range.
    Rising RR during a price bounce = smart money still hedging = bearish signal.
    """
    from app.services.rr_history_service import get_rr_history
    try:
        return await get_rr_history(days=days)
    except Exception as e:
        logger.error(f"RR history failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/straddle-iv-context")
async def get_straddle_iv_context_route(
    dte: int = Query(..., description="Current days to expiry"),
    vix: float = Query(..., description="Current India VIX"),
    atm_iv: float | None = Query(default=None, description="Current ATM IV (optional for percentile)"),
):
    """
    Historical ATM IV context for current DTE + VIX conditions.
    Answers: is today's IV cheap/fair/expensive given similar past conditions?
    Returns a progress note when fewer than 30 matching sessions exist.
    """
    from app.services.straddle_iv_context_service import get_straddle_iv_context
    try:
        return await get_straddle_iv_context(
            current_dte=dte,
            current_vix=vix,
            current_atm_iv=atm_iv,
        )
    except Exception as e:
        logger.error(f"Straddle IV context failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/max-pain-history")
async def get_max_pain_history_route(
    days: int = Query(default=30, description="Number of EOD sessions to return"),
):
    """
    Historical max pain migration — one data point per EOD session.
    Shows whether option writers are steering price up, down, or keeping it pinned.
    """
    from app.db.database import get_ts_session
    from sqlalchemy import text
    from datetime import datetime, timedelta, timezone
    IST = timezone(timedelta(hours=5, minutes=30))
    try:
        cutoff = datetime.now(IST) - timedelta(days=days * 2)  # buffer for weekends
        async with get_ts_session() as session:
            rows = (await session.execute(text("""
                SELECT timestamp, value
                FROM derived_metric_snapshots
                WHERE symbol = 'NIFTY50' AND metric_name = 'max_pain'
                  AND timestamp >= :cutoff
                  AND value IS NOT NULL
                ORDER BY timestamp ASC
                LIMIT :lim
            """), {"cutoff": cutoff, "lim": days})).fetchall()
        history = [
            {"date": row[0].date().isoformat(), "max_pain": float(row[1])}
            for row in rows
        ]
        return {"history": history, "count": len(history)}
    except Exception as e:
        logger.error(f"Max pain history failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))
