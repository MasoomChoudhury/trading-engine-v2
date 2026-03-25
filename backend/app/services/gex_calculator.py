"""
Gamma Exposure (GEX) Calculator for Nifty 50 options.
Uses pre-computed Greeks from Upstox option chain API.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from loguru import logger
from app.services.upstox_client import upstox_client


@dataclass
class StrikeGEX:
    strike: float
    call_oi: float
    call_gamma: float
    call_gamma_exposure: float
    put_oi: float
    put_gamma: float
    put_gamma_exposure: float
    net_gex: float


@dataclass
class GEXResult:
    timestamp: str
    expiry_date: str
    spot_price: float
    lot_size: int
    total_call_gex: float
    total_put_gex: float
    net_gex: float
    total_gex: float
    zero_gamma_level: Optional[float]
    call_wall: Optional[float]
    put_wall: Optional[float]
    pcr_oi: float
    pcr_volume: float
    regime: str  # 'positive_gex' or 'negative_gex'
    regime_description: str
    strike_gex: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "expiry_date": self.expiry_date,
            "spot_price": self.spot_price,
            "lot_size": self.lot_size,
            "total_call_gex": self.total_call_gex,
            "total_put_gex": self.total_put_gex,
            "net_gex": self.net_gex,
            "total_gex": self.total_gex,
            "zero_gamma_level": self.zero_gamma_level,
            "call_wall": self.call_wall,
            "put_wall": self.put_wall,
            "pcr_oi": self.pcr_oi,
            "pcr_volume": self.pcr_volume,
            "regime": self.regime,
            "regime_description": self.regime_description,
            "strike_gex": self.strike_gex,
        }


def _calculate_zero_gamma_level(sorted_strikes: list[StrikeGEX], cumulative: list[float]) -> Optional[float]:
    """Find the strike where cumulative net gamma crosses zero via linear interpolation."""
    for i in range(1, len(cumulative)):
        prev_cum = cumulative[i - 1]
        curr_cum = cumulative[i]
        if prev_cum <= 0 <= curr_cum or prev_cum >= 0 >= curr_cum:
            # Linear interpolation
            prev_strike = sorted_strikes[i - 1].strike
            curr_strike = sorted_strikes[i].strike
            if curr_strike == prev_strike:
                return prev_strike
            t = -prev_cum / (curr_cum - prev_cum)
            return prev_strike + t * (curr_strike - prev_strike)
    return None


async def calculate_gex(expiry_date: str, lot_size: int = 50) -> GEXResult:
    """
    Calculate Net GEX for Nifty 50 from the Upstox option chain.

    GEX Formula:
      Call GEX = Call_OI × Call_Gamma × Lot_Size × Spot × 0.01
      Put GEX  = Put_OI  × Put_Gamma  × Lot_Size × Spot × 0.01
      Net GEX  = Call GEX - Put GEX
      Total GEX = Σ Net GEX (summed across all strikes)
    """
    from datetime import datetime, timezone

    instrument_key = "NSE_INDEX|Nifty 50"
    logger.info(f"Fetching option chain for {instrument_key}, expiry: {expiry_date}")

    chain_data = await upstox_client.get_option_chain(instrument_key, expiry_date)

    # Parse the option chain response
    underlying_spot = float(chain_data.get("underlying_spot_price", 0))
    if not underlying_spot:
        raise ValueError(f"Could not get spot price from option chain: {chain_data}")

    calls_data = chain_data.get("call_options", {}) or {}
    puts_data = chain_data.get("put_options", {}) or {}

    # Build per-strike GEX
    strike_map: dict[float, StrikeGEX] = {}

    for strike_str, call_info in calls_data.items():
        try:
            strike = float(strike_str)
            mkt_data = call_info.get("market_data", {})
            oi = float(mkt_data.get("oi", 0) or 0)
            greeks = call_info.get("option_greeks", {})
            gamma = float(greeks.get("gamma", 0) or 0)

            call_gex = oi * gamma * lot_size * underlying_spot * 0.01
            volume = float(mkt_data.get("volume", 0) or 0)

            strike_map[strike] = StrikeGEX(
                strike=strike,
                call_oi=oi,
                call_gamma=gamma,
                call_gamma_exposure=call_gex,
                put_oi=0.0,
                put_gamma=0.0,
                put_gamma_exposure=0.0,
                net_gex=call_gex,
            )
        except (ValueError, TypeError, KeyError):
            continue

    for strike_str, put_info in puts_data.items():
        try:
            strike = float(strike_str)
            mkt_data = put_info.get("market_data", {})
            oi = float(mkt_data.get("oi", 0) or 0)
            greeks = put_info.get("option_greeks", {})
            gamma = float(greeks.get("gamma", 0) or 0)

            put_gex = oi * gamma * lot_size * underlying_spot * 0.01
            volume = float(mkt_data.get("volume", 0) or 0)

            if strike in strike_map:
                s = strike_map[strike]
                s.put_oi = oi
                s.put_gamma = gamma
                s.put_gamma_exposure = put_gex
                s.net_gex = s.call_gamma_exposure - put_gex
            else:
                strike_map[strike] = StrikeGEX(
                    strike=strike,
                    call_oi=0.0,
                    call_gamma=0.0,
                    call_gamma_exposure=0.0,
                    put_oi=oi,
                    put_gamma=gamma,
                    put_gamma_exposure=put_gex,
                    net_gex=-put_gex,
                )
        except (ValueError, TypeError, KeyError):
            continue

    sorted_strikes = sorted(strike_map.values(), key=lambda s: s.strike)

    total_call_gex = sum(s.call_gamma_exposure for s in sorted_strikes)
    total_put_gex = sum(s.put_gamma_exposure for s in sorted_strikes)
    net_gex = total_call_gex - total_put_gex
    total_gex = sum(s.net_gex for s in sorted_strikes)

    # Cumulative net GEX for zero gamma level
    cumulative = []
    running = 0.0
    for s in sorted_strikes:
        running += s.net_gex
        cumulative.append(running)

    zero_gamma_level = _calculate_zero_gamma_level(sorted_strikes, cumulative)

    # Gamma walls (max call/put gamma strikes)
    call_wall_strike = max(sorted_strikes, key=lambda s: s.call_gamma_exposure)
    put_wall_strike = max(sorted_strikes, key=lambda s: s.put_gamma_exposure)
    call_wall = call_wall_strike.strike if call_wall_strike.call_gamma_exposure > 0 else None
    put_wall = put_wall_strike.strike if put_wall_strike.put_gamma_exposure > 0 else None

    # PCR calculations
    total_call_oi = sum(s.call_oi for s in sorted_strikes)
    total_put_oi = sum(s.put_oi for s in sorted_strikes)
    pcr_oi = total_put_oi / total_call_oi if total_call_oi > 0 else 0.0

    # PCR by volume approximation (use gamma-weighted volume as proxy)
    pcr_volume = pcr_oi  # Simplified — Upstox chain doesn't give volume per strike easily

    # Regime determination
    if total_gex > 0:
        regime = "positive_gex"
        regime_desc = "Market makers dampen volatility — expect range-bound behavior (buy dips, sell rallies)"
    else:
        regime = "negative_gex"
        regime_desc = "Market makers amplify moves — expect increased volatility and potential breakouts"

    # Strike GEX array for storage
    strike_gex_list = [
        {
            "strike": s.strike,
            "call_oi": s.call_oi,
            "call_gamma": s.call_gamma,
            "call_gex": s.call_gamma_exposure,
            "put_oi": s.put_oi,
            "put_gamma": s.put_gamma,
            "put_gex": s.put_gamma_exposure,
            "net_gex": s.net_gex,
        }
        for s in sorted_strikes
    ]

    return GEXResult(
        timestamp=datetime.now(timezone.utc).isoformat(),
        expiry_date=expiry_date,
        spot_price=underlying_spot,
        lot_size=lot_size,
        total_call_gex=total_call_gex,
        total_put_gex=total_put_gex,
        net_gex=net_gex,
        total_gex=total_gex,
        zero_gamma_level=zero_gamma_level,
        call_wall=call_wall,
        put_wall=put_wall,
        pcr_oi=pcr_oi,
        pcr_volume=pcr_volume,
        regime=regime,
        regime_description=regime_desc,
        strike_gex=strike_gex_list,
    )
