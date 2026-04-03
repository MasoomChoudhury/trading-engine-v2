import { useQuery } from '@tanstack/react-query';
import { getOptionsAnalytics, PcrHistoryRow, OiWallRow, OiHeatmap, EdgeLabel, ChainGreeksRow, DteCurvePoint, AtmSummary, VolIndicatorPoint, VolSignal, StraddlePoint, PcrBias, PcrDivergenceSignal } from '../lib/api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Cell, Legend,
  BarChart, LineChart, AreaChart, Area,
} from 'recharts';
import { useDashboard } from '../context/DashboardContext';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Eye, EyeOff, Info, Zap, Target } from 'lucide-react';
import { useMemo } from 'react';
import { useIVSkew, useOITrend, useBuyersEdge, useVolIndicators, useStraddleIntraday, usePcrDivergence } from '../hooks/useIndicators';

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

// ── Panel 5: IV Skew ─────────────────────────────────────────────────────────

function IVSkewPanel() {
  const { data, isLoading, error } = useIVSkew();

  if (isLoading) return <div className="panel-card animate-pulse h-72 flex items-center justify-center text-slate-500 text-sm">Loading IV skew…</div>;
  if (error || !data) return <div className="panel-card h-28 flex items-center justify-center text-slate-500 text-sm">IV skew unavailable — market may be closed</div>;

  const { smile, atm_iv, rr25, rr10, fly25, skew_direction, skew_note, expiry_date, spot_price } = data;

  // Only include strikes with both call and put IV for the smile chart
  const smileData = smile.filter(s => s.call_iv != null || s.put_iv != null).map(s => ({
    strike: s.strike,
    call_iv: s.call_iv,
    put_iv: s.put_iv,
  }));

  const skewColor =
    skew_direction === 'put_skew' ? 'text-red-400' :
    skew_direction === 'call_skew' ? 'text-emerald-400' : 'text-slate-300';

  const rr25Color = (rr25 ?? 0) > 1 ? 'text-red-400' : (rr25 ?? 0) < -1 ? 'text-emerald-400' : 'text-slate-300';

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">IV Skew / Volatility Smile</h3>
          <p className="text-xs text-slate-500 mt-0.5">Expiry: {expiry_date} · Spot: ₹{spot_price?.toLocaleString('en-IN')}</p>
        </div>
        <div className={`text-xs font-semibold px-2 py-1 rounded ${
          skew_direction === 'put_skew' ? 'bg-red-900/40 text-red-300' :
          skew_direction === 'call_skew' ? 'bg-emerald-900/40 text-emerald-300' :
          'bg-slate-700/40 text-slate-400'
        }`}>
          {skew_direction === 'put_skew' ? 'Put Skew' : skew_direction === 'call_skew' ? 'Call Skew' : 'Neutral'}
        </div>
      </div>

      {/* Smile chart */}
      {smileData.length > 0 ? (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={smileData} margin={{ top: 4, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="strike" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={v => String(v)} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit="%" domain={['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v?.toFixed(1)}%`]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="call_iv" stroke="#34d399" dot={false} strokeWidth={2} name="Call IV" connectNulls />
            <Line type="monotone" dataKey="put_iv" stroke="#f87171" dot={false} strokeWidth={2} name="Put IV" connectNulls />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-32 flex items-center justify-center text-slate-500 text-sm">No IV smile data</div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">ATM IV</div>
          <div className="text-base font-bold text-amber-400">{atm_iv != null ? `${atm_iv.toFixed(1)}%` : '—'}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">25d RR</div>
          <div className={`text-base font-bold ${rr25Color}`}>{rr25 != null ? (rr25 > 0 ? '+' : '') + rr25.toFixed(2) : '—'}</div>
          <div className="text-xs text-slate-500">put−call vol</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">10d RR</div>
          <div className={`text-base font-bold ${((rr10 ?? 0) > 1) ? 'text-red-400' : ((rr10 ?? 0) < -1) ? 'text-emerald-400' : 'text-slate-300'}`}>
            {rr10 != null ? (rr10 > 0 ? '+' : '') + rr10.toFixed(2) : '—'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 text-center">
          <div className="text-xs text-slate-400">25d Fly</div>
          <div className="text-base font-bold text-violet-400">{fly25 != null ? fly25.toFixed(2) : '—'}</div>
          <div className="text-xs text-slate-500">wings vs ATM</div>
        </div>
      </div>

      {/* Skew note */}
      <div className={`mt-3 text-xs ${skewColor} bg-slate-800/40 rounded px-3 py-2`}>{skew_note}</div>
    </div>
  );
}

// ── Panel 7: OI Build-up Trend ────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  build: 'text-emerald-400',
  unwind: 'text-red-400',
  flat: 'text-slate-400',
  no_data: 'text-slate-600',
};
const STATUS_LABEL: Record<string, string> = {
  build: 'Build ↑',
  unwind: 'Unwind ↓',
  flat: 'Flat →',
  no_data: '—',
};

function OITrendPanel() {
  const { data, isLoading, error } = useOITrend(10);

  if (isLoading) return <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">Loading OI trend…</div>;
  if (error || !data || !data.series.length) return <div className="panel-card h-24 flex items-center justify-center text-slate-500 text-sm">OI trend unavailable — no historical snapshots yet</div>;

  const { series, dates, atm_strike, spot_price, expiry } = data;

  // Show ATM ± 5 strikes
  const atm_idx = series.findIndex(s => s.is_atm);
  const start = Math.max(0, atm_idx - 5);
  const end = Math.min(series.length, atm_idx + 6);
  const visible = series.slice(start, end).reverse(); // high strikes at top

  const shortDates = dates.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  });

  return (
    <div className="panel-card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">OI Build-up Trend</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Expiry: {expiry} · ATM: ₹{atm_strike?.toLocaleString('en-IN')} · Spot: ₹{spot_price?.toLocaleString('en-IN')}
          · {dates.length}-day window
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full min-w-[520px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-right pr-3 py-1 font-normal">Strike</th>
              <th className="text-center px-2 py-1 font-normal text-teal-400">CE OI Trend</th>
              <th className="text-center px-2 py-1 font-normal text-rose-400">PE OI Trend</th>
              {shortDates.map((d, i) => (
                <th key={i} className="text-center px-1 py-1 font-normal min-w-[52px]">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(s => (
              <tr key={s.strike} className={s.is_atm ? 'bg-blue-900/20' : ''}>
                <td className="text-right pr-3 font-mono py-0.5">
                  {s.is_atm && <span className="text-blue-400 mr-1">ATM</span>}
                  {s.strike.toLocaleString('en-IN')}
                </td>
                <td className={`text-center px-2 font-semibold ${STATUS_COLOR[s.ce_status]}`}>
                  {STATUS_LABEL[s.ce_status]}
                </td>
                <td className={`text-center px-2 font-semibold ${STATUS_COLOR[s.pe_status]}`}>
                  {STATUS_LABEL[s.pe_status]}
                </td>
                {s.ce_oi.map((v, i) => (
                  <td key={i} className="text-center px-1 py-0.5 font-mono text-slate-400 text-xs">
                    {v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span><span className="text-emerald-400 font-semibold">Build ↑</span> — fresh OI added</span>
        <span><span className="text-red-400 font-semibold">Unwind ↓</span> — OI being closed</span>
        <span><span className="text-slate-400">Flat →</span> — no meaningful change</span>
      </div>
    </div>
  );
}

// ── Intraday Momentum Proxies ─────────────────────────────────────────────────

const VOL_SIGNAL_CONFIG: Record<VolSignal, { label: string; color: string; bg: string }> = {
  bullish_confirmed:   { label: '✓ Bullish + Volume',   color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  bullish_unconfirmed: { label: '⚠ Bullish (no vol)',   color: 'text-yellow-400',  bg: 'bg-yellow-900/20'  },
  bearish_confirmed:   { label: '✓ Bearish + Volume',   color: 'text-red-400',     bg: 'bg-red-900/30'     },
  bearish_unconfirmed: { label: '⚠ Bearish (no vol)',   color: 'text-orange-400',  bg: 'bg-orange-900/20'  },
  neutral:             { label: '⊖ Neutral',            color: 'text-slate-400',   bg: 'bg-slate-800/40'   },
  mixed:               { label: '⟳ Mixed',              color: 'text-slate-400',   bg: 'bg-slate-800/40'   },
  no_data:             { label: '— No data',            color: 'text-slate-600',   bg: 'bg-slate-800/30'   },
  insufficient_data:   { label: '— Building data',      color: 'text-slate-600',   bg: 'bg-slate-800/30'   },
};

const PCR_SIGNAL_CONFIG: Record<PcrDivergenceSignal, { label: string; color: string; bg: string; icon: string }> = {
  counter_trend_bounce: { label: 'Counter-Trend Bounce',  color: 'text-amber-400',   bg: 'bg-amber-900/20',   icon: '⚡' },
  short_term_pullback:  { label: 'Short-Term Pullback',   color: 'text-blue-400',    bg: 'bg-blue-900/20',    icon: '↩' },
  aligned_bullish:      { label: 'Aligned Bullish',       color: 'text-emerald-400', bg: 'bg-emerald-900/20', icon: '↑' },
  aligned_bearish:      { label: 'Aligned Bearish',       color: 'text-red-400',     bg: 'bg-red-900/30',     icon: '↓' },
  neutral:              { label: 'Neutral',               color: 'text-slate-400',   bg: 'bg-slate-800/40',   icon: '→' },
};

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

// ── Panel A: Volume-Weighted MACD + RSI ───────────────────────────────────────

function VwMacdRsiPanel() {
  const { data, isLoading } = useVolIndicators('5min', 78); // ~6.5 hrs of 5-min candles

  if (isLoading) return <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">Loading VW indicators…</div>;
  if (!data || !data.series.length) return (
    <div className="panel-card h-28 flex items-center justify-center text-slate-500 text-sm">
      VW indicators unavailable — market may be closed
    </div>
  );

  const sig = VOL_SIGNAL_CONFIG[data.signal] ?? VOL_SIGNAL_CONFIG.no_data;
  const tt = { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '11px' };

  // Format x-axis labels to HH:MM
  const chartData = data.series.map(p => ({ ...p, time: fmtTime(p.timestamp) }));

  return (
    <div className="panel-card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">MACD + RSI</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {data.price_only_mode
              ? 'Price-based RSI & MACD — index has no volume data'
              : 'VW-RSI mutes low-volume noise · VW-MACD uses rolling VWAP · 5-min bars'}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${sig.bg} ${sig.color}`}>
          {sig.label}
        </span>
      </div>

      {/* VW-RSI */}
      <div>
        <div className="text-xs text-slate-500 mb-1">VW-RSI (14)</div>
        <ResponsiveContainer width="100%" height={100}>
          <ComposedChart data={chartData} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} width={30} />
            <Tooltip contentStyle={tt} formatter={(v: unknown) => [Number(v).toFixed(1), 'VW-RSI']} />
            <ReferenceArea y1={65} y2={100} fill="#22c55e" fillOpacity={0.06} />
            <ReferenceArea y1={0} y2={35} fill="#ef4444" fillOpacity={0.06} />
            <ReferenceLine y={65} stroke="#22c55e" strokeDasharray="3 3" strokeWidth={1} />
            <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
            <ReferenceLine y={50} stroke="#475569" strokeDasharray="2 4" strokeWidth={1} />
            <Line type="monotone" dataKey="vrsi" stroke="#a78bfa" dot={false} strokeWidth={2} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* VW-MACD histogram */}
      <div>
        <div className="text-xs text-slate-500 mb-1">VW-MACD (12/26/9 on rolling VWAP)</div>
        <ResponsiveContainer width="100%" height={110}>
          <ComposedChart data={chartData} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={42} />
            <Tooltip contentStyle={tt} formatter={(v: unknown, name: string) => [Number(v).toFixed(4), name === 'vwmacd_hist' ? 'Histogram' : name === 'vwmacd' ? 'MACD' : 'Signal']} />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
            <Bar dataKey="vwmacd_hist" name="vwmacd_hist" radius={[1,1,0,0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={(entry.vwmacd_hist ?? 0) >= 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="vwmacd" stroke="#60a5fa" dot={false} strokeWidth={1.5} connectNulls name="vwmacd" />
            <Line type="monotone" dataKey="vwmacd_signal" stroke="#f97316" dot={false} strokeWidth={1.5} strokeDasharray="4 2" connectNulls name="vwmacd_signal" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1">
        <span><span className="text-emerald-400 font-semibold">Confirmed</span> = price move supported by above-avg volume</span>
        <span><span className="text-amber-400 font-semibold">Unconfirmed</span> = price moved on thin volume = potential trap</span>
      </div>
    </div>
  );
}

// ── Panel B: ATM Straddle Premium Decay ───────────────────────────────────────

function StraddleDecayPanel() {
  const { data, isLoading } = useStraddleIntraday();

  if (isLoading) return <div className="panel-card animate-pulse h-56 flex items-center justify-center text-slate-500 text-sm">Loading straddle data…</div>;

  const signalColor = !data ? 'text-slate-500' :
    data.decay_signal === 'iv_crush_warning' ? 'text-red-400' :
    data.decay_signal === 'iv_expansion' ? 'text-emerald-400' : 'text-slate-400';

  const signalBg = !data ? '' :
    data.decay_signal === 'iv_crush_warning' ? 'bg-red-900/20 border border-red-800/30' :
    data.decay_signal === 'iv_expansion' ? 'bg-emerald-900/20 border border-emerald-800/30' :
    'bg-slate-800/40 border border-slate-700/30';

  const snapshots = data?.snapshots ?? [];
  const chartData = snapshots.map(p => ({ ...p, time: fmtTime(p.timestamp) }));

  const tt = { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '11px' };

  return (
    <div className="panel-card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">ATM Straddle Premium Decay</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Spot vs CE+PE straddle price intraday · saved every 5 min
          </p>
        </div>
        {data && (
          <span className={`text-xs font-semibold px-2 py-1 rounded ${signalColor} ${signalBg}`}>
            {data.decay_signal === 'iv_crush_warning' ? '⚠ IV Crush' :
             data.decay_signal === 'iv_expansion' ? '↑ IV Expanding' : '✓ Normal'}
          </span>
        )}
      </div>

      {chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis yAxisId="spot" tick={{ fill: '#60a5fa', fontSize: 10 }} width={52} domain={['auto', 'auto']} tickFormatter={v => v.toLocaleString('en-IN')} />
            <YAxis yAxisId="str" orientation="right" tick={{ fill: '#f97316', fontSize: 10 }} width={42} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={tt}
              formatter={(v: unknown, name: string) => [
                name === 'spot' ? `₹${Number(v).toLocaleString('en-IN')}` : `₹${Number(v).toFixed(1)}`,
                name === 'spot' ? 'Nifty Spot' : 'Straddle',
              ]}
            />
            <Line yAxisId="spot" type="monotone" dataKey="spot" stroke="#60a5fa" dot={false} strokeWidth={2} name="spot" connectNulls />
            <Line yAxisId="str" type="monotone" dataKey="straddle_price" stroke="#f97316" dot={false} strokeWidth={2} name="straddle_price" connectNulls strokeDasharray="5 2" />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-32 flex items-center justify-center text-slate-500 text-sm text-center px-4">
          Snapshots accumulate every 5 minutes during market hours.<br />
          <span className="text-xs text-slate-600 mt-1 block">Check back once market opens.</span>
        </div>
      )}

      {data && (
        <div className={`text-xs rounded px-3 py-2 ${signalColor} ${signalBg || 'bg-slate-800/30'}`}>
          {data.note}
        </div>
      )}

      <div className="flex gap-4 text-xs text-slate-500">
        <span><span className="text-blue-400 font-semibold">Blue</span> = Nifty spot (left axis)</span>
        <span><span className="text-orange-400 font-semibold">Orange dashed</span> = straddle price (right axis)</span>
      </div>
    </div>
  );
}

// ── Panel C: Monthly vs Weekly PCR Divergence ─────────────────────────────────

function PcrDivergencePanel() {
  const { data, isLoading } = usePcrDivergence();

  if (isLoading) return <div className="panel-card animate-pulse h-48 flex items-center justify-center text-slate-500 text-sm">Loading PCR divergence…</div>;
  if (!data || 'error' in data) return (
    <div className="panel-card h-24 flex items-center justify-center text-slate-500 text-sm">
      PCR divergence unavailable — need ≥ 2 active expiries
    </div>
  );

  const sigCfg = PCR_SIGNAL_CONFIG[data.signal] ?? PCR_SIGNAL_CONFIG.neutral;
  const biasBadge = (bias: PcrBias) =>
    bias === 'bullish' ? 'text-emerald-400 bg-emerald-900/20' :
    bias === 'bearish' ? 'text-red-400 bg-red-900/20' : 'text-slate-400 bg-slate-800/40';
  const biasLabel = (bias: PcrBias) =>
    bias === 'bullish' ? 'Put-heavy ↑' : bias === 'bearish' ? 'Call-heavy ↓' : 'Neutral';

  return (
    <div className="panel-card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Monthly vs Weekly PCR Divergence</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Weekly: {data.near_expiry} · Monthly proxy: {data.monthly_expiry}
          </p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${sigCfg.bg} ${sigCfg.color}`}>
          {sigCfg.icon} {sigCfg.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Weekly */}
        <div className="bg-slate-800/60 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-2 font-medium">Weekly (Near) PCR</div>
          <div className="text-2xl font-bold text-slate-100">{data.near_pcr_oi.toFixed(3)}</div>
          <div className="text-xs text-slate-500 mt-0.5">PCR OI</div>
          <span className={`text-xs font-semibold mt-2 inline-block px-2 py-0.5 rounded ${biasBadge(data.near_bias)}`}>
            {biasLabel(data.near_bias)}
          </span>
          <div className="mt-2 text-xs text-slate-500">Vol PCR: {data.near_pcr_vol.toFixed(3)}</div>
        </div>

        {/* Monthly */}
        <div className="bg-slate-800/60 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-2 font-medium">Monthly (Far) PCR</div>
          <div className="text-2xl font-bold text-slate-100">{data.monthly_pcr_oi.toFixed(3)}</div>
          <div className="text-xs text-slate-500 mt-0.5">PCR OI</div>
          <span className={`text-xs font-semibold mt-2 inline-block px-2 py-0.5 rounded ${biasBadge(data.monthly_bias)}`}>
            {biasLabel(data.monthly_bias)}
          </span>
          <div className="mt-2 text-xs text-slate-500">Vol PCR: {data.monthly_pcr_vol.toFixed(3)}</div>
        </div>
      </div>

      <div className={`text-xs rounded px-3 py-2 leading-relaxed ${sigCfg.color} ${sigCfg.bg}`}>
        {data.note}
      </div>

      <div className="text-xs text-slate-600 mt-1">
        PCR ≥ 1.0 = put-heavy (floor support) · PCR ≤ 0.75 = call-heavy (ceiling resistance)
      </div>
    </div>
  );
}

function IntradayMomentumSection() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp size={18} className="text-cyan-400" />
        <h2 className="text-lg font-bold text-slate-100">Intraday Momentum Proxies</h2>
        <span className="text-xs text-slate-500 ml-1">surviving without Level 2 data</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <VwMacdRsiPanel />
        <div className="space-y-4">
          <StraddleDecayPanel />
          <PcrDivergencePanel />
        </div>
      </div>
    </div>
  );
}

// ── Buyer's Toolkit ───────────────────────────────────────────────────────────

const EDGE_CONFIG: Record<EdgeLabel, { label: string; color: string; bg: string }> = {
  strong:  { label: 'Strong',   color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  edge:    { label: 'Edge',     color: 'text-green-300',   bg: 'bg-green-900/20'   },
  tight:   { label: 'Tight',    color: 'text-amber-400',   bg: 'bg-amber-900/20'   },
  no_edge: { label: 'No Edge',  color: 'text-red-400',     bg: 'bg-red-900/20'     },
  no_data: { label: '—',        color: 'text-slate-500',   bg: 'bg-slate-800/40'   },
};

const ZONE_COLOR: Record<string, string> = {
  danger:  '#ef4444',
  warning: '#f97316',
  caution: '#f59e0b',
  normal:  '#60a5fa',
};

function fmt2(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

function fmtV(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function EdgeBadge({ label }: { label: EdgeLabel }) {
  const cfg = EDGE_CONFIG[label] ?? EDGE_CONFIG.no_data;
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function AtmGreeksCards({ atm, atr, dte, dteNote }: {
  atm: AtmSummary; atr: number | null; dte: number; dteNote: string;
}) {
  const dteColor = dte === 0 ? 'text-red-400' : dte <= 1 ? 'text-red-400' : dte <= 3 ? 'text-amber-400' : dte <= 7 ? 'text-yellow-300' : 'text-emerald-400';
  const atmIV = (atm.ce_iv != null && atm.pe_iv != null)
    ? ((atm.ce_iv + atm.pe_iv) / 2).toFixed(1)
    : atm.ce_iv?.toFixed(1) ?? atm.pe_iv?.toFixed(1) ?? '—';

  return (
    <div className="space-y-3">
      {/* DTE warning banner */}
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
        dte <= 3 ? 'bg-red-900/20 border border-red-800/30 text-red-300' :
        dte <= 7 ? 'bg-amber-900/20 border border-amber-800/30 text-amber-300' :
        'bg-slate-800/40 border border-slate-700/30 text-slate-400'
      }`}>
        <Target size={12} />
        <span className="font-semibold">{dteNote}</span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <div className="stat-card text-center">
          <div className="text-xs text-slate-400 mb-1">DTE</div>
          <div className={`text-xl font-bold ${dteColor}`}>{dte}</div>
          <div className="text-xs text-slate-500">days left</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-xs text-slate-400 mb-1">ATR(14)</div>
          <div className="text-xl font-bold text-cyan-400">{atr != null ? `₹${atr.toFixed(0)}` : '—'}</div>
          <div className="text-xs text-slate-500">daily move</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-xs text-slate-400 mb-1">ATM IV</div>
          <div className="text-xl font-bold text-amber-400">{atmIV !== '—' ? `${atmIV}%` : '—'}</div>
          <div className="text-xs text-slate-500">implied vol</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-xs text-slate-400 mb-1">CE Delta</div>
          <div className="text-xl font-bold text-blue-400">{fmt2(atm.ce_delta)}</div>
          <div className="text-xs text-slate-500">call sensitivity</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-xs text-slate-400 mb-1">CE Theta</div>
          <div className="text-xl font-bold text-red-400">{atm.ce_theta != null ? `₹${fmt2(atm.ce_theta)}` : '—'}</div>
          <div className="text-xs text-slate-500">daily decay</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-xs text-slate-400 mb-1">CE Vega</div>
          <div className="text-xl font-bold text-violet-400">{atm.ce_vega != null ? `₹${fmt2(atm.ce_vega)}` : '—'}</div>
          <div className="text-xs text-slate-500">per 1% IV</div>
        </div>
      </div>

      {/* Buyer's Edge ATM summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/60 rounded-lg p-3 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 mb-1">CE Buyer's Edge</div>
            <div className="text-lg font-bold text-slate-100">{fmt2(atm.ce_buyers_edge)}×</div>
            <div className="text-xs text-slate-500">ATR×|Δ| / |Θ|</div>
          </div>
          <EdgeBadge label={atm.ce_edge_label} />
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 mb-1">PE Buyer's Edge</div>
            <div className="text-lg font-bold text-slate-100">{fmt2(atm.pe_buyers_edge)}×</div>
            <div className="text-xs text-slate-500">ATR×|Δ| / |Θ|</div>
          </div>
          <EdgeBadge label={atm.pe_edge_label} />
        </div>
      </div>
    </div>
  );
}

function DteDecayCurve({ curve, dte }: { curve: DteCurvePoint[]; dte: number }) {
  if (!curve.length) return null;

  // Only show up to max 30 DTE for readability
  const displayCurve = curve.filter(p => p.dte <= Math.min(dte, 30));

  const tooltipStyle = {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f1f5f9',
    fontSize: '12px',
  };

  return (
    <div className="chart-card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Zap size={14} className="text-amber-400" />
          DTE Theta Decay Curve
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          How theta accelerates as expiry approaches · model: θ ∝ 1/√DTE
        </p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={displayCurve} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="thetaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="dte" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'DTE', position: 'insideBottomRight', fill: '#64748b', fontSize: 10 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={45} tickFormatter={v => `₹${v}`} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: unknown) => [`₹${Number(v).toFixed(2)}`, 'Theta/day']}
            labelFormatter={(l) => `${l} DTE`}
          />
          {/* Zone reference lines */}
          <ReferenceLine x={3} stroke="#ef4444" strokeDasharray="3 3" label={{ value: '3DTE', fill: '#ef4444', fontSize: 9 }} />
          <ReferenceLine x={7} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '7DTE', fill: '#f59e0b', fontSize: 9 }} />
          {/* Current DTE marker */}
          <ReferenceLine x={dte} stroke="#60a5fa" strokeWidth={2} label={{ value: 'NOW', fill: '#60a5fa', fontSize: 9 }} />
          <Area type="monotone" dataKey="theta_per_day" stroke="#f59e0b" fill="url(#thetaGrad)" strokeWidth={2} dot={false} name="theta_per_day" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 text-xs text-slate-500">
        <span><span className="text-blue-400 font-semibold">Blue line</span> = today (DTE {dte})</span>
        <span><span className="text-amber-400 font-semibold">Amber</span> = 7 DTE warning</span>
        <span><span className="text-red-400 font-semibold">Red</span> = 3 DTE danger</span>
      </div>
    </div>
  );
}

function OptionChainTable({ chain, spot }: { chain: ChainGreeksRow[]; spot: number }) {
  // Show ATM ± 8 strikes by default
  const atmIdx = chain.findIndex(r => r.is_atm);
  const start = Math.max(0, atmIdx - 8);
  const end = Math.min(chain.length, atmIdx + 9);
  const visible = chain.slice(start, end);

  return (
    <div className="panel-card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Option Chain — Greeks Snapshot</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          ATM ± 8 strikes · Spot: ₹{spot.toLocaleString('en-IN')}
          <span className="ml-2 text-slate-600">IV in % · Theta in ₹/day · Edge = ATR×|Δ|/|Θ|</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full min-w-[900px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-700">
              {/* CE side */}
              <th className="text-right pr-2 py-1.5 font-medium text-emerald-400 w-14">Edge</th>
              <th className="text-right pr-2 py-1.5 font-normal w-10">Vega</th>
              <th className="text-right pr-2 py-1.5 font-normal w-10">Theta</th>
              <th className="text-right pr-2 py-1.5 font-normal w-10">Delta</th>
              <th className="text-right pr-2 py-1.5 font-normal w-10">IV%</th>
              <th className="text-right pr-2 py-1.5 font-normal w-12">Vol</th>
              <th className="text-right pr-2 py-1.5 font-semibold text-emerald-400 w-14">CE LTP</th>
              {/* Strike */}
              <th className="text-center px-3 py-1.5 font-bold text-slate-200 w-20 bg-slate-800/60">STRIKE</th>
              {/* PE side */}
              <th className="text-left pl-2 py-1.5 font-semibold text-rose-400 w-14">PE LTP</th>
              <th className="text-left pl-2 py-1.5 font-normal w-12">Vol</th>
              <th className="text-left pl-2 py-1.5 font-normal w-10">IV%</th>
              <th className="text-left pl-2 py-1.5 font-normal w-10">Delta</th>
              <th className="text-left pl-2 py-1.5 font-normal w-10">Theta</th>
              <th className="text-left pl-2 py-1.5 font-normal w-10">Vega</th>
              <th className="text-left pl-2 py-1.5 font-medium text-rose-400 w-14">Edge</th>
            </tr>
          </thead>
          <tbody>
            {[...visible].reverse().map(row => {
              const isAtm = row.is_atm;
              const rowCls = isAtm ? 'bg-blue-900/20 border-y border-blue-800/40' : 'hover:bg-slate-800/30';
              const ceDelta = row.ce_delta ?? 0;
              const peDelta = Math.abs(row.pe_delta ?? 0);
              // Color CE LTP by moneyness
              const ceLtpColor = ceDelta > 0.5 ? 'text-emerald-300' : ceDelta > 0.3 ? 'text-emerald-400' : 'text-slate-300';
              const peLtpColor = peDelta > 0.5 ? 'text-rose-300' : peDelta > 0.3 ? 'text-rose-400' : 'text-slate-300';

              return (
                <tr key={row.strike} className={`${rowCls} transition-colors`}>
                  {/* CE side */}
                  <td className="text-right pr-2 py-1">
                    <EdgeBadge label={row.ce_edge_label} />
                  </td>
                  <td className="text-right pr-2 py-1 font-mono text-violet-400">{fmt2(row.ce_vega)}</td>
                  <td className="text-right pr-2 py-1 font-mono text-red-400">{fmt2(row.ce_theta)}</td>
                  <td className="text-right pr-2 py-1 font-mono text-blue-400">{fmt2(row.ce_delta)}</td>
                  <td className="text-right pr-2 py-1 font-mono text-amber-400">
                    {row.ce_iv != null ? row.ce_iv.toFixed(1) : '—'}
                  </td>
                  <td className="text-right pr-2 py-1 font-mono text-slate-400">{fmtV(row.ce_volume)}</td>
                  <td className={`text-right pr-2 py-1 font-bold font-mono ${ceLtpColor}`}>
                    {row.ce_ltp > 0 ? row.ce_ltp.toFixed(1) : '—'}
                  </td>
                  {/* Strike */}
                  <td className="text-center px-3 py-1 font-bold font-mono bg-slate-800/60">
                    {isAtm && <span className="text-blue-400 text-xs mr-1">ATM</span>}
                    {row.strike.toLocaleString('en-IN')}
                  </td>
                  {/* PE side */}
                  <td className={`text-left pl-2 py-1 font-bold font-mono ${peLtpColor}`}>
                    {row.pe_ltp > 0 ? row.pe_ltp.toFixed(1) : '—'}
                  </td>
                  <td className="text-left pl-2 py-1 font-mono text-slate-400">{fmtV(row.pe_volume)}</td>
                  <td className="text-left pl-2 py-1 font-mono text-amber-400">
                    {row.pe_iv != null ? row.pe_iv.toFixed(1) : '—'}
                  </td>
                  <td className="text-left pl-2 py-1 font-mono text-blue-400">{fmt2(row.pe_delta)}</td>
                  <td className="text-left pl-2 py-1 font-mono text-red-400">{fmt2(row.pe_theta)}</td>
                  <td className="text-left pl-2 py-1 font-mono text-violet-400">{fmt2(row.pe_vega)}</td>
                  <td className="text-left pl-2 py-1">
                    <EdgeBadge label={row.pe_edge_label} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        {Object.entries(EDGE_CONFIG).filter(([k]) => k !== 'no_data').map(([k, v]) => (
          <span key={k} className={v.color}><span className="font-semibold">{v.label}</span>
            {k === 'strong' && ' (≥3×)'}
            {k === 'edge' && ' (1.5–3×)'}
            {k === 'tight' && ' (0.8–1.5×)'}
            {k === 'no_edge' && ' (<0.8×)'}
          </span>
        ))}
        <span className="ml-auto">Edge = ATR(14)×|Delta| / |Theta|</span>
      </div>
    </div>
  );
}

function BuyersToolkitPanel() {
  const { data, isLoading, error } = useBuyersEdge();

  if (isLoading) return (
    <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">
      Loading Buyer's Toolkit…
    </div>
  );

  if (error || !data) return (
    <div className="panel-card h-24 flex items-center justify-center text-slate-500 text-sm">
      Greeks unavailable — market may be closed or token expired
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Zap size={18} className="text-amber-400" />
        <h2 className="text-lg font-bold text-slate-100">Buyer's Survival Toolkit</h2>
        <span className="text-xs text-slate-500 ml-1">
          Expiry: {data.expiry} · {data.dte}d left
        </span>
      </div>

      {/* ATM Greeks + Edge cards */}
      {data.atm && (
        <AtmGreeksCards
          atm={data.atm}
          atr={data.atr_14}
          dte={data.dte}
          dteNote={data.dte_note}
        />
      )}

      {/* Option chain table + DTE decay side by side on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <OptionChainTable chain={data.chain} spot={data.spot} />
        </div>
        <div>
          <DteDecayCurve curve={data.decay_curve} dte={data.dte} />
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

      {/* Panel 5: IV Skew */}
      <IVSkewPanel />

      {/* Panel 7: OI Build-up Trend */}
      <OITrendPanel />

      {/* Panel 8: Intraday Momentum Proxies */}
      <IntradayMomentumSection />

      {/* Panel 9: Buyer's Toolkit */}
      <BuyersToolkitPanel />
    </div>
  );
}
