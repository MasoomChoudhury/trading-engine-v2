import { useIVTermStructure } from '../hooks/useIndicators';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function RegimeIcon({ regime }: { regime: string }) {
  if (regime === 'contango') return <TrendingUp size={16} className="text-emerald-400" />;
  if (regime === 'backwardation') return <TrendingDown size={16} className="text-red-400" />;
  return <Minus size={16} className="text-slate-400" />;
}

function RegimeBadge({ regime }: { regime: string }) {
  const map: Record<string, string> = {
    contango: 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300',
    backwardation: 'bg-red-900/40 border-red-700/50 text-red-300',
    flat: 'bg-slate-800 border-slate-600 text-slate-300',
  };
  const cls = map[regime] ?? map.flat;
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-semibold uppercase ${cls}`}>
      {regime}
    </span>
  );
}

export default function IVTermStructurePanel() {
  const { data, isLoading, error } = useIVTermStructure();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">IV Term Structure</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">IV Term Structure</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to load IV term structure'}
        </div>
      </div>
    );
  }

  const { term_structure, regime, near_iv, far_iv, near_far_ratio, weekly_premium_pct, note, spot_price } = data;

  const chartData = term_structure.map(p => ({
    label: `${p.expiry.slice(5)} (${p.dte}d)`,
    dte: p.dte,
    iv: p.atm_iv,
    ce_iv: p.atm_ce_iv,
    pe_iv: p.atm_pe_iv,
    expiry: p.expiry,
  }));

  const weeklyExpensive = near_far_ratio != null && near_far_ratio >= 1.4;

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>IV Term Structure</span>
        <div className="flex items-center gap-2">
          <RegimeIcon regime={regime} />
          <RegimeBadge regime={regime} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Near IV</div>
          <div className="text-xl font-bold text-white">{near_iv.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">{term_structure[0]?.expiry ?? ''}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Far IV</div>
          <div className="text-xl font-bold text-white">{far_iv.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">{term_structure[term_structure.length - 1]?.expiry ?? ''}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Near/Far Ratio</div>
          <div className={`text-xl font-bold ${weeklyExpensive ? 'text-red-400' : 'text-slate-200'}`}>
            {near_far_ratio?.toFixed(2) ?? '—'}
          </div>
          {weekly_premium_pct != null && (
            <div className={`text-xs mt-1 ${weeklyExpensive ? 'text-red-400' : 'text-slate-500'}`}>
              {weekly_premium_pct > 0 ? '+' : ''}{weekly_premium_pct.toFixed(0)}% vs monthly
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => [`${v.toFixed(2)}%`, 'ATM IV']}
            />
            <Line
              type="monotone"
              dataKey="iv"
              stroke={regime === 'backwardation' ? '#f87171' : '#34d399'}
              strokeWidth={2}
              dot={{ fill: '#1e293b', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly expensive warning */}
      {weeklyExpensive && (
        <div className="mt-3 flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg p-3">
          <Info size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300 leading-relaxed">
            <span className="font-semibold">Weekly premium alert:</span> Near-month IV is{' '}
            {weekly_premium_pct?.toFixed(0)}% above monthly IV. Buying naked weeklies is
            statistically expensive — favour spreads or wait for IV crush.
          </p>
        </div>
      )}

      {/* Note */}
      {!weeklyExpensive && note && (
        <p className="mt-3 text-xs text-slate-400 leading-relaxed">{note}</p>
      )}
    </div>
  );
}
