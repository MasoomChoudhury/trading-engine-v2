import { useIndiaVIX } from '../hooks/useIndicators';
import { Activity } from 'lucide-react';

const REGIME_CONFIG = {
  extreme_fear: {
    bg: 'bg-red-900/40',
    border: 'border-red-700/50',
    text: 'text-red-300',
    badge: 'bg-red-800/60 text-red-200',
    label: 'Extreme Fear',
    tip: 'VIX>25: Options very expensive — sell premium or avoid buying calls',
  },
  fear: {
    bg: 'bg-orange-900/40',
    border: 'border-orange-700/50',
    text: 'text-orange-300',
    badge: 'bg-orange-800/60 text-orange-200',
    label: 'Fear',
    tip: 'VIX 20–25: Elevated risk — prefer defined-risk strategies',
  },
  caution: {
    bg: 'bg-amber-900/40',
    border: 'border-amber-700/50',
    text: 'text-amber-300',
    badge: 'bg-amber-800/60 text-amber-200',
    label: 'Caution',
    tip: 'VIX 15–20: Moderate — balanced approach',
  },
  calm: {
    bg: 'bg-emerald-900/40',
    border: 'border-emerald-700/50',
    text: 'text-emerald-300',
    badge: 'bg-emerald-800/60 text-emerald-200',
    label: 'Calm',
    tip: 'VIX≤15: Options cheap — good time to buy premium/hedge',
  },
} as const;

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

export default function IndiaVIXPanel() {
  const { data, isLoading, error } = useIndiaVIX();

  if (isLoading) {
    return (
      <div className="panel-card animate-pulse h-52 flex items-center justify-center text-slate-500 text-sm">
        Loading India VIX…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-card">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={16} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">India VIX</h3>
        </div>
        <p className="text-xs text-slate-500">Failed to load VIX data. {(error as Error)?.message}</p>
      </div>
    );
  }

  const cfg = REGIME_CONFIG[data.regime] ?? REGIME_CONFIG.caution;
  const changePositive = data.vix_change >= 0;

  return (
    <div className={`panel-card border ${cfg.border} ${cfg.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className={cfg.text} />
          <h3 className="text-sm font-semibold text-slate-200">India VIX</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>
        <span className="text-xs text-slate-500">
          {new Date(data.timestamp).toLocaleString('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true,
          })} IST
        </span>
      </div>

      {/* Big VIX number */}
      <div className="flex items-end gap-3 mb-3">
        <span className={`text-4xl font-bold tabular-nums ${cfg.text}`}>
          {fmt(data.vix)}
        </span>
        <div className="mb-1">
          <span className={`text-sm font-semibold tabular-nums ${changePositive ? 'text-red-400' : 'text-emerald-400'}`}>
            {changePositive ? '+' : ''}{fmt(data.vix_change)} ({changePositive ? '+' : ''}{fmt(data.vix_change_pct)}%)
          </span>
          <div className="text-xs text-slate-500">vs prev close {fmt(data.vix_prev_close)}</div>
        </div>
      </div>

      {/* Percentile gauge bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>52W Low: {fmt(data.vix_52w_low)}</span>
          <span className="text-slate-400 font-medium">Percentile: {fmt(data.vix_percentile, 1)}%</span>
          <span>52W High: {fmt(data.vix_52w_high)}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              data.regime === 'extreme_fear' ? 'bg-red-500' :
              data.regime === 'fear' ? 'bg-orange-500' :
              data.regime === 'caution' ? 'bg-amber-500' :
              'bg-emerald-500'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, data.vix_percentile))}%` }}
          />
        </div>
      </div>

      {/* Mini stats row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Day High', value: fmt(data.vix_high) },
          { label: 'Day Low', value: fmt(data.vix_low) },
          { label: '1W Ago', value: fmt(data.vix_1w_ago) },
          { label: '1M Ago', value: fmt(data.vix_1m_ago) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-800/60 rounded p-2 text-center">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-xs font-semibold text-slate-200 tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {/* HV20 and IV/RV row */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-500">HV20 (Realised Vol)</div>
          <div className="text-sm font-bold text-slate-200 tabular-nums">
            {data.hv20 != null ? `${fmt(data.hv20)}%` : '—'}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-500">IV/RV Ratio</div>
          <div className={`text-sm font-bold tabular-nums ${
            data.iv_rv_ratio == null ? 'text-slate-400' :
            data.iv_rv_ratio > 1.2 ? 'text-red-400' :
            data.iv_rv_ratio < 0.8 ? 'text-emerald-400' :
            'text-slate-200'
          }`}>
            {data.iv_rv_ratio != null ? fmt(data.iv_rv_ratio) : '—'}
            {data.iv_rv_ratio != null && (
              <span className="text-xs font-normal ml-1 text-slate-500">
                {data.iv_rv_ratio > 1.2 ? '(expensive)' : data.iv_rv_ratio < 0.8 ? '(cheap)' : '(fair)'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Regime note */}
      <div className={`rounded-lg p-2 text-xs ${cfg.bg} border ${cfg.border}`}>
        <span className={`font-medium ${cfg.text}`}>What this means: </span>
        <span className="text-slate-400">{cfg.tip}</span>
      </div>
    </div>
  );
}
