"""
Position Sizing Engine — Gap 16.

Calculates optimal lot sizes given capital and risk tolerance.

Modes:
  'naked'  — full entry_premium is max loss per lot
  'spread' — net_debit is max loss per lot (defined risk)

VIX adjustment is post-formula:
  VIX 20–25 → 75% of raw lots  (rounded down)
  VIX  25+  → 50% of raw lots  (rounded down)
  Both raw and adjusted lots are returned so the UI shows what the reduction costs.

Kelly fraction is a secondary display-only output:
  Kelly % = Edge / Odds  (Edge = 0.5 until journal data exists, Odds = max_gain / max_loss)
"""
import math
from loguru import logger

LOT_SIZE = 50


async def calculate_position_size(
    capital: float,
    risk_pct: float,
    mode: str,                        # 'naked' | 'spread'
    entry_premium: float,
    net_debit: float | None = None,   # spread mode only
    max_gain: float | None = None,    # spread mode, for Kelly
) -> dict:
    """Return sizing dict with raw_lots, adjusted_lots, VIX context, and Kelly."""

    # ── Fetch current VIX ─────────────────────────────────────────────────────
    vix_current = 0.0
    try:
        from app.services.vix_service import get_india_vix
        vix_data = await get_india_vix()
        vix_current = float(vix_data.get("vix", 0))
    except Exception as e:
        logger.warning(f"position_sizer: VIX fetch failed — {e}")

    # ── VIX haircut factor (applied AFTER formula, not inside it) ─────────────
    if vix_current >= 25:
        vix_factor = 0.5
        vix_level = "extreme"
        vix_note = f"VIX {vix_current:.1f} ≥ 25 — half-size recommended (extreme fear)"
    elif vix_current >= 20:
        vix_factor = 0.75
        vix_level = "elevated"
        vix_note = f"VIX {vix_current:.1f} ≥ 20 — ¾-size recommended (elevated risk)"
    else:
        vix_factor = 1.0
        vix_level = "normal"
        vix_note = None

    # ── Max risk in ₹ ─────────────────────────────────────────────────────────
    max_risk_inr = capital * risk_pct / 100.0

    # ── Max loss per lot ──────────────────────────────────────────────────────
    if mode == "spread" and net_debit is not None and net_debit > 0:
        max_loss_per_lot = net_debit * LOT_SIZE
    else:
        if entry_premium <= 0:
            return {"error": "entry_premium must be > 0"}
        max_loss_per_lot = entry_premium * LOT_SIZE

    # ── Raw lots (before VIX haircut) ─────────────────────────────────────────
    raw_lots = math.floor(max_risk_inr / max_loss_per_lot) if max_loss_per_lot > 0 else 0
    raw_lots = max(raw_lots, 0)

    # ── VIX-adjusted lots ─────────────────────────────────────────────────────
    adjusted_lots = math.floor(raw_lots * vix_factor)
    adjusted_lots = max(adjusted_lots, 0)

    # ── Capital at risk (using adjusted lots) ────────────────────────────────
    capital_at_risk_inr = adjusted_lots * max_loss_per_lot
    capital_at_risk_pct = round(capital_at_risk_inr / capital * 100, 2) if capital > 0 else 0.0

    # ── Kelly fraction (display-only, greyed in UI) ───────────────────────────
    kelly_pct = None
    kelly_note = "will auto-calibrate once 20 trades are logged"
    if (
        mode == "spread"
        and max_gain is not None and max_gain > 0
        and net_debit is not None and net_debit > 0
    ):
        edge = 0.5  # coin-flip assumption until journal provides real win rate
        odds = max_gain / net_debit  # lot sizes cancel
        kelly_pct = round(edge / odds * 100, 1) if odds > 0 else None

    return {
        "mode": mode,
        "capital": capital,
        "risk_pct": risk_pct,
        "entry_premium": entry_premium,
        "net_debit": net_debit,
        "max_loss_per_lot": round(max_loss_per_lot, 2),
        "max_risk_inr": round(max_risk_inr, 2),
        "raw_lots": raw_lots,
        "adjusted_lots": adjusted_lots,
        "vix_current": round(vix_current, 2),
        "vix_factor": vix_factor,
        "vix_level": vix_level,
        "vix_note": vix_note,
        "capital_at_risk_inr": round(capital_at_risk_inr, 2),
        "capital_at_risk_pct": capital_at_risk_pct,
        "kelly_pct": kelly_pct,
        "kelly_note": kelly_note,
        "lot_size": LOT_SIZE,
    }
