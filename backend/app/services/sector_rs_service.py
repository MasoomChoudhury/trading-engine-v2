"""
Sector Relative Strength — Financials & IT vs Nifty 50.

Computes a weight-adjusted synthetic sector price from constituent candles
already stored in TimescaleDB (populated by the daily breadth refresh).
This avoids dependency on Upstox index API keys for FinNifty / Nifty IT.

Financials ≈ 35% of Nifty · IT ≈ 15% of Nifty → together ~50% of the index.

Relative Strength (RS):
    RS_t = (sector_WAP_t / nifty50_close_t) / (sector_WAP_base / nifty50_close_base) × 100

RS > 100 = sector gained more (or lost less) than Nifty since base date.
RS < 100 = sector lagged Nifty since base date.
"""
from __future__ import annotations
import json
import os
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))

_CONSTITUENT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "nifty50_constituents.json"
)


def _load_sector_weights() -> dict[str, dict[str, float]]:
    """
    Return {sector: {symbol: normalised_weight}} from constituent config.
    Only Financials and IT sectors are used here.
    """
    with open(_CONSTITUENT_PATH) as f:
        cfg = json.load(f)

    sector_stocks: dict[str, dict[str, float]] = {"Financials": {}, "IT": {}}
    for c in cfg.get("constituents", []):
        sector = c.get("sector", "")
        if sector not in sector_stocks:
            continue
        sym = c["symbol"]
        w = float(c.get("weight", 0))
        # Sum weights if a symbol appears more than once (data quirk)
        sector_stocks[sector][sym] = sector_stocks[sector].get(sym, 0.0) + w

    # Normalise to 1.0 within each sector
    result = {}
    for sector, stocks in sector_stocks.items():
        total = sum(stocks.values())
        if total > 0:
            result[sector] = {s: w / total for s, w in stocks.items()}

    return result


async def get_sector_rs(days: int = 60) -> dict:
    """
    Return per-day RS series for Financials and IT sectors vs Nifty 50.

    Reads from TimescaleDB:
      - NIFTY_50 (interval=1day) for the benchmark
      - EQ_{SYMBOL} (interval=1day) for each constituent

    Response keys:
      series   — [{date, nifty50, financials_rs, it_rs, financials_wap, it_wap}]
      current  — latest RS, 5-day slope, today's relative performance, signals
      market_note — plain-language trading implication
    """
    from app.db.database import get_ts_session
    from app.db.models import Candle as DBCandle
    from sqlalchemy import select, desc

    sector_weights = _load_sector_weights()
    fin_weights = sector_weights.get("Financials", {})
    it_weights  = sector_weights.get("IT", {})

    all_eq_symbols = [f"EQ_{s}" for s in set(list(fin_weights) + list(it_weights))]
    fetch_limit = days + 10  # buffer for warmup / weekends

    # ── 1. Fetch Nifty 50 daily closes ────────────────────────────────────────
    async with get_ts_session() as session:
        nifty_stmt = (
            select(DBCandle.timestamp, DBCandle.close)
            .where(DBCandle.symbol == "NIFTY_50", DBCandle.interval == "1day")
            .order_by(desc(DBCandle.timestamp))
            .limit(fetch_limit)
        )
        nifty_rows = (await session.execute(nifty_stmt)).all()

    nifty_map: dict[str, float] = {}
    for ts, close in nifty_rows:
        date = str(ts)[:10]
        nifty_map[date] = float(close)

    if not nifty_map:
        return {"error": "No Nifty 50 daily candles in DB — run a breadth refresh first", "series": []}

    # ── 2. Fetch constituent daily closes ─────────────────────────────────────
    stock_map: dict[str, dict[str, float]] = defaultdict(dict)  # {symbol: {date: close}}

    async with get_ts_session() as session:
        eq_stmt = (
            select(DBCandle.symbol, DBCandle.timestamp, DBCandle.close)
            .where(DBCandle.symbol.in_(all_eq_symbols), DBCandle.interval == "1day")
            .order_by(desc(DBCandle.timestamp))
            .limit(fetch_limit * len(all_eq_symbols))
        )
        eq_rows = (await session.execute(eq_stmt)).all()

    for sym, ts, close in eq_rows:
        raw_sym = sym.replace("EQ_", "")   # strip EQ_ prefix
        date = str(ts)[:10]
        stock_map[raw_sym][date] = float(close)

    # ── 3. Find common dates with full coverage ────────────────────────────────
    # Require Nifty + at least 80% of stocks in each sector to have data
    def _has_coverage(stocks: dict[str, float], date: str) -> bool:
        have = sum(1 for s in stocks if date in stock_map[s])
        return have >= max(1, int(len(stocks) * 0.8))

    common_dates = sorted(
        d for d in nifty_map
        if _has_coverage(fin_weights, d) and _has_coverage(it_weights, d)
    )[-days:]

    if len(common_dates) < 5:
        return {
            "error": (
                "Insufficient constituent candle data in DB. "
                "Run a breadth refresh (/api/v1/breadth/refresh) to populate daily candles."
            ),
            "series": [],
        }

    # ── 4. Compute weighted average price (WAP) per sector per day ────────────
    def _sector_wap(date: str, weights: dict[str, float]) -> float | None:
        total_w = 0.0
        wap = 0.0
        for sym, w in weights.items():
            close = stock_map[sym].get(date)
            if close:
                wap += close * w
                total_w += w
        return wap / total_w if total_w > 0.5 else None  # require >50% weight coverage

    # Base date for RS normalisation
    base = common_dates[0]
    n50_base    = nifty_map[base]
    fin_wap_base = _sector_wap(base, fin_weights)
    it_wap_base  = _sector_wap(base, it_weights)

    if not fin_wap_base or not it_wap_base:
        return {"error": "Insufficient data on base date — try fewer days", "series": []}

    fin_rs_base = fin_wap_base / n50_base
    it_rs_base  = it_wap_base  / n50_base

    series = []
    for d in common_dates:
        n50 = nifty_map[d]
        fin_wap = _sector_wap(d, fin_weights)
        it_wap  = _sector_wap(d, it_weights)
        if fin_wap is None or it_wap is None:
            continue

        fin_rs = (fin_wap / n50) / fin_rs_base * 100
        it_rs  = (it_wap  / n50) / it_rs_base  * 100

        series.append({
            "date":           d,
            "nifty50":        round(n50, 2),
            "financials_wap": round(fin_wap, 2),
            "it_wap":         round(it_wap, 2),
            "financials_rs":  round(fin_rs, 2),
            "it_rs":          round(it_rs,  2),
        })

    if len(series) < 3:
        return {"error": "Too few data points after alignment", "series": []}

    curr = series[-1]
    prev = series[-2]
    ref5 = series[-6] if len(series) >= 6 else series[0]

    # 5-day slope
    fin_slope = round((curr["financials_rs"] - ref5["financials_rs"]) / 5, 3)
    it_slope  = round((curr["it_rs"]         - ref5["it_rs"])         / 5, 3)

    # Today's % change
    n50_pct = round((curr["nifty50"]        / prev["nifty50"]        - 1) * 100, 3)
    fin_pct = round((curr["financials_wap"] / prev["financials_wap"] - 1) * 100, 3)
    it_pct  = round((curr["it_wap"]         / prev["it_wap"]         - 1) * 100, 3)

    fin_rel = round(fin_pct - n50_pct, 3)
    it_rel  = round(it_pct  - n50_pct, 3)

    def _signal(rs: float, slope: float) -> str:
        if rs > 102 and slope > 0:   return "outperforming"
        if rs > 102 and slope <= 0:  return "fading_leader"
        if rs < 98  and slope < 0:   return "underperforming"
        if rs < 98  and slope >= 0:  return "recovering"
        return "neutral"

    fin_sig = _signal(curr["financials_rs"], fin_slope)
    it_sig  = _signal(curr["it_rs"],         it_slope)

    # Market interpretation
    if fin_sig == "outperforming" and it_sig == "outperforming":
        note = "Both heavyweight sectors outperforming — broad Nifty rally has sector support. Call buying has conviction."
    elif fin_sig == "underperforming" and it_sig == "underperforming":
        note = "Both Financials and IT lagging Nifty — move is narrow. Avoid buying calls on breakouts; thin participation."
    elif fin_sig in ("outperforming", "fading_leader") and it_sig in ("underperforming", "recovering"):
        note = "Financials leading; IT lagging. BFSI-driven rally — confirm with BankNifty before sizing up."
    elif it_sig in ("outperforming", "fading_leader") and fin_sig in ("underperforming", "recovering"):
        note = "IT leading; Financials lagging. Tech-driven move — narrower rally, BFSI weakness is a risk for Nifty bulls."
    elif fin_sig == "fading_leader" or it_sig == "fading_leader":
        note = "One heavyweight fading from recent outperformance — momentum weakening. Confirm before adding to positions."
    else:
        note = f"Mixed sector performance. Financials: {fin_sig}, IT: {it_sig}. No clear directional leadership."

    return {
        "days":       len(series),
        "base_date":  base,
        "series":     series,
        "current": {
            "date":              curr["date"],
            "nifty50":           curr["nifty50"],
            "financials_wap":    curr["financials_wap"],
            "it_wap":            curr["it_wap"],
            "financials_rs":     curr["financials_rs"],
            "it_rs":             curr["it_rs"],
            "financials_5d_slope": fin_slope,
            "it_5d_slope":        it_slope,
            "nifty_today_pct":   n50_pct,
            "fin_today_pct":     fin_pct,
            "it_today_pct":      it_pct,
            "fin_rel_today":     fin_rel,
            "it_rel_today":      it_rel,
            "financials_signal": fin_sig,
            "it_signal":         it_sig,
        },
        "market_note": note,
        "timestamp":   datetime.now(IST).isoformat(),
    }
