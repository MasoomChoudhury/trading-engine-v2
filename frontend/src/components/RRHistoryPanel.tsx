import { useQuery } from '@tanstack/react-query';
import { fetcher } from '../lib/api';
import { TrendingUp, TrendingDown } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

interface RRHistory {
  timestamp: string;
  current_rr25: number | null;
  rr_rank: number | null;
  rr_pct: number | null;
  rr_min_252d: number | null;
  rr_max_252d: number | null;
  history_count: number;
  signal: string | null;
  signal_note: string | null;
  history: { timestamp: string; rr25: number }[];
  error?: string;
}

function rankColor(rank: number | null) {
  if (rank === null) return 'text-white/40';
  if (rank >= 75) return 'text-red-400';
  if (rank >= 50) return 'text-amber-400';
  return 'text-emerald-400';
}

export default function RRHistoryPanel() {
  const { data, isLoading, isError } = useQuery<RRHistory>({
    queryKey: ['rr-history'],
    queryFn: () => fetcher('/v1/options/rr-history?days=60'),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // Format timestamps for chart x-axis
  const chartData = data?.history.map((p) => ({
    t: new Date(p.timestamp).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    rr25: p.rr25,
  })) ?? [];

  const insufficient = !data?.history_count || data.history_count < 10;

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <TrendingDown className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">25Δ Risk Reversal History</h3>
        {data?.current_rr25 !== null && data?.current_rr25 !== undefined && (
          <span className="text-xs text-orange-300 font-mono ml-auto">
            RR25: {data.current_rr25 > 0 ? '+' : ''}{data.current_rr25.toFixed(2)}
          </span>
        )}
      </div>

      {isLoading && <div className="text-xs text-white/30 text-center py-6">Loading RR history…</div>}
      {isError && <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">Failed to load RR history</div>}

      {data && !data.error && (
        <>
          {/* Rank / Percentile gauges */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">RR Rank</div>
              <div className={`text-lg font-bold ${rankColor(data.rr_rank)}`}>
                {data.rr_rank !== null ? `${data.rr_rank.toFixed(0)}` : '—'}
                <span className="text-xs font-normal text-white/30 ml-0.5">/ 100</span>
              </div>
            </div>
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">RR Pct</div>
              <div className={`text-lg font-bold ${rankColor(data.rr_pct)}`}>
                {data.rr_pct !== null ? `${data.rr_pct.toFixed(0)}` : '—'}
                <span className="text-xs font-normal text-white/30 ml-0.5">%ile</span>
              </div>
            </div>
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">252d Range</div>
              <div className="text-xs font-mono text-white/60">
                {data.rr_min_252d !== null ? data.rr_min_252d.toFixed(2) : '—'}
                <span className="text-white/25"> – </span>
                {data.rr_max_252d !== null ? data.rr_max_252d.toFixed(2) : '—'}
              </div>
            </div>
          </div>

          {/* Signal note */}
          {data.signal_note && (
            <div className={`text-xs rounded px-3 py-2 border ${
              data.signal === 'put_skew_extreme'  ? 'border-red-500/40 bg-red-500/10 text-red-300' :
              data.signal === 'put_skew_elevated' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' :
              data.signal === 'call_skew'         ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' :
              'border-white/10 bg-white/5 text-white/60'
            }`}>
              {data.signal_note}
            </div>
          )}

          {/* Chart */}
          {insufficient ? (
            <div className="text-xs text-white/30 bg-white/3 rounded p-3 text-center">
              Building history — {data.history_count} snapshots so far.
              Chart will appear after a few market sessions.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: '#ffffff40' }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10, fill: '#ffffff40' }} />
                <Tooltip
                  contentStyle={{ background: '#1a1f2e', border: '1px solid #ffffff15', borderRadius: 6 }}
                  labelStyle={{ color: '#ffffff60', fontSize: 11 }}
                  itemStyle={{ color: '#fb923c', fontSize: 11 }}
                  formatter={(v: number) => [v.toFixed(2), 'RR25']}
                />
                <ReferenceLine y={0} stroke="#ffffff20" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="rr25"
                  stroke="#fb923c"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          <div className="text-[10px] text-white/20 border-t border-white/5 pt-2">
            RR25 = 25Δ Put IV − 25Δ Call IV. Positive = put premium &gt; call premium (market hedging downside).
            Rising RR during a price bounce = smart money still hedging = don't buy calls.
          </div>
        </>
      )}
    </div>
  );
}
