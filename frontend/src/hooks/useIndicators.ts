import { useQuery } from '@tanstack/react-query';
import { getIndicators, getDerivedMetrics, getGEX, getCandles } from '../lib/api';

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
