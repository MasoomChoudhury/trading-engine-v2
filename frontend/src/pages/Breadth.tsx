import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBreadthAnalytics, triggerBreadthRefresh,
  VolumeSeriesRow, BreadthSeriesRow, SectorSeriesRow, HeavyweightRow, HeatmapRow,
  getAdvanceDecline, RsSignal,
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
  BarChart2, RefreshCw, Eye, EyeOff, Activity,
} from 'lucide-react';
import { useSectorRS } from '../hooks/useIndicators';

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

// ── Panel 8: Advance-Decline ──────────────────────────────────────────────────

const tooltipStyle2 = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function AdvanceDeclinePanel() {
  const { data, isLoading, error, refetch: refetchAD } = useQuery({
    queryKey: ['advance-decline'],
    queryFn: () => getAdvanceDecline(30),
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) return <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">Loading A-D data…</div>;
  if (error || !data || !data.series.length) return (
    <div className="panel-card h-28 flex flex-col items-center justify-center gap-3">
      <div className="text-slate-500 text-sm">
        {error instanceof Error ? error.message : 'Advance-Decline data unavailable — constituent candles not yet loaded'}
      </div>
      <button onClick={() => refetchAD()} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );

  const { series, latest, avg_breadth_5d, trend, constituents_tracked } = data;

  const latest_typed = latest as {
    advances?: number; declines?: number; breadth_pct?: number; a_d_ratio?: number;
  };

  const trendColor = trend === 'improving' ? 'text-emerald-400' : trend === 'deteriorating' ? 'text-red-400' : 'text-slate-400';

  const chartData = series.map(s => ({
    date: new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    Advances: s.advances,
    Declines: -s.declines, // negative so they stack downward visually
    Breadth: s.breadth_pct,
    MA5: s.breadth_ma5,
    ADLine: s.cum_ad_line,
  }));

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Advance-Decline Ratio</h3>
          <p className="text-xs text-slate-500 mt-0.5">Nifty 50 constituents · {constituents_tracked} stocks tracked</p>
        </div>
        <div className={`text-xs font-semibold ${trendColor} bg-slate-800/60 rounded px-2 py-1`}>
          {trend === 'improving' ? 'Improving ↑' : trend === 'deteriorating' ? 'Deteriorating ↓' : 'Stable →'}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">Advances</div>
          <div className="text-lg font-bold text-emerald-400">{latest_typed.advances ?? '—'}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">Declines</div>
          <div className="text-lg font-bold text-red-400">{latest_typed.declines ?? '—'}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">Breadth %</div>
          <div className={`text-lg font-bold ${(latest_typed.breadth_pct ?? 0) >= 60 ? 'text-emerald-400' : (latest_typed.breadth_pct ?? 0) < 40 ? 'text-red-400' : 'text-amber-400'}`}>
            {latest_typed.breadth_pct?.toFixed(0) ?? '—'}%
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">A-D Ratio</div>
          <div className="text-lg font-bold text-slate-200">{latest_typed.a_d_ratio?.toFixed(1) ?? '—'}</div>
          {avg_breadth_5d != null && <div className="text-xs text-slate-500">5d avg: {avg_breadth_5d}%</div>}
        </div>
      </div>

      {/* Breadth % chart with MA5 */}
      <div className="mb-1 text-xs text-slate-500">Breadth % (advances / total)</div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit="%" domain={[0, 100]} />
          <Tooltip contentStyle={tooltipStyle2} formatter={(v: number, name: string) => [`${Number(v).toFixed(1)}%`, name]} />
          <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />
          <Bar dataKey="Breadth" fill="#3b82f6" opacity={0.5} name="Breadth %" />
          <Line type="monotone" dataKey="MA5" stroke="#f59e0b" dot={false} strokeWidth={2} name="MA5" />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Cumulative A-D Line */}
      <div className="mt-3 mb-1 text-xs text-slate-500">Cumulative A-D Line (trend indicator)</div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: -16 }}>
          <defs>
            <linearGradient id="adGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <Tooltip contentStyle={tooltipStyle2} />
          <Area type="monotone" dataKey="ADLine" stroke="#a78bfa" fill="url(#adGrad)" strokeWidth={2} name="Cum A-D" dot={false} />
        </AreaChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-600 mt-2">
        Rising A-D line = broad participation. Divergence (index up, A-D flat) = concentration risk.
      </p>
    </div>
  );
}

// ── Sector Relative Strength ──────────────────────────────────────────────────

const RS_SIGNAL_CFG: Record<RsSignal, { label: string; color: string; dot: string }> = {
  outperforming:  { label: 'Outperforming ↑', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  fading_leader:  { label: 'Fading ↗',        color: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  recovering:     { label: 'Recovering ↗',    color: 'text-blue-400',    dot: 'bg-blue-400'    },
  neutral:        { label: 'Neutral →',        color: 'text-slate-400',   dot: 'bg-slate-400'   },
  underperforming:{ label: 'Lagging ↓',       color: 'text-red-400',     dot: 'bg-red-400'     },
};

function SectorRSPanel() {
  const { data, isLoading, error } = useSectorRS(60);

  if (isLoading) return (
    <div className="chart-card animate-pulse h-72 flex items-center justify-center text-slate-500 text-sm">
      Loading sector relative strength…
    </div>
  );

  if (error || !data || data.error || !data.series?.length) return (
    <div className="chart-card h-24 flex items-center justify-center text-slate-500 text-sm">
      Sector RS unavailable — market may be closed
    </div>
  );

  const { series, current, market_note, base_date } = data;
  const finCfg = RS_SIGNAL_CFG[current.financials_signal];
  const itCfg  = RS_SIGNAL_CFG[current.it_signal];

  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtRs  = (v: number) => v.toFixed(2);

  const noteColor =
    market_note.includes('conviction') ? 'text-emerald-300' :
    market_note.includes('narrow') || market_note.includes('avoid') ? 'text-red-300' :
    market_note.includes('fading') ? 'text-amber-300' : 'text-slate-400';

  const tt = {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: '8px', color: '#f1f5f9', fontSize: '11px',
  };

  return (
    <div className="chart-card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-cyan-400" />
          <div>
            <h2 className="text-lg font-semibold">Sector Relative Strength</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Financials & IT vs Nifty 50 · weight-adjusted from constituents · RS = 100 on {base_date}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center min-w-[90px]">
            <div className="text-xs text-slate-400 mb-0.5">Financials RS</div>
            <div className="text-lg font-bold text-blue-400">{fmtRs(current.financials_rs)}</div>
            <div className={`text-xs font-semibold mt-0.5 ${finCfg.color}`}>{finCfg.label}</div>
          </div>
          <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center min-w-[90px]">
            <div className="text-xs text-slate-400 mb-0.5">IT RS</div>
            <div className="text-lg font-bold text-violet-400">{fmtRs(current.it_rs)}</div>
            <div className={`text-xs font-semibold mt-0.5 ${itCfg.color}`}>{itCfg.label}</div>
          </div>
        </div>
      </div>

      {/* RS chart */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={series} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date"
            tick={{ fill: '#64748b', fontSize: 9 }}
            tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            interval="preserveStartEnd"
          />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 10 }} width={42} />
          <Tooltip
            contentStyle={tt}
            formatter={(v: unknown, name: string) => [
              `${Number(v).toFixed(2)}`,
              name === 'financials_rs' ? 'Financials RS' : 'IT RS',
            ]}
            labelFormatter={l => `Date: ${l}`}
          />
          <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 4" strokeWidth={1.5}
            label={{ value: '100 (parity)', fill: '#64748b', fontSize: 9, position: 'left' }} />
          <ReferenceArea y1={102} y2={130} fill="#22c55e" fillOpacity={0.04} />
          <ReferenceArea y1={70}  y2={98}  fill="#ef4444" fillOpacity={0.04} />
          <Line type="monotone" dataKey="financials_rs" stroke="#60a5fa" strokeWidth={2} dot={false} name="financials_rs" connectNulls />
          <Line type="monotone" dataKey="it_rs"         stroke="#a78bfa" strokeWidth={2} dot={false} name="it_rs"         connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Today's stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-slate-800/50 rounded p-2 text-center">
          <div className="text-xs text-slate-400">Nifty Today</div>
          <div className={`text-sm font-bold ${current.nifty_today_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtPct(current.nifty_today_pct)}
          </div>
        </div>
        <div className="bg-slate-800/50 rounded p-2 text-center">
          <div className="text-xs text-slate-400">Financials Today</div>
          <div className={`text-sm font-bold ${current.fin_today_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtPct(current.fin_today_pct)}
          </div>
          <div className={`text-xs ${current.fin_rel_today >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
            {fmtPct(current.fin_rel_today)} vs Nifty
          </div>
        </div>
        <div className="bg-slate-800/50 rounded p-2 text-center">
          <div className="text-xs text-slate-400">IT Today</div>
          <div className={`text-sm font-bold ${current.it_today_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtPct(current.it_today_pct)}
          </div>
          <div className={`text-xs ${current.it_rel_today >= 0 ? 'text-violet-400' : 'text-orange-400'}`}>
            {fmtPct(current.it_rel_today)} vs Nifty
          </div>
        </div>
        <div className="bg-slate-800/50 rounded p-2 text-center">
          <div className="text-xs text-slate-400">5-day Slope</div>
          <div className="text-xs font-semibold text-blue-400">Fin: {current.financials_5d_slope >= 0 ? '+' : ''}{current.financials_5d_slope}</div>
          <div className="text-xs font-semibold text-violet-400">IT: {current.it_5d_slope >= 0 ? '+' : ''}{current.it_5d_slope}</div>
          <div className="text-xs text-slate-600 mt-0.5">RS pts/day</div>
        </div>
      </div>

      <div className={`text-xs rounded px-3 py-2 bg-slate-800/40 border border-slate-700/30 ${noteColor}`}>
        {market_note}
      </div>

      <div className="flex gap-6 text-xs text-slate-500">
        <span><span className="text-blue-400 font-semibold">Blue</span> = Financials (13 stocks, ~35% weight)</span>
        <span><span className="text-violet-400 font-semibold">Purple</span> = IT (5 stocks, ~15% weight)</span>
        <span className="ml-auto">Above 100 = outperforming Nifty since {base_date}</span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Breadth() {
  const qc = useQueryClient();
  const { hideExpiry } = useDashboard();

  const { data, isLoading, error, refetch } = useQuery({
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
        <div className="text-slate-500 text-sm">{error instanceof Error ? error.message : 'Unknown error'}</div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
        >
          <RefreshCw size={14} /> Retry
        </button>
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

  const filteredVolSeries = volume_series;
  const filteredBreadthSeries = breadth_series;

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
          label="Vol Highs (60d)"
          value={String(summary.high_vol_count)}
          sub="stocks at 60d volume high"
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

      {/* Panel 8: Advance-Decline */}
      <AdvanceDeclinePanel />

      {/* Panel 9: Sector Relative Strength */}
      <SectorRSPanel />
    </div>
  );
}
