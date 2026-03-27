import { useState } from 'react';
import { useIndicators, useCandles, useIndicatorSeries, useGEX } from '../hooks/useIndicators';
import type { IndicatorRow, GEX } from '../lib/api';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart, Bar,
} from 'recharts';

const INTERVALS = ['1min', '5min', '15min', '1hour', '1day'] as const;

// ── Column definitions ────────────────────────────────────────────────────────
type RowColDef = {
  source: 'row';
  key: keyof IndicatorRow;
  label: string;
  group: string;
  fmt?: (v: unknown) => string;
  color?: (v: unknown) => string;
};

type GexColDef = {
  source: 'gex';
  key: keyof GEX;
  label: string;
  group: string;
  fmt?: (v: unknown) => string;
  color?: (v: unknown) => string;
};

type ColDef = RowColDef | GexColDef;

const n2 = (v: unknown) => v != null ? Number(v).toFixed(2) : '—';
const n4 = (v: unknown) => v != null ? Number(v).toFixed(4) : '—';
const nBig = (v: unknown) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toFixed(2);
};

const COLUMNS: ColDef[] = [
  // Price
  { source: 'row', key: 'close',  label: 'Close',  group: 'Price', fmt: n2 },
  { source: 'row', key: 'open',   label: 'Open',   group: 'Price', fmt: n2 },
  { source: 'row', key: 'high',   label: 'High',   group: 'Price', fmt: n2 },
  { source: 'row', key: 'low',    label: 'Low',    group: 'Price', fmt: n2 },
  { source: 'row', key: 'volume', label: 'Volume', group: 'Price',
    fmt: (v) => v != null ? Number(v).toLocaleString() : '—' },
  // RSI
  { source: 'row', key: 'rsi_14', label: 'RSI(14)', group: 'RSI', fmt: n2,
    color: (v) => v == null ? '' : Number(v) > 70 ? 'text-red-400' : Number(v) < 30 ? 'text-emerald-400' : 'text-slate-300' },
  // Moving Averages
  { source: 'row', key: 'ema_20',  label: 'EMA 20',  group: 'MA', fmt: n2 },
  { source: 'row', key: 'ema_21',  label: 'EMA 21',  group: 'MA', fmt: n2 },
  { source: 'row', key: 'ema_50',  label: 'EMA 50',  group: 'MA', fmt: n2 },
  { source: 'row', key: 'sma_200', label: 'SMA 200', group: 'MA', fmt: n2 },
  // MACD
  { source: 'row', key: 'macd_line',   label: 'MACD',      group: 'MACD', fmt: n4 },
  { source: 'row', key: 'macd_signal', label: 'Signal',    group: 'MACD', fmt: n4 },
  { source: 'row', key: 'macd_hist',   label: 'Histogram', group: 'MACD', fmt: n4,
    color: (v) => v == null ? '' : Number(v) > 0 ? 'text-emerald-400' : 'text-red-400' },
  // Bollinger Bands
  { source: 'row', key: 'bb_upper',     label: 'BB Upper', group: 'Bollinger', fmt: n2 },
  { source: 'row', key: 'bb_middle',    label: 'BB Mid',   group: 'Bollinger', fmt: n2 },
  { source: 'row', key: 'bb_lower',     label: 'BB Lower', group: 'Bollinger', fmt: n2 },
  { source: 'row', key: 'bb_bandwidth', label: 'BB BW',    group: 'Bollinger', fmt: n4 },
  // Supertrend
  { source: 'row', key: 'supertrend',     label: 'Value',     group: 'Supertrend', fmt: n2 },
  { source: 'row', key: 'supertrend_dir', label: 'Direction', group: 'Supertrend',
    fmt: (v) => v ? String(v) : '—',
    color: (v) => v === 'bullish' ? 'text-emerald-400' : 'text-red-400' },
  // Stochastic RSI
  { source: 'row', key: 'stoch_k', label: '%K', group: 'StochRSI', fmt: n2 },
  { source: 'row', key: 'stoch_d', label: '%D', group: 'StochRSI', fmt: n2 },
  // ADX
  { source: 'row', key: 'adx',      label: 'ADX', group: 'ADX', fmt: n2 },
  { source: 'row', key: 'plus_di',  label: '+DI', group: 'ADX', fmt: n2, color: () => 'text-emerald-400' },
  { source: 'row', key: 'minus_di', label: '-DI', group: 'ADX', fmt: n2, color: () => 'text-red-400' },
  // ATR & VWAP
  { source: 'row', key: 'atr_14', label: 'ATR(14)', group: 'ATR',  fmt: n2 },
  { source: 'row', key: 'vwap',   label: 'VWAP',    group: 'VWAP', fmt: n2 },
  // GEX (latest snapshot — same value for all rows)
  { source: 'gex', key: 'net_gex',           label: 'Net GEX',     group: 'GEX', fmt: nBig,
    color: (v) => v == null ? '' : Number(v) > 0 ? 'text-emerald-400' : 'text-red-400' },
  { source: 'gex', key: 'total_gex',         label: 'Total GEX',   group: 'GEX', fmt: nBig },
  { source: 'gex', key: 'regime',            label: 'Regime',      group: 'GEX',
    fmt: (v) => v ? String(v).replace(/_/g, ' ') : '—',
    color: (v) => String(v).includes('positive') ? 'text-emerald-400' : 'text-red-400' },
  { source: 'gex', key: 'zero_gamma_level',  label: 'Zero Gamma',  group: 'GEX', fmt: n2 },
  { source: 'gex', key: 'call_wall',         label: 'Call Wall',   group: 'GEX', fmt: n2, color: () => 'text-red-400' },
  { source: 'gex', key: 'put_wall',          label: 'Put Wall',    group: 'GEX', fmt: n2, color: () => 'text-emerald-400' },
  { source: 'gex', key: 'pcr',               label: 'PCR',         group: 'GEX', fmt: n4 },
  { source: 'gex', key: 'call_wall_distance', label: 'CW Dist%',   group: 'GEX', fmt: n2 },
  { source: 'gex', key: 'put_wall_distance',  label: 'PW Dist%',   group: 'GEX', fmt: n2 },
];

// Pre-compute group header spans
const GROUP_SPANS = (() => {
  const spans: { group: string; span: number }[] = [];
  for (const col of COLUMNS) {
    if (!spans.length || spans[spans.length - 1].group !== col.group) {
      spans.push({ group: col.group, span: 1 });
    } else {
      spans[spans.length - 1].span++;
    }
  }
  return spans;
})();

export default function Indicators() {
  const [interval, setInterval] = useState<string>('5min');
  const { data: ind } = useIndicators(interval);
  const { data: candles } = useCandles(interval, 200);
  const { data: series, isLoading: seriesLoading } = useIndicatorSeries(interval, 100);
  const { data: gex } = useGEX();

  const chartData = (candles ?? []).map((c) => ({
    time: new Date(c.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: new Date(c.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    close: c.close,
    volume: c.volume,
    ema20: ind?.indicators.ema_20 as number | undefined,
    ema50: ind?.indicators.ema_50 as number | undefined,
    sma200: ind?.indicators.sma_200 as number | undefined,
    vwap: ind?.indicators.vwap as number | undefined,
    rsi: ind?.indicators.rsi_14 as number | undefined,
    macd: ind?.indicators.macd_histogram as number | undefined,
  }));

  const xKey = interval === '1day' ? 'date' : 'time';

  const getCellValue = (col: ColDef, row: IndicatorRow): unknown => {
    if (col.source === 'row') return row[col.key];
    return gex ? gex[col.key] : null;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Indicators Deep Dive</h1>
          <p className="text-slate-400 text-sm mt-1">Historical view with overlays</p>
        </div>
        <div className="flex gap-1">
          {INTERVALS.map((int) => (
            <button
              key={int}
              onClick={() => setInterval(int)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] ${
                interval === int
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {int}
            </button>
          ))}
        </div>
      </div>

      {/* Price + EMAs + VWAP */}
      <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Price with EMAs & VWAP</h3>
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(0)} />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94a3b8' }} />
            <Line type="monotone" dataKey="close" stroke="#3b82f6" dot={false} strokeWidth={2} name="Close" />
            <Line type="monotone" dataKey="ema20" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="EMA 20" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="ema50" stroke="#a855f7" dot={false} strokeWidth={1.5} name="EMA 50" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="sma200" stroke="#ec4899" dot={false} strokeWidth={1.5} name="SMA 200" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="vwap" stroke="#10b981" dot={false} strokeWidth={2} name="VWAP" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI */}
      {chartData.some((d) => d.rsi !== undefined) && (
        <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-slate-300">RSI (14)</h3>
            {ind?.indicators.rsi_14 !== undefined && (
              <span className={`text-xs font-bold ${
                Number(ind.indicators.rsi_14) > 70 ? 'text-red-400' :
                Number(ind.indicators.rsi_14) < 30 ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {Number(ind.indicators.rsi_14).toFixed(1)}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 2" />
              <ReferenceLine y={30} stroke="#10b981" strokeDasharray="4 2" />
              <Line type="monotone" dataKey="rsi" stroke="#f59e0b" dot={false} strokeWidth={2} name="RSI" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MACD Histogram */}
      {chartData.some((d) => d.macd !== undefined) && (
        <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">MACD Histogram</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#475569" />
              <Bar dataKey="macd" fill="#6366f1" name="MACD Histogram" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Time-Series Indicator + GEX Table */}
      <div className="bg-slate-900 rounded-xl p-4 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-300">Indicator History — {interval}</h3>
            <p className="text-xs text-slate-500 mt-0.5">GEX columns show the latest snapshot (same for all rows)</p>
          </div>
          {seriesLoading && <span className="text-xs text-slate-500 animate-pulse">Loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs font-mono whitespace-nowrap border-collapse">
            <thead>
              {/* Group row */}
              <tr>
                <th
                  className="sticky left-0 z-20 bg-slate-900 px-3 py-1 text-left text-slate-500 border-b border-r border-slate-700"
                  rowSpan={2}
                >
                  Time
                </th>
                {GROUP_SPANS.map(({ group, span }) => (
                  <th
                    key={group}
                    colSpan={span}
                    className={`px-2 py-1 text-center border-b border-r border-slate-700 font-medium text-xs ${
                      group === 'GEX' ? 'text-violet-400' : 'text-slate-500'
                    }`}
                  >
                    {group}
                  </th>
                ))}
              </tr>
              {/* Column headers */}
              <tr>
                {COLUMNS.map((col, i) => (
                  <th
                    key={`${col.source}-${col.key}`}
                    className={`px-2 py-1 text-right border-b border-slate-700 font-medium ${
                      i < COLUMNS.length - 1 ? 'border-r border-slate-800' : ''
                    } ${col.source === 'gex' ? 'text-violet-400/70' : 'text-slate-400'}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series && [...series].reverse().map((row) => {
                const d = new Date(row.timestamp);
                const timeLabel = d.toLocaleTimeString('en-IN', {
                  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
                });
                const dateLabel = d.toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
                });
                return (
                  <tr key={row.timestamp} className="hover:bg-slate-800/50 transition-colors">
                    <td className="sticky left-0 z-10 bg-slate-900 hover:bg-slate-800 px-3 py-1 border-r border-slate-700">
                      <div className="text-slate-200">{timeLabel}</div>
                      <div className="text-slate-500 text-[10px]">{dateLabel}</div>
                    </td>
                    {COLUMNS.map((col, i) => {
                      const val = getCellValue(col, row);
                      const formatted = col.fmt ? col.fmt(val) : (val != null ? String(val) : '—');
                      const colorClass = col.color ? col.color(val) : (col.source === 'gex' ? 'text-violet-300' : 'text-slate-300');
                      return (
                        <td
                          key={`${col.source}-${col.key}`}
                          className={`px-2 py-1 text-right ${colorClass} ${
                            i < COLUMNS.length - 1 ? 'border-r border-slate-800' : ''
                          }`}
                        >
                          {formatted}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {!series && !seriesLoading && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-500">
                    No data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
