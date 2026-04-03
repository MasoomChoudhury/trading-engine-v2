import { useQuery } from '@tanstack/react-query';
import { getBankNiftyAnalytics, BankNiftyAnalytics } from '../lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { AlertTriangle, Zap, Shield, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtGex = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}B`;
  return `${v.toFixed(0)}M`;
};

const fmtPrice = (v: number) =>
  v.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '12px',
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="stat-card">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ── Regime banner ─────────────────────────────────────────────────────────────

function RegimeBanner({ data }: { data: BankNiftyAnalytics }) {
  const isPos = data.regime === 'positive_gex';
  const colors = isPos
    ? { bg: 'bg-emerald-900/30', border: 'border-emerald-800', icon: <Shield size={20} className="text-emerald-400" /> }
    : { bg: 'bg-red-900/30', border: 'border-red-800', icon: <Zap size={20} className="text-red-400" /> };

  return (
    <div className={`rounded-xl p-4 border ${colors.bg} ${colors.border}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{colors.icon}</div>
        <div className="flex-1">
          <p className="font-semibold capitalize text-slate-100">
            {data.regime.replace(/_/g, ' ')}
          </p>
          <p className="text-sm text-slate-400 mt-0.5">{data.regime_description}</p>
          <p className="text-xs text-slate-500 mt-2 italic border-t border-slate-700/50 pt-2">
            {data.commentary}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Strike GEX bar chart ──────────────────────────────────────────────────────

function StrikeChart({ data }: { data: BankNiftyAnalytics }) {
  const chartData = data.strike_chart.map(s => ({
    ...s,
    label: fmtPrice(s.strike),
  }));

  return (
    <div className="chart-card">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">
        GEX by Strike (₹M) — Top 20 strikes
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={2} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={v => `${v}M`} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number, name: string) => [`${v.toFixed(1)}M`, name === 'call_gex' ? 'Call GEX' : name === 'put_gex' ? 'Put GEX' : 'Net GEX']}
          />
          <ReferenceLine y={0} stroke="#475569" />
          <ReferenceLine
            x={fmtPrice(data.call_wall)}
            stroke="#22c55e"
            strokeDasharray="4 2"
            label={{ value: 'CW', fill: '#22c55e', fontSize: 10 }}
          />
          <ReferenceLine
            x={fmtPrice(data.put_wall)}
            stroke="#ef4444"
            strokeDasharray="4 2"
            label={{ value: 'PW', fill: '#ef4444', fontSize: 10 }}
          />
          <Bar dataKey="call_gex" name="call_gex" stackId="a">
            {chartData.map((_, i) => <Cell key={i} fill="#22c55e" fillOpacity={0.75} />)}
          </Bar>
          <Bar dataKey="put_gex" name="put_gex" stackId="a">
            {chartData.map((_, i) => <Cell key={i} fill="#ef4444" fillOpacity={0.75} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-500 inline-block" /> Call GEX</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-red-500 inline-block" /> Put GEX (neg)</span>
        <span className="flex items-center gap-1.5"><span className="text-emerald-400 font-mono">CW</span> Call Wall</span>
        <span className="flex items-center gap-1.5"><span className="text-red-400 font-mono">PW</span> Put Wall</span>
      </div>
    </div>
  );
}

// ── PCR gauge ─────────────────────────────────────────────────────────────────

function PcrGauge({ pcr }: { pcr: number }) {
  let label: string;
  let color: string;
  let Icon = Minus;
  if (pcr > 1.3) { label = 'Overly bearish — contrarian buy'; color = 'text-emerald-400'; Icon = TrendingUp; }
  else if (pcr > 1.0) { label = 'Mild put dominance'; color = 'text-emerald-300'; Icon = TrendingUp; }
  else if (pcr < 0.7) { label = 'Overly bullish — contrarian sell'; color = 'text-red-400'; Icon = TrendingDown; }
  else if (pcr < 1.0) { label = 'Mild call dominance'; color = 'text-red-300'; Icon = TrendingDown; }
  else { label = 'Balanced'; color = 'text-slate-300'; }

  return (
    <div className="stat-card">
      <p className="text-xs text-slate-400 mb-1">PCR (OI)</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{pcr.toFixed(3)}</p>
      <div className={`flex items-center gap-1 mt-1 text-xs ${color}`}>
        <Icon size={12} />
        <span>{label}</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BankNifty() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['banknifty-analytics'],
    queryFn: getBankNiftyAnalytics,
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto page-enter space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-7 bg-slate-800 rounded w-64" />
          <div className="h-24 bg-slate-800 rounded-xl" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-slate-800 rounded-lg" />)}
          </div>
          <div className="h-64 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto page-enter">
        <div className="flex items-center gap-3 bg-red-900/20 border border-red-800/40 rounded-xl p-4">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <div>
            <p className="text-red-400 font-medium">BankNifty data unavailable</p>
            <p className="text-slate-400 text-sm mt-0.5">{(error as Error)?.message || 'Could not fetch option chain.'}</p>
          </div>
          <button onClick={() => refetch()} className="ml-auto btn-ghost text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const gexB = data.total_gex / 1e9;
  const gexColor = data.net_gex >= 0 ? 'text-emerald-400' : 'text-red-400';
  const aboveZeroColor = data.above_zero_gamma ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">BankNifty Internals</h1>
          <p className="text-sm text-slate-400 mt-1">
            GEX · PCR · Gamma walls — expiry: <span className="text-slate-300 font-medium">{data.expiry_date}</span>
            <span className="ml-2 text-slate-500">(lot size {data.lot_size})</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white tabular-nums">{fmtPrice(data.spot_price)}</p>
          <p className="text-xs text-slate-400">BankNifty spot</p>
        </div>
      </div>

      {/* Regime */}
      <RegimeBanner data={data} />

      {/* Stat cards row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total GEX"
          value={`${gexB.toFixed(2)}B`}
          sub="Gross call + put gamma exposure"
          color={gexColor}
        />
        <StatCard
          label="Net GEX"
          value={fmtGex(data.net_gex / 1e6)}
          sub="Call GEX − Put GEX"
          color={data.net_gex >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <PcrGauge pcr={data.pcr_oi} />
        <StatCard
          label="vs Zero Gamma"
          value={data.above_zero_gamma ? 'Above' : 'Below'}
          sub={`ZGL: ${fmtPrice(data.zero_gamma_level)}`}
          color={aboveZeroColor}
        />
      </div>

      {/* Stat cards row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Call Wall (Max Call Γ)"
          value={fmtPrice(data.call_wall)}
          sub={`${data.call_wall_pct >= 0 ? '+' : ''}${data.call_wall_pct.toFixed(2)}% from spot`}
          color="text-emerald-300"
        />
        <StatCard
          label="Put Wall (Max Put Γ)"
          value={fmtPrice(data.put_wall)}
          sub={`${data.put_wall_pct >= 0 ? '+' : ''}${data.put_wall_pct.toFixed(2)}% from spot`}
          color="text-red-300"
        />
        <StatCard
          label="Zero Gamma Level"
          value={fmtPrice(data.zero_gamma_level)}
          sub={`${data.zero_gamma_pct >= 0 ? '+' : ''}${data.zero_gamma_pct.toFixed(2)}% from spot`}
          color="text-yellow-400"
        />
        <StatCard
          label="PCR Volume"
          value={data.pcr_volume.toFixed(3)}
          sub="Put/Call volume ratio"
          color={data.pcr_volume > 1 ? 'text-emerald-300' : 'text-red-300'}
        />
      </div>

      {/* Strike GEX chart */}
      <StrikeChart data={data} />

      {/* Reading guide */}
      <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40 text-xs text-slate-400 space-y-1.5">
        <p className="font-semibold text-slate-300 mb-2">How to read BankNifty GEX</p>
        <p><span className="text-emerald-400 font-medium">Positive GEX:</span> Dealers are long gamma — they sell into rallies and buy dips, suppressing volatility. Sell premium.</p>
        <p><span className="text-red-400 font-medium">Negative GEX:</span> Dealers are short gamma — they chase moves, amplifying them. Avoid short vol; trend likely.</p>
        <p><span className="text-yellow-400 font-medium">Zero Gamma Level:</span> Price below this = negative gamma zone (vol expands); above = positive gamma (vol dampened).</p>
        <p><span className="text-slate-300 font-medium">BankNifty leads Nifty:</span> BankNifty has higher beta and often turns before the index — watch for divergence.</p>
      </div>

      <p className="text-xs text-slate-600 text-center">
        As of: {new Date(data.timestamp).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: true,
        })} IST
      </p>
    </div>
  );
}
