import { useCVD } from '../hooks/useIndicators';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Info, AlertTriangle } from 'lucide-react';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function DivergenceIcon({ d }: { d: string }) {
  if (d === 'confirmed_up') return <TrendingUp size={16} className="text-emerald-400" />;
  if (d === 'confirmed_down') return <TrendingDown size={16} className="text-red-400" />;
  if (d === 'bearish_divergence') return <AlertTriangle size={16} className="text-red-400" />;
  if (d === 'bullish_divergence') return <TrendingUp size={16} className="text-amber-400" />;
  return <Minus size={16} className="text-slate-400" />;
}

export default function CVDPanel() {
  const { data, isLoading, error } = useCVD();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Cumulative Volume Delta <span className="text-slate-500 font-normal text-xs">(est)</span></div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Cumulative Volume Delta <span className="text-slate-500 font-normal text-xs">(est)</span></div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'No intraday data'}
        </div>
      </div>
    );
  }

  const { cvd_series, current_cvd, divergence, divergence_note,
    depth_imbalance, depth_note, session_high_cvd, session_low_cvd } = data;

  const divColor = divergence === 'confirmed_up' || divergence === 'bullish_divergence'
    ? 'text-emerald-300 bg-emerald-900/20 border-emerald-700/40'
    : divergence === 'confirmed_down' || divergence === 'bearish_divergence'
    ? 'text-red-300 bg-red-900/20 border-red-700/40'
    : 'text-slate-300 bg-slate-800/60 border-slate-700/40';

  const divLabel: Record<string, string> = {
    confirmed_up: 'Confirmed Up',
    confirmed_down: 'Confirmed Down',
    bearish_divergence: 'Bearish Divergence',
    bullish_divergence: 'Bullish Divergence',
    neutral: 'Neutral',
  };

  // Dual-axis: normalise CVD for overlay on price scale
  const prices = cvd_series.map((d: any) => d.price);
  const cvds = cvd_series.map((d: any) => d.cvd);
  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const cvdMin = Math.min(...cvds);
  const cvdMax = Math.max(...cvds);
  const pRange = priceMax - priceMin || 1;
  const cRange = cvdMax - cvdMin || 1;

  const chartData = cvd_series.map((d: any) => ({
    ...d,
    cvd_scaled: priceMin + ((d.cvd - cvdMin) / cRange) * pRange,
    delta_color: d.delta >= 0 ? '#34d399' : '#f87171',
  }));

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>
          Cumulative Volume Delta
          <span className="ml-1.5 text-slate-500 font-normal text-xs">(candle est.)</span>
        </span>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-semibold ${divColor}`}>
          <DivergenceIcon d={divergence} />
          {divLabel[divergence] ?? divergence}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Current CVD</div>
          <div className={`text-lg font-bold tabular-nums ${current_cvd >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {current_cvd >= 0 ? '+' : ''}{current_cvd?.toLocaleString()}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Session High</div>
          <div className="text-sm font-bold text-emerald-300 tabular-nums">+{session_high_cvd?.toLocaleString()}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Session Low</div>
          <div className="text-sm font-bold text-red-300 tabular-nums">{session_low_cvd?.toLocaleString()}</div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="h-44 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} width={50} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => [
                name === 'Price' ? v?.toFixed(2) : name === 'CVD (scaled)' ? '' : v?.toLocaleString(),
                name
              ]} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
              <Line type="monotone" dataKey="price" stroke="#60a5fa" strokeWidth={2} dot={false} name="Price" />
              <Line type="monotone" dataKey="cvd_scaled" stroke="#f59e0b" strokeWidth={1.5}
                strokeDasharray="4 2" dot={false} name="CVD (scaled)" />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Divergence note */}
      <div className={`flex items-start gap-2 rounded-lg p-3 border mb-2 ${divColor}`}>
        <DivergenceIcon d={divergence} />
        <p className="text-xs text-slate-300 leading-relaxed">{divergence_note}</p>
      </div>

      {/* Depth imbalance */}
      {depth_imbalance != null && (
        <div className="flex items-start gap-2 bg-slate-800/40 border border-slate-700/40 rounded-lg p-2.5">
          <Info size={12} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-400">{depth_note}</p>
        </div>
      )}
    </div>
  );
}
