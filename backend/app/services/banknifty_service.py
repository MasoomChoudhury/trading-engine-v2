"""
BankNifty analytics — GEX, PCR, key levels, regime.
Reuses the same GEX calculator with BankNifty instrument key and lot size.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from loguru import logger
from app.services.upstox_client import upstox_client
from app.services.gex_calculator import calculate_gex

BANKNIFTY_KEY = "NSE_INDEX|Nifty Bank"
BANKNIFTY_LOT_SIZE = 15  # current lot size (revised Nov 2024)
IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST)


async def get_banknifty_expiry() -> str | None:
    """Get nearest upcoming BankNifty expiry (weekly options)."""
    try:
        contracts = await upstox_client.get_option_contracts(BANKNIFTY_KEY)
        if not contracts:
            return None
        today_str = ist_now().strftime("%Y-%m-%d")
        valid = sorted(
            [c.get("expiry", "") for c in contracts
             if c.get("expiry", "") and c.get("expiry", "") >= today_str]
        )
        return valid[0] if valid else None
    except Exception as e:
        logger.warning(f"BankNifty expiry fetch failed: {e}")
        return None


async def build_banknifty_analytics() -> dict:
    """Fetch BankNifty GEX, PCR, key levels and return analytics dict."""
    expiry = await get_banknifty_expiry()
    if not expiry:
        raise ValueError("No active BankNifty expiry found")

    gex = await calculate_gex(expiry, lot_size=BANKNIFTY_LOT_SIZE, instrument_key=BANKNIFTY_KEY)

    spot = gex.spot_price
    call_wall = gex.call_wall or 0.0
    put_wall = gex.put_wall or 0.0
    zero_gamma = gex.zero_gamma_level or 0.0

    # BankNifty-specific commentary (use net_gex — total_gex is always positive)
    if gex.net_gex > 0:
        commentary = (
            "BankNifty in positive GEX — dealers dampen moves. "
            "Financials likely rangebound; avoid buying vol."
        )
    else:
        commentary = (
            "BankNifty in negative GEX — dealers amplify moves. "
            "Financials prone to trending; breakouts more likely."
        )

    # Distance metrics
    call_wall_pct = round((call_wall - spot) / spot * 100, 2) if call_wall and spot else 0.0
    put_wall_pct = round((put_wall - spot) / spot * 100, 2) if put_wall and spot else 0.0
    zero_gamma_pct = round((zero_gamma - spot) / spot * 100, 2) if zero_gamma and spot else 0.0

    # Top 10 strikes by absolute net GEX for the bar chart
    strikes_sorted = sorted(
        gex.strike_gex,
        key=lambda s: abs(s.get("net_gex", 0) if isinstance(s, dict) else s.net_gex),
        reverse=True,
    )[:20]

    strike_chart = []
    for s in sorted(strikes_sorted, key=lambda x: x.get("strike", 0) if isinstance(x, dict) else x.strike):
        if isinstance(s, dict):
            strike_chart.append({
                "strike": s["strike"],
                "call_gex": round(s.get("call_gex", 0) / 1e6, 2),
                "put_gex": round(-s.get("put_gex", 0) / 1e6, 2),
                "net_gex": round(s.get("net_gex", 0) / 1e6, 2),
            })

    return {
        "timestamp": gex.timestamp,
        "expiry_date": expiry,
        "spot_price": round(spot, 2),
        "lot_size": BANKNIFTY_LOT_SIZE,
        "total_gex": round(gex.total_gex, 2),
        "net_gex": round(gex.net_gex, 2),
        "regime": gex.regime,
        "regime_description": gex.regime_description,
        "commentary": commentary,
        "zero_gamma_level": round(zero_gamma, 2),
        "zero_gamma_pct": zero_gamma_pct,
        "call_wall": round(call_wall, 2),
        "call_wall_pct": call_wall_pct,
        "put_wall": round(put_wall, 2),
        "put_wall_pct": put_wall_pct,
        "pcr_oi": round(gex.pcr_oi, 4),
        "pcr_volume": round(gex.pcr_volume, 4),
        "above_zero_gamma": spot >= zero_gamma,
        "strike_chart": strike_chart,
    }
