import { useGEXVelocity } from '../hooks/useIndicators';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, Zap, Minus } from 'lucide-react';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function DirectionBadge({ direction }: { direction: string }) {
  const configs: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    building: { icon: <TrendingUp size={13} />, label: 'Building', cls: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50' },
    accelerating_build: { icon: <Zap size={13} />, label: 'Accel Build', cls: 'text-emerald-300 bg-emerald-900/40 border-emerald-500/60' },
    decaying: { icon: <TrendingDown size={13} />, label: 'Decaying', cls: 'text-red-300 bg-red-900/30 border-red-700/50' },
    accelerating_decay: { icon: <Zap size={13} />, label: 'Accel Decay', cls: 'text-red-300 bg-red-900/40 border-red-500/60' },
    stable: { icon: <Minus size={13} />, label: 'Stable', cls: 'text-slate-300 bg-slate-800 border-slate-600' },
  };
  const cfg = configs[direction] ?? configs.stable;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-semibold ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </div>
  );
}

export default function GEXVelocityPanel() {
  const { data, isLoading, error } = useGEXVelocity();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">GEX Velocity</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">GEX Velocity</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'No GEX snapshot history (data builds during market hours)'}
        </div>
      </div>
    );
  }

  const { velocity, total_gex_velocity, direction, direction_note,
    net_gex_start, net_gex_current, total_gex_current,
    gex_series, strike_movers, elapsed_hours, snapshot_count } = data;

  const velocityColor = velocity > 0 ? 'text-emerald-300' : velocity < 0 ? 'text-red-300' : 'text-slate-300';

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>GEX Velocity</span>
        <DirectionBadge direction={direction} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Net GEX Δ/hr</div>
          <div className={`text-lg font-bold tabular-nums ${velocityColor}`}>
            {velocity >= 0 ? '+' : ''}{velocity?.toFixed(1)}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Net GEX Now</div>
          <div className={`text-sm font-bold tabular-nums ${(net_gex_current ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {((net_gex_current ?? 0) / 1e9).toFixed(1)}B
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-xs text-slate-400">Total GEX</div>
          <div className="text-sm font-bold text-blue-300 tabular-nums">
            {((total_gex_current ?? 0) / 1e9).toFixed(1)}B
          </div>
        </div>
      </div>

      {/* Chart */}
      {gex_series && gex_series.length > 1 && (
        <div className="h-36 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={gex_series} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} width={48}
                tickFormatter={(v) => `${(v / 1e9).toFixed(1)}B`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${(v / 1e9).toFixed(2)}B`, 'Net GEX']}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="net_gex" stroke="#a78bfa" strokeWidth={2} dot={false} name="Net GEX" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Direction note */}
      <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3 mb-3">
        <p className="text-xs text-slate-300 leading-relaxed">{direction_note}</p>
        <div className="text-xs text-slate-500 mt-1">
          {snapshot_count} snapshots over {elapsed_hours?.toFixed(1)}h window
        </div>
      </div>

      {/* Strike movers */}
      {strike_movers && strike_movers.length > 0 && (
        <>
          <div className="text-xs text-slate-400 mb-2 font-medium">Top GEX Movers (last 30 min)</div>
          <div className="space-y-1">
            {strike_movers.map((m: any, i: number) => {
              const isBuilding = m.direction === 'building';
              return (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-300 font-medium">{m.strike}</span>
                  <div className={`flex items-center gap-1 ${isBuilding ? 'text-emerald-300' : 'text-red-300'}`}>
                    {isBuilding ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    <span className="tabular-nums font-semibold">
                      {m.net_gex_change >= 0 ? '+' : ''}{(m.net_gex_change / 1e6).toFixed(1)}M
                    </span>
                    <span className="text-slate-500 capitalize">{m.direction}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
