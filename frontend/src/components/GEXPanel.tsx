import { useGEX, useGEXHistory } from '../hooks/useIndicators';
import { AlertTriangle, Zap, Shield, XCircle } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

function gammaColor(gex: number) {
  if (gex > 1e8) return 'text-emerald-400';
  if (gex < -1e8) return 'text-red-400';
  return 'text-amber-400';
}

function regimeIcon(regime: string) {
  if (regime === 'positive_gex') return <Shield size={20} className="text-emerald-400" />;
  if (regime === 'negative_gex') return <Zap size={20} className="text-red-400" />;
  return <XCircle size={20} className="text-slate-400" />;
}

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function PercentileBadge({ rank, label }: { rank: number; label: string }) {
  let color = 'text-slate-300 bg-slate-800 border-slate-600';
  if (rank <= 10) color = 'text-red-300 bg-red-900/40 border-red-700/60';
  else if (rank <= 25) color = 'text-orange-300 bg-orange-900/30 border-orange-700/50';
  else if (rank <= 50) color = 'text-amber-300 bg-amber-900/20 border-amber-700/40';
  else if (rank <= 75) color = 'text-blue-300 bg-blue-900/20 border-blue-700/40';
  else color = 'text-emerald-300 bg-emerald-900/20 border-emerald-700/40';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${color}`}>
      <span className="font-bold text-base tabular-nums">{rank.toFixed(0)}th</span>
      <div>
        <p className="font-semibold">percentile</p>
        <p className="opacity-80">{label}</p>
      </div>
    </div>
  );
}

function GEXHistoryChart() {
  const { data: hist } = useGEXHistory(90);

  if (!hist || hist.history.length === 0) return null;

  const chartData = hist.history.map(h => ({
    date: h.date?.slice(5) ?? '',   // MM-DD
    gex: h.total_gex !== null ? parseFloat((h.total_gex / 1e9).toFixed(3)) : null,
  }));

  const minGex = Math.min(...chartData.map(d => d.gex ?? 0));
  const maxGex = Math.max(...chartData.map(d => d.gex ?? 0));
  const currentGex = hist.current_gex !== null ? parseFloat((hist.current_gex / 1e9).toFixed(3)) : null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          90-Day GEX History
        </p>
        {hist.percentile_rank !== null && hist.percentile_label && (
          <PercentileBadge rank={hist.percentile_rank} label={hist.percentile_label} />
        )}
      </div>
      {hist.data_points < 5 && (
        <p className="text-xs text-slate-500 mb-2 italic">
          Only {hist.data_points} day(s) of data — percentile unreliable until 30+ days accumulate.
        </p>
      )}
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gexGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} interval={Math.floor(chartData.length / 6)} />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 9 }}
            tickFormatter={v => `${v}B`}
            domain={[Math.floor(minGex - 0.5), Math.ceil(maxGex + 0.5)]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`${v}B`, 'Total GEX']}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
          {currentGex !== null && (
            <ReferenceLine y={currentGex} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} />
          )}
          <Area
            type="monotone"
            dataKey="gex"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="url(#gexGrad)"
            connectNulls
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-600 mt-1">
        Yellow dashed = current GEX · {hist.data_points} trading day snapshots
      </p>
    </div>
  );
}

export default function GEXPanel() {
  const { data: gex, isLoading, error } = useGEX();

  if (isLoading) {
    return (
      <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-2/3" />
          <div className="h-20 bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  if (error || !gex) {
    return (
      <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-red-900/50 shadow-lg shadow-black/20">
        <div className="flex items-center gap-2 text-red-400 mb-2">
          <AlertTriangle size={18} />
          <span className="font-semibold">GEX Data Unavailable</span>
        </div>
        <p className="text-sm text-slate-400">Could not fetch option chain data. Check API credentials.</p>
      </div>
    );
  }

  const regimeColors: Record<string, string> = {
    positive_gex: 'bg-emerald-900/30 border-emerald-800',
    negative_gex: 'bg-red-900/30 border-red-800',
    unknown: 'bg-slate-800 border-slate-700',
  };

  return (
    <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-200">Gamma Exposure (GEX)</h2>
        <span className="text-xs text-slate-500">Expiry: {gex.expiry_date}</span>
      </div>

      <div className={`rounded-lg p-4 border mb-4 ${regimeColors[gex.regime] || regimeColors.unknown}`}>
        <div className="flex items-center gap-3">
          {regimeIcon(gex.regime)}
          <div>
            <p className="font-semibold capitalize">{typeof gex.regime === 'string' ? gex.regime.replace(/_/g, ' ') : String(gex.regime ?? 'unknown')}</p>
            <p className="text-xs text-slate-400 mt-0.5">{gex.regime_description}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat-card !p-3">
          <p className="text-xs text-slate-400 mb-1">Total GEX</p>
          <p className={`text-xl font-bold tabular-nums ${gammaColor(gex.total_gex)}`}>
            {(gex.total_gex / 1e9).toFixed(2)}B
          </p>
        </div>
        <div className="stat-card !p-3">
          <p className="text-xs text-slate-400 mb-1">Net GEX</p>
          <p className={`text-xl font-bold tabular-nums ${gammaColor(gex.net_gex)}`}>
            {(gex.net_gex / 1e9).toFixed(2)}B
          </p>
        </div>
        <div className="stat-card !p-3">
          <p className="text-xs text-slate-400 mb-1">Zero Gamma</p>
          <p className="text-xl font-bold tabular-nums text-yellow-400">
            {gex.zero_gamma_level != null
              ? gex.zero_gamma_level.toLocaleString('en-IN', { maximumFractionDigits: 0 })
              : <span className="text-slate-500 text-base">N/A</span>}
          </p>
          {gex.zero_gamma_level == null && (
            <p className="text-xs text-slate-600 mt-0.5">No crossing — all strikes negative</p>
          )}
        </div>
        <div className="stat-card !p-3">
          <p className="text-xs text-slate-400 mb-1">PCR</p>
          <p className={`text-xl font-bold tabular-nums ${gex.pcr > 1 ? 'text-red-400' : 'text-emerald-400'}`}>
            {gex.pcr.toFixed(3)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="stat-card !p-3">
          <p className="text-xs text-emerald-400 mb-1">Call Wall (Max Call Gamma)</p>
          <p className="text-lg font-bold tabular-nums text-emerald-300">
            {gex.call_wall.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-slate-400">
            {gex.call_wall_distance >= 0 ? '+' : ''}{gex.call_wall_distance.toFixed(2)}% from spot
          </p>
        </div>
        <div className="stat-card !p-3">
          <p className="text-xs text-red-400 mb-1">Put Wall (Max Put Gamma)</p>
          <p className="text-lg font-bold tabular-nums text-red-300">
            {gex.put_wall.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-slate-400">
            {gex.put_wall_distance >= 0 ? '+' : ''}{gex.put_wall_distance.toFixed(2)}% from spot
          </p>
        </div>
      </div>

      <div className="mt-4 stat-card !p-3">
        <p className="text-xs text-slate-400 mb-1">Price vs Zero Gamma Level</p>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">{gex.spot_price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          <span className="text-slate-500">vs</span>
          {gex.zero_gamma_level != null ? (
            <>
              <span className="text-lg font-bold text-yellow-400">{gex.zero_gamma_level.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              <span className={`text-sm font-medium ml-auto ${gex.spot_price >= gex.zero_gamma_level ? 'text-emerald-400' : 'text-red-400'}`}>
                {gex.spot_price >= gex.zero_gamma_level ? 'Above Zero Gamma' : 'Below Zero Gamma'}
              </span>
            </>
          ) : (
            <span className="text-slate-500 text-sm ml-auto">Zero gamma level unavailable — uniform negative GEX</span>
          )}
        </div>
      </div>

      {/* 90-day GEX history + percentile rank */}
      <GEXHistoryChart />

      <p className="text-xs text-slate-600 mt-3">
        GEX as of: {new Date(gex.timestamp).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: true,
        })} IST
      </p>
    </div>
  );
}
