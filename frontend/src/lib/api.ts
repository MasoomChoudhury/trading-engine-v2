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
