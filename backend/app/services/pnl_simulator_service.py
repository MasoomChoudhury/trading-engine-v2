"""
Options P&L Scenario Simulator.

Computes a 2D grid of P&L across:
  - Spot price moves: −600 to +600 in 100-pt steps (13 columns)
  - IV changes:       −5 to +5 in 1-pt steps (11 rows)

For five time slices:
  - Today (0d theta), +1d, +2d, +3d, and At Expiry (intrinsic value)

Supports two modes:
  - Single Leg: long call or long put
  - Debit Spread: long lower + short higher (call spread) or vice versa (put spread)
    Net P&L = long_leg_P&L − short_leg_P&L per cell

Formula (Greek approximation):
  ΔP ≈ Delta × ΔS + 0.5 × Gamma × ΔS² + Vega × ΔIV + Theta × Δt
At Expiry:
  Call P&L = max(spot + ΔS − strike, 0) − entry
  Put  P&L = max(strike − spot − ΔS, 0) − entry
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
LOT_SIZE = 50

SPOT_STEPS = list(range(-600, 700, 100))   # 13 columns: −600 … +600
IV_STEPS   = list(range(-5, 6, 1))         # 11 rows:    −5 … +5
TIME_SLICES = [0, 1, 2, 3]                 # days of theta; "expiry" added separately


def _ist_now() -> datetime:
    return datetime.now(IST)


def _days_to_expiry(expiry_str: str) -> int:
    expiry = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    return (expiry - _ist_now().date()).days


def _atm_strike(spot: float, step: int = 50) -> float:
    return round(spot / step) * step


def _pnl(
    delta: float,
    gamma: float,
    theta: float,
    vega: float,
    entry_price: float,
    ds: float,
    div: float,
    days: int,
    qty: int,
) -> float:
    """Greek-approximation P&L for a single leg (buyer perspective)."""
    price_change = (
        delta * ds
        + 0.5 * gamma * ds * ds
        + vega * div
        + theta * days
    )
    new_price = max(entry_price + price_change, 0.0)
    return round((new_price - entry_price) * qty * LOT_SIZE, 2)


def _pnl_at_expiry(
    spot: float,
    strike: float,
    option_type: str,
    entry_price: float,
    ds: float,
    qty: int,
) -> float:
    """Exact intrinsic-value P&L at expiry — no Greek extrapolation."""
    new_spot = spot + ds
    if option_type == "call":
        intrinsic = max(new_spot - strike, 0.0)
    else:
        intrinsic = max(strike - new_spot, 0.0)
    return round((intrinsic - entry_price) * qty * LOT_SIZE, 2)


async def compute_pnl_scenarios(
    strike: float,
    option_type: str,           # 'call' or 'put'
    expiry: Optional[str],
    entry_price: Optional[float],
    quantity: int = 1,
    spread_strike: Optional[float] = None,
    spread_option_type: Optional[str] = None,
) -> dict:
    """
    Build the P&L scenario grid for a single leg or debit spread.

    spread_strike / spread_option_type — if provided, models a debit spread:
      net P&L = long-leg P&L − short-leg P&L at every cell.
    """
    from app.services.options_service import get_active_expiries, fetch_chain

    expiries = await get_active_expiries()
    if not expiries:
        return {"error": "No active expiries"}

    near = expiries[0]
    next_e = expiries[1] if len(expiries) > 1 else None
    dte_near = _days_to_expiry(near)
    use_next = dte_near <= 3 and next_e is not None
    target_expiry = expiry or (next_e if use_next else near)

    raw_chain = await fetch_chain(target_expiry)

    spot = 0.0
    long_greeks: Optional[dict] = None
    long_ltp: Optional[float] = None
    short_greeks: Optional[dict] = None
    short_ltp: Optional[float] = None

    short_otype = spread_option_type or option_type  # default same side as long

    for item in raw_chain:
        s = float(item.get("underlying_spot_price") or 0)
        if s and not spot:
            spot = s

        item_strike = float(item.get("strike_price") or 0)

        # Long leg
        if item_strike == strike and long_greeks is None:
            side = item.get("call_options" if option_type == "call" else "put_options") or {}
            md = side.get("market_data") or {}
            og = side.get("option_greeks") or {}
            long_ltp = float(md.get("ltp") or 0) or None
            long_greeks = {
                "delta": float(og.get("delta") or 0),
                "gamma": float(og.get("gamma") or 0),
                "theta": float(og.get("theta") or 0),
                "vega":  float(og.get("vega")  or 0),
                "iv":    float(og.get("iv")    or 0),
            }

        # Short leg (spread mode)
        if spread_strike is not None and item_strike == spread_strike and short_greeks is None:
            side = item.get("call_options" if short_otype == "call" else "put_options") or {}
            md = side.get("market_data") or {}
            og = side.get("option_greeks") or {}
            short_ltp = float(md.get("ltp") or 0) or None
            short_greeks = {
                "delta": float(og.get("delta") or 0),
                "gamma": float(og.get("gamma") or 0),
                "theta": float(og.get("theta") or 0),
                "vega":  float(og.get("vega")  or 0),
                "iv":    float(og.get("iv")    or 0),
            }

        if long_greeks and (spread_strike is None or short_greeks):
            break

    if not long_greeks:
        return {
            "error": f"Strike {strike} not found in chain for expiry {target_expiry}",
            "expiry": target_expiry,
            "spot_price": round(spot, 2),
        }

    if spread_strike is not None and not short_greeks:
        return {
            "error": f"Spread strike {spread_strike} not found in chain for expiry {target_expiry}",
            "expiry": target_expiry,
            "spot_price": round(spot, 2),
        }

    effective_entry_long  = entry_price if entry_price is not None else (long_ltp or 0.0)
    effective_entry_short = short_ltp or 0.0
    net_debit = round(effective_entry_long - effective_entry_short, 2) if spread_strike else None

    dte = _days_to_expiry(target_expiry)

    # ── Build scenario grids ────────────────────────────────────────────────────
    scenarios: dict[str, list[dict]] = {}

    def _cell(days: int, ds: float, div: float) -> float:
        long_pnl = _pnl(
            long_greeks["delta"], long_greeks["gamma"],
            long_greeks["theta"], long_greeks["vega"],
            effective_entry_long, ds, div, days, quantity,
        )
        if spread_strike is None:
            return long_pnl
        short_pnl = _pnl(
            short_greeks["delta"], short_greeks["gamma"],    # type: ignore[index]
            short_greeks["theta"], short_greeks["vega"],     # type: ignore[index]
            effective_entry_short, ds, div, days, quantity,
        )
        return round(long_pnl - short_pnl, 2)

    def _cell_expiry(ds: float) -> float:
        long_pnl = _pnl_at_expiry(spot, strike, option_type, effective_entry_long, ds, quantity)
        if spread_strike is None:
            return long_pnl
        short_pnl = _pnl_at_expiry(spot, spread_strike, short_otype, effective_entry_short, ds, quantity)
        return round(long_pnl - short_pnl, 2)

    for days in TIME_SLICES:
        key = f"days_{days}"
        rows = []
        for iv_change in IV_STEPS:
            rows.append({
                "iv_change": iv_change,
                "cells": [_cell(days, float(ds), float(iv_change)) for ds in SPOT_STEPS],
            })
        scenarios[key] = rows

    # At-expiry slice (intrinsic value, no IV dimension matters)
    expiry_rows = []
    for iv_change in IV_STEPS:
        expiry_rows.append({
            "iv_change": iv_change,
            "cells": [_cell_expiry(float(ds)) for ds in SPOT_STEPS],
        })
    scenarios["expiry"] = expiry_rows

    # ── Summary ─────────────────────────────────────────────────────────────────
    if abs(long_greeks["delta"]) > 0.01:
        breakeven_ds = -effective_entry_long / long_greeks["delta"]
        breakeven_spot = round(spot + breakeven_ds, 0)
    else:
        breakeven_spot = None

    daily_theta_pnl = round(long_greeks["theta"] * quantity * LOT_SIZE, 2)
    max_loss_single = round(-effective_entry_long * quantity * LOT_SIZE, 2)

    spread_width = abs(spread_strike - strike) if spread_strike else None
    max_loss_spread = round(-net_debit * quantity * LOT_SIZE, 2) if net_debit is not None else None
    max_gain_spread = round((spread_width - net_debit) * quantity * LOT_SIZE, 2) if (spread_width and net_debit is not None) else None

    return {
        "timestamp": _ist_now().isoformat(),
        "expiry": target_expiry,
        "dte": dte,
        "spot_price": round(spot, 2),
        "strike": strike,
        "option_type": option_type,
        "entry_price": round(effective_entry_long, 2),
        "quantity": quantity,
        "lot_size": LOT_SIZE,
        "spread_mode": spread_strike is not None,
        "spread_strike": spread_strike,
        "spread_option_type": short_otype if spread_strike else None,
        "spread_entry_price": round(effective_entry_short, 2) if spread_strike else None,
        "net_debit": net_debit,
        "greeks": {
            "delta": round(long_greeks["delta"], 4),
            "gamma": round(long_greeks["gamma"], 6),
            "theta": round(long_greeks["theta"], 4),
            "vega":  round(long_greeks["vega"],  4),
            "iv":    round(long_greeks["iv"],    2),
        },
        "spread_greeks": {
            "delta": round(short_greeks["delta"], 4),
            "gamma": round(short_greeks["gamma"], 6),
            "theta": round(short_greeks["theta"], 4),
            "vega":  round(short_greeks["vega"],  4),
            "iv":    round(short_greeks["iv"],    2),
        } if short_greeks else None,
        "spot_steps": SPOT_STEPS,
        "iv_steps": IV_STEPS,
        "time_slices": TIME_SLICES,
        "scenarios": scenarios,
        "summary": {
            "breakeven_spot": breakeven_spot,
            "daily_theta_pnl": daily_theta_pnl,
            "max_loss_if_zero": max_loss_single,
            "max_loss_spread": max_loss_spread,
            "max_gain_spread": max_gain_spread,
            "spread_width": spread_width,
            "current_ltp": round(long_ltp, 2) if long_ltp else None,
        },
    }
