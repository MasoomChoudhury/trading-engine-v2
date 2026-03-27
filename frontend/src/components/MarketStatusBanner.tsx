import { useQuery } from '@tanstack/react-query';
import { getTodayMarketStatus } from '../lib/api';
import { CalendarOff, TrendingUp, TrendingDown, Calendar } from 'lucide-react';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function MarketStatusBanner() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['marketStatus'],
    queryFn: getTodayMarketStatus,
    refetchInterval: 60 * 60 * 1000, // refresh every hour
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  if (isLoading || isError || !data) {
    return null;
  }

  // Holiday + market closed — show prominent banner
  if (data.is_holiday && !data.is_market_open) {
    return (
      <div className="bg-amber-900/40 border border-amber-600/50 rounded-xl p-4 flex items-start gap-3">
        <CalendarOff size={20} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-amber-300 font-semibold text-sm">
            Market Holiday Today — {data.holiday_description || 'Trading Closed'}
          </p>
          {data.nse_status && (
            <p className="text-amber-500 text-xs mt-0.5">
              NSE Status: {data.nse_status}
            </p>
          )}
          {data.last_updated && (
            <p className="text-amber-600 text-xs mt-0.5">
              Status as of: {data.last_updated}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Market open — subtle indicator
  if (data.is_market_open) {
    return (
      <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-xl p-3 flex items-center gap-2">
        <TrendingUp size={16} className="text-emerald-400 shrink-0" />
        <p className="text-emerald-400 text-xs font-medium">
          Market Open — NSE: {data.nse_status || '—'}
        </p>
        {data.last_updated && (
          <p className="text-emerald-600 text-xs ml-auto">
            {data.last_updated}
          </p>
        )}
      </div>
    );
  }

  // Market closed (but not a holiday — e.g. weekend)
  if (data.nse_status) {
    return (
      <div className="bg-slate-800/60 rounded-xl p-3 flex items-center gap-2 ring-1 ring-white/[0.06]">
        <TrendingDown size={16} className="text-slate-400 shrink-0" />
        <p className="text-slate-400 text-xs">
          Market Closed — NSE: {data.nse_status}
          {data.is_holiday ? ` (${data.holiday_description})` : ''}
        </p>
        {data.last_updated && (
          <p className="text-slate-600 text-xs ml-auto">{data.last_updated}</p>
        )}
      </div>
    );
  }

  // Next upcoming holiday
  if (data.next_holiday) {
    return (
      <div className="bg-slate-800/60 rounded-xl p-3 flex items-center gap-2 ring-1 ring-white/[0.06]">
        <Calendar size={14} className="text-slate-500 shrink-0" />
        <p className="text-slate-500 text-xs">
          Next holiday: <span className="text-slate-400">{data.next_holiday_desc}</span>
          {' on '}
          {formatDate(data.next_holiday)}
        </p>
      </div>
    );
  }

  return null;
}
