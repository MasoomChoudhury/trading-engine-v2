import { useFuturesBasis } from '../hooks/useIndicators';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, Info, AlertTriangle } from 'lucide-react';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function regimeColor(regime: string) {
  if (regime === 'premium_elevated') return 'text-emerald-400';
  if (regime === 'discount') return 'text-red-400';
  if (regime === 'premium_compressed') return 'text-orange-400';
  return 'text-slate-300';
}

function regimeBadgeClass(regime: string) {
  if (regime === 'premium_elevated') return 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300';
  if (regime === 'discount') return 'bg-red-900/40 border-red-700/50 text-red-300';
  if (regime === 'premium_compressed') return 'bg-orange-900/30 border-orange-700/40 text-orange-300';
  return 'bg-slate-800 border-slate-600 text-slate-300';
}

const REGIME_LABELS: Record<string, string> = {
  premium_elevated: 'Premium Elevated',
  premium_compressed: 'Premium Compressed',
  discount: 'Discount',
  normal: 'Normal',
};

export default function FuturesBasisPanel() {
  const { data, isLoading, error } = useFuturesBasis();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Futures Basis / Cost of Carry</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Futures Basis / Cost of Carry</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to load futures basis data'}
        </div>
      </div>
    );
  }

  const {
    near_expiry, dte, spot_price, futures_ltp,
    basis_pts, basis_pct, annualised_carry_pct, avg_carry_10d,
    fair_basis_pts, basis_vs_fair,
    regime, regime_note, rollover_alert, rollover_note, history,
  } = data;

  const basisPositive = basis_pts >= 0;
  const basisColor = basis_pts > 0 ? 'text-emerald-400' : 'text-red-400';

  // Build chart data: show futures close; annotate fair-value line dynamically
  const chartData = history.map(h => ({
    date: h.date.slice(5),  // MM-DD
    futures: h.futures_close,
    volume: h.volume,
  }));

  const badgeCls = regimeBadgeClass(regime);

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Futures Basis / Cost of Carry</span>
        <span className={`px-2 py-0.5 rounded border text-xs font-semibold ${badgeCls}`}>
          {REGIME_LABELS[regime] ?? regime}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-1">
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Basis (Futs − Spot)</div>
          <div className={`text-xl font-bold tabular-nums ${basisColor}`}>
            {basisPositive ? '+' : ''}{basis_pts.toFixed(1)} pts
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {basisPositive ? '+' : ''}{basis_pct.toFixed(3)}%
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Annualised Carry</div>
          <div className={`text-xl font-bold tabular-nums ${basisColor}`}>
            {annualised_carry_pct.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {avg_carry_10d != null ? `10d avg: ${avg_carry_10d.toFixed(1)}%` : `${dte}d to expiry`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Fair Basis (r×T model)</div>
          <div className="text-lg font-bold text-slate-200 tabular-nums">
            +{fair_basis_pts.toFixed(1)} pts
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Basis vs Fair</div>
          <div className={`text-lg font-bold tabular-nums ${basis_vs_fair >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
            {basis_vs_fair >= 0 ? '+' : ''}{basis_vs_fair.toFixed(1)} pts
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {basis_vs_fair > 10 ? 'Expensive' : basis_vs_fair < -10 ? 'Cheap' : 'Fair value'}
          </div>
        </div>
      </div>

      {/* 30-day futures price chart */}
      {chartData.length > 0 && (
        <>
          <div className="text-xs text-slate-400 mb-2">30-Day Futures Price History</div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`₹${v?.toLocaleString('en-IN') ?? '—'}`, 'Futures Close']}
                />
                <Line
                  type="monotone"
                  dataKey="futures"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Rollover unwinding alert */}
      {rollover_alert && rollover_note && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg p-3 border ${
          rollover_alert === 'bearish_unwinding'
            ? 'bg-red-900/30 border-red-700/50'
            : 'bg-emerald-900/30 border-emerald-700/50'
        }`}>
          <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${rollover_alert === 'bearish_unwinding' ? 'text-red-400' : 'text-emerald-400'}`} />
          <p className={`text-xs leading-relaxed ${rollover_alert === 'bearish_unwinding' ? 'text-red-300' : 'text-emerald-300'}`}>
            {rollover_note}
          </p>
        </div>
      )}

      {/* Regime note */}
      <div className="mt-2 flex items-start gap-2 bg-slate-800/60 border border-slate-700/40 rounded-lg p-3">
        <Info size={13} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">{regime_note}</p>
      </div>
    </div>
  );
}
