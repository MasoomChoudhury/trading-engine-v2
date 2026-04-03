"""
Nifty 50 Constituent Breadth & Volume Analytics Service.

Answers: was today's index move driven by broad participation or
a handful of heavyweights (Reliance, HDFC Bank, ICICI Bank, Infosys, TCS)?
"""
from __future__ import annotations
import asyncio
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from loguru import logger

IST = timezone(timedelta(hours=5, minutes=30))
CONFIG_PATH = Path(__file__).parent.parent / "data" / "nifty50_constituents.json"
WEIGHTS_STALE_DAYS = 100


def ist_now() -> datetime:
    return datetime.now(IST)


def ist_today() -> str:
    return ist_now().strftime("%Y-%m-%d")


# ── Config ────────────────────────────────────────────────────────────────────

def load_constituents() -> dict:
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    # Deduplicate by symbol (keep last occurrence)
    seen: dict[str, dict] = {}
    for c in cfg["constituents"]:
        seen[c["symbol"]] = c
    cfg["constituents"] = list(seen.values())
    cfg["weights_age_days"] = (
        ist_now().date() - datetime.strptime(cfg["last_updated"], "%Y-%m-%d").date()
    ).days
    return cfg


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _upsert_candles_batch(symbol: str, candles: list[list[Any]]) -> int:
    """Store daily candles (newest-first from API) for an equity symbol."""
    from app.db.database import get_ts_session
    from sqlalchemy import text

    if not candles:
        return 0
    db_sym = f"EQ_{symbol}"
    count = 0
    from datetime import datetime
    async with get_ts_session() as session:
        for c in candles:
            ts_raw = c[0]
            if isinstance(ts_raw, str):
                # e.g. "2026-03-25T00:00:00+05:30"
                ts = datetime.fromisoformat(ts_raw)
            else:
                ts = ts_raw
            await session.execute(
                text("""
                    INSERT INTO candles (timestamp, symbol, interval, open, high, low, close, volume, oi)
                    VALUES (:ts, :sym, '1day', :o, :h, :l, :cl, :v, 0)
                    ON CONFLICT (timestamp, symbol, interval) DO UPDATE SET
                        open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                        close=EXCLUDED.close, volume=EXCLUDED.volume
                """),
                {
                    "ts": ts,
                    "sym": db_sym,
                    "o": c[1], "h": c[2], "l": c[3], "cl": c[4],
                    "v": int(c[5]) if c[5] else 0,
                },
            )
            count += 1
    return count


async def _load_candles_from_db(symbol: str, days: int = 80) -> list[dict]:
    """Load cached equity candles from DB. Returns [{date, close, volume}] ASC."""
    from app.db.database import get_ts_session
    from sqlalchemy import text

    db_sym = f"EQ_{symbol}"
    cutoff = (ist_now().date() - timedelta(days=days))
    async with get_ts_session() as session:
        r = await session.execute(
            text("""
                SELECT DATE(timestamp AT TIME ZONE 'Asia/Kolkata') AS date, close, volume
                FROM candles
                WHERE symbol = :sym AND interval = '1day' AND timestamp >= :cutoff
                ORDER BY timestamp ASC
            """),
            {"sym": db_sym, "cutoff": cutoff},
        )
        rows = r.mappings().all()
    return [{"date": str(row["date"]), "close": float(row["close"]), "volume": int(row["volume"])} for row in rows]


async def _count_db_coverage() -> dict[str, int]:
    """Return {symbol: candle_count} for all EQ_ symbols."""
    from app.db.database import get_ts_session
    from sqlalchemy import text

    cutoff = ist_now().date() - timedelta(days=90)
    async with get_ts_session() as session:
        r = await session.execute(
            text("""
                SELECT symbol, COUNT(*) AS cnt FROM candles
                WHERE symbol LIKE 'EQ_%' AND interval='1day' AND timestamp >= :cutoff
                GROUP BY symbol
            """),
            {"cutoff": cutoff},
        )
        rows = r.mappings().all()
    return {row["symbol"].replace("EQ_", ""): int(row["cnt"]) for row in rows}


# ── Upstox fetch ──────────────────────────────────────────────────────────────

async def _fetch_candles_from_upstox(instrument_key: str, symbol: str) -> list[list]:
    from app.services.upstox_client import token_manager
    import httpx
    import urllib.parse

    token = await token_manager.get_access_token()
    to_date = ist_today()
    encoded = urllib.parse.quote(instrument_key, safe="")
    url = f"https://api.upstox.com/v2/historical-candle/{encoded}/day/{to_date}"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
        r.raise_for_status()
        data = r.json()
        candles = data.get("data", {}).get("candles", [])
        return candles  # newest-first


async def refresh_constituent(symbol: str, instrument_key: str, semaphore: asyncio.Semaphore) -> int:
    async with semaphore:
        try:
            candles = await _fetch_candles_from_upstox(instrument_key, symbol)
            count = await _upsert_candles_batch(symbol, candles[:90])  # keep 90 days
            logger.info(f"Refreshed {symbol}: {count} candles")
            return count
        except Exception as e:
            logger.warning(f"Failed to refresh {symbol}: {e}")
            return 0


async def refresh_all_constituents() -> dict[str, int]:
    """Fetch candles for all 50 constituents concurrently (max 8 at a time)."""
    cfg = load_constituents()
    sem = asyncio.Semaphore(8)
    tasks = [
        refresh_constituent(c["symbol"], c["instrument_key"], sem)
        for c in cfg["constituents"]
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    counts = {}
    for c, r in zip(cfg["constituents"], results):
        counts[c["symbol"]] = r if isinstance(r, int) else 0
    logger.info(f"Constituent refresh complete: {sum(counts.values())} total candles")
    return counts


# ── Analytics computation ─────────────────────────────────────────────────────

def _rolling_mean_std(values: list[float], i: int, window: int) -> tuple[float, float]:
    """Rolling mean and std over `window` items ending at index i (inclusive)."""
    start = max(0, i - window + 1)
    w = [v for v in values[start: i + 1] if v > 0]
    if len(w) < 3:
        return 0.0, 1.0
    mean = sum(w) / len(w)
    var = sum((x - mean) ** 2 for x in w) / len(w)
    return mean, math.sqrt(var) if var > 0 else 1.0


def _clamp(v: float, lo: float = -3.0, hi: float = 3.0) -> float:
    return max(lo, min(hi, v))


def compute_breadth_analytics(
    candles_by_symbol: dict[str, list[dict]],
    nifty_candles: list[dict],
    futures_data: list[dict],
    constituents: list[dict],
) -> dict:
    """
    Core analytics computation. All inputs keyed by date string.

    candles_by_symbol: {symbol -> [{date, close, volume}]} sorted ASC
    nifty_candles: [{date, close}] sorted ASC
    futures_data: [{date, near_volume}] sorted ASC — from futures panel
    constituents: list from config
    """
    hw_symbols = {c["symbol"] for c in constituents if c["is_hw"]}
    weight_map = {c["symbol"]: c["weight"] for c in constituents}
    sector_map = {c["symbol"]: c["sector"] for c in constituents}
    all_symbols = [c["symbol"] for c in constituents]

    # Build date-indexed lookups
    nifty_map: dict[str, float] = {r["date"]: r["close"] for r in nifty_candles}
    futures_map: dict[str, int] = {r["date"]: r.get("near_volume", 0) for r in futures_data}

    # Build all_dates from equity candles only — Nifty data may be more recent
    # (equity refresh lags), so including Nifty-only dates would add zero-volume rows
    all_dates_set: set[str] = set()
    for rows in candles_by_symbol.values():
        all_dates_set.update(r["date"] for r in rows)
    all_dates = sorted(all_dates_set)[-60:]

    # Build per-symbol date→candle lookup
    sym_map: dict[str, dict[str, dict]] = {}
    for sym, rows in candles_by_symbol.items():
        sym_map[sym] = {r["date"]: r for r in rows}

    # Pre-collect ordered volume lists per symbol for rolling calcs
    sym_vol_lists: dict[str, list[tuple[str, float]]] = {}
    for sym in all_symbols:
        ordered = [(d, sym_map.get(sym, {}).get(d, {}).get("volume", 0) or 0)
                   for d in all_dates]
        sym_vol_lists[sym] = ordered

    # Build time series
    volume_series = []
    breadth_series = []
    sector_series = []
    heatmap_data: dict[str, list] = {sym: [] for sym in all_symbols}

    # Rolling weighted vol for MA
    weighted_vols: list[float] = []

    for i, date in enumerate(all_dates):
        day_vols: dict[str, float] = {}
        for sym in all_symbols:
            vol = sym_vol_lists[sym][i][1]
            day_vols[sym] = float(vol)

        total_raw_vol = sum(day_vols.values())
        # Weight-adjusted: vol * weight/100 then scale back to absolute (multiply by avg weight)
        # To keep magnitude comparable to raw, normalize by mean weight
        weighted_vol = sum(day_vols[s] * (weight_map.get(s, 0.5) / 100) for s in all_symbols)

        # Collect weighted vol for MA
        weighted_vols.append(weighted_vol)
        wvol_mean, wvol_std = _rolling_mean_std(weighted_vols, i, 20)
        wvol_ma20 = wvol_mean

        # Nifty close
        nifty_close = nifty_map.get(date, 0) or 0
        prev_nifty = next((nifty_map.get(d, 0) for d in reversed(all_dates[:i]) if nifty_map.get(d, 0) > 0), 0)
        nifty_chg_pct = ((nifty_close - prev_nifty) / prev_nifty * 100) if prev_nifty > 0 else 0

        # Divergence annotation
        divergence = None
        if i >= 5 and nifty_close > 0 and wvol_ma20 > 0:
            above_avg = weighted_vol > wvol_ma20
            up_day = nifty_chg_pct > 0.5
            down_day = nifty_chg_pct < -0.5
            if up_day and above_avg:
                divergence = "Confirmed breakout"
            elif up_day and not above_avg:
                divergence = "Low conviction rally"
            elif down_day and above_avg:
                divergence = "High conviction selloff"

        # Breadth: per-stock MA20
        breadth_count = 0
        for sym in all_symbols:
            vols_seq = [sym_vol_lists[sym][j][1] for j in range(i + 1)]
            own_mean, _ = _rolling_mean_std(vols_seq, len(vols_seq) - 1, 20)
            if own_mean > 0 and day_vols[sym] > own_mean:
                breadth_count += 1

        n_active = sum(1 for s in all_symbols if day_vols[s] > 0)
        denom = max(n_active, 1)
        breadth_pct = round(breadth_count / denom * 100, 1)

        # Heavyweight share
        hw_vol = sum(day_vols.get(s, 0) for s in hw_symbols)
        hw_share_pct = round(hw_vol / total_raw_vol * 100, 1) if total_raw_vol > 0 else 0.0

        # Breadth annotation
        breadth_ann = None
        if i >= 10:
            if breadth_pct < 40 and hw_share_pct > 50:
                breadth_ann = "Heavyweight-driven — low breadth"
            elif breadth_pct > 70 and hw_share_pct < 40:
                breadth_ann = "Broad-based move — high conviction"

        # Sector volumes
        sector_vols: dict[str, float] = defaultdict(float)
        for sym in all_symbols:
            sector_vols[sector_map.get(sym, "Other")] += day_vols[sym]
        if total_raw_vol > 0:
            sector_pcts = {s: round(v / total_raw_vol * 100, 2) for s, v in sector_vols.items()}
        else:
            sector_pcts = {s: 0.0 for s in sector_vols}

        # Heatmap z-scores
        for sym in all_symbols:
            vols_seq = [sym_vol_lists[sym][j][1] for j in range(i + 1)]
            own_mean, own_std = _rolling_mean_std(vols_seq, len(vols_seq) - 1, 20)
            if own_mean > 0 and own_std > 0:
                z = _clamp((day_vols[sym] - own_mean) / own_std)
            else:
                z = 0.0
            heatmap_data[sym].append(round(z, 2))

        # Build row data
        volume_series.append({
            "date": date,
            "weighted_vol": round(weighted_vol, 0),
            "vol_ma20": round(wvol_ma20, 0) if wvol_ma20 > 0 else None,
            "nifty_close": nifty_close,
            "nifty_chg_pct": round(nifty_chg_pct, 2),
            "futures_vol": futures_map.get(date, 0),
            "divergence": divergence,
        })
        breadth_series.append({
            "date": date,
            "breadth_pct": breadth_pct,
            "hw_share_pct": hw_share_pct,
            "annotation": breadth_ann,
        })
        sector_series.append({"date": date, **sector_pcts})

    # Heatmap (last 20 days, all 50 stocks, z-scores clipped ±3)
    last_20_dates = all_dates[-20:]
    n_total = len(all_dates)
    last_20_idx = range(n_total - len(last_20_dates), n_total)
    heatmap_rows = []
    for c in constituents:
        sym = c["symbol"]
        z_slice = [heatmap_data[sym][j] for j in last_20_idx if j < len(heatmap_data[sym])]
        heatmap_rows.append({
            "symbol": sym,
            "name": c["name"],
            "sector": c["sector"],
            "weight": c["weight"],
            "is_hw": c["is_hw"],
            "zscores": z_slice,
        })
    # Sort by sector then symbol
    heatmap_rows.sort(key=lambda x: (x["sector"], -x["weight"]))

    # Today's summary (last date)
    last_vs = volume_series[-1] if volume_series else {}
    last_bs = breadth_series[-1] if breadth_series else {}
    last_ss = sector_series[-1] if sector_series else {}

    # Conviction label
    bs = last_bs.get("breadth_pct", 0)
    hw = last_bs.get("hw_share_pct", 0)
    if bs >= 65:
        conviction = "Broad"
    elif bs < 40 and hw > 50:
        conviction = "Heavyweight-driven"
    else:
        conviction = "Narrow"

    # Top sector
    sector_vals = {k: v for k, v in last_ss.items() if k != "date" and isinstance(v, (int, float))}
    top_sector = max(sector_vals, key=sector_vals.get) if sector_vals else "—"
    top_sector_pct = sector_vals.get(top_sector, 0)

    # 52-week high volume count (proxy: volume > max in stored history)
    high_vol_count = 0
    for sym in all_symbols:
        vols_all = [v for _, v in sym_vol_lists[sym] if v > 0]
        today_vol = day_vols.get(sym, 0)
        if len(vols_all) >= 5 and today_vol > max(vols_all[:-1], default=0):
            high_vol_count += 1

    # Alerts
    alerts = []
    nifty_today_chg = last_vs.get("nifty_chg_pct", 0) or 0
    if nifty_today_chg > 0.5 and bs < 40:
        alerts.append({
            "type": "warning",
            "msg": f"Index rising on narrow base (breadth {bs:.0f}%) — unsustainable without broadening",
        })
    if nifty_today_chg <= 0.2 and bs > 70:
        alerts.append({
            "type": "info",
            "msg": f"Broad accumulation underway despite flat index (breadth {bs:.0f}%) — heavyweights dragging",
        })
    if hw > 60 and abs(nifty_today_chg) > 0.5:
        alerts.append({
            "type": "warning",
            "msg": f"Move is heavyweight-driven ({hw:.0f}% share) — verify with futures panel",
        })
    if top_sector_pct > 40:
        alerts.append({
            "type": "warning",
            "msg": f"Sector concentration: {top_sector} at {top_sector_pct:.0f}% of total volume",
        })

    # Heavyweight today stats
    today = all_dates[-1] if all_dates else ist_today()
    hw_today = []
    for c in constituents:
        if not c["is_hw"]:
            continue
        sym = c["symbol"]
        idx = all_dates.index(today) if today in all_dates else -1
        today_vol = float(sym_vol_lists[sym][idx][1]) if idx >= 0 else 0
        vols_seq = [sym_vol_lists[sym][j][1] for j in range(idx)] if idx > 0 else []
        ma20, _ = _rolling_mean_std(vols_seq, len(vols_seq) - 1, 20) if vols_seq else (0, 0)
        pct_vs_ma = round((today_vol - ma20) / ma20 * 100, 1) if ma20 > 0 else 0
        hw_today.append({
            "symbol": sym,
            "name": c["name"],
            "volume": int(today_vol),
            "ma20": int(ma20),
            "pct_vs_ma": pct_vs_ma,
            "weight": c["weight"],
            "above_ma": today_vol > ma20,
        })

    return {
        "config": {
            "last_updated": "unknown",
            "weights_stale": False,
            "n_constituents": len(constituents),
        },
        "summary": {
            "breadth_pct": round(bs, 1),
            "hw_share_pct": round(hw, 1),
            "conviction": conviction,
            "top_sector": top_sector,
            "top_sector_pct": round(top_sector_pct, 1),
            "high_vol_count": high_vol_count,
            "nifty_chg_pct": round(nifty_today_chg, 2),
        },
        "alerts": alerts,
        "volume_series": volume_series,
        "breadth_series": breadth_series,
        "sector_series": sector_series,
        "heatmap": {
            "dates": last_20_dates,
            "rows": heatmap_rows,
        },
        "heavyweight_today": hw_today,
    }


# ── Main builder ──────────────────────────────────────────────────────────────

async def build_breadth_analytics() -> dict:
    cfg = load_constituents()
    constituents = cfg["constituents"]

    # Check DB coverage
    coverage = await _count_db_coverage()
    symbols_with_data = sum(1 for c in constituents if coverage.get(c["symbol"], 0) >= 10)
    data_ready = symbols_with_data >= 20  # need at least 20 stocks to be useful

    if not data_ready:
        return {
            "status": "loading",
            "symbols_ready": symbols_with_data,
            "total": len(constituents),
            "message": f"Building data cache: {symbols_with_data}/{len(constituents)} stocks loaded. "
                       "POST /api/v1/breadth/refresh to trigger full fetch.",
        }

    # Load all candles from DB
    tasks = [_load_candles_from_db(c["symbol"], days=80) for c in constituents]
    candle_results = await asyncio.gather(*tasks)
    candles_by_symbol = {c["symbol"]: rows for c, rows in zip(constituents, candle_results)}

    # Load Nifty index candles
    from app.db.database import get_ts_session
    from sqlalchemy import text
    cutoff = (ist_now().date() - timedelta(days=80))
    async with get_ts_session() as session:
        r = await session.execute(
            text("""
                SELECT DATE(timestamp AT TIME ZONE 'Asia/Kolkata') AS date, close
                FROM candles
                WHERE symbol = 'NIFTY_50' AND interval = '1day' AND timestamp >= :cutoff
                ORDER BY timestamp ASC
            """),
            {"cutoff": cutoff},
        )
        nifty_rows = r.mappings().all()
    nifty_candles = [{"date": str(r["date"]), "close": float(r["close"])} for r in nifty_rows]

    # Load futures near-month volume for correlation
    from app.services.futures_service import get_active_futures, fetch_futures_daily_candles
    futures_data: list[dict] = []
    try:
        contracts = await get_active_futures()
        if contracts:
            near_candles = await fetch_futures_daily_candles(contracts[0]["instrument_key"])
            futures_data = [
                {"date": str(c[0])[:10], "near_volume": int(c[5]) if c[5] else 0}
                for c in near_candles
            ]
    except Exception as e:
        logger.warning(f"Could not load futures data for breadth overlay: {e}")

    result = compute_breadth_analytics(candles_by_symbol, nifty_candles, futures_data, constituents)
    result["config"]["last_updated"] = cfg["last_updated"]
    result["config"]["weights_stale"] = cfg["weights_age_days"] > WEIGHTS_STALE_DAYS
    return result


async def compute_advance_decline(days: int = 30) -> dict:
    """
    Compute Advance-Decline ratio for Nifty 50 constituents.

    For each trading day in the last `days` days:
      - advance: stocks with close > prev_close
      - decline: stocks with close < prev_close
      - unchanged: stocks flat
      - a_d_ratio: advances / max(declines, 1)
      - breadth_pct: advances / total * 100
      - cumulative_ad_line: running sum of (advances - declines) — trend indicator

    Returns daily series + latest summary.
    """
    cfg = load_constituents()
    constituents = cfg["constituents"]
    cutoff = ist_now().date() - timedelta(days=days + 10)

    from app.db.database import get_ts_session
    from sqlalchemy import text

    # Load close prices for all constituents from DB
    symbols = [c["symbol"] for c in constituents]
    db_syms = [f"EQ_{s}" for s in symbols]

    async with get_ts_session() as session:
        r = await session.execute(
            text("""
                SELECT DATE(timestamp AT TIME ZONE 'Asia/Kolkata') AS date,
                       symbol,
                       close
                FROM candles
                WHERE symbol = ANY(:syms)
                  AND interval = '1day'
                  AND timestamp >= :cutoff
                ORDER BY date ASC
            """),
            {"syms": db_syms, "cutoff": cutoff},
        )
        rows = r.mappings().all()

    # Build {date: {symbol: close}}
    from collections import defaultdict
    date_sym_close: dict[str, dict[str, float]] = defaultdict(dict)
    for row in rows:
        d = str(row["date"])
        sym = str(row["symbol"]).replace("EQ_", "")
        date_sym_close[d][sym] = float(row["close"])

    all_dates = sorted(date_sym_close.keys())
    series = []
    cum_ad = 0

    for i, d in enumerate(all_dates):
        if i == 0:
            continue  # need prev day to compare
        prev = all_dates[i - 1]
        advances = 0
        declines = 0
        unchanged = 0
        for sym in symbols:
            cur = date_sym_close[d].get(sym)
            prv = date_sym_close[prev].get(sym)
            if cur is None or prv is None:
                continue
            if cur > prv:
                advances += 1
            elif cur < prv:
                declines += 1
            else:
                unchanged += 1
        total = advances + declines + unchanged
        cum_ad += (advances - declines)
        if total > 0:
            series.append({
                "date": d,
                "advances": advances,
                "declines": declines,
                "unchanged": unchanged,
                "total": total,
                "a_d_ratio": round(advances / max(declines, 1), 2),
                "breadth_pct": round(advances / total * 100, 1),
                "cum_ad_line": cum_ad,
            })

    # Trim to requested days
    series = series[-days:]

    # 5-day moving average of breadth_pct
    for i, s in enumerate(series):
        window = [series[j]["breadth_pct"] for j in range(max(0, i - 4), i + 1)]
        s["breadth_ma5"] = round(sum(window) / len(window), 1)

    latest = series[-1] if series else {}
    prev5 = series[-6:-1] if len(series) >= 6 else []
    avg5 = round(sum(s["breadth_pct"] for s in prev5) / len(prev5), 1) if prev5 else None

    return {
        "series": series,
        "latest": latest,
        "avg_breadth_5d": avg5,
        "trend": (
            "improving" if avg5 and latest.get("breadth_pct", 50) > avg5
            else "deteriorating" if avg5 and latest.get("breadth_pct", 50) < avg5
            else "stable"
        ),
        "data_points": len(series),
        "constituents_tracked": len(symbols),
    }
