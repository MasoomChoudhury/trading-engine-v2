"""
Dealer Net Delta Exposure Service.

Market makers (dealers) take the opposite side of customer aggregate delta.
This service derives dealer directional exposure from the options chain:

  Customer Call Delta = CE_OI × Call_Delta (positive — customers are long)
  Customer Put Delta  = PE_OI × Put_Delta  (negative — customers are long puts)
  Customer Net Delta  = Σ(CE_OI × call_delta + PE_OI × put_delta) per strike
  Dealer Net Delta    = −1 × Customer Net Delta

Interpretation:
  Dealer net short (< 0): As spot rises, dealers must BUY underlying to hedge → rally self-reinforces
  Dealer net long  (> 0): As spot rises, dealers must SELL underlying to hedge → rally fades/caps

Delta units: notional lots (OI in contracts × delta × lot_size).
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
LOT_SIZE = 50


def _ist_now() -> datetime:
    return datetime.now(IST)


def _days_to_expiry(expiry_str: str) -> int:
    expiry = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    return (expiry - _ist_now().date()).days


def _atm_strike(spot: float, step: int = 50) -> float:
    return round(spot / step) * step


async def build_dealer_delta_exposure(target_expiry: Optional[str] = None) -> dict:
    """
    Compute dealer net delta exposure for the given (or nearest) expiry.
    """
    from app.services.options_service import get_active_expiries, fetch_chain

    expiries = await get_active_expiries()
    if not expiries:
        return {"error": "No active expiries"}

    near = expiries[0]
    next_e = expiries[1] if len(expiries) > 1 else None
    dte_near = _days_to_expiry(near)
    use_next = dte_near <= 3 and next_e is not None
    expiry = target_expiry or (next_e if use_next else near)

    raw_chain = await fetch_chain(expiry)

    spot = 0.0
    total_customer_delta = 0.0
    total_call_delta = 0.0
    total_put_delta = 0.0
    gamma_by_strike: list[dict] = []
    delta_by_strike: list[dict] = []

    for item in raw_chain:
        s = float(item.get("underlying_spot_price") or 0)
        if s and not spot:
            spot = s

        strike = float(item.get("strike_price") or 0)
        if not strike:
            continue

        ce_md = (item.get("call_options") or {}).get("market_data") or {}
        pe_md = (item.get("put_options") or {}).get("market_data") or {}
        ce_g = (item.get("call_options") or {}).get("option_greeks") or {}
        pe_g = (item.get("put_options") or {}).get("option_greeks") or {}

        ce_oi = float(ce_md.get("oi") or 0)
        pe_oi = float(pe_md.get("oi") or 0)
        ce_delta = float(ce_g.get("delta") or 0)
        pe_delta = float(pe_g.get("delta") or 0)
        ce_gamma = float(ce_g.get("gamma") or 0)
        pe_gamma = float(pe_g.get("gamma") or 0)
        ce_iv = float(ce_g.get("iv") or 0)
        pe_iv = float(pe_g.get("iv") or 0)

        # Customer aggregate delta at this strike (in lot units)
        # Call buyers: long delta; Put buyers: long (negative) delta
        strike_call_delta = ce_oi * ce_delta
        strike_put_delta = pe_oi * pe_delta  # put delta is negative from Upstox

        strike_net_delta = strike_call_delta + strike_put_delta
        total_customer_delta += strike_net_delta
        total_call_delta += strike_call_delta
        total_put_delta += strike_put_delta

        # Gamma concentration (weighted by OI)
        gamma_oi_weighted = (ce_oi * ce_gamma + pe_oi * abs(pe_gamma)) * LOT_SIZE

        delta_by_strike.append({
            "strike": strike,
            "ce_oi": int(ce_oi),
            "pe_oi": int(pe_oi),
            "ce_delta": round(ce_delta, 4),
            "pe_delta": round(pe_delta, 4),
            "ce_iv": round(ce_iv, 2) if ce_iv else None,
            "pe_iv": round(pe_iv, 2) if pe_iv else None,
            "strike_customer_delta": round(strike_net_delta, 2),
            "gamma_oi_weighted": round(gamma_oi_weighted, 2),
        })

        if gamma_oi_weighted > 0:
            gamma_by_strike.append({
                "strike": strike,
                "gamma_oi_weighted": round(gamma_oi_weighted, 2),
            })

    # Dealer net delta is the mirror of customer net delta
    dealer_net_delta = -total_customer_delta
    # Normalise to lot-level (divide by lot_size to get readable units)
    dealer_net_delta_lots = round(dealer_net_delta, 1)

    # Determine dealer position
    if dealer_net_delta_lots < -50:
        dealer_position = "net_short"
    elif dealer_net_delta_lots > 50:
        dealer_position = "net_long"
    else:
        dealer_position = "neutral"

    # ── Hedging pressure interpretation ───────────────────────────────────────
    if dealer_position == "net_short":
        hedging_note = (
            "Dealers are net SHORT delta. As spot rises, they must BUY the underlying to delta-hedge → "
            "rally becomes self-reinforcing. Dips likely to be supported."
        )
    elif dealer_position == "net_long":
        hedging_note = (
            "Dealers are net LONG delta. As spot rises, they must SELL the underlying to hedge → "
            "strength gets sold into. Caps on rallies expected."
        )
    else:
        hedging_note = "Dealer delta is near-neutral. No strong directional hedging pressure."

    # Top gamma strikes (highest OI-weighted gamma = pinning zones)
    gamma_by_strike.sort(key=lambda x: x["gamma_oi_weighted"], reverse=True)
    top_gamma_strikes = gamma_by_strike[:5]

    # Filter delta chart to ATM ± 1000
    atm = _atm_strike(spot)
    delta_chart = sorted(
        [d for d in delta_by_strike if abs(d["strike"] - atm) <= 1000],
        key=lambda x: x["strike"],
    )

    dte = _days_to_expiry(expiry)

    return {
        "timestamp": _ist_now().isoformat(),
        "expiry": expiry,
        "dte": dte,
        "spot_price": round(spot, 2),
        "atm_strike": atm,
        "customer_net_delta": round(total_customer_delta, 1),
        "customer_call_delta": round(total_call_delta, 1),
        "customer_put_delta": round(total_put_delta, 1),
        "dealer_net_delta": dealer_net_delta_lots,
        "dealer_position": dealer_position,
        "hedging_note": hedging_note,
        "top_gamma_strikes": top_gamma_strikes,
        "delta_chart": delta_chart,
    }
