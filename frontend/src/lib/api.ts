const API_BASE = '/api';

async function fetcher<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Health ────────────────────────────────────────────────────────────────
export interface Health {
  status: string;
  timestamp: string;
  database: string;
  websocket: string;
}
export const getHealth = () => fetcher<Health>('/v1/admin/health');

// ─── Market Status ────────────────────────────────────────────────────────
export interface TodayMarketStatus {
  is_holiday: boolean;
  holiday_description: string | null;
  is_market_open: boolean;
  nse_status: string | null;
  last_updated: string | null;
  next_holiday: string | null;
  next_holiday_desc: string | null;
  message: string;
}
export const getTodayMarketStatus = () => fetcher<TodayMarketStatus>('/v1/auth/market-status');

// ─── Live Price ────────────────────────────────────────────────────────────
export interface LivePrice {
  symbol: string;
  ltp: number;
  change: number;
  change_pct: number;
  ltt?: string;
  cp?: number;
}
export const getLivePrice = () => fetcher<LivePrice>('/v1/nifty50/price');

// ─── Indicators ────────────────────────────────────────────────────────────
export interface IndicatorResponse {
  timestamp: string;
  symbol: string;
  indicators: Record<string, number | Record<string, unknown>>;
  spot_price?: number;
  approximation_note?: string;
}
export const getIndicators = (interval = '5min') =>
  fetcher<IndicatorResponse>(`/v1/nifty50/indicators?interval=${interval}`);

// ─── Derived Metrics ───────────────────────────────────────────────────────
export interface DerivedMetricsResponse {
  timestamp: string;
  symbol: string;
  spot_price: number;
  metrics: Record<string, unknown>;
  approximation_note?: string;
}
export const getDerivedMetrics = (interval = '5min') =>
  fetcher<DerivedMetricsResponse>(`/v1/nifty50/derived-metrics?interval=${interval}`);

// ─── GEX ──────────────────────────────────────────────────────────────────
export interface StrikeGEX {
  strike: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
}
export interface GEX {
  timestamp: string;
  expiry_date: string;
  spot_price: number;
  total_gex: number;
  net_gex: number;
  regime: string;
  regime_description: string;
  zero_gamma_level: number;
  call_wall: number;
  put_wall: number;
  pcr: number;
  strike_gex: StrikeGEX[];
  call_wall_distance: number;
  put_wall_distance: number;
}
export const getGEX = (expiry_date?: string) =>
  fetcher<GEX>(`/v1/nifty50/gex${expiry_date ? `?expiry_date=${expiry_date}` : ''}`);

// ─── Candles ───────────────────────────────────────────────────────────────
export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}
export const getCandles = (interval = '5min', limit = 100) =>
  fetcher<Candle[]>(`/v1/nifty50/candles?interval=${interval}&limit=${limit}`);

// ─── API Logs ───────────────────────────────────────────────────────────────
export interface ApiLogEntry {
  id: number;
  timestamp: string;
  endpoint: string;
  method: string;
  request_params?: Record<string, unknown>;
  response_status?: number;
  duration_ms?: number;
  error?: string;
}
export interface ApiLogResponse {
  total: number;
  page: number;
  page_size: number;
  entries: ApiLogEntry[];
}
export const getApiLogs = (params: {
  page?: number;
  page_size?: number;
  endpoint?: string;
  method?: string;
  status?: number;
  hours?: number;
}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  return fetcher<ApiLogResponse>(`/v1/logs/api?${qs}`);
};

// ─── Market Status ─────────────────────────────────────────────────────────
export interface MarketStatus {
  status: string;
  segment: string;
  timestamp: string;
}
export const getMarketStatus = (hours = 24) =>
  fetcher<MarketStatus[]>(`/v1/logs/market-status?hours=${hours}`);

// ─── Admin Refresh ─────────────────────────────────────────────────────────
export interface RefreshResult {
  status: string;
  message: string;
  candles_fetched: number;
  indicators_calculated: number;
  gex_calculated: boolean;
  derived_calculated: number;
}
export const triggerRefresh = () =>
  fetcher<RefreshResult>('/v1/admin/refresh', { method: 'POST' });

// ─── Indicator Series ───────────────────────────────────────────────────────
export interface IndicatorRow {
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  rsi_14: number | null;
  ema_20: number | null;
  ema_21: number | null;
  ema_50: number | null;
  sma_200: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_middle: number | null;
  bb_lower: number | null;
  bb_bandwidth: number | null;
  supertrend: number | null;
  supertrend_dir: string | null;
  stoch_k: number | null;
  stoch_d: number | null;
  adx: number | null;
  plus_di: number | null;
  minus_di: number | null;
  atr_14: number | null;
  vwap: number | null;
}
export const getIndicatorSeries = (interval = '5min', limit = 100) =>
  fetcher<IndicatorRow[]>(`/v1/nifty50/indicator-series?interval=${interval}&limit=${limit}`);

// ─── Auth Token Request ─────────────────────────────────────────────────────
export interface TokenRequestResult {
  message: string;
  authorization_expiry?: string;
  notifier_url?: string;
}
export const requestToken = () =>
  fetcher<TokenRequestResult>('/v1/auth/request-token', { method: 'POST' });

// ─── Futures Volume ─────────────────────────────────────────────────────────
export interface FuturesChartRow {
  date: string;
  near_volume: number;
  far_volume: number;
  combined_volume: number;
  rollover_pct: number;
  near_oi: number;
  far_oi: number;
  near_close: number | null;
  far_close: number | null;
  is_expiry_week: boolean;
  volume_zscore: number | null;
}

export interface FuturesSummary {
  avg_daily_volume: number;
  volume_spike_count: number;
  current_rollover_pct: number;
  avg_rollover_pct_10d: number;
  current_near_oi: number;
  total_days: number;
}

export interface FuturesVolumeData {
  chart_data: FuturesChartRow[];
  near_expiry: string;
  far_expiry: string;
  near_lot_size: number;
  summary: FuturesSummary;
}

export const getFuturesVolume = () =>
  fetcher<FuturesVolumeData>('/v1/futures/volume');

// ─── Options OI & Sentiment ──────────────────────────────────────────────────
export interface OptionsCurrent {
  expiry: string;
  near_expiry: string;
  next_expiry: string | null;
  active_expiry: string;
  use_next_expiry: boolean;
  spot_price: number;
  atm_strike: number;
  days_to_expiry: number;
  is_expiry_week: boolean;
  pcr_oi: number;
  pcr_vol: number;
  pcr_oi_prev: number | null;
  straddle_premium: number;
  atm_ce_vol: number;
  atm_pe_vol: number;
  oi_wall_strike: number;
  max_pain: number;
}

export interface PcrHistoryRow {
  date: string;
  pcr_oi: number;
  pcr_vol: number;
  pcr_oi_ema10: number | null;
  atm_strike: number;
  ce_straddle_vol: number;
  pe_straddle_vol: number;
  total_straddle_vol: number;
  straddle_ma20: number | null;
  spot_price: number;
  is_expiry_week: boolean;
}

export interface OiWallRow {
  strike: number;
  ce_oi: number;
  pe_oi: number;
  total_oi: number;
}

export interface OiChangeRow {
  strike: number;
  ce_change: number;
  pe_change: number;
}

export interface OiHeatmap {
  dates: string[];
  strikes: number[];
  rows: { strike: number; ce_changes: number[]; pe_changes: number[] }[];
}

export interface OptionsAnalytics {
  current: OptionsCurrent;
  pcr_history: PcrHistoryRow[];
  oi_wall: OiWallRow[];
  oi_change_today: OiChangeRow[];
  oi_heatmap: OiHeatmap;
}

export const getOptionsAnalytics = (expiry?: string) =>
  fetcher<OptionsAnalytics>(
    `/v1/options/analytics${expiry ? `?expiry=${expiry}` : ''}`
  );

// ─── Breadth / Constituent Analysis ─────────────────────────────────────────
export interface BreadthSummary {
  breadth_pct: number;
  hw_share_pct: number;
  conviction: 'Broad' | 'Narrow' | 'Heavyweight-driven';
  top_sector: string;
  top_sector_pct: number;
  high_vol_count: number;
  nifty_chg_pct: number;
}

export interface BreadthAlert { type: 'warning' | 'info'; msg: string; }

export interface VolumeSeriesRow {
  date: string;
  weighted_vol: number;
  vol_ma20: number | null;
  nifty_close: number;
  nifty_chg_pct: number;
  futures_vol: number;
  divergence: string | null;
}

export interface BreadthSeriesRow {
  date: string;
  breadth_pct: number;
  hw_share_pct: number;
  annotation: string | null;
}

export interface SectorSeriesRow {
  date: string;
  [sector: string]: number | string;
}

export interface HeatmapRow {
  symbol: string;
  name: string;
  sector: string;
  weight: number;
  is_hw: boolean;
  zscores: number[];
}

export interface HeavyweightRow {
  symbol: string;
  name: string;
  volume: number;
  ma20: number;
  pct_vs_ma: number;
  weight: number;
  above_ma: boolean;
}

export interface BreadthAnalytics {
  status?: string;
  symbols_ready?: number;
  total?: number;
  message?: string;
  config?: { last_updated: string; weights_age_days?: number; n_constituents: number };
  summary: BreadthSummary;
  alerts: BreadthAlert[];
  volume_series: VolumeSeriesRow[];
  breadth_series: BreadthSeriesRow[];
  sector_series: SectorSeriesRow[];
  heatmap: { dates: string[]; rows: HeatmapRow[] };
  heavyweight_today: HeavyweightRow[];
}

export const getBreadthAnalytics = () =>
  fetcher<BreadthAnalytics>('/v1/breadth/analytics');

// ─── Sector Relative Strength ─────────────────────────────────────────────────
export type RsSignal = 'outperforming' | 'fading_leader' | 'underperforming' | 'recovering' | 'neutral';

export interface SectorRsPoint {
  date: string;
  nifty50: number;
  financials_wap: number;
  it_wap: number;
  financials_rs: number;
  it_rs: number;
}

export interface SectorRsCurrent {
  date: string;
  nifty50: number;
  financials_wap: number;
  it_wap: number;
  financials_rs: number;
  it_rs: number;
  financials_5d_slope: number;
  it_5d_slope: number;
  nifty_today_pct: number;
  fin_today_pct: number;
  it_today_pct: number;
  fin_rel_today: number;
  it_rel_today: number;
  financials_signal: RsSignal;
  it_signal: RsSignal;
}

export interface SectorRS {
  days: number;
  base_date: string;
  series: SectorRsPoint[];
  current: SectorRsCurrent;
  market_note: string;
  timestamp: string;
  error?: string;
}

export const getSectorRS = (days = 60) =>
  fetcher<SectorRS>(`/v1/breadth/sector-rs?days=${days}`);

export const triggerBreadthRefresh = () =>
  fetcher<{ status: string; message: string }>('/v1/breadth/refresh', { method: 'POST' });

// ─── Macro Calendar ──────────────────────────────────────────────────────────
export interface MacroEvent {
  id: number;
  event_date: string;
  event_type: 'rbi_mpc' | 'fomc' | 'us_cpi' | 'earnings' | 'custom';
  title: string;
  description: string;
  is_approximate: boolean;
  days_to_event: number;
  is_past: boolean;
  is_today: boolean;
}

export interface MacroCalendar {
  today: MacroEvent[];
  upcoming: MacroEvent[];
  past: MacroEvent[];
  next_event: MacroEvent | null;
  total: number;
}

export const getMacroCalendar = (days_back = 14, days_forward = 90) =>
  fetcher<MacroCalendar>(`/v1/macro/events?days_back=${days_back}&days_forward=${days_forward}`);

export const addMacroEvent = (body: {
  event_date: string; event_type: string; title: string;
  description?: string; is_approximate?: boolean;
}) => fetcher<{ id: number }>('/v1/macro/events', { method: 'POST', body: JSON.stringify(body) });

// ─── BankNifty Analytics ─────────────────────────────────────────────────────
export interface BankNiftyStrikeBar {
  strike: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
}

export interface BankNiftyAnalytics {
  timestamp: string;
  expiry_date: string;
  spot_price: number;
  lot_size: number;
  total_gex: number;
  net_gex: number;
  regime: string;
  regime_description: string;
  commentary: string;
  zero_gamma_level: number;
  zero_gamma_pct: number;
  call_wall: number;
  call_wall_pct: number;
  put_wall: number;
  put_wall_pct: number;
  pcr_oi: number;
  pcr_volume: number;
  above_zero_gamma: boolean;
  strike_chart: BankNiftyStrikeBar[];
}

export const getBankNiftyAnalytics = () =>
  fetcher<BankNiftyAnalytics>('/v1/banknifty/analytics');

// ─── GEX History ─────────────────────────────────────────────────────────────
export interface GEXHistoryRow {
  date: string;
  total_gex: number | null;
  net_gex: number | null;
  spot_price: number | null;
  zero_gamma_level: number | null;
}

export interface GEXHistory {
  history: GEXHistoryRow[];
  current_gex: number | null;
  percentile_rank: number | null;
  percentile_label: string | null;
  days: number;
  data_points: number;
}

export const getGEXHistory = (days = 90) =>
  fetcher<GEXHistory>(`/v1/nifty50/gex-history?days=${days}`);

// ─── IV Skew ──────────────────────────────────────────────────────────────────
export interface IVSmilePoint {
  strike: number;
  call_iv: number | null;
  put_iv: number | null;
  call_delta: number;
  put_delta: number;
}

export interface IVSkew {
  timestamp: string;
  expiry_date: string;
  spot_price: number;
  smile: IVSmilePoint[];
  atm_iv: number | null;
  call_25d_iv: number | null;
  put_25d_iv: number | null;
  call_10d_iv: number | null;
  put_10d_iv: number | null;
  rr25: number | null;
  fly25: number | null;
  rr10: number | null;
  skew_direction: 'put_skew' | 'call_skew' | 'neutral';
  skew_note: string;
}

export const getIVSkew = (expiry?: string) =>
  fetcher<IVSkew>(`/v1/options/iv-skew${expiry ? `?expiry=${expiry}` : ''}`);

// ─── OI Trend ─────────────────────────────────────────────────────────────────
export interface OITrendStrike {
  strike: number;
  is_atm: boolean;
  ce_oi: number[];
  pe_oi: number[];
  ce_change: number;
  pe_change: number;
  ce_status: 'build' | 'unwind' | 'flat' | 'no_data';
  pe_status: 'build' | 'unwind' | 'flat' | 'no_data';
}

export interface OITrend {
  expiry: string;
  spot_price: number;
  atm_strike: number;
  dates: string[];
  series: OITrendStrike[];
}

export const getOITrend = (expiry?: string, days = 10) =>
  fetcher<OITrend>(`/v1/options/oi-trend?days=${days}${expiry ? `&expiry=${expiry}` : ''}`);

// ─── Option Greeks / Buyer's Toolkit ─────────────────────────────────────────
export type EdgeLabel = 'strong' | 'edge' | 'tight' | 'no_edge' | 'no_data';

export interface ChainGreeksRow {
  strike: number;
  is_atm: boolean;
  ce_ltp: number;
  pe_ltp: number;
  ce_volume: number;
  pe_volume: number;
  ce_oi: number;
  pe_oi: number;
  ce_iv: number | null;
  pe_iv: number | null;
  ce_delta: number | null;
  pe_delta: number | null;
  ce_theta: number | null;
  pe_theta: number | null;
  ce_vega: number | null;
  pe_vega: number | null;
  ce_gamma: number | null;
  pe_gamma: number | null;
  ce_buyers_edge: number | null;
  pe_buyers_edge: number | null;
  ce_edge_label: EdgeLabel;
  pe_edge_label: EdgeLabel;
}

export interface DteCurvePoint {
  dte: number;
  theta_per_day: number;
  is_current: boolean;
  zone: 'danger' | 'warning' | 'caution' | 'normal';
}

export interface AtmSummary {
  strike: number;
  ce_ltp: number | null;
  pe_ltp: number | null;
  ce_iv: number | null;
  pe_iv: number | null;
  ce_delta: number | null;
  pe_delta: number | null;
  ce_theta: number | null;
  pe_theta: number | null;
  ce_vega: number | null;
  pe_vega: number | null;
  ce_buyers_edge: number | null;
  pe_buyers_edge: number | null;
  ce_edge_label: EdgeLabel;
  pe_edge_label: EdgeLabel;
}

export interface BuyersEdgeData {
  expiry: string;
  spot: number;
  atm_strike: number;
  dte: number;
  dte_note: string;
  atr_14: number | null;
  atm: AtmSummary | null;
  chain: ChainGreeksRow[];
  decay_curve: DteCurvePoint[];
  timestamp: string;
}

export const getBuyersEdge = (expiry?: string) =>
  fetcher<BuyersEdgeData>(`/v1/options/buyers-edge${expiry ? `?expiry=${expiry}` : ''}`);

// ─── Intraday Momentum Proxies ────────────────────────────────────────────────
export interface VolIndicatorPoint {
  timestamp: string;
  close: number;
  volume: number;
  vrsi: number | null;
  vwmacd: number | null;
  vwmacd_signal: number | null;
  vwmacd_hist: number | null;
}

export type VolSignal =
  | 'bullish_confirmed' | 'bullish_unconfirmed'
  | 'bearish_confirmed' | 'bearish_unconfirmed'
  | 'neutral' | 'mixed' | 'no_data' | 'insufficient_data';

export interface VolIndicators {
  series: VolIndicatorPoint[];
  interval: string;
  current: VolIndicatorPoint | null;
  signal: VolSignal;
  price_only_mode?: boolean;
  price_only_note?: string | null;
  timestamp: string;
}

export interface StraddlePoint {
  timestamp: string;
  spot: number | null;
  atm_strike: number | null;
  ce_ltp: number | null;
  pe_ltp: number | null;
  straddle_price: number | null;
  atm_iv: number | null;
}

export interface StraddleIntraday {
  snapshots: StraddlePoint[];
  count: number;
  decay_signal: 'iv_crush_warning' | 'iv_expansion' | 'normal' | 'no_data';
  note: string;
  timestamp: string;
}

export type PcrBias = 'bullish' | 'bearish' | 'neutral';
export type PcrDivergenceSignal =
  | 'counter_trend_bounce' | 'short_term_pullback'
  | 'aligned_bullish' | 'aligned_bearish' | 'neutral';

export interface PcrDivergence {
  near_expiry: string;
  monthly_expiry: string;
  near_pcr_oi: number;
  near_pcr_vol: number;
  near_bias: PcrBias;
  monthly_pcr_oi: number;
  monthly_pcr_vol: number;
  monthly_bias: PcrBias;
  divergence: boolean;
  signal: PcrDivergenceSignal;
  note: string;
  timestamp: string;
}

export const getVolIndicators = (interval = '5min', limit = 100) =>
  fetcher<VolIndicators>(`/v1/options/vol-indicators?interval=${interval}&limit=${limit}`);

export const getStraddleIntraday = () =>
  fetcher<StraddleIntraday>('/v1/options/straddle-intraday');

export const getPcrDivergence = () =>
  fetcher<PcrDivergence>('/v1/options/pcr-divergence');

// ─── FII/DII Flows ───────────────────────────────────────────────────────────
export interface FIIFlowDay {
  date: string;
  fii_buy: number;
  fii_sell: number;
  fii_net: number;
  dii_buy: number;
  dii_sell: number;
  dii_net: number;
  combined_net: number;
  cum_fii: number;
  cum_dii: number;
}

export interface FIIFlows {
  series: FIIFlowDay[];
  latest_date: string | null;
  latest_fii_net: number | null;
  latest_dii_net: number | null;
  fii_5d_net: number | null;
  dii_5d_net: number | null;
  fii_trend: 'buying' | 'selling';
  dii_trend: 'buying' | 'selling';
  data_points: number;
  unit: string;
  note: string;
}

export const getFIIFlows = (days = 30, refresh = false) =>
  fetcher<FIIFlows>(`/v1/macro/fii-flows?days=${days}${refresh ? '&refresh=true' : ''}`);

// ─── Advance-Decline ──────────────────────────────────────────────────────────
export interface ADRow {
  date: string;
  advances: number;
  declines: number;
  unchanged: number;
  total: number;
  a_d_ratio: number;
  breadth_pct: number;
  breadth_ma5: number;
  cum_ad_line: number;
}

export interface AdvanceDecline {
  series: ADRow[];
  latest: ADRow | Record<string, never>;
  avg_breadth_5d: number | null;
  trend: 'improving' | 'deteriorating' | 'stable';
  data_points: number;
  constituents_tracked: number;
}

export const getAdvanceDecline = (days = 30) =>
  fetcher<AdvanceDecline>(`/v1/breadth/advance-decline?days=${days}`);

// ─── Market Depth ─────────────────────────────────────────────────────────────
export interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface MarketDepth {
  timestamp: string;
  symbol: string;
  ltp: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  total_bid_qty: number;
  total_ask_qty: number;
  bid_ask_ratio: number;
  buy_pressure_pct: number;
  spread: number | null;
  spread_pct: number | null;
}

export const getMarketDepth = () =>
  fetcher<MarketDepth>('/v1/nifty50/depth');

// ─── India VIX ────────────────────────────────────────────────────────────────
export interface IndiaVIX {
  vix: number;
  vix_prev_close: number;
  vix_change: number;
  vix_change_pct: number;
  vix_high: number;
  vix_low: number;
  vix_52w_high: number;
  vix_52w_low: number;
  vix_1w_ago: number | null;
  vix_1m_ago: number | null;
  vix_percentile: number;
  regime: 'extreme_fear' | 'fear' | 'caution' | 'calm';
  regime_note: string;
  hv20: number | null;
  iv_rv_ratio: number | null;
  timestamp: string;
}
export const getIndiaVIX = () => fetcher<IndiaVIX>('/v1/nifty50/vix');

// ─── Global Cues ──────────────────────────────────────────────────────────────
export interface GlobalCueItem {
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  high: number | null;
  low: number | null;
  name: string;
}

export interface UsdInrTrend {
  trend: 'depreciating' | 'appreciating' | 'sideways' | 'unknown';
  severity?: string;
  intraday_chg_pct: number | null;
  open?: number;
  current?: number;
  slope_per_candle?: number;
  candles?: number;
  note?: string;
}

export interface EmHeadwind {
  signal: 'strong_headwind' | 'headwind' | 'neutral' | 'mild_tailwind' | 'tailwind';
  score: number;
  reasons: string[];
}

export interface GlobalCues {
  dow: GlobalCueItem;
  nasdaq: GlobalCueItem;
  sp500: GlobalCueItem;
  nikkei: GlobalCueItem;
  hang_seng: GlobalCueItem;
  usd_inr: GlobalCueItem;
  dxy: GlobalCueItem;
  us10y: GlobalCueItem;
  usd_inr_trend: UsdInrTrend;
  em_headwind: EmHeadwind;
  gift_nifty: { price: null; note: string };
  sentiment: 'bullish' | 'bearish' | 'mixed';
  timestamp: string;
}
export const getGlobalCues = () => fetcher<GlobalCues>('/v1/macro/global-cues');

// ─── Pre-market Bias ──────────────────────────────────────────────────────────
export type BiasSignalSentiment = 'bullish' | 'mild_bullish' | 'neutral' | 'mild_bearish' | 'bearish';

export interface BiasSignal {
  key: string;
  label: string;
  value: string;
  sentiment: BiasSignalSentiment;
  note: string;
}

export interface GiftNiftyProxy {
  ltp: number | null;
  prev_close: number | null;
  spot: number | null;
  gap_pct: number | null;
  basis_pct: number | null;
  expiry: string;
  note: string;
}

export interface PreMarketBias {
  bias: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  score: number;
  signals: BiasSignal[];
  global_cues: GlobalCues;
  gift_nifty: GiftNiftyProxy;
  fii_cash: {
    fii_net: number | null;
    dii_net: number | null;
    combined_net: number | null;
    date: string | null;
    fii_5d_net: number | null;
    fii_trend: string | null;
  };
  fii_deriv: {
    index_fut_net: number | null;
    total_options_net: number | null;
    net_position: 'net_long' | 'net_short' | 'unknown';
    date: string | null;
  };
  timestamp: string;
}

export const getPreMarketBias = () => fetcher<PreMarketBias>('/v1/macro/premarket-bias');

// ─── FII Derivatives ──────────────────────────────────────────────────────────
export interface FIIDerivRow {
  trade_date: string;
  future_index_long: number;
  future_index_short: number;
  future_index_net: number;
  option_index_calls_long: number;
  option_index_calls_short: number;
  option_index_puts_long: number;
  option_index_puts_short: number;
}
export interface FIIDerivatives {
  series: FIIDerivRow[];
  latest: FIIDerivRow | null;
  net_position: 'net_long' | 'net_short' | 'unknown';
  latest_date: string | null;
  index_fut_net: number | null;
  total_options_net: number | null;
  note: string;
}
export const getFIIDerivatives = (days = 20) =>
  fetcher<FIIDerivatives>(`/v1/macro/fii-derivatives?days=${days}`);
export const refreshFIIDerivatives = () =>
  fetcher<FIIDerivatives>('/v1/macro/fii-derivatives/refresh', { method: 'POST' });
