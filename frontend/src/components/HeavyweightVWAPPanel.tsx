import { useHeavyweightVWAP } from '../hooks/useIndicators';
import { CheckCircle, XCircle, Minus, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

function VWAPBadge({ vs }: { vs: string }) {
  if (vs === 'above') return (
    <span className="flex items-center gap-1 text-emerald-300 bg-emerald-900/30 border border-emerald-700/50 px-1.5 py-0.5 rounded text-xs font-semibold">
      <TrendingUp size={11} />Above
    </span>
  );
  if (vs === 'below') return (
    <span className="flex items-center gap-1 text-red-300 bg-red-900/30 border border-red-700/50 px-1.5 py-0.5 rounded text-xs font-semibold">
      <TrendingDown size={11} />Below
    </span>
  );
  if (vs === 'at') return (
    <span className="flex items-center gap-1 text-amber-300 bg-amber-900/20 border border-amber-700/40 px-1.5 py-0.5 rounded text-xs font-semibold">
      <Minus size={11} />At
    </span>
  );
  return <span className="text-slate-500 text-xs">—</span>;
}

function VolBadge({ trend }: { trend: string }) {
  if (trend === 'expanding') return <span className="text-emerald-400 text-xs">▲ Expanding</span>;
  if (trend === 'contracting') return <span className="text-red-400 text-xs">▼ Contracting</span>;
  return <span className="text-slate-500 text-xs">→ Neutral</span>;
}

function SignalIcon({ signal }: { signal: string }) {
  if (signal === 'confirmed') return <CheckCircle size={18} className="text-emerald-400" />;
  if (signal === 'invalid') return <XCircle size={18} className="text-red-400" />;
  return <AlertTriangle size={18} className="text-amber-400" />;
}

export default function HeavyweightVWAPPanel() {
  const { data, isLoading, error } = useHeavyweightVWAP();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Heavyweight VWAP</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Heavyweight VWAP</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to fetch heavyweight data'}
        </div>
      </div>
    );
  }

  const {
    above_count, below_count, expanding_volume_count,
    weighted_above_pct, signal, signal_valid, signal_note, heavyweights,
  } = data;

  const signalBg = signal === 'confirmed'
    ? 'border-emerald-700/40 bg-emerald-900/20'
    : signal === 'invalid'
    ? 'border-red-700/40 bg-red-900/20'
    : 'border-amber-700/40 bg-amber-900/20';

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Heavyweight VWAP</span>
        <span className="text-xs text-slate-400">{above_count}/5 above</span>
      </div>

      {/* Signal banner */}
      <div className={`flex items-start gap-2.5 rounded-lg p-3 border mb-4 ${signalBg}`}>
        <SignalIcon signal={signal} />
        <div>
          <div className="text-xs font-bold text-slate-200 mb-0.5">
            {signal === 'confirmed' ? 'Signal Confirmed — Calls Supported'
              : signal === 'invalid' ? 'Signal Invalid — Avoid Calls'
              : 'Weak Confirmation — Wait'}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{signal_note}</p>
        </div>
      </div>

      {/* Metrics bar */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Above VWAP</div>
          <div className={`text-2xl font-bold ${above_count >= 3 ? 'text-emerald-300' : 'text-red-300'}`}>
            {above_count}<span className="text-slate-500 text-sm">/5</span>
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Index Weight</div>
          <div className={`text-xl font-bold tabular-nums ${weighted_above_pct >= 55 ? 'text-emerald-300' : 'text-red-300'}`}>
            {weighted_above_pct?.toFixed(0)}%
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Vol Expanding</div>
          <div className={`text-2xl font-bold ${expanding_volume_count >= 2 ? 'text-emerald-300' : 'text-amber-300'}`}>
            {expanding_volume_count}<span className="text-slate-500 text-sm">/5</span>
          </div>
        </div>
      </div>

      {/* Per-stock table */}
      <div className="text-xs text-slate-400 mb-2 font-medium">Top 5 Heavyweights</div>
      <div className="space-y-1.5">
        {heavyweights?.map((hw: any) => (
          <div key={hw.symbol} className={`flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 border ${
            hw.vs_vwap === 'above' ? 'border-emerald-800/40' :
            hw.vs_vwap === 'below' ? 'border-red-800/40' : 'border-slate-700/40'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <div>
                <div className="text-xs font-semibold text-slate-200">{hw.symbol}</div>
                <div className="text-[10px] text-slate-500">{hw.weight}% wt</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-right">
              {hw.current_price != null && (
                <div>
                  <div className="text-xs tabular-nums text-slate-300">{hw.current_price?.toFixed(1)}</div>
                  <div className="text-[10px] text-slate-500">VWAP {hw.vwap?.toFixed(1)}</div>
                </div>
              )}
              {hw.vwap_gap_pct != null && (
                <div className={`text-xs tabular-nums font-semibold ${hw.vwap_gap_pct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {hw.vwap_gap_pct >= 0 ? '+' : ''}{hw.vwap_gap_pct?.toFixed(2)}%
                </div>
              )}
              <div className="flex flex-col items-end gap-0.5">
                <VWAPBadge vs={hw.vs_vwap} />
                {hw.vol_trend && hw.vol_trend !== 'unknown' && <VolBadge trend={hw.vol_trend} />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
