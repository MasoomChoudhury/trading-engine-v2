import { useQuery } from '@tanstack/react-query';
import { getFuturesVolume, FuturesChartRow } from '../lib/api';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Cell,
} from 'recharts';
import { useMemo } from 'react';
import { AlertTriangle, TrendingUp, BarChart2, Activity, Eye, EyeOff } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import FuturesBasisPanel from '../components/FuturesBasisPanel';
import PivotLevelsPanel from '../components/PivotLevelsPanel';

const fmtVolume = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
};

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

function StatCard({
  label,
  value,
  sub,
  color = 'text-white',
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

// Shared tooltip style
const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

export default function Futures() {
  const { hideExpiry, setHideExpiry } = useDashboard();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['futures-volume'],
    queryFn: getFuturesVolume,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });

  const chartData = useMemo(() => {
    if (!data) return [];
    const rows = hideExpiry
      ? data.chart_data.filter((r) => !r.is_expiry_week)
      : data.chart_data;
    return rows.slice(-60); // last 60 trading days
  }, [data, hideExpiry]);

  // Expiry-week reference areas for shading
  const expiryRanges = useMemo(() => {
    if (!data || hideExpiry) return [];
    const ranges: { start: string; end: string }[] = [];
    let inRange = false;
    let rangeStart = '';
    for (const row of chartData) {
      if (row.is_expiry_week && !inRange) {
        inRange = true;
        rangeStart = row.date;
      } else if (!row.is_expiry_week && inRange) {
        inRange = false;
        ranges.push({ start: rangeStart, end: chartData[chartData.indexOf(row) - 1]?.date });
      }
    }
    if (inRange && rangeStart) {
      ranges.push({ start: rangeStart, end: chartData[chartData.length - 1]?.date });
    }
    return ranges;
  }, [chartData, hideExpiry, data]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-slate-400 text-lg animate-pulse">Loading futures data…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="text-red-400" size={40} />
        <div className="text-red-400 text-lg">Failed to load futures data</div>
        <div className="text-slate-500 text-sm">{String(error)}</div>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const { summary, near_expiry, far_expiry } = data;
  const currentZscore = chartData[chartData.length - 1]?.volume_zscore ?? null;
  const isSpike = currentZscore !== null && Math.abs(currentZscore) > 2;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Nifty Futures Volume</h1>
          <p className="text-slate-400 text-sm mt-1">
            Near: <span className="text-blue-400 font-medium">{near_expiry}</span>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            Far: <span className="text-orange-400 font-medium">{far_expiry}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSpike && (
            <div className="flex items-center gap-2 bg-yellow-900/40 border border-yellow-600/40 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="text-yellow-400" />
              <span className="text-yellow-300 text-sm font-medium">
                Volume Spike (z={currentZscore?.toFixed(1)})
              </span>
            </div>
          )}
          <button
            onClick={() => setHideExpiry(!hideExpiry)}
            className="btn-ghost"
          >
            {hideExpiry ? <Eye size={14} /> : <EyeOff size={14} />}
            {hideExpiry ? 'Show' : 'Hide'} Expiry Weeks
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="Avg Daily Volume"
          value={fmtVolume(summary.avg_daily_volume)}
          sub="last 60 days"
          color="text-blue-400"
        />
        <StatCard
          label="Current Rollover"
          value={`${summary.current_rollover_pct.toFixed(1)}%`}
          sub={`10d avg: ${summary.avg_rollover_pct_10d}%`}
          color={summary.current_rollover_pct > 20 ? 'text-orange-400' : 'text-green-400'}
        />
        <StatCard
          label="Near-Month OI"
          value={fmtVolume(summary.current_near_oi)}
          sub="contracts"
          color="text-cyan-400"
        />
        <StatCard
          label="Volume Spikes"
          value={String(summary.volume_spike_count)}
          sub="z-score > 2"
          color={summary.volume_spike_count > 3 ? 'text-red-400' : 'text-slate-300'}
        />
        <StatCard
          label="Trading Days"
          value={String(summary.total_days)}
          sub="in dataset"
        />
      </div>

      {/* Chart 1: Combined Volume Bar */}
      <div className="chart-card">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={18} className="text-blue-400" />
          <h2 className="text-lg font-semibold">Combined Futures Volume</h2>
          {!hideExpiry && (
            <span className="ml-auto text-xs text-slate-500 italic">
              Shaded = expiry week
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={fmtVolume}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              width={55}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => [
                fmtVolume(value),
                name === 'near_volume' ? 'Near Month' : 'Far Month',
              ]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Legend
              formatter={(value) =>
                value === 'near_volume' ? 'Near Month' : 'Far Month'
              }
            />
            {expiryRanges.map((r, i) => (
              <ReferenceArea
                key={i}
                x1={r.start}
                x2={r.end}
                fill="#f59e0b"
                fillOpacity={0.08}
              />
            ))}
            <Bar dataKey="near_volume" stackId="vol" fill="#3b82f6" name="near_volume" />
            <Bar dataKey="far_volume" stackId="vol" fill="#f97316" name="far_volume" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Rollover Ratio */}
      <div className="chart-card">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-orange-400" />
          <h2 className="text-lg font-semibold">Rollover Ratio</h2>
          <span className="ml-2 text-xs text-slate-500">far_vol / combined_vol × 100</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              width={45}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => [`${v.toFixed(1)}%`, 'Rollover %']}
              labelFormatter={(l) => `Date: ${l}`}
            />
            {expiryRanges.map((r, i) => (
              <ReferenceArea
                key={i}
                x1={r.start}
                x2={r.end}
                fill="#f59e0b"
                fillOpacity={0.08}
              />
            ))}
            <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="rollover_pct"
              stroke="#f97316"
              dot={false}
              strokeWidth={2}
              name="Rollover %"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: Volume Z-Score */}
      <div className="chart-card">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} className="text-green-400" />
          <h2 className="text-lg font-semibold">Volume Spike Detector</h2>
          <span className="ml-2 text-xs text-slate-500">20-day rolling z-score</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              width={40}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: unknown) => [
                v != null ? Number(v).toFixed(2) : '—',
                'Z-Score',
              ]}
              labelFormatter={(l) => `Date: ${l}`}
            />
            {expiryRanges.map((r, i) => (
              <ReferenceArea
                key={i}
                x1={r.start}
                x2={r.end}
                fill="#f59e0b"
                fillOpacity={0.08}
              />
            ))}
            <ReferenceLine y={2} stroke="#ef4444" strokeDasharray="4 4" />
            <ReferenceLine y={-2} stroke="#ef4444" strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="#475569" />
            <Bar dataKey="volume_zscore" name="Z-Score">
              {chartData.map((row, i) => (
                <Cell
                  key={i}
                  fill={
                    row.volume_zscore == null
                      ? '#475569'
                      : row.volume_zscore > 2
                      ? '#ef4444'
                      : row.volume_zscore < -2
                      ? '#3b82f6'
                      : row.volume_zscore > 0
                      ? '#22c55e'
                      : '#f97316'
                  }
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> Spike &gt;+2σ
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> Above avg
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-orange-500" /> Below avg
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" /> Spike &lt;−2σ
          </span>
        </div>
      </div>

      {/* Futures Basis / Cost of Carry */}
      <FuturesBasisPanel />

      {/* Weekly & Monthly Pivot Levels */}
      <PivotLevelsPanel />
    </div>
  );
}
