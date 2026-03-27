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

export const triggerBreadthRefresh = () =>
  fetcher<{ status: string; message: string }>('/v1/breadth/refresh', { method: 'POST' });
