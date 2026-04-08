import { useIVRIVP } from '../hooks/useIndicators';
import { AlertTriangle, CheckCircle, Info, TrendingDown } from 'lucide-react';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function IVRGauge({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 50 ? '#f87171' : pct < 30 ? '#34d399' : '#fbbf24';
  const label = pct > 50 ? 'Elevated' : pct < 30 ? 'Cheap' : 'Mid-Range';
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 60" className="w-full">
          {/* Track */}
          <path d="M 10 55 A 45 45 0 0 1 90 55" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
          {/* Fill */}
          <path
            d="M 10 55 A 45 45 0 0 1 90 55"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${pct * 1.413} 999`}
          />
        </svg>
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className="text-xl font-bold tabular-nums" style={{ color }}>{Math.round(pct)}</span>
        </div>
      </div>
      <span className="text-xs font-semibold mt-1" style={{ color }}>{label}</span>
    </div>
  );
}

export default function IVRIVPPanel() {
  const { data, isLoading, error } = useIVRIVP();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">IV Rank &amp; IV Percentile</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">IV Rank &amp; IV Percentile</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to compute IVR/IVP'}
        </div>
      </div>
    );
  }

  const { atm_ivr, atm_ivp, signal, restrict_naked, guidance, current_vix,
    vix_52w_high, vix_52w_low, strikes } = data;

  const signalBg = signal === 'buy_debit_spread'
    ? 'bg-red-900/20 border-red-700/40'
    : signal === 'buy_viable'
    ? 'bg-emerald-900/20 border-emerald-700/40'
    : 'bg-amber-900/20 border-amber-700/40';

  const signalIcon = signal === 'buy_debit_spread'
    ? <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
    : signal === 'buy_viable'
    ? <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
    : <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />;

  const signalText = signal === 'buy_debit_spread'
    ? 'Use Debit Spreads'
    : signal === 'buy_viable'
    ? 'Naked Buying Viable'
    : 'Neutral — Monitor';

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>IV Rank &amp; IV Percentile</span>
        {restrict_naked && (
          <span className="text-xs bg-red-900/40 border border-red-700/50 text-red-300 px-2 py-0.5 rounded font-semibold">
            NAKED RESTRICTED
          </span>
        )}
      </div>

      {/* Gauges */}
      <div className="flex items-center justify-around mb-4">
        <div className="text-center">
          <IVRGauge value={atm_ivr} />
          <div className="text-xs text-slate-400 mt-1">IV Rank</div>
          <div className="text-xs text-slate-500">(52w range)</div>
        </div>
        <div className="w-px h-16 bg-slate-700" />
        <div className="text-center">
          <IVRGauge value={atm_ivp} />
          <div className="text-xs text-slate-400 mt-1">IV Percentile</div>
          <div className="text-xs text-slate-500">(52w dist)</div>
        </div>
        <div className="w-px h-16 bg-slate-700" />
        <div className="text-center space-y-1">
          <div className="text-xs text-slate-400">India VIX</div>
          <div className="text-lg font-bold text-amber-300 tabular-nums">{current_vix?.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">52w H: {vix_52w_high?.toFixed(1)}</div>
          <div className="text-xs text-slate-500">52w L: {vix_52w_low?.toFixed(1)}</div>
        </div>
      </div>

      {/* Signal banner */}
      <div className={`flex items-start gap-2 rounded-lg p-3 border mb-4 ${signalBg}`}>
        {signalIcon}
        <div>
          <div className="text-xs font-bold text-slate-200 mb-0.5">{signalText}</div>
          <p className="text-xs text-slate-400 leading-relaxed">{guidance}</p>
        </div>
      </div>

      {/* Per-strike table */}
      {strikes && strikes.length > 0 && (
        <>
          <div className="text-xs text-slate-400 mb-2 font-medium">Strike-Level IVR</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1 pr-2">Strike</th>
                  <th className="text-right pr-2">CE IV</th>
                  <th className="text-right pr-2">PE IV</th>
                  <th className="text-right pr-2">IVR</th>
                  <th className="text-right">Signal</th>
                </tr>
              </thead>
              <tbody>
                {strikes.map((s: any) => {
                  const sigColor = s.signal === 'buy_debit_spread'
                    ? 'text-red-300'
                    : s.signal === 'buy_viable'
                    ? 'text-emerald-300'
                    : 'text-amber-300';
                  const rowBg = s.is_atm ? 'bg-slate-800/60' : '';
                  return (
                    <tr key={`${s.strike}-${s.side}`} className={`border-b border-slate-800/60 ${rowBg}`}>
                      <td className="py-1 pr-2 font-medium text-slate-200">
                        {s.strike}{s.is_atm && <span className="ml-1 text-amber-400 text-[10px]">ATM</span>}
                      </td>
                      <td className="text-right pr-2 tabular-nums text-slate-300">{s.ce_iv?.toFixed(1)}%</td>
                      <td className="text-right pr-2 tabular-nums text-slate-300">{s.pe_iv?.toFixed(1)}%</td>
                      <td className="text-right pr-2 tabular-nums font-bold text-slate-200">{s.ivr?.toFixed(0)}</td>
                      <td className={`text-right text-[10px] font-semibold uppercase ${sigColor}`}>
                        {s.signal === 'buy_debit_spread' ? 'Spread' : s.signal === 'buy_viable' ? 'Buy' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Legend */}
      <div className="mt-3 grid grid-cols-3 gap-1 text-[10px] text-center">
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded px-1 py-0.5 text-emerald-300">IVR &lt;30 Buy</div>
        <div className="bg-amber-900/20 border border-amber-700/30 rounded px-1 py-0.5 text-amber-300">IVR 30–50 Neutral</div>
        <div className="bg-red-900/20 border border-red-700/30 rounded px-1 py-0.5 text-red-300">IVR &gt;50 Spread</div>
      </div>
    </div>
  );
}
