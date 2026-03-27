import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBreadthAnalytics, triggerBreadthRefresh,
  VolumeSeriesRow, BreadthSeriesRow, SectorSeriesRow, HeavyweightRow, HeatmapRow,
} from '../lib/api';
import {
  ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ReferenceArea, Legend, Cell,
} from 'recharts';
import { useDashboard } from '../context/DashboardContext';
import { useMemo, useState } from 'react';
import {
  AlertTriangle, Info, TrendingUp, TrendingDown, Minus,
  BarChart2, RefreshCw, Eye, EyeOff,
} from 'lucide-react';

// ── Design tokens & helpers ───────────────────────────────────────────────────
const SECTOR_COLORS: Record<string, string> = {
  Financials: '#3b82f6', IT: '#8b5cf6', Energy: '#f97316',
  Auto: '#22d3ee', Consumer: '#f59e0b', Pharma: '#10b981',
  Infra: '#6366f1', Telecom: '#ec4899', Metals: '#94a3b8', Other: '#475569',
};
const SECTORS = Object.keys(SECTOR_COLORS);

const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` :
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` :
  v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

const tooltipStyle = {
  backgroundColor: '#1e293b', border: '1px solid #334155',
  borderRadius: '8px', color: '#f1f5f9', fontSize: '11px',
};

function StatCard({ label, value, sub, color = 'text-white', icon }:
  { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="stat-card">
      <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

// ── Chart 1: Aggregate Volume vs Nifty ───────────────────────────────────────
function VolumeConvictionChart({ data }: { data: VolumeSeriesRow[] }) {
  const annotations = useMemo(
    () => data.filter(r => r.divergence),
    [data],
  );
  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 size={18} className="text-teal-400" />
        <h2 className="text-lg font-semibold">Aggregate Volume vs Nifty Price</h2>
        <span className="text-xs text-slate-500 ml-2">weight-adjusted constituent volume</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 50, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="vol" tickFormatter={fmtVol} tick={{ fill: '#94a3b8', fontSize: 10 }} width={55} />
          <YAxis yAxisId="price" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={55}
            domain={['auto', 'auto']} tickFormatter={v => v.toLocaleString('en-IN')} />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string): [string, string] => {
              if (name === 'nifty_close') return [Number(v).toLocaleString('en-IN'), 'Nifty'];
              if (name === 'weighted_vol') return [fmtVol(Number(v)), 'Vol (weighted)'];
              if (name === 'vol_ma20') return [fmtVol(Number(v)), '20d MA'];
              if (name === 'futures_vol') return [fmtVol(Number(v)), 'Futures Vol'];
              return [String(v), name];
            }}
            labelFormatter={l => `Date: ${l}`}
          />
          {annotations.map((a, i) => (
            <ReferenceLine key={i} yAxisId="vol" x={a.date} stroke="#f59e0b" strokeDasharray="3 3"
              label={{ value: a.divergence === 'Confirmed breakout' ? '✓ Breakout' :
                       a.divergence === 'Low conviction rally' ? '⚠ Low conv.' : '↓ HiVol sell',
                       fill: a.divergence === 'Confirmed breakout' ? '#22c55e' :
                             a.divergence === 'Low conviction rally' ? '#f59e0b' : '#ef4444',
                       fontSize: 9, position: 'top' }} />
          ))}
          <Bar yAxisId="vol" dataKey="weighted_vol" fill="#2dd4bf" fillOpacity={0.7} name="weighted_vol" />
          <Line yAxisId="vol" type="monotone" dataKey="vol_ma20" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="vol_ma20" connectNulls />
          <Line yAxisId="price" type="monotone" dataKey="nifty_close" stroke="#60a5fa" dot={false} strokeWidth={2} name="nifty_close" />
          <Line yAxisId="vol" type="monotone" dataKey="futures_vol" stroke="#a78bfa" dot={false} strokeWidth={1} strokeDasharray="2 4" name="futures_vol" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-400 inline-block rounded-sm" /> Constituent vol</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-dashed border-yellow-400 inline-block" /> 20d MA</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-blue-400 inline-block" /> Nifty price →</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-dashed border-violet-400 inline-block" /> Futures vol</span>
      </div>
    </div>
  );
}

// ── Chart 2: Breadth Score ───────────────────────────────────────────────────
function BreadthScoreChart({ data }: { data: BreadthSeriesRow[] }) {
  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={18} className="text-green-400" />
        <h2 className="text-lg font-semibold">Breadth Score</h2>
        <span className="text-xs text-slate-500 ml-2">% of 50 stocks above their own 20d avg volume</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 50, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="breadth" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#94a3b8', fontSize: 10 }} width={40} />
          <YAxis yAxisId="hw" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#94a3b8', fontSize: 10 }} width={40} />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string) => [
              `${Number(v).toFixed(1)}%`,
              name === 'breadth_pct' ? 'Breadth' : 'HW share',
            ]}
            labelFormatter={l => `Date: ${l}`}
          />
          {/* Bands */}
          <ReferenceArea yAxisId="breadth" y1={70} y2={100} fill="#22c55e" fillOpacity={0.07} />
          <ReferenceArea yAxisId="breadth" y1={0} y2={40} fill="#ef4444" fillOpacity={0.07} />
          <ReferenceLine yAxisId="breadth" y={70} stroke="#22c55e" strokeDasharray="4 4" label={{ value: '70%', fill: '#22c55e', fontSize: 9 }} />
          <ReferenceLine yAxisId="breadth" y={40} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '40%', fill: '#ef4444', fontSize: 9 }} />
          {/* Annotations */}
          {data.filter(r => r.annotation).map((r, i) => (
            <ReferenceLine key={i} yAxisId="breadth" x={r.date} stroke="#f59e0b" strokeDasharray="3 3"
              label={{ value: r.annotation!.includes('Broad') ? '↑ Broad' : '↓ HW', fill: '#f59e0b', fontSize: 9, position: 'top' }} />
          ))}
          <Line yAxisId="breadth" type="monotone" dataKey="breadth_pct" stroke="#22c55e" dot={false} strokeWidth={2} name="breadth_pct" />
          <Line yAxisId="hw" type="monotone" dataKey="hw_share_pct" stroke="#f97316" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="hw_share_pct" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-green-400 inline-block" /> Breadth %</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-dashed border-orange-400 inline-block" /> HW share % →</span>
        <span className="ml-auto text-slate-500 italic">Green band = broad, Red band = narrow</span>
      </div>
    </div>
  );
}

// ── Chart 3: Constituent Heatmap ──────────────────────────────────────────────
function ConstituentHeatmap({ dates, rows }: { dates: string[]; rows: HeatmapRow[] }) {
  const [showTodayOnly, setShowTodayOnly] = useState(false);

  const cellBg = (z: number): string => {
    const c = Math.min(Math.abs(z) / 3, 1);
    return z > 0 ? `rgba(34,197,94,${0.1 + c * 0.8})` :
           z < 0 ? `rgba(239,68,68,${0.1 + c * 0.8})` : 'rgba(71,85,105,0.25)';
  };

  // Group rows by sector
  const bySector = useMemo(() => {
    const m = new Map<string, HeatmapRow[]>();
    for (const r of rows) {
      if (!m.has(r.sector)) m.set(r.sector, []);
      m.get(r.sector)!.push(r);
    }
    return m;
  }, [rows]);

  if (showTodayOnly) {
    // Today-only: sorted bar chart (last zscore)
    const todayRows = [...rows]
      .map(r => ({ ...r, z: r.zscores[r.zscores.length - 1] ?? 0 }))
      .sort((a, b) => b.z - a.z);
    return (
      <div className="chart-card">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold">Today's Volume Z-Score (ranked)</h2>
          <button onClick={() => setShowTodayOnly(false)}
            className="ml-auto flex items-center gap-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-[background-color,transform] duration-150 active:scale-[0.97]">
            <Eye size={12} /> Show Grid
          </button>
        </div>
        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart data={todayRows} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
            <XAxis type="number" domain={[-3, 3]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <YAxis type="category" dataKey="symbol" tick={{ fill: '#94a3b8', fontSize: 9 }} width={68} />
            <Tooltip contentStyle={tooltipStyle}
              formatter={(v: unknown) => [`z = ${Number(v).toFixed(2)}`, 'Vol Z-Score']}
              labelFormatter={l => l} />
            <ReferenceLine x={0} stroke="#475569" />
            <ReferenceLine x={2} stroke="#ef4444" strokeDasharray="3 3" />
            <ReferenceLine x={-2} stroke="#ef4444" strokeDasharray="3 3" />
            <Bar dataKey="z" name="z">
              {todayRows.map((r, i) => (
                <Cell key={i} fill={r.z > 0 ? '#22c55e' : '#ef4444'} fillOpacity={Math.min(0.4 + Math.abs(r.z) / 3 * 0.6, 1)} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold">Constituent Volume Heatmap</h2>
        <span className="text-xs text-slate-500 ml-2">z-score vs own 20d avg, last 20 days</span>
        <button onClick={() => setShowTodayOnly(true)}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded">
          <EyeOff size={12} /> Today Only
        </button>
      </div>
      <div className="flex gap-3 text-xs text-slate-400 mb-3">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(34,197,94,0.7)' }} /> Above avg</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(239,68,68,0.7)' }} /> Below avg</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-yellow-400 inline-block bg-transparent" /> Heavyweight</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-slate-400 font-normal text-left pr-3 pb-1 w-24 sticky left-0 bg-slate-800">Stock</th>
              {dates.map(d => (
                <th key={d} className="text-slate-500 font-normal px-0.5 text-center min-w-[28px]">
                  {new Date(d).getDate()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTORS.map(sector => {
              const sRows = bySector.get(sector);
              if (!sRows || sRows.length === 0) return null;
              return [
                <tr key={`hdr-${sector}`}>
                  <td colSpan={dates.length + 1}
                    className="text-xs font-semibold pt-2 pb-0.5 sticky left-0 bg-slate-800"
                    style={{ color: SECTOR_COLORS[sector] }}>
                    {sector}
                  </td>
                </tr>,
                ...sRows.map(row => (
                  <tr key={row.symbol} className="hover:bg-slate-700/20">
                    <td className={`pr-3 py-0.5 font-mono sticky left-0 bg-slate-800 ${row.is_hw ? 'text-yellow-300' : 'text-slate-300'}`}>
                      {row.symbol}
                    </td>
                    {row.zscores.map((z, ci) => (
                      <td key={ci} style={{ backgroundColor: cellBg(z) }}
                        className={`text-center px-0.5 py-0.5 font-mono text-xs ${row.is_hw ? 'ring-1 ring-inset ring-yellow-500/40' : ''}`}
                        title={`${row.symbol} ${dates[ci]}: z=${z}`}>
                        {z !== 0 ? z.toFixed(1) : ''}
                      </td>
                    ))}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Chart 4: Sector Rotation ─────────────────────────────────────────────────
function SectorRotationChart({ data }: { data: SectorSeriesRow[] }) {
  const availableSectors = useMemo(() => {
    const s = new Set<string>();
    for (const row of data) {
      Object.keys(row).forEach(k => { if (k !== 'date' && typeof row[k] === 'number') s.add(k); });
    }
    return SECTORS.filter(s2 => s.has(s2));
  }, [data]);

  // Detect sector concentration alerts
  const alerts = useMemo(() => {
    if (!data.length) return [];
    const last = data[data.length - 1];
    return availableSectors
      .filter(s => (last[s] as number ?? 0) > 40)
      .map(s => `Sector concentration: ${s} at ${(last[s] as number).toFixed(0)}% of volume`);
  }, [data, availableSectors]);

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold">Sector Volume Rotation</h2>
        <span className="text-xs text-slate-500 ml-2">each sector's share of total daily volume</span>
      </div>
      {alerts.map((a, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded px-3 py-1.5 mb-3">
          <AlertTriangle size={12} /> {a}
        </div>
      ))}
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fill: '#94a3b8', fontSize: 10 }} width={40} />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string) => [`${Number(v).toFixed(1)}%`, name]}
            labelFormatter={l => `Date: ${l}`} />
          <Legend formatter={v => <span className="text-xs">{v}</span>} />
          {availableSectors.map(sector => (
            <Area key={sector} type="monotone" dataKey={sector} stackId="1"
              fill={SECTOR_COLORS[sector]} stroke={SECTOR_COLORS[sector]}
              fillOpacity={0.75} strokeWidth={0} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 5: Heavyweight Isolation ───────────────────────────────────────────
function HeavyweightView({ data }: { data: HeavyweightRow[] }) {
  const totalWeight = data.reduce((a, h) => a + h.weight, 0);
  const totalVol = data.reduce((a, h) => a + h.volume, 0);
  const totalMa = data.reduce((a, h) => a + h.ma20, 0);
  const combined = { pct_vs_ma: totalMa > 0 ? ((totalVol - totalMa) / totalMa * 100) : 0 };

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold">Heavyweight Isolation</h2>
        <span className="text-xs text-slate-500 ml-2">top 5 stocks vs their 20d avg volume</span>
        <span className="ml-auto text-xs text-slate-400">
          Combined weight: <span className="text-white font-medium">{totalWeight.toFixed(1)}%</span>
          &nbsp;|&nbsp; Combined vol today: <span className={combined.pct_vs_ma >= 0 ? 'text-green-400' : 'text-red-400'}>
            {combined.pct_vs_ma >= 0 ? '+' : ''}{combined.pct_vs_ma.toFixed(1)}% vs MA
          </span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 16, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="symbol" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tickFormatter={fmtVol} tick={{ fill: '#94a3b8', fontSize: 10 }} width={55} />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string) => [fmtVol(Number(v)), name === 'volume' ? 'Today' : '20d MA']}
            labelFormatter={l => l} />
          <Bar dataKey="volume" name="volume" radius={[3, 3, 0, 0]}>
            {data.map((r, i) => <Cell key={i} fill={r.above_ma ? '#22c55e' : '#ef4444'} />)}
          </Bar>
          <Line type="monotone" dataKey="ma20" stroke="#f59e0b" dot={{ fill: '#f59e0b', r: 4 }} strokeWidth={0} name="20d MA" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-5 gap-2 mt-3">
        {data.map(h => (
          <div key={h.symbol} className={`text-center text-xs rounded p-1.5 ${h.above_ma ? 'bg-green-900/30 border border-green-700/30' : 'bg-red-900/30 border border-red-700/30'}`}>
            <div className="font-medium text-slate-200">{h.symbol}</div>
            <div className={`font-bold ${h.above_ma ? 'text-green-400' : 'text-red-400'}`}>
              {h.pct_vs_ma >= 0 ? '+' : ''}{h.pct_vs_ma.toFixed(0)}%
            </div>
            <div className="text-slate-500">{h.weight}% idx</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Alerts Banner ────────────────────────────────────────────────────────────
function AlertsBanner({ alerts }: { alerts: { type: string; msg: string }[] }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const visible = alerts.filter((_, i) => !dismissed.has(i));
  if (!visible.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => !dismissed.has(i) && (
        <div key={i} className={`flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm
          ${a.type === 'warning' ? 'bg-amber-900/30 border border-amber-700/40 text-amber-200' : 'bg-blue-900/30 border border-blue-700/40 text-blue-200'}`}>
          <div className="flex items-center gap-2">
            {a.type === 'warning' ? <AlertTriangle size={14} /> : <Info size={14} />}
            {a.msg}
          </div>
          <button onClick={() => setDismissed(prev => new Set([...prev, i]))} className="text-xs opacity-50 hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Breadth() {
  const qc = useQueryClient();
  const { hideExpiry } = useDashboard();

  const { data, isLoading, error } = useQuery({
    queryKey: ['breadth-analytics'],
    queryFn: getBreadthAnalytics,
    refetchInterval: 10 * 60 * 1000,
    retry: 2,
  });

  const refresh = useMutation({
    mutationFn: triggerBreadthRefresh,
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['breadth-analytics'] }), 35000),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading breadth data…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <AlertTriangle size={40} className="text-red-400" />
        <div className="text-red-400">Failed to load breadth data</div>
      </div>
    );
  }

  // Loading state: data cache not yet built
  if (data.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center gap-6">
        <h1 className="text-2xl font-bold">Nifty 50 Breadth</h1>
        <div className="chart-card !p-8 max-w-md text-center space-y-4">
          <BarChart2 size={48} className="mx-auto text-teal-400" />
          <p className="text-slate-300">{data.message}</p>
          <p className="text-slate-500 text-sm">
            {data.symbols_ready ?? 0} / {data.total ?? 50} stocks loaded
          </p>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="flex items-center gap-2 mx-auto px-6 py-3 bg-teal-600 hover:bg-teal-500 rounded-lg font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
          >
            <RefreshCw size={16} className={refresh.isPending ? 'animate-spin' : ''} />
            {refresh.isPending ? 'Fetching 50 stocks… (~30s)' : 'Load Constituent Data'}
          </button>
          {refresh.isSuccess && (
            <p className="text-green-400 text-sm">Fetch started — page will refresh in ~35 seconds</p>
          )}
        </div>
      </div>
    );
  }

  const { summary, alerts, volume_series, breadth_series, sector_series, heatmap, heavyweight_today } = data;

  const convictionColor =
    summary.conviction === 'Broad' ? 'text-green-400' :
    summary.conviction === 'Heavyweight-driven' ? 'text-orange-400' : 'text-yellow-300';

  const filteredVolSeries = hideExpiry ? volume_series : volume_series;
  const filteredBreadthSeries = hideExpiry ? breadth_series : breadth_series;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nifty 50 Breadth</h1>
          <p className="text-slate-400 text-sm mt-1">
            Constituent volume participation across all 50 stocks
            {data.config && (
              <span className="ml-3 text-slate-600 text-xs">
                Weights as of {data.config.last_updated}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="btn-ghost disabled:opacity-50"
        >
          <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} />
          Refresh Data
        </button>
      </div>

      {/* Alerts */}
      <AlertsBanner alerts={alerts} />

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="Breadth Score"
          value={`${summary.breadth_pct.toFixed(0)}%`}
          sub={`${summary.breadth_pct >= 65 ? 'Broad participation' : summary.breadth_pct < 40 ? 'Narrow move' : 'Mixed'}`}
          color={summary.breadth_pct >= 65 ? 'text-green-400' : summary.breadth_pct < 40 ? 'text-red-400' : 'text-yellow-300'}
          icon={summary.breadth_pct >= 65 ? <TrendingUp size={12} className="text-green-400" /> :
                summary.breadth_pct < 40 ? <TrendingDown size={12} className="text-red-400" /> :
                <Minus size={12} className="text-yellow-300" />}
        />
        <StatCard
          label="HW Volume Share"
          value={`${summary.hw_share_pct.toFixed(0)}%`}
          sub="top 5 stocks"
          color={summary.hw_share_pct > 55 ? 'text-orange-400' : 'text-slate-300'}
        />
        <StatCard
          label="Conviction"
          value={summary.conviction}
          sub={`Nifty ${summary.nifty_chg_pct >= 0 ? '+' : ''}${summary.nifty_chg_pct.toFixed(2)}%`}
          color={convictionColor}
        />
        <StatCard
          label="Top Sector"
          value={summary.top_sector}
          sub={`${summary.top_sector_pct.toFixed(1)}% of volume`}
          color="text-blue-400"
        />
        <StatCard
          label="52-wk Vol Highs"
          value={String(summary.high_vol_count)}
          sub="stocks at record volume"
          color={summary.high_vol_count >= 5 ? 'text-yellow-400' : 'text-slate-300'}
        />
      </div>

      {/* Chart 1: Volume Conviction */}
      <VolumeConvictionChart data={filteredVolSeries} />

      {/* Chart 2: Breadth Score */}
      <BreadthScoreChart data={filteredBreadthSeries} />

      {/* Chart 3: Constituent Heatmap */}
      <ConstituentHeatmap dates={heatmap.dates} rows={heatmap.rows} />

      {/* Chart 4: Sector Rotation + Chart 5: Heavyweight view */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectorRotationChart data={sector_series} />
        <HeavyweightView data={heavyweight_today} />
      </div>
    </div>
  );
}
