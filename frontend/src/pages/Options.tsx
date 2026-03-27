import { useQuery } from '@tanstack/react-query';
import { getOptionsAnalytics, PcrHistoryRow, OiWallRow, OiHeatmap } from '../lib/api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Cell, Legend,
  BarChart,
} from 'recharts';
import { useDashboard } from '../context/DashboardContext';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Eye, EyeOff, Info } from 'lucide-react';
import { useMemo } from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtVol = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
};

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const fmtStrike = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function StatCard({
  label, value, sub, color = 'text-white', icon,
}: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="stat-card">
      <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function ExpiryBadge({ isExpiry, daysToExpiry }: { isExpiry: boolean; daysToExpiry: number }) {
  if (!isExpiry) return null;
  return (
    <div className="flex items-center gap-2 bg-amber-900/40 border border-amber-600/40 rounded-lg px-3 py-2">
      <AlertTriangle size={14} className="text-amber-400" />
      <span className="text-amber-300 text-xs font-medium">
        Expiry week — {daysToExpiry}d left. OI signals unreliable.
      </span>
    </div>
  );
}

// ── Chart 1: PCR Trend ────────────────────────────────────────────────────────

function PcrTrendChart({ history, hideExpiry }: { history: PcrHistoryRow[]; hideExpiry: boolean }) {
  const data = useMemo(() => {
    const rows = hideExpiry ? history.filter(h => !h.is_expiry_week) : history;
    return rows;
  }, [history, hideExpiry]);

  // Detect crossover points for annotations
  const annotations = useMemo(() => {
    const ann: { date: string; label: string; color: string }[] = [];
    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1].pcr_oi;
      const curr = data[i].pcr_oi;
      if (prev < 1.2 && curr >= 1.2) {
        ann.push({ date: data[i].date, label: '↑ Put dom', color: '#ef4444' });
      } else if (prev > 0.7 && curr <= 0.7) {
        ann.push({ date: data[i].date, label: '↓ Call dom', color: '#22c55e' });
      }
    }
    return ann;
  }, [data]);

  // Expiry shading ranges
  const expiryRanges = useMemo(() => {
    if (hideExpiry) return [];
    const ranges: { start: string; end: string }[] = [];
    let inRange = false; let rs = '';
    for (const row of data) {
      if (row.is_expiry_week && !inRange) { inRange = true; rs = row.date; }
      else if (!row.is_expiry_week && inRange) { inRange = false; ranges.push({ start: rs, end: data[data.indexOf(row) - 1]?.date }); }
    }
    if (inRange && rs) ranges.push({ start: rs, end: data[data.length - 1]?.date });
    return ranges;
  }, [data, hideExpiry]);

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-lg font-semibold">PCR Trend</h2>
        <span className="text-xs text-slate-500 ml-2">PE OI / CE OI — front expiry</span>
      </div>
      <div className="flex gap-4 mb-4 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> OI PCR</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t-2 border-dashed border-orange-400 inline-block" /> Vol PCR</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-cyan-400 inline-block" /> 10d EMA</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string) => [
              Number(v).toFixed(3),
              name === 'pcr_oi' ? 'PCR (OI)' : name === 'pcr_vol' ? 'PCR (Vol)' : '10d EMA',
            ]}
            labelFormatter={(l) => `Date: ${l}`}
          />

          {/* Reference bands */}
          <ReferenceArea y1={0.7} y2={1.0} fill="#475569" fillOpacity={0.15} />
          <ReferenceArea y1={1.2} y2={2.5} fill="#ef4444" fillOpacity={0.08} />
          <ReferenceArea y1={0} y2={0.7} fill="#22c55e" fillOpacity={0.08} />
          <ReferenceLine y={1.2} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: '1.2', fill: '#ef4444', fontSize: 10 }} />
          <ReferenceLine y={0.7} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} label={{ value: '0.7', fill: '#22c55e', fontSize: 10 }} />

          {/* Expiry shading */}
          {expiryRanges.map((r, i) => (
            <ReferenceArea key={i} x1={r.start} x2={r.end} fill="#f59e0b" fillOpacity={0.08} />
          ))}

          {/* Crossover annotations */}
          {annotations.map((a, i) => (
            <ReferenceLine key={i} x={a.date} stroke={a.color} strokeDasharray="3 3"
              label={{ value: a.label, fill: a.color, fontSize: 9, position: 'top' }} />
          ))}

          <Line type="monotone" dataKey="pcr_oi" stroke="#60a5fa" dot={false} strokeWidth={2} name="pcr_oi" />
          <Line type="monotone" dataKey="pcr_vol" stroke="#fb923c" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="pcr_vol" />
          <Line type="monotone" dataKey="pcr_oi_ema10" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="pcr_oi_ema10" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 2: ATM Straddle Volume ──────────────────────────────────────────────

function StraddleVolumeChart({ history, hideExpiry }: { history: PcrHistoryRow[]; hideExpiry: boolean }) {
  const data = useMemo(() => {
    return (hideExpiry ? history.filter(h => !h.is_expiry_week) : history).map(h => ({
      ...h,
      is_elevated: h.straddle_ma20 != null && h.total_straddle_vol > h.straddle_ma20 * 1.5,
    }));
  }, [history, hideExpiry]);

  const expiryRanges = useMemo(() => {
    if (hideExpiry) return [];
    const ranges: { start: string; end: string }[] = [];
    let inRange = false; let rs = '';
    for (const row of data) {
      if (row.is_expiry_week && !inRange) { inRange = true; rs = row.date; }
      else if (!row.is_expiry_week && inRange) { inRange = false; ranges.push({ start: rs, end: data[data.indexOf(row) - 1]?.date }); }
    }
    if (inRange && rs) ranges.push({ start: rs, end: data[data.length - 1]?.date });
    return ranges;
  }, [data, hideExpiry]);

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">ATM Straddle Volume</h2>
        <span className="text-xs text-slate-500 ml-2">CE + PE volume at ATM strike</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis yAxisId="vol" tickFormatter={fmtVol} tick={{ fill: '#94a3b8', fontSize: 11 }} width={55} />
          {expiryRanges.map((r, i) => (
            <ReferenceArea key={i} x1={r.start} x2={r.end} fill="#f59e0b" fillOpacity={0.08} />
          ))}
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string) => [
              fmtVol(Number(v)),
              name === 'ce_straddle_vol' ? 'CE Vol' : name === 'pe_straddle_vol' ? 'PE Vol' : '20d MA',
            ]}
            labelFormatter={(l) => `Date: ${l}`}
          />
          <Bar yAxisId="vol" dataKey="ce_straddle_vol" stackId="s" fill="#a855f7" name="ce_straddle_vol" />
          <Bar yAxisId="vol" dataKey="pe_straddle_vol" stackId="s" fill="#94a3b8" name="pe_straddle_vol" />
          <Line yAxisId="vol" type="monotone" dataKey="straddle_ma20" stroke="#fbbf24" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="straddle_ma20" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-500 inline-block" /> CE Vol</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-400 inline-block" /> PE Vol</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-dashed border-yellow-400 inline-block" /> 20d MA</span>
        <span className="ml-auto text-slate-500 italic">{'>'} 1.5× MA = elevated hedging</span>
      </div>
    </div>
  );
}

// ── Chart 3: OI Wall ──────────────────────────────────────────────────────────

function OiWallChart({
  oi_wall, atm_strike, oi_wall_strike, max_pain,
}: { oi_wall: OiWallRow[]; atm_strike: number; oi_wall_strike: number; max_pain: number }) {
  // Mirror PE OI as negative for the butterfly chart
  const data = useMemo(() =>
    oi_wall.map(r => ({
      strike: r.strike,
      ce_oi: r.ce_oi,
      pe_oi_neg: -r.pe_oi,   // negative for left side
      total_oi: r.total_oi,
    })), [oi_wall]);

  const maxOi = Math.max(...oi_wall.map(r => Math.max(r.ce_oi, r.pe_oi)), 1);

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold">OI Wall</h2>
        <span className="text-xs text-slate-500 ml-2">ATM ± 10 strikes</span>
        <span className="ml-auto flex gap-2">
          <span className="bg-purple-900/50 border border-purple-600/40 rounded px-2 py-0.5 text-xs text-purple-300">
            OI Wall: {fmtStrike(oi_wall_strike)}
          </span>
          <span className="bg-amber-900/40 border border-amber-600/40 rounded px-2 py-0.5 text-xs text-amber-300">
            Max Pain: {fmtStrike(max_pain)}
          </span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={380}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 55 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis
            type="number"
            domain={[-maxOi * 1.1, maxOi * 1.1]}
            tickFormatter={(v) => fmtVol(Math.abs(v))}
            tick={{ fill: '#94a3b8', fontSize: 10 }}
          />
          <YAxis
            type="category"
            dataKey="strike"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickFormatter={(v) => `${v}`}
            width={52}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: unknown, name: string) => [
              fmtVol(Math.abs(Number(v))),
              name === 'ce_oi' ? 'CE OI' : 'PE OI',
            ]}
            labelFormatter={(l) => `Strike: ₹${l}`}
          />
          <ReferenceLine x={0} stroke="#475569" />
          {/* ATM strike horizontal dashed line */}
          <ReferenceLine y={atm_strike} stroke="#60a5fa" strokeDasharray="4 4"
            label={{ value: 'ATM', fill: '#60a5fa', fontSize: 10, position: 'right' }} />
          {max_pain !== atm_strike && (
            <ReferenceLine y={max_pain} stroke="#fbbf24" strokeDasharray="4 4"
              label={{ value: 'MaxPain', fill: '#fbbf24', fontSize: 10, position: 'right' }} />
          )}
          <Bar dataKey="pe_oi_neg" name="pe_oi" fill="#2dd4bf" radius={[0, 0, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.strike === oi_wall_strike ? '#f97316' : '#2dd4bf'}
                fillOpacity={d.strike === atm_strike ? 1 : 0.75}
              />
            ))}
          </Bar>
          <Bar dataKey="ce_oi" name="ce_oi" fill="#a855f7" radius={[0, 0, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.strike === oi_wall_strike ? '#f97316' : '#a855f7'}
                fillOpacity={d.strike === atm_strike ? 1 : 0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-purple-500 rounded-sm inline-block" /> CE OI →</span>
        <span className="flex items-center gap-1">← <span className="w-3 h-3 bg-teal-400 rounded-sm inline-block" /> PE OI</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-500 rounded-sm inline-block" /> Max OI wall</span>
      </div>
    </div>
  );
}

// ── Chart 4: OI Change Heatmap ────────────────────────────────────────────────

function OiHeatmapGrid({ heatmap, isExpiryWeek }: { heatmap: OiHeatmap; isExpiryWeek: boolean }) {
  const { dates, rows } = heatmap;

  const maxChange = useMemo(() => {
    let m = 1;
    for (const r of rows) {
      for (const v of [...r.ce_changes, ...r.pe_changes]) {
        if (Math.abs(v) > m) m = Math.abs(v);
      }
    }
    return m;
  }, [rows]);

  const cellColor = (v: number): string => {
    const intensity = Math.min(Math.abs(v) / maxChange, 1);
    if (v > 0) return `rgba(34,197,94,${0.15 + intensity * 0.7})`;
    if (v < 0) return `rgba(239,68,68,${0.15 + intensity * 0.7})`;
    return 'rgba(71,85,105,0.3)';
  };

  if (dates.length === 0) {
    return (
      <div className="chart-card">
        <h2 className="text-lg font-semibold mb-2">OI Change Heatmap</h2>
        <div className="text-slate-400 text-sm text-center py-8">
          Building history — data appears here after EOD snapshots accumulate (runs daily at 15:40 IST)
        </div>
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-lg font-semibold">OI Change Heatmap</h2>
        <span className="text-xs text-slate-500 ml-2">day-over-day, ATM ± 10 strikes</span>
        {isExpiryWeek && (
          <span className="ml-auto flex items-center gap-1 bg-amber-900/40 border border-amber-600/40 rounded px-2 py-0.5 text-xs text-amber-300">
            <Info size={10} /> Expiry closeout — OI reduction not a signal
          </span>
        )}
      </div>
      <div className="flex gap-2 text-xs text-slate-400 mb-3">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: 'rgba(34,197,94,0.7)' }} /> OI addition</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: 'rgba(239,68,68,0.7)' }} /> OI reduction</span>
      </div>

      <div className="flex gap-4 overflow-x-auto">
        {/* CE Side */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-purple-400 mb-2 text-center">CE OI Change</div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-slate-400 font-normal pr-2 text-right w-16">Strike</th>
                  {dates.map(d => (
                    <th key={d} className="text-slate-400 font-normal px-1 text-center min-w-[44px]">
                      {fmtDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(row => (
                  <tr key={row.strike}>
                    <td className="text-slate-300 pr-2 text-right font-mono">{row.strike}</td>
                    {row.ce_changes.map((v, ci) => (
                      <td key={ci} className="px-1 py-0.5 text-center font-mono text-xs"
                        style={{ backgroundColor: cellColor(v) }}
                        title={`${v > 0 ? '+' : ''}${fmtVol(v)}`}>
                        {v !== 0 ? (v > 0 ? '+' : '') + fmtVol(Math.abs(v)) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PE Side */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-teal-400 mb-2 text-center">PE OI Change</div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-slate-400 font-normal pr-2 text-right w-16">Strike</th>
                  {dates.map(d => (
                    <th key={d} className="text-slate-400 font-normal px-1 text-center min-w-[44px]">
                      {fmtDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(row => (
                  <tr key={row.strike}>
                    <td className="text-slate-300 pr-2 text-right font-mono">{row.strike}</td>
                    {row.pe_changes.map((v, ci) => (
                      <td key={ci} className="px-1 py-0.5 text-center font-mono text-xs"
                        style={{ backgroundColor: cellColor(v) }}
                        title={`${v > 0 ? '+' : ''}${fmtVol(v)}`}>
                        {v !== 0 ? (v > 0 ? '+' : '') + fmtVol(Math.abs(v)) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Options Page ─────────────────────────────────────────────────────────

export default function Options() {
  const { hideExpiry, setHideExpiry } = useDashboard();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['options-analytics'],
    queryFn: () => getOptionsAnalytics(),
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading options data…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="text-red-400" size={40} />
        <div className="text-red-400">Failed to load options data</div>
        <button onClick={() => refetch()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-[background-color,transform] duration-150 active:scale-[0.97]">Retry</button>
      </div>
    );
  }

  const { current, pcr_history, oi_wall, oi_change_today, oi_heatmap } = data;
  const pcrDir = current.pcr_oi_prev != null
    ? current.pcr_oi > current.pcr_oi_prev ? 'up' : current.pcr_oi < current.pcr_oi_prev ? 'down' : 'flat'
    : 'flat';

  const pcrColor =
    current.pcr_oi > 1.2 ? 'text-red-400' :
    current.pcr_oi < 0.7 ? 'text-green-400' : 'text-yellow-300';

  // Straddle interpretation
  const straddleInterpret =
    current.atm_ce_vol > current.atm_pe_vol * 1.2 ? '📈 Call heavy' :
    current.atm_pe_vol > current.atm_ce_vol * 1.2 ? '📉 Put heavy' : '⚖️ Balanced';

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Options OI & Sentiment</h1>
          <p className="text-slate-400 text-sm mt-1">
            Active expiry: <span className="text-blue-400 font-medium">{current.active_expiry}</span>
            {current.use_next_expiry && (
              <span className="ml-2 text-amber-400 text-xs">(switched to next — {current.days_to_expiry}d left on near)</span>
            )}
            <span className="ml-4 text-slate-500">Spot: <span className="text-white">{current.spot_price?.toLocaleString('en-IN')}</span></span>
            <span className="ml-3 text-slate-500">ATM: <span className="text-white">{current.atm_strike}</span></span>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ExpiryBadge isExpiry={current.is_expiry_week} daysToExpiry={current.days_to_expiry} />
          <button
            onClick={() => setHideExpiry(!hideExpiry)}
            className="btn-ghost"
          >
            {hideExpiry ? <Eye size={14} /> : <EyeOff size={14} />}
            {hideExpiry ? 'Show' : 'Hide'} Expiry Weeks
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="PCR (OI-based)"
          value={current.pcr_oi.toFixed(3)}
          sub={pcrDir === 'up' ? '↑ vs yesterday' : pcrDir === 'down' ? '↓ vs yesterday' : '→ unchanged'}
          color={pcrColor}
          icon={
            pcrDir === 'up' ? <TrendingUp size={12} className={pcrColor} /> :
            pcrDir === 'down' ? <TrendingDown size={12} className={pcrColor} /> :
            <Minus size={12} className="text-slate-400" />
          }
        />
        <StatCard
          label="PCR (Volume)"
          value={current.pcr_vol.toFixed(3)}
          sub="faster signal"
          color={current.pcr_vol > 1.2 ? 'text-red-400' : current.pcr_vol < 0.7 ? 'text-green-400' : 'text-yellow-300'}
        />
        <StatCard
          label="ATM Straddle"
          value={`₹${current.straddle_premium.toLocaleString('en-IN')}`}
          sub={straddleInterpret}
          color="text-cyan-400"
        />
        <StatCard
          label="OI Wall"
          value={`₹${current.oi_wall_strike?.toLocaleString('en-IN') ?? '—'}`}
          sub="max CE+PE OI strike"
          color="text-orange-400"
        />
        <StatCard
          label="Max Pain"
          value={`₹${current.max_pain?.toLocaleString('en-IN') ?? '—'}`}
          sub="option writer's breakeven"
          color="text-amber-400"
        />
      </div>

      {/* Expiry week PCR caveat */}
      {current.is_expiry_week && (
        <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-4 py-3 text-sm text-amber-300">
          <Info size={16} />
          <span>
            <strong>Expiry week:</strong> PCR is distorted by pin risk and mechanical rollovers.
            Trust volume PCR (<span className="font-mono">{current.pcr_vol.toFixed(3)}</span>) over OI PCR this week.
          </span>
        </div>
      )}

      {/* PCR History chart */}
      {pcr_history.length > 0 ? (
        <PcrTrendChart history={pcr_history} hideExpiry={hideExpiry} />
      ) : (
        <div className="chart-card text-center text-slate-400">
          PCR trend chart builds up over time as daily snapshots accumulate.
        </div>
      )}

      {/* Straddle Volume chart */}
      {pcr_history.length > 0 ? (
        <StraddleVolumeChart history={pcr_history} hideExpiry={hideExpiry} />
      ) : null}

      {/* OI Wall + OI Change Today in 2 columns */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OiWallChart
          oi_wall={oi_wall}
          atm_strike={current.atm_strike}
          oi_wall_strike={current.oi_wall_strike}
          max_pain={current.max_pain}
        />

        {/* OI Change Today (single-day from prev_oi) */}
        <div className="chart-card">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold">Today's OI Change</h2>
            <span className="text-xs text-slate-500 ml-2">vs prev close (from prev_oi)</span>
          </div>
          {oi_change_today.length > 0 ? (
            <div className="overflow-y-auto max-h-[360px]">
              <table className="text-xs w-full">
                <thead className="sticky top-0 bg-slate-800">
                  <tr>
                    <th className="text-slate-400 font-normal text-right pb-2 pr-4">Strike</th>
                    <th className="text-purple-400 font-medium text-right pb-2 pr-4">CE Δ OI</th>
                    <th className="text-teal-400 font-medium text-right pb-2">PE Δ OI</th>
                  </tr>
                </thead>
                <tbody>
                  {[...oi_change_today].reverse().map(row => (
                    <tr key={row.strike} className={row.strike === current.atm_strike ? 'bg-blue-900/20' : 'hover:bg-slate-700/30'}>
                      <td className="text-slate-300 text-right pr-4 font-mono py-0.5">
                        {row.strike === current.atm_strike && <span className="text-blue-400 mr-1 text-xs">ATM</span>}
                        {row.strike}
                      </td>
                      <td className={`text-right pr-4 font-mono py-0.5 ${row.ce_change > 0 ? 'text-green-400' : row.ce_change < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                        {row.ce_change > 0 ? '+' : ''}{fmtVol(row.ce_change)}
                      </td>
                      <td className={`text-right font-mono py-0.5 ${row.pe_change > 0 ? 'text-green-400' : row.pe_change < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                        {row.pe_change > 0 ? '+' : ''}{fmtVol(row.pe_change)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-slate-400 text-sm text-center py-8">No OI change data</div>
          )}
        </div>
      </div>

      {/* OI Change Heatmap */}
      <OiHeatmapGrid heatmap={oi_heatmap} isExpiryWeek={current.is_expiry_week} />
    </div>
  );
}
