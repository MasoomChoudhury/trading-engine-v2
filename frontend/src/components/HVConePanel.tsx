import { useHVCone } from '../hooks/useIndicators';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Scatter,
} from 'recharts';
import { Info } from 'lucide-react';
import { HVConePoint } from '../lib/api';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function RatioBadge({ ratio, lookback }: { ratio: number | null; lookback: number }) {
  if (ratio == null) return null;
  const expensive = ratio > 1.3;
  const cheap = ratio < 0.85;
  const cls = expensive
    ? 'text-red-300 bg-red-900/30 border-red-700/50'
    : cheap
    ? 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50'
    : 'text-slate-300 bg-slate-800 border-slate-600';
  const label = expensive ? 'expensive' : cheap ? 'cheap' : 'fair';
  return (
    <div className={`flex items-center justify-between px-2 py-1 rounded border text-xs ${cls}`}>
      <span className="font-medium">{lookback}d</span>
      <span className="tabular-nums">{ratio.toFixed(2)}x IV/RV</span>
      <span className="uppercase font-semibold">{label}</span>
    </div>
  );
}

export default function HVConePanel() {
  const { data, isLoading, error } = useHVCone();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Historical Volatility Cone</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Historical Volatility Cone</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Insufficient historical data'}
        </div>
      </div>
    );
  }

  const { cone, current_vix, note } = data;
  const validPoints = cone.filter(p => p.current_hv != null) as HVConePoint[];

  if (validPoints.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">Historical Volatility Cone</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          Not enough candle history to build cone
        </div>
      </div>
    );
  }

  const chartData = validPoints.map(p => ({
    name: `${p.lookback}d`,
    current: p.current_hv,
    p10: p.p10,
    p25: p.p25,
    p50: p.p50,
    p75: p.p75,
    p90: p.p90,
    vix: current_vix,
  }));

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Historical Volatility Cone</span>
        {current_vix != null && (
          <span className="text-xs text-amber-300 border border-amber-700/50 bg-amber-900/20 px-2 py-0.5 rounded">
            VIX {current_vix.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="h-52 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, name: string) => [`${v?.toFixed(2)}%`, name]}
            />
            {/* 10th–90th band */}
            <Area
              dataKey="p90" stroke="transparent" fill="#334155" fillOpacity={0.5}
              name="90th pct" legendType="none"
            />
            <Area
              dataKey="p10" stroke="transparent" fill="#1e293b" fillOpacity={1}
              name="10th pct" legendType="none"
            />
            {/* 25th–75th inner band */}
            <Area
              dataKey="p75" stroke="transparent" fill="#1d4ed8" fillOpacity={0.25}
              name="75th pct"
            />
            <Area
              dataKey="p25" stroke="transparent" fill="#1e293b" fillOpacity={1}
              name="25th pct" legendType="none"
            />
            {/* Median */}
            <Line
              type="monotone" dataKey="p50" stroke="#60a5fa" strokeWidth={1.5}
              strokeDasharray="4 2" dot={false} name="Median"
            />
            {/* Current HV */}
            <Line
              type="monotone" dataKey="current" stroke="#f59e0b" strokeWidth={2.5}
              dot={{ fill: '#1e293b', strokeWidth: 2, r: 4 }} name="Current HV"
            />
            {/* VIX overlay */}
            {current_vix != null && (
              <Line
                type="monotone" dataKey="vix" stroke="#f97316" strokeWidth={2}
                strokeDasharray="6 3" dot={false} name="India VIX"
              />
            )}
            <Legend
              iconType="line"
              wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* IV/RV ratio per horizon */}
      {current_vix != null && validPoints.some(p => p.iv_rv_ratio != null) && (
        <div className="mb-3">
          <div className="text-xs text-slate-400 mb-2">IV/RV Ratio by Horizon (VIX ÷ Current HV)</div>
          <div className="grid grid-cols-5 gap-1.5">
            {validPoints.map(p => (
              <RatioBadge key={p.lookback} ratio={p.iv_rv_ratio} lookback={p.lookback} />
            ))}
          </div>
        </div>
      )}

      {/* Percentile rank row */}
      <div className="mb-3">
        <div className="text-xs text-slate-400 mb-2">Current HV Percentile Rank (in own history)</div>
        <div className="flex gap-2 flex-wrap">
          {validPoints.map(p => {
            const high = p.pct_rank > 75;
            const low = p.pct_rank < 25;
            const cls = high ? 'text-red-300 bg-red-900/20 border-red-700/40'
              : low ? 'text-emerald-300 bg-emerald-900/20 border-emerald-700/40'
              : 'text-slate-300 bg-slate-800 border-slate-600';
            return (
              <div key={p.lookback} className={`px-2 py-0.5 rounded border text-xs ${cls}`}>
                <span className="font-medium">{p.lookback}d:</span>{' '}
                <span className="tabular-nums font-bold">{p.pct_rank}th</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Note */}
      {note && (
        <div className="flex items-start gap-2 bg-slate-800/60 border border-slate-700/40 rounded-lg p-3">
          <Info size={13} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-400 leading-relaxed">{note}</p>
        </div>
      )}
    </div>
  );
}
