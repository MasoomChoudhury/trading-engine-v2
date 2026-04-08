import { useDealerDeltaExposure } from '../hooks/useIndicators';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { ArrowUpCircle, ArrowDownCircle, MinusCircle, Info } from 'lucide-react';

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

function fmt(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

function PositionBadge({ position }: { position: string }) {
  if (position === 'net_short') return (
    <div className="flex items-center gap-1.5 text-emerald-300">
      <ArrowUpCircle size={16} />
      <span className="text-sm font-semibold">Dealers Net SHORT</span>
    </div>
  );
  if (position === 'net_long') return (
    <div className="flex items-center gap-1.5 text-red-300">
      <ArrowDownCircle size={16} />
      <span className="text-sm font-semibold">Dealers Net LONG</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-slate-300">
      <MinusCircle size={16} />
      <span className="text-sm font-semibold">Dealers Neutral</span>
    </div>
  );
}

export default function DealerDeltaPanel() {
  const { data, isLoading, error } = useDealerDeltaExposure();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Dealer Net Delta Exposure</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Dealer Net Delta Exposure</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to load dealer delta'}
        </div>
      </div>
    );
  }

  const {
    dealer_net_delta, dealer_position, hedging_note,
    customer_call_delta, customer_put_delta,
    top_gamma_strikes, delta_chart, atm_strike, expiry, dte,
  } = data;

  // Chart: per-strike customer delta (dealers flip sign)
  const chartData = delta_chart.map(d => ({
    strike: d.strike,
    call_delta: parseFloat(d.strike_customer_delta.toFixed(1)),
    gamma: d.gamma_oi_weighted,
    isAtm: d.strike === atm_strike,
  }));

  const dealerColor = dealer_position === 'net_short' ? '#34d399'
    : dealer_position === 'net_long' ? '#f87171'
    : '#94a3b8';

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Dealer Net Delta</span>
        <span className="text-xs text-slate-400">{expiry} ({dte}d)</span>
      </div>

      {/* Main stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-1">Dealer Net Delta</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: dealerColor }}>
            {dealer_net_delta >= 0 ? '+' : ''}{fmt(dealer_net_delta)}
          </div>
          <div className="mt-1.5">
            <PositionBadge position={dealer_position} />
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-slate-400 mb-2">Customer Breakdown</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-emerald-400">Call (long)</span>
              <span className="tabular-nums text-slate-200">{fmt(customer_call_delta)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-red-400">Put (short)</span>
              <span className="tabular-nums text-slate-200">{fmt(customer_put_delta)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Strike-level customer delta chart */}
      <div className="text-xs text-slate-400 mb-2">Customer Delta by Strike (dealers = inverse)</div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="strike"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickLine={false}
              tickFormatter={v => `${(v / 1000).toFixed(1)}k`}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickLine={false}
              tickFormatter={fmt}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, name: string) => [fmt(v), 'Customer Δ']}
              labelFormatter={v => `Strike: ₹${Number(v).toLocaleString('en-IN')}`}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
            <Bar dataKey="call_delta" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.isAtm ? '#f59e0b'
                      : entry.call_delta > 0 ? '#34d399'
                      : '#f87171'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top gamma strikes */}
      {top_gamma_strikes.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-slate-400 mb-2">Top Gamma Concentration (pinning zones)</div>
          <div className="flex flex-wrap gap-2">
            {top_gamma_strikes.slice(0, 5).map((g, i) => (
              <div key={i} className="bg-amber-900/20 border border-amber-700/40 rounded px-2 py-1 text-xs">
                <span className="text-amber-300 font-semibold">₹{g.strike.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hedging note */}
      <div className="mt-3 flex items-start gap-2 bg-slate-800/60 border border-slate-700/40 rounded-lg p-3">
        <Info size={13} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">{hedging_note}</p>
      </div>
    </div>
  );
}
