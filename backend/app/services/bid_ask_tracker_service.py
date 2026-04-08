"""
Bid-Ask Spread Tracker Service.

In high-volatility environments (VIX > 25), market makers widen bid-ask spreads
significantly. A wide spread means your LTP-based P&L is theoretical — the real
fill cost includes crossing the spread, which can put you in the red immediately.

Executability thresholds:
  < 1% spread  → 'liquid'         — fill at mid feasible with limit order
  1–3% spread  → 'acceptable'     — use limit order close to mid; avoid market orders
  3–5% spread  → 'wide'           — significant crossing cost; wait for liquidity
  > 5% spread  → 'un-executable'  — market order will destroy edge immediately

Upstox V2 option chain returns bid_price, ask_price, bid_qty, ask_qty per strike.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
NIFTY_KEY = "NSE_INDEX|Nifty 50"
LOT_SIZE = 50


def _executability(spread_pct: float) -> str:
    if spread_pct < 1.0:
        return "liquid"
    if spread_pct < 3.0:
        return "acceptable"
    if spread_pct < 5.0:
        return "wide"
    return "un-executable"


def _liquidity_score(spread_pct: float, bid_qty: float, ask_qty: float) -> int:
    """0–100 liquidity score. Higher is more liquid."""
    spread_penalty = min(spread_pct * 10, 60)      # up to 60 pts penalty for spread
    qty_score = min((bid_qty + ask_qty) / 100, 40)  # up to 40 pts bonus for depth
    return max(0, int(100 - spread_penalty + qty_score))


async def get_bid_ask_spread(target_expiry: str | None = None) -> dict:
    """
    Compute bid-ask spread metrics for ATM ± 5 strikes.

    Returns per-strike:
      bid, ask, spread_pts, spread_pct, executability, liquidity_score,
      effective_premium (true cost to lift offer), crossing_cost_per_lot
    """
    from app.services.upstox_client import UpstoxClient

    client = UpstoxClient()

    # ── Expiry ─────────────────────────────────────────────────────────────────
    try:
        contracts = await client.get_option_contracts(NIFTY_KEY)
        expiry = target_expiry or (contracts[0].get("expiry", "") if contracts else "")
    except Exception as e:
        return {
            "error": f"Failed to get option contracts: {e}",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # ── Option chain ───────────────────────────────────────────────────────────
    try:
        chain = await client.get_option_chain(NIFTY_KEY, expiry)
    except Exception as e:
        return {
            "error": f"Option chain fetch failed: {e}",
            "timestamp": datetime.now(IST).isoformat(),
        }

    if not chain:
        return {"error": "Empty option chain", "timestamp": datetime.now(IST).isoformat()}

    # Find spot and ATM
    spot = 0.0
    for entry in chain:
        s = entry.get("underlying_spot_price") or 0
        if s:
            spot = float(s)
            break

    if not spot:
        return {"error": "Spot price unavailable", "timestamp": datetime.now(IST).isoformat()}

    sorted_chain = sorted(chain, key=lambda x: float(x.get("strike_price", 0)))
    atm_idx = min(range(len(sorted_chain)),
                  key=lambda i: abs(float(sorted_chain[i].get("strike_price", 0)) - spot))
    window = sorted_chain[max(0, atm_idx - 5): atm_idx + 6]

    strike_data: list[dict] = []
    un_executable_count = 0
    wide_count = 0

    for entry in window:
        strike = float(entry.get("strike_price", 0))
        is_atm = abs(strike - spot) <= 75

        for side, key in [("CE", "call_options"), ("PE", "put_options")]:
            opt = entry.get(key) or {}
            md = opt.get("market_data") or {}

            bid = float(md.get("bid_price") or md.get("lower_circuit_limit") or 0)
            ask = float(md.get("ask_price") or md.get("upper_circuit_limit") or 0)
            bid_qty = float(md.get("bid_qty") or md.get("total_buy_quantity") or 0)
            ask_qty = float(md.get("ask_qty") or md.get("total_sell_quantity") or 0)
            ltp = float(md.get("ltp") or 0)

            # Fallback: if bid/ask not in market_data, estimate from circuit limits
            if bid == 0 and ask == 0 and ltp > 0:
                # Estimate: typical spread is 0.5–2% for liquid options
                est_spread = max(ltp * 0.01, 0.05)
                bid = round(ltp - est_spread / 2, 2)
                ask = round(ltp + est_spread / 2, 2)

            if ask == 0:
                continue

            mid = (bid + ask) / 2 if bid and ask else ltp
            spread_pts = round(ask - bid, 2) if bid else 0.0
            spread_pct = round(spread_pts / max(mid, 0.01) * 100, 2)
            exec_label = _executability(spread_pct)
            liq_score = _liquidity_score(spread_pct, bid_qty, ask_qty)
            effective_premium = round(ask + spread_pts * 0.1, 2)  # conservative fill
            crossing_cost_lot = round(spread_pts / 2 * LOT_SIZE, 0)

            if exec_label == "un-executable":
                un_executable_count += 1
            elif exec_label == "wide":
                wide_count += 1

            strike_data.append({
                "strike": strike,
                "side": side,
                "is_atm": is_atm,
                "bid": round(bid, 2),
                "ask": round(ask, 2),
                "mid": round(mid, 2),
                "ltp": round(ltp, 2),
                "bid_qty": int(bid_qty),
                "ask_qty": int(ask_qty),
                "spread_pts": spread_pts,
                "spread_pct": spread_pct,
                "executability": exec_label,
                "liquidity_score": liq_score,
                "effective_premium": effective_premium,
                "crossing_cost_per_lot": int(crossing_cost_lot),
            })

    # Overall rating
    total = len(strike_data) or 1
    if un_executable_count / total > 0.4:
        overall_rating = "un-executable"
        overall_note = (
            f"{un_executable_count} of {total} strikes have spread > 5%. "
            "Market is illiquid — use only limit orders at mid; avoid market orders entirely."
        )
    elif wide_count / total > 0.4:
        overall_rating = "wide"
        overall_note = (
            f"{wide_count} of {total} strikes have spread 3–5%. "
            "Significant crossing cost — every market order puts position in immediate deficit. "
            "Wait for spread to compress or use aggressive limit orders."
        )
    else:
        overall_rating = "acceptable"
        overall_note = "Spreads within acceptable range. Use limit orders near mid for best fills."

    return {
        "timestamp": datetime.now(IST).isoformat(),
        "expiry": expiry,
        "spot": round(spot, 2),
        "overall_rating": overall_rating,
        "overall_note": overall_note,
        "un_executable_count": un_executable_count,
        "wide_count": wide_count,
        "strikes": strike_data,
    }
