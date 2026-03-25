import { useState } from 'react';
import { useIndicators, useCandles } from '../hooks/useIndicators';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart, Bar,
} from 'recharts';

const INTERVALS = ['1min', '5min', '15min', '1hour', '1day'] as const;

export default function Indicators() {
  const [interval, setInterval] = useState<string>('5min');
  const { data: ind } = useIndicators(interval);
  const { data: candles } = useCandles(interval, 200);

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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Indicators Deep Dive</h1>
          <p className="text-slate-400 text-sm mt-1">Historical view with overlays</p>
        </div>
        <div className="flex gap-1">
          {INTERVALS.map((int) => (
            <button
              key={int}
              onClick={() => setInterval(int)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                interval === int ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {int}
            </button>
          ))}
        </div>
      </div>

      {/* Price + EMAs + VWAP */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
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
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
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
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
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

      {/* Current Values Table */}
      {ind && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Current Indicator Values</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(ind.indicators)
              .filter(([, v]) => typeof v === 'number')
              .map(([key, value]) => (
                <div key={key} className="flex justify-between items-center">
                  <span className="text-sm text-slate-400 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-sm font-medium text-white">
                    {(value as number).toFixed(4)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
