"""
IV Term Structure Service.

Fetches ATM IV for each active expiry and builds a term structure curve.
Classifies the market as contango (normal: far IV > near IV) or
backwardation (fear spike: near IV > far IV — statistically likely to mean-revert).

Also computes the near/far IV ratio which indicates whether weekly options
are overpriced relative to monthly expectations.
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone
from typing import Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))


def _ist_now() -> datetime:
    return datetime.now(IST)


def _days_to_expiry(expiry_str: str) -> int:
    expiry = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    return (expiry - _ist_now().date()).days


def _atm_strike(spot: float, step: int = 50) -> float:
    return round(spot / step) * step


async def build_iv_term_structure() -> dict:
    """
    Build the IV term structure across all active Nifty expiries.

    Returns:
      - term_structure: list of {expiry, dte, atm_iv, atm_ce_iv, atm_pe_iv}
      - regime: 'contango' | 'backwardation' | 'flat'
      - near_far_ratio: near_atm_iv / far_atm_iv (> 1.4 = weekly expensive)
      - slope: linear slope of IV vs DTE (negative = contango, positive = backwardation)
      - note: human-readable interpretation
      - spot_price, timestamp
    """
    from app.services.options_service import get_active_expiries, fetch_chain

    expiries = await get_active_expiries()
    if not expiries:
        return {"error": "No active expiries found"}

    # Cap at 6 expiries to keep the chart readable
    expiries = expiries[:6]

    spot = 0.0
    term_structure = []

    for expiry in expiries:
        dte = _days_to_expiry(expiry)
        if dte < 0:
            continue
        try:
            raw_chain = await fetch_chain(expiry)
        except Exception as exc:
            logger.warning(f"IV term structure: failed to fetch chain for {expiry}: {exc}")
            continue

        expiry_spot = 0.0
        ce_iv_atm: Optional[float] = None
        pe_iv_atm: Optional[float] = None

        for item in raw_chain:
            s = float(item.get("underlying_spot_price") or 0)
            if s and not expiry_spot:
                expiry_spot = s
            if s and not spot:
                spot = s

        if not expiry_spot:
            continue

        atm = _atm_strike(expiry_spot)

        for item in raw_chain:
            strike = float(item.get("strike_price") or 0)
            if strike != atm:
                continue
            ce_g = (item.get("call_options") or {}).get("option_greeks") or {}
            pe_g = (item.get("put_options") or {}).get("option_greeks") or {}
            ce_iv_raw = float(ce_g.get("iv") or 0)
            pe_iv_raw = float(pe_g.get("iv") or 0)
            ce_iv_atm = round(ce_iv_raw, 2) if ce_iv_raw > 0 else None
            pe_iv_atm = round(pe_iv_raw, 2) if pe_iv_raw > 0 else None
            break

        # Use average of CE and PE iv as the ATM IV; fall back to whichever is available
        if ce_iv_atm and pe_iv_atm:
            atm_iv = round((ce_iv_atm + pe_iv_atm) / 2, 2)
        elif ce_iv_atm:
            atm_iv = ce_iv_atm
        elif pe_iv_atm:
            atm_iv = pe_iv_atm
        else:
            # Skip expiries where IV data is unavailable
            continue

        term_structure.append({
            "expiry": expiry,
            "dte": dte,
            "atm_iv": atm_iv,
            "atm_ce_iv": ce_iv_atm,
            "atm_pe_iv": pe_iv_atm,
        })

    if not term_structure:
        return {
            "error": "Could not retrieve IV data for any expiry",
            "spot_price": round(spot, 2),
            "timestamp": _ist_now().isoformat(),
        }

    # Sort by DTE ascending (nearest first)
    term_structure.sort(key=lambda x: x["dte"])

    # ── Regime classification ──────────────────────────────────────────────────
    # Contango: IV increases with DTE (normal term structure)
    # Backwardation: near IV > far IV (fear spike, mean-reversion expected)
    near_iv = term_structure[0]["atm_iv"]
    far_iv = term_structure[-1]["atm_iv"] if len(term_structure) > 1 else near_iv

    near_far_ratio = round(near_iv / far_iv, 3) if far_iv > 0 else None

    # Linear slope via least-squares (DTE as x, IV as y)
    if len(term_structure) >= 2:
        xs = [p["dte"] for p in term_structure]
        ys = [p["atm_iv"] for p in term_structure]
        n = len(xs)
        x_mean = sum(xs) / n
        y_mean = sum(ys) / n
        num = sum((xs[i] - x_mean) * (ys[i] - y_mean) for i in range(n))
        den = sum((xs[i] - x_mean) ** 2 for i in range(n))
        slope = round(num / den, 4) if den != 0 else 0.0
    else:
        slope = 0.0

    # slope > 0 → IV rising with DTE → contango
    # slope < 0 → IV falling with DTE → backwardation (or front-month fear)
    if slope > 0.05:
        regime = "contango"
    elif slope < -0.05:
        regime = "backwardation"
    else:
        regime = "flat"

    # ── Near/far premium analysis ──────────────────────────────────────────────
    # If near_far_ratio > 1.4 (near IV 40%+ above far IV) → weekly is expensive
    weekly_premium_pct = round((near_far_ratio - 1) * 100, 1) if near_far_ratio else None

    if regime == "backwardation":
        if near_far_ratio and near_far_ratio >= 1.4:
            note = (
                f"Backwardation: near IV ({near_iv:.1f}%) is {weekly_premium_pct:.0f}% above "
                f"monthly IV ({far_iv:.1f}%) — weekly options are statistically expensive. "
                "Avoid naked weekly buys; favour selling premium or using spreads."
            )
        else:
            note = (
                f"Mild backwardation: near IV slightly elevated vs monthly. "
                "Monitor for mean-reversion to contango — typical after a fear spike."
            )
    elif regime == "contango":
        note = (
            f"Normal contango: far IV ({far_iv:.1f}%) > near IV ({near_iv:.1f}%). "
            "Weekly options are not overpriced relative to monthly expectations."
        )
    else:
        note = "Flat term structure: IV relatively uniform across expiries."

    return {
        "timestamp": _ist_now().isoformat(),
        "spot_price": round(spot, 2),
        "term_structure": term_structure,
        "regime": regime,
        "slope": slope,
        "near_iv": near_iv,
        "far_iv": far_iv,
        "near_far_ratio": near_far_ratio,
        "weekly_premium_pct": weekly_premium_pct,
        "note": note,
    }
