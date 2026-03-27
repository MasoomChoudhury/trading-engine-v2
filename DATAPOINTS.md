# Nifty50 Analytics — Complete Datapoints Reference

> All data fields exposed across the platform: indicators, derived metrics, futures, options, breadth, and live data.

---

## 1. Technical Indicators

Computed from OHLCV candle data. Available at intervals: `1min`, `5min`, `15min`, `1hour`, `1day`.

| Field | Label | Description | Signal Logic |
|---|---|---|---|
| `rsi_14` | RSI (14) | Relative Strength Index, 14-period | >70 → overbought (bearish); <30 → oversold (bullish) |
| `ema_20` | EMA 20 | Exponential Moving Average, 20-period | Price > EMA → bullish; Price < EMA → bearish |
| `ema_21` | EMA 21 | Exponential Moving Average, 21-period | Alternative fast trend line |
| `ema_50` | EMA 50 | Exponential Moving Average, 50-period | Medium-term trend reference |
| `sma_200` | SMA 200 | Simple Moving Average, 200-period | Long-term trend; widely watched support/resistance |
| `macd_line` | MACD Line | 12-EMA minus 26-EMA | Momentum direction |
| `macd_signal` | MACD Signal | 9-period EMA of MACD line | Crossover with MACD line = signal |
| `macd_histogram` | MACD Histogram | MACD line minus signal line | >5 → bullish; <−5 → bearish |
| `bb_upper` | BB Upper | Bollinger Band upper (SMA20 + 2σ) | Price at upper = overbought |
| `bb_middle` | BB Middle | Bollinger Band middle (SMA20) | Mean reversion anchor |
| `bb_lower` | BB Lower | Bollinger Band lower (SMA20 − 2σ) | Price at lower = oversold |
| `bb_bandwidth` | BB Bandwidth | (Upper − Lower) / Middle | Volatility measure; squeeze precedes breakout |
| `supertrend` | Supertrend (7,3) | Dynamic support/resistance level | Trailing stop line |
| `supertrend_direction` | Supertrend Dir | `uptrend` or `downtrend` | uptrend → bullish; downtrend → bearish |
| `stoch_rsi_k` | Stoch RSI %K | Stochastic applied to RSI, %K line | >0.8 → extreme overbought; <0.2 → extreme oversold |
| `stoch_rsi_d` | Stoch RSI %D | 3-period SMA of Stoch RSI %K | Signal/confirmation line |
| `adx_14` | ADX (14) | Average Directional Index, trend strength | <20 → no trend; >40 → strong trend |
| `plus_di_14` | +DI (14) | Positive Directional Indicator | +DI > −DI → uptrend forming |
| `minus_di_14` | −DI (14) | Negative Directional Indicator | −DI > +DI → downtrend forming |
| `atr_14` | ATR (14) | Average True Range, 14-period (pts) | Higher → more volatility; used for stop sizing |
| `vwap` | VWAP | Volume Weighted Average Price (intraday) | Price > VWAP → bullish; Price < VWAP → bearish |

---

## 2. GEX — Gamma Exposure

Computed from live Nifty options chain. Reflects net dealer hedging pressure by strike.

| Field | Description | Signal Logic |
|---|---|---|
| `total_gex` | Sum of gamma exposure across all strikes (₹B) | >1B → positive gamma regime; <−1B → negative |
| `net_gex` | Net gamma (call GEX − put GEX) (₹B) | >100M → bullish structure; <−100M → bearish |
| `regime` | `positive_gex`, `negative_gex`, or `unknown` | Positive → low vol, mean reverting; Negative → high vol, trending |
| `regime_description` | Human-readable regime interpretation | Explains expected market behaviour |
| `zero_gamma_level` | Strike where net gamma = 0 | Inflection point; price tends to gravitate here |
| `call_wall` | Strike with maximum call gamma | Resistance; dealers short calls here and hedge by selling futures |
| `put_wall` | Strike with maximum put gamma | Support; dealers short puts here and hedge by buying futures |
| `call_wall_distance` | % distance of call wall above spot | e.g. +2.5% = call wall 2.5% above current price |
| `put_wall_distance` | % distance of put wall below spot | e.g. −2.1% = put wall 2.1% below current price |
| `pcr` (GEX) | OI-based Put-Call Ratio | >1.2 → put heavy (bearish); <0.7 → call heavy (bullish) |
| `spot_price` | Nifty spot price at time of calculation | Reference for all distance calculations |
| `expiry_date` | Active options expiry used | Which expiry the GEX is computed from |

**Per-strike fields (used in OI Wall chart)**

| Field | Description |
|---|---|
| `strike` | Strike price |
| `ce_oi` | Call open interest at this strike |
| `pe_oi` | Put open interest at this strike |
| `total_oi` | Combined CE + PE OI at this strike |

---

## 3. Derived Metrics

Intraday contextual metrics computed from 5-min candle data. Marked as approximations where tick-level data is unavailable.

| Field | Label | Description | Signal Logic |
|---|---|---|---|
| `cpr_status` | CPR Status | Position vs Central Pivot Range | `above_cpr` → bullish; `below_cpr` → bearish |
| `cpr_width` | CPR Width | Width of CPR in points (approx) | Narrow CPR = tight range day expected |
| `vwap_status` | VWAP Status | Price position vs intraday VWAP | `above_vwap` → bullish; `below_vwap` → bearish |
| `vwap_value` | VWAP | True VWAP price level (approx) | Dynamic support/resistance |
| `vwap_context` | VWAP Context | e.g. "Premium", "Discount" | Interpretation of gap from VWAP |
| `opening_range_status` | Opening Range | Position vs first 15-min range (approx) | `above_or` → bullish breakout; `below_or` → bearish |
| `momentum_burst_type` | Momentum Burst | Sudden acceleration type | `bullish_burst` / `bearish_burst` / `neutral` |
| `gap_status` | Gap Analysis | Today's open vs previous close | `gap_up` → bullish open; `gap_down` → bearish open |
| `day_phase` | Day Phase | Time-of-day classification | `early` / `mid` / `late` — context for intraday expectations |
| `pcr` (derived) | PCR | Options-based Put-Call ratio | >1 → more puts; <0.7 → more calls |
| `volume_profile_poc` | Volume Profile | Point of Control (highest volume price, approx) | Key support/resistance by volume |
| `swing_high` | Swing High | Recent swing high price (approx) | Previous resistance level |
| `swing_low` | Swing Low | Recent swing low price (approx) | Previous support level |

---

## 4. Futures Volume Analytics

Daily data for near-month and far-month Nifty futures contracts. Last 60 trading days used in charts.

### Summary Stats

| Field | Description | Signal Logic |
|---|---|---|
| `avg_daily_volume` | Average combined daily volume (60d) | Baseline for z-score |
| `current_rollover_pct` | Far-month % of combined volume today | >20% → active rollover; typical 10–15% |
| `avg_rollover_pct_10d` | 10-day average rollover % | Comparison baseline |
| `current_near_oi` | Open interest in near-month contract | Rising → accumulation; falling → expiry closeout |
| `volume_spike_count` | Days with z-score >2σ in dataset | >3 → elevated activity |
| `total_days` | Trading days in dataset | Data completeness |
| `near_expiry` | Near-month expiry date | Current active contract |
| `far_expiry` | Far-month expiry date | Next active contract |

### Per-Day Chart Data

| Field | Description | Signal Logic |
|---|---|---|
| `date` | Trading date | X-axis |
| `near_volume` | Volume in near-month futures | Declining pre-expiry = rollover starting |
| `far_volume` | Volume in far-month futures | Rising = traders rolling forward |
| `combined_volume` | `near_volume + far_volume` | Total daily activity |
| `rollover_pct` | `(far_vol / combined) × 100` | Rising trend = rollover phase underway |
| `near_oi` | Open interest, near-month | Declining = expiry closeouts |
| `far_oi` | Open interest, far-month | Rising = accumulation next cycle |
| `near_close` | Near-month contract price | Contract value reference |
| `far_close` | Far-month contract price | Contract value reference |
| `volume_zscore` | Rolling 20-day z-score of combined volume | >2 → spike (red); 0–2 → above avg (green); <0 → below avg (orange); <−2 → negative spike (blue) |
| `is_expiry_week` | Flag: week of contract expiry | Used to shade charts; affects interpretation |

---

## 5. Options OI & Sentiment

### Current Snapshot

| Field | Description | Signal Logic |
|---|---|---|
| `pcr_oi` | Put-Call Ratio (OI-based) | >1.2 → bearish; 0.7–1.2 → balanced; <0.7 → bullish |
| `pcr_vol` | Put-Call Ratio (volume-based) | Faster signal than OI PCR |
| `pcr_oi_prev` | Previous day's OI PCR | Direction: rising → more put buying |
| `straddle_premium` | ATM CE + PE premium (₹) | Implied move proxy; higher = larger expected range |
| `atm_ce_vol` | ATM call volume today | >PE vol → call buying pressure |
| `atm_pe_vol` | ATM put volume today | >CE vol → put buying / hedging |
| `oi_wall_strike` | Strike with peak total OI | Max resistance/support level |
| `max_pain` | Strike where total option loss is minimised | Price gravitates here into expiry |
| `active_expiry` | Expiry in use | Near-month unless DTE ≤ 3 |
| `spot_price` | Nifty spot at snapshot time | ATM calculation reference |
| `atm_strike` | At-The-Money strike (rounded to 50) | Centre of options analysis |
| `days_to_expiry` | Days until expiry | <3 → expiry week; >7 → normal |
| `is_expiry_week` | True when DTE ≤ 5 | PCR unreliable; trust volume PCR only |
| `use_next_expiry` | True if switched to next expiry | Near expiry nearly illiquid |

### Historical PCR Trend (per day)

| Field | Description | Signal Logic |
|---|---|---|
| `pcr_oi` | OI-based PCR on this date | Trend direction matters more than absolute value |
| `pcr_vol` | Volume-based PCR on this date | Faster signal |
| `pcr_oi_ema10` | 10-day EMA of PCR OI | Smoothed trend; crossovers = sentiment shift |
| `ce_straddle_vol` | ATM call volume on date | |
| `pe_straddle_vol` | ATM put volume on date | |
| `total_straddle_vol` | `ce_vol + pe_vol` | Total hedging/straddle activity |
| `straddle_ma20` | 20-day MA of straddle volume | >1.5× baseline → elevated hedging |
| `is_expiry_week` | Expiry week flag | Unreliable PCR signal |

### OI Wall (ATM ± 500 pts, all strikes)

| Field | Description |
|---|---|
| `strike` | Strike price |
| `ce_oi` | Call OI at this strike |
| `pe_oi` | Put OI at this strike |
| `total_oi` | Combined OI — peak = OI wall |

### Today's OI Change (ATM ± 500 pts)

| Field | Description | Signal Logic |
|---|---|---|
| `strike` | Strike price | |
| `ce_change` | CE OI change vs prev close | +ve → call accumulation; −ve → call unwinding |
| `pe_change` | PE OI change vs prev close | +ve → put accumulation; −ve → put unwinding |

### OI Change Heatmap (ATM ± 10 strikes, last N days)

| Field | Description | Signal Logic |
|---|---|---|
| `strike` | Strike price (row) | |
| `ce_changes` | Array of daily CE OI changes | Green cell = OI addition; red cell = OI reduction |
| `pe_changes` | Array of daily PE OI changes | Green cell = OI addition; red cell = OI reduction |

---

## 6. Breadth — Constituent Participation

Analysis of all 50 Nifty constituent stocks. Computed daily at 16:00 IST from 90-day historical candles.

### Summary Stats

| Field | Description | Signal Logic |
|---|---|---|
| `breadth_pct` | % of 50 stocks above their own 20d avg volume | >65% → broad (bullish); <40% → narrow (bearish) |
| `hw_share_pct` | Top 5 stocks' share of total volume | >55% → heavyweight-driven (fragile); <35% → broad (strong) |
| `conviction` | Move classification | `Broad` / `Narrow` / `Heavyweight-driven` |
| `top_sector` | Sector with highest volume today | Which sector led |
| `top_sector_pct` | Top sector's % of total volume | >40% → high concentration warning |
| `high_vol_count` | Stocks at 52-week volume high today | >5 → broad accumulation signal |
| `nifty_chg_pct` | Nifty index % change today | Direction context |

### Alerts (auto-generated)

| Field | Description |
|---|---|
| `type` | `warning` or `info` |
| `msg` | Triggered condition, e.g. "HW share > 60% — narrow move" |

### Volume Series (per day, last 90 days)

| Field | Description | Signal Logic |
|---|---|---|
| `date` | Trading date | |
| `weighted_vol` | Index-weight-adjusted constituent volume | Normalised by each stock's weight |
| `vol_ma20` | 20-day MA of weighted volume | Baseline for divergence |
| `nifty_close` | Nifty closing price | Price reference |
| `nifty_chg_pct` | Nifty % change | Move size |
| `futures_vol` | Nifty futures combined volume | Comparison overlay |
| `divergence` | Volume-price divergence type | `Confirmed breakout` / `Low conviction rally` / `HiVol sell` / `null` |

### Breadth Series (per day, last 90 days)

| Field | Description | Signal Logic |
|---|---|---|
| `date` | Trading date | |
| `breadth_pct` | % of stocks above MA on this date | >70% band = broad; <40% band = narrow |
| `hw_share_pct` | HW volume share on this date | Trend in concentration |
| `annotation` | Special inflection event | e.g. `Broad inflection`, `HW shift` |

### Sector Rotation Series (per day, per sector)

Each date has one column per sector representing that sector's **% of total Nifty constituent volume** that day. All sectors sum to 100%.

| Sector | Colour |
|---|---|
| Financials | Blue |
| IT | Purple |
| Energy | Orange |
| Auto | Cyan |
| Consumer | Amber |
| Pharma | Green |
| Infra | Indigo |
| Telecom | Pink |
| Metals | Slate |
| Other | Grey |

### Constituent Heatmap (per stock × last 20 days)

| Field | Description | Signal Logic |
|---|---|---|
| `symbol` | NSE ticker | Row identifier |
| `name` | Company name | Display |
| `sector` | Sector grouping | Row grouping |
| `weight` | Index weight (%) | Contribution to index |
| `is_hw` | Heavyweight flag (top 5) | Yellow highlight |
| `zscores` | Array of 20-day volume z-scores | >2 → very high vol (deep green); <−2 → very low vol (deep red) |

### Heavyweight Isolation (top 5 stocks, today only)

| Field | Description | Signal Logic |
|---|---|---|
| `symbol` | NSE ticker (HDFCBANK, RELIANCE, ICICIBANK, INFY, TCS) | |
| `volume` | Today's volume | |
| `ma20` | 20-day average volume | Baseline |
| `pct_vs_ma` | (volume − ma20) / ma20 × 100 | +ve (green) → above avg; −ve (red) → below avg |
| `weight` | Index weight (%) | |
| `above_ma` | Boolean flag | Drives colour coding |

---

## 7. Live Price

Delivered via WebSocket (`/ws/live`) with REST fallback (`/api/nifty/live-price`).

| Field | Description |
|---|---|
| `ltp` | Last Traded Price (₹) |
| `change` | Absolute change from previous close (pts) |
| `change_pct` | Percentage change from previous close |
| `cp` | Previous close price |
| `ltt` | Last trade timestamp |

---

## 8. OHLCV Candle Data

Base data for all indicator calculations. Stored in TimescaleDB `candles` table.

| Field | Description |
|---|---|
| `timestamp` | Candle open time (ISO 8601, IST) |
| `open` | Opening price |
| `high` | Highest price in candle |
| `low` | Lowest price in candle |
| `close` | Closing price |
| `volume` | Contracts traded |
| `oi` | Open interest (futures candles only) |

Instruments stored: `NIFTY_INDEX` (spot), `NSE_FO|51714` (near-month futures), `NSE_FO|51715` (far-month), `EQ_<SYMBOL>` (each of 50 constituents).

---

## 9. Market Status

| Field | Description |
|---|---|
| `is_market_open` | True during NSE trading hours (09:15–15:30 IST) |
| `is_holiday` | True if today is an NSE holiday |
| `holiday_description` | Holiday name if applicable |
| `nse_status` | Official NSE status string |
| `next_holiday` | Date of next NSE market holiday |
| `next_holiday_desc` | Name of next holiday |
| `last_updated` | Timestamp of last status check |
| `message` | Human-readable status summary |

---

## Summary

| Section | Datapoints | Refresh Cadence |
|---|---|---|
| Technical Indicators | 21 fields | Every 5 min (scheduler) |
| GEX | 12 fields + per-strike | On request (live options chain) |
| Derived Metrics | 13 fields | Every 5 min |
| Futures Volume | 10 summary + 10 per-day | Every 5 min |
| Options OI — Snapshot | 14 fields | Every 5 min |
| Options OI — Historical | 8 fields × N days | EOD snapshot at 15:40 IST |
| Options OI — OI Wall | 4 fields × ~20 strikes | Every 5 min |
| Options OI — Heatmap | 2 arrays × 21 strikes × N days | EOD only |
| Breadth — Summary | 7 fields | EOD at 16:00 IST |
| Breadth — Volume Series | 7 fields × 90 days | EOD at 16:00 IST |
| Breadth — Breadth Series | 4 fields × 90 days | EOD at 16:00 IST |
| Breadth — Sector Rotation | 10 sectors × 90 days | EOD at 16:00 IST |
| Breadth — Heatmap | 6 fields × 50 stocks × 20 days | EOD at 16:00 IST |
| Breadth — Heavyweight | 6 fields × 5 stocks | EOD at 16:00 IST |
| Live Price | 5 fields | Real-time WebSocket / 15s REST |
| OHLCV Candles | 7 fields | Streamed / 5-min batch |
| Market Status | 8 fields | Every 30s |
| **Total** | **~200+ datapoints** | |
