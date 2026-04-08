import { useQuery } from '@tanstack/react-query';
import { fetcher } from '../lib/api';
import { TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

interface MaxPainHistory {
  history: { date: string; max_pain: number }[];
  count: number;
}

export default function MaxPainTrendPanel({ currentMaxPain, spot }: {
  currentMaxPain?: number;
  spot?: number;
}) {
  const { data, isLoading } = useQuery<MaxPainHistory>({
    queryKey: ['max-pain-history'],
    queryFn: () => fetcher('/v1/options/max-pain-history?days=30'),
    refetchInterval: 60 * 60 * 1000, // hourly — EOD-only data
    retry: 1,
    staleTime: 30 * 60 * 1000,
  });

  const history = data?.history ?? [];

  // Add today's live max pain if not yet in EOD series
  const allPoints = currentMaxPain
    ? [...history, { date: 'Today', max_pain: currentMaxPain }]
    : history;

  // Trend direction from last 5 sessions
  let trend: 'rising' | 'falling' | 'flat' | null = null;
  if (history.length >= 5) {
    const recent = history.slice(-5);
    const delta = recent[recent.length - 1].max_pain - recent[0].max_pain;
    trend = delta > 50 ? 'rising' : delta < -50 ? 'falling' : 'flat';
  }

  const trendNote = {
    rising:  'Max pain migrating UP — option writers may be pinning higher',
    falling: 'Max pain migrating DOWN — option writers may be pinning lower',
    flat:    'Max pain stable — price likely to oscillate near current level near expiry',
  };

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Max Pain Trend</h3>
        {currentMaxPain && (
          <span className="text-xs font-mono text-amber-300 ml-auto">
            Today: ₹{currentMaxPain.toLocaleString('en-IN')}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-xs text-white/30 text-center py-4">Loading max pain history…</div>
      )}

      {!isLoading && history.length === 0 && (
        <div className="text-xs text-white/30 bg-white/3 rounded p-3 text-center space-y-1">
          <div>No EOD max pain history yet.</div>
          <div className="text-white/20">First data point will appear after today's 3:40 PM IST snapshot.</div>
        </div>
      )}

      {trend && (
        <div className={`text-xs rounded px-3 py-2 border ${
          trend === 'rising'  ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-300' :
          trend === 'falling' ? 'border-red-500/30 bg-red-500/8 text-red-300' :
          'border-white/10 bg-white/5 text-white/60'
        }`}>
          {trendNote[trend]}
        </div>
      )}

      {allPoints.length > 1 && (
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={allPoints} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#ffffff40' }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10, fill: '#ffffff40' }}
              tickFormatter={(v) => (v / 1000).toFixed(1) + 'K'}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{ background: '#1a1f2e', border: '1px solid #ffffff15', borderRadius: 6 }}
              labelStyle={{ color: '#ffffff60', fontSize: 11 }}
              itemStyle={{ color: '#fbbf24', fontSize: 11 }}
              formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Max Pain']}
            />
            {spot && (
              <ReferenceLine
                y={spot}
                stroke="#60a5fa40"
                strokeDasharray="4 4"
                label={{ value: 'Spot', position: 'insideTopRight', fill: '#60a5fa60', fontSize: 10 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="max_pain"
              stroke="#fbbf24"
              strokeWidth={1.5}
              dot={{ r: 2, fill: '#fbbf24' }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="text-[10px] text-white/20 border-t border-white/5 pt-2">
        One point per EOD session (3:40 PM IST). Max pain = strike where total options loss is minimised for option writers.
        Migration direction shows where writers are steering price into expiry.
      </div>
    </div>
  );
}
