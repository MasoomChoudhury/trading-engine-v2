import { useGEX } from '../hooks/useIndicators';
import { AlertTriangle, Zap, Shield, XCircle } from 'lucide-react';

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
            {gex.zero_gamma_level.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
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
          <span className="text-lg font-bold text-yellow-400">{gex.zero_gamma_level.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          <span className={`text-sm font-medium ml-auto ${gex.spot_price >= gex.zero_gamma_level ? 'text-emerald-400' : 'text-red-400'}`}>
            {gex.spot_price >= gex.zero_gamma_level ? 'Above Zero Gamma' : 'Below Zero Gamma'}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-3">
        GEX as of: {new Date(gex.timestamp).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: true,
        })} IST
      </p>
    </div>
  );
}
