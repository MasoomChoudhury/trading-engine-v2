import { useQuery } from '@tanstack/react-query';
import { getIndicators, getDerivedMetrics, getGEX, getCandles, getIndicatorSeries, getGEXHistory, getIVSkew, getOITrend, getFIIFlows, getAdvanceDecline, getMarketDepth, getIndiaVIX, getGlobalCues, getFIIDerivatives, getBuyersEdge, getVolIndicators, getStraddleIntraday, getPcrDivergence, getSectorRS } from '../lib/api';

export function useIndicators(interval = '5min') {
  return useQuery({
    queryKey: ['indicators', interval],
    queryFn: () => getIndicators(interval),
    refetchInterval: 30000,
    retry: 2,
  });
}

export function useDerivedMetrics(interval = '5min') {
  return useQuery({
    queryKey: ['derived-metrics', interval],
    queryFn: () => getDerivedMetrics(interval),
    refetchInterval: 60000,
    retry: 2,
  });
}

export function useGEX() {
  return useQuery({
    queryKey: ['gex'],
    queryFn: () => getGEX(),
    refetchInterval: 120000,
    retry: 2,
  });
}

export function useCandles(interval = '5min', limit = 200) {
  return useQuery({
    queryKey: ['candles', interval, limit],
    queryFn: () => getCandles(interval, limit),
    refetchInterval: 60000,
    retry: 2,
  });
}

export function useGEXHistory(days = 90) {
  return useQuery({
    queryKey: ['gex-history', days],
    queryFn: () => getGEXHistory(days),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useIVSkew(expiry?: string) {
  return useQuery({
    queryKey: ['iv-skew', expiry],
    queryFn: () => getIVSkew(expiry),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useOITrend(days = 10) {
  return useQuery({
    queryKey: ['oi-trend', days],
    queryFn: () => getOITrend(undefined, days),
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useFIIFlows(days = 30) {
  return useQuery({
    queryKey: ['fii-flows', days],
    queryFn: () => getFIIFlows(days),
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });
}

export function useAdvanceDecline(days = 30) {
  return useQuery({
    queryKey: ['advance-decline', days],
    queryFn: () => getAdvanceDecline(days),
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useMarketDepth() {
  return useQuery({
    queryKey: ['market-depth'],
    queryFn: getMarketDepth,
    refetchInterval: 30 * 1000,
    retry: 1,
  });
}

export function useIndiaVIX() {
  return useQuery({
    queryKey: ['india-vix'],
    queryFn: getIndiaVIX,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useGlobalCues() {
  return useQuery({
    queryKey: ['global-cues'],
    queryFn: getGlobalCues,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useFIIDerivatives(days = 20) {
  return useQuery({
    queryKey: ['fii-derivatives', days],
    queryFn: () => getFIIDerivatives(days),
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });
}

export function useSectorRS(days = 60) {
  return useQuery({
    queryKey: ['sector-rs', days],
    queryFn: () => getSectorRS(days),
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
  });
}

export function useVolIndicators(interval = '5min', limit = 100) {
  return useQuery({
    queryKey: ['vol-indicators', interval, limit],
    queryFn: () => getVolIndicators(interval, limit),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useStraddleIntraday() {
  return useQuery({
    queryKey: ['straddle-intraday'],
    queryFn: getStraddleIntraday,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function usePcrDivergence() {
  return useQuery({
    queryKey: ['pcr-divergence'],
    queryFn: getPcrDivergence,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useBuyersEdge(expiry?: string) {
  return useQuery({
    queryKey: ['buyers-edge', expiry],
    queryFn: () => getBuyersEdge(expiry),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useIndicatorSeries(interval = '5min', limit = 100) {
  return useQuery({
    queryKey: ['indicator-series', interval, limit],
    queryFn: () => getIndicatorSeries(interval, limit),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    retry: 2,
  });
}
