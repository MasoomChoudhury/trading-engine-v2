import { useMarketRegime } from '../hooks/useIndicators';
import { RegimeLabel } from '../lib/api';
import { TrendingUp, TrendingDown, Zap, BarChart2, AlertTriangle } from 'lucide-react';

const REGIME_CONFIG: Record<RegimeLabel, {
  icon: React.ReactNode;
  label: string;
  color: string;
  badge: string;
  borderColor: string;
}> = {
  trending_bullish: {
    icon: <TrendingUp size={20} />,
    label: 'Trending Bullish',
    color: 'text-emerald-300',
    badge: 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300',
    borderColor: 'border-emerald-700/30',
  },
  trending_bearish: {
    icon: <TrendingDown size={20} />,
    label: 'Trending Bearish',
    color: 'text-red-300',
    badge: 'bg-red-900/40 border-red-700/50 text-red-300',
    borderColor: 'border-red-700/30',
  },
  breakout_imminent: {
    icon: <Zap size={20} />,
    label: 'Breakout Imminent',
    color: 'text-amber-300',
    badge: 'bg-amber-900/40 border-amber-700/50 text-amber-300',
    borderColor: 'border-amber-700/30',
  },
  mean_reverting: {
    icon: <BarChart2 size={20} />,
    label: 'Mean-Reverting',
    color: 'text-blue-300',
    badge: 'bg-blue-900/40 border-blue-700/50 text-blue-300',
    borderColor: 'border-blue-700/30',
  },
  choppy: {
    icon: <AlertTriangle size={20} />,
    label: 'Choppy / Volatile',
    color: 'text-orange-300',
    badge: 'bg-orange-900/30 border-orange-700/40 text-orange-300',
    borderColor: 'border-orange-700/30',
  },
};

function InputRow({ label, value, unit = '' }: { label: string; value: string | number | null | boolean | undefined; unit?: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-800">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 font-medium tabular-nums">
        {value == null ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : `${value}${unit}`}
      </span>
    </div>
  );
}

export default function MarketRegimePanel() {
  const { data, isLoading, error } = useMarketRegime();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Market Regime</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Market Regime</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Insufficient data for regime classification'}
        </div>
      </div>
    );
  }

  const { regime, strength, guidance, inputs } = data;
  const cfg = REGIME_CONFIG[regime] ?? REGIME_CONFIG.mean_reverting;

  return (
    <div className={`panel border-l-4 ${cfg.borderColor}`}>
      <div className="panel-header flex items-center justify-between">
        <span>Market Regime Classifier</span>
        <span className={`px-2 py-0.5 rounded border text-xs font-bold ${cfg.badge}`}>
          {strength.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>

      {/* Regime hero */}
      <div className={`flex items-center gap-3 mb-4 ${cfg.color}`}>
        {cfg.icon}
        <span className="text-2xl font-bold">{cfg.label}</span>
      </div>

      {/* Guidance */}
      <div className={`rounded-lg p-3 mb-4 border ${cfg.borderColor} bg-slate-800/40`}>
        <p className="text-sm text-slate-200 leading-relaxed">{guidance}</p>
      </div>

      {/* Input signals */}
      <div className="text-xs text-slate-400 mb-2 font-medium">Classifier Inputs (1-Day)</div>
      <div className="bg-slate-900/40 rounded-lg px-3 py-1">
        <InputRow label="ADX (trend strength)" value={inputs.adx?.toFixed(1)} />
        <InputRow label="+DI (bullish pressure)" value={inputs.plus_di?.toFixed(1)} />
        <InputRow label="−DI (bearish pressure)" value={inputs.minus_di?.toFixed(1)} />
        <InputRow label="BB Width (current)" value={inputs.bb_width_current?.toFixed(2)} unit="%" />
        <InputRow label="BB Width (avg)" value={inputs.bb_width_avg?.toFixed(2)} unit="%" />
        <InputRow label="Bollinger Squeeze" value={inputs.bb_squeeze} />
        <InputRow label="ATR / 20d Avg ATR" value={inputs.atr_ratio?.toFixed(2)} unit="x" />
        <InputRow label="India VIX" value={inputs.vix?.toFixed(1)} unit="%" />
      </div>

      {/* Strategy quick-ref */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {regime === 'trending_bullish' && (
          <>
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded p-2">
              <p className="font-semibold text-emerald-400 mb-1">Favour</p>
              <p className="text-slate-300">ATM/OTM calls, bull call spreads, call diagonals</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
              <p className="font-semibold text-red-400 mb-1">Avoid</p>
              <p className="text-slate-300">Naked put buys, shorting into strength without trigger</p>
            </div>
          </>
        )}
        {regime === 'trending_bearish' && (
          <>
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded p-2">
              <p className="font-semibold text-emerald-400 mb-1">Favour</p>
              <p className="text-slate-300">ATM/OTM puts, bear call spreads, put diagonals</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
              <p className="font-semibold text-red-400 mb-1">Avoid</p>
              <p className="text-slate-300">Chasing call bounces, naked calls without hedge</p>
            </div>
          </>
        )}
        {regime === 'breakout_imminent' && (
          <>
            <div className="bg-amber-900/20 border border-amber-700/30 rounded p-2">
              <p className="font-semibold text-amber-400 mb-1">Favour</p>
              <p className="text-slate-300">Straddle/strangle near squeeze level, defined-risk spreads</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
              <p className="font-semibold text-red-400 mb-1">Avoid</p>
              <p className="text-slate-300">Selling premium into a squeeze — expansion imminent</p>
            </div>
          </>
        )}
        {regime === 'mean_reverting' && (
          <>
            <div className="bg-blue-900/20 border border-blue-700/30 rounded p-2">
              <p className="font-semibold text-blue-400 mb-1">Favour</p>
              <p className="text-slate-300">Short strangles, iron condors, credit spreads at extremes</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
              <p className="font-semibold text-red-400 mb-1">Avoid</p>
              <p className="text-slate-300">Directional plays — ADX&lt;20 means no trend edge</p>
            </div>
          </>
        )}
        {regime === 'choppy' && (
          <>
            <div className="bg-orange-900/20 border border-orange-700/30 rounded p-2">
              <p className="font-semibold text-orange-400 mb-1">Favour</p>
              <p className="text-slate-300">Wide iron condors, neutral spreads; wait for clarity</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
              <p className="font-semibold text-red-400 mb-1">Avoid</p>
              <p className="text-slate-300">Any directional naked buys — premium elevated, no trend</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
