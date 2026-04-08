import { useBidAskSpread } from '../hooks/useIndicators';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';

function ExecBadge({ label }: { label: string }) {
  const configs: Record<string, string> = {
    liquid:          'text-emerald-300 bg-emerald-900/30 border-emerald-700/50',
    acceptable:      'text-blue-300 bg-blue-900/20 border-blue-700/40',
    wide:            'text-amber-300 bg-amber-900/20 border-amber-700/40',
    'un-executable': 'text-red-300 bg-red-900/30 border-red-700/50',
  };
  const cls = configs[label] ?? 'text-slate-400 bg-slate-800 border-slate-600';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase ${cls}`}>
      {label}
    </span>
  );
}

function LiquidityBar({ score }: { score: number }) {
  const color = score >= 70 ? '#34d399' : score >= 40 ? '#60a5fa' : score >= 20 ? '#fbbf24' : '#f87171';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] tabular-nums text-slate-400 w-6 text-right">{score}</span>
    </div>
  );
}

function OverallIcon({ rating }: { rating: string }) {
  if (rating === 'acceptable') return <CheckCircle size={16} className="text-emerald-400" />;
  if (rating === 'wide') return <AlertTriangle size={16} className="text-amber-400" />;
  if (rating === 'un-executable') return <XCircle size={16} className="text-red-400" />;
  return <Info size={16} className="text-blue-400" />;
}

export default function BidAskPanel() {
  const { data, isLoading, error } = useBidAskSpread();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Bid-Ask Spread</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Bid-Ask Spread</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to load bid-ask data'}
        </div>
      </div>
    );
  }

  const { strikes, overall_rating, overall_note, un_executable_count, wide_count, spot } = data;

  const overallBg = overall_rating === 'acceptable'
    ? 'bg-emerald-900/20 border-emerald-700/40'
    : overall_rating === 'wide'
    ? 'bg-amber-900/20 border-amber-700/40'
    : 'bg-red-900/20 border-red-700/40';

  // Group by strike, show CE and PE side-by-side
  const byStrike: Record<number, { CE?: any; PE?: any }> = {};
  for (const s of (strikes ?? [])) {
    if (!byStrike[s.strike]) byStrike[s.strike] = {};
    byStrike[s.strike][s.side as 'CE' | 'PE'] = s;
  }
  const strikeRows = Object.entries(byStrike)
    .map(([k, v]) => ({ strike: Number(k), ...v }))
    .sort((a, b) => a.strike - b.strike);

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Bid-Ask Spread</span>
        <ExecBadge label={overall_rating} />
      </div>

      {/* Overall banner */}
      <div className={`flex items-start gap-2 rounded-lg p-3 border mb-4 ${overallBg}`}>
        <OverallIcon rating={overall_rating} />
        <p className="text-xs text-slate-300 leading-relaxed">{overall_note}</p>
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {un_executable_count > 0 && (
          <span className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded px-2 py-0.5">
            {un_executable_count} un-executable
          </span>
        )}
        {wide_count > 0 && (
          <span className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded px-2 py-0.5">
            {wide_count} wide
          </span>
        )}
        {spot && (
          <span className="text-xs text-slate-400 ml-auto">Spot {spot?.toFixed(1)}</span>
        )}
      </div>

      {/* Strike table */}
      {strikeRows.length > 0 && (
        <>
          <div className="text-xs text-slate-400 mb-2 font-medium">Spread by Strike</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1 pr-2">Strike</th>
                  <th className="text-center pr-3">CE Spread</th>
                  <th className="text-center pr-3">PE Spread</th>
                  <th className="text-left">Liquidity</th>
                </tr>
              </thead>
              <tbody>
                {strikeRows.map((row) => {
                  const ce = row.CE;
                  const pe = row.PE;
                  const isAtm = ce?.is_atm || pe?.is_atm;
                  return (
                    <tr key={row.strike} className={`border-b border-slate-800/60 ${isAtm ? 'bg-slate-800/40' : ''}`}>
                      <td className="py-1.5 pr-2 font-medium text-slate-200">
                        {row.strike}
                        {isAtm && <span className="ml-1 text-amber-400 text-[10px]">ATM</span>}
                      </td>
                      {/* CE */}
                      <td className="pr-3">
                        {ce ? (
                          <div className="text-center">
                            <div className={`font-bold tabular-nums ${
                              ce.spread_pct > 5 ? 'text-red-300' :
                              ce.spread_pct > 3 ? 'text-amber-300' :
                              ce.spread_pct > 1 ? 'text-blue-300' : 'text-emerald-300'
                            }`}>{ce.spread_pct?.toFixed(1)}%</div>
                            <div className="text-[10px] text-slate-500">₹{ce.spread_pts?.toFixed(1)}</div>
                          </div>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      {/* PE */}
                      <td className="pr-3">
                        {pe ? (
                          <div className="text-center">
                            <div className={`font-bold tabular-nums ${
                              pe.spread_pct > 5 ? 'text-red-300' :
                              pe.spread_pct > 3 ? 'text-amber-300' :
                              pe.spread_pct > 1 ? 'text-blue-300' : 'text-emerald-300'
                            }`}>{pe.spread_pct?.toFixed(1)}%</div>
                            <div className="text-[10px] text-slate-500">₹{pe.spread_pts?.toFixed(1)}</div>
                          </div>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      {/* Liquidity bar (CE side) */}
                      <td>
                        {ce && <LiquidityBar score={ce.liquidity_score ?? 0} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Crossing cost note */}
          {strikeRows[0]?.CE && (
            <div className="mt-3 bg-slate-800/40 border border-slate-700/30 rounded p-2.5">
              <div className="text-xs text-slate-400 mb-1 font-medium">ATM Execution Cost</div>
              {(() => {
                const atmCE = strikeRows.find(r => r.CE?.is_atm)?.CE;
                const atmPE = strikeRows.find(r => r.PE?.is_atm)?.PE;
                if (!atmCE && !atmPE) return null;
                return (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {atmCE && (
                      <div>
                        <span className="text-slate-500">CE crossing cost: </span>
                        <span className="text-amber-300 font-semibold">₹{atmCE.crossing_cost_per_lot}/lot</span>
                      </div>
                    )}
                    {atmPE && (
                      <div>
                        <span className="text-slate-500">PE crossing cost: </span>
                        <span className="text-amber-300 font-semibold">₹{atmPE.crossing_cost_per_lot}/lot</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div className="mt-3 grid grid-cols-4 gap-1 text-[10px] text-center">
        {[
          { label: '<1% Liquid', cls: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
          { label: '1-3% OK', cls: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
          { label: '3-5% Wide', cls: 'text-amber-300 bg-amber-900/20 border-amber-700/30' },
          { label: '>5% Avoid', cls: 'text-red-300 bg-red-900/20 border-red-700/30' },
        ].map(item => (
          <div key={item.label} className={`rounded border px-1 py-0.5 ${item.cls}`}>{item.label}</div>
        ))}
      </div>
    </div>
  );
}
