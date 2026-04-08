import { useSweepDetection } from '../hooks/useIndicators';
import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';

function SweepBadge({ direction }: { direction: string }) {
  if (direction === 'call_sweep') return (
    <span className="flex items-center gap-1 text-emerald-300 bg-emerald-900/30 border border-emerald-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">
      <TrendingUp size={10} />Call
    </span>
  );
  if (direction === 'put_sweep') return (
    <span className="flex items-center gap-1 text-red-300 bg-red-900/30 border border-red-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">
      <TrendingDown size={10} />Put
    </span>
  );
  return <span className="text-slate-500 text-[10px] uppercase">Mixed</span>;
}

function FlagBadge({ flag }: { flag: string }) {
  const configs: Record<string, string> = {
    high_vol_oi: 'text-amber-300 bg-amber-900/20 border-amber-700/40',
    directional: 'text-blue-300 bg-blue-900/20 border-blue-700/40',
    block_trade: 'text-purple-300 bg-purple-900/20 border-purple-700/40',
  };
  const labels: Record<string, string> = {
    high_vol_oi: 'Hi Vol/OI',
    directional: 'Directional',
    block_trade: 'Block',
  };
  const cls = configs[flag] ?? 'text-slate-400 bg-slate-800 border-slate-600';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${cls}`}>
      {labels[flag] ?? flag}
    </span>
  );
}

export default function SweepPanel() {
  const { data, isLoading, error } = useSweepDetection();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Options Sweeps <span className="text-slate-500 font-normal text-xs">(vol est.)</span></div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Options Sweeps <span className="text-slate-500 font-normal text-xs">(vol est.)</span></div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'No sweep data available'}
        </div>
      </div>
    );
  }

  const { alerts, summary, call_sweeps, put_sweeps, block_trades, alert_count, spot } = data;

  const summaryBg = call_sweeps > put_sweeps + 1
    ? 'bg-emerald-900/20 border-emerald-700/40'
    : put_sweeps > call_sweeps + 1
    ? 'bg-red-900/20 border-red-700/40'
    : 'bg-slate-800/60 border-slate-700/40';

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>
          Options Sweeps
          <span className="ml-1.5 text-slate-500 font-normal text-xs">(vol est.)</span>
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-emerald-300 bg-emerald-900/20 border border-emerald-700/40 px-1.5 py-0.5 rounded">
            {call_sweeps}C
          </span>
          <span className="text-red-300 bg-red-900/20 border border-red-700/40 px-1.5 py-0.5 rounded">
            {put_sweeps}P
          </span>
          {block_trades > 0 && (
            <span className="text-purple-300 bg-purple-900/20 border border-purple-700/40 px-1.5 py-0.5 rounded">
              {block_trades}BLK
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className={`flex items-start gap-2 rounded-lg p-3 border mb-3 ${summaryBg}`}>
        {alert_count > 0 ? <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          : <Info size={13} className="text-slate-400 shrink-0 mt-0.5" />}
        <p className="text-xs text-slate-300 leading-relaxed">{summary}</p>
      </div>

      {/* Alert table */}
      {alerts && alerts.length > 0 ? (
        <>
          <div className="text-xs text-slate-400 mb-2 font-medium">Unusual Volume Strikes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-1 pr-2">Strike</th>
                  <th className="text-right pr-2">C Vol</th>
                  <th className="text-right pr-2">P Vol</th>
                  <th className="text-right pr-2">V/OI</th>
                  <th className="text-left pl-1">Type</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a: any, i: number) => {
                  const distColor = (a.distance_from_spot ?? 0) === 0
                    ? 'text-amber-400'
                    : a.distance_from_spot > 0
                    ? 'text-emerald-300'
                    : 'text-red-300';
                  return (
                    <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="py-1 pr-2">
                        <span className="font-medium text-slate-200">{a.strike}</span>
                        {a.distance_from_spot != null && (
                          <span className={`ml-1 text-[10px] ${distColor}`}>
                            {a.distance_from_spot > 0 ? '+' : ''}{a.distance_from_spot}
                          </span>
                        )}
                      </td>
                      <td className="text-right pr-2 tabular-nums text-emerald-300">{a.ce_volume?.toLocaleString()}</td>
                      <td className="text-right pr-2 tabular-nums text-red-300">{a.pe_volume?.toLocaleString()}</td>
                      <td className="text-right pr-2 tabular-nums font-bold text-amber-300">
                        {(a.vol_oi_ratio * 100)?.toFixed(1)}%
                      </td>
                      <td className="pl-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <SweepBadge direction={a.sweep_direction} />
                          {a.is_block && <FlagBadge flag="block_trade" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-slate-600 text-right">
            Notional &gt; ₹50L = Block. Vol/OI &gt; 8% = Unusual.
          </div>
        </>
      ) : (
        <div className="text-center text-slate-500 text-sm py-6">
          No unusual activity detected
        </div>
      )}
    </div>
  );
}
