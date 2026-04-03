import { useQuery } from '@tanstack/react-query';
import { getPreMarketBias, BiasSignal, PreMarketBias } from '../lib/api';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle,
  DollarSign, Globe, Activity, BarChart2, Zap,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BIAS_CONFIG = {
  strong_bullish: { label: 'Strong Bullish', color: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-700/40', bar: 'bg-emerald-500' },
  bullish:        { label: 'Bullish',        color: 'text-emerald-300', bg: 'bg-emerald-900/20 border-emerald-800/40', bar: 'bg-emerald-400' },
  neutral:        { label: 'Neutral',        color: 'text-slate-300',   bg: 'bg-slate-800/60 border-slate-700/40',     bar: 'bg-slate-500' },
  bearish:        { label: 'Bearish',        color: 'text-red-300',     bg: 'bg-red-900/20 border-red-800/40',         bar: 'bg-red-400' },
  strong_bearish: { label: 'Strong Bearish', color: 'text-red-400',     bg: 'bg-red-900/30 border-red-700/40',         bar: 'bg-red-500' },
} as const;

const SENTIMENT_COLOR: Record<string, string> = {
  bullish:      'text-emerald-400 bg-emerald-900/30',
  mild_bullish: 'text-emerald-300 bg-emerald-900/20',
  neutral:      'text-slate-400 bg-slate-800/50',
  mild_bearish: 'text-red-300 bg-red-900/20',
  bearish:      'text-red-400 bg-red-900/30',
};

const SIGNAL_ICONS: Record<string, React.ReactNode> = {
  gift_nifty:  <Zap size={13} />,
  em_headwind: <Globe size={13} />,
  usd_inr:     <DollarSign size={13} />,
  fii_cash:    <TrendingUp size={13} />,
  fii_fo:      <BarChart2 size={13} />,
};

function fmt2(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// ── Bias meter ────────────────────────────────────────────────────────────────

function BiasMeter({ score }: { score: number }) {
  // Score range roughly -8 to +8; clamp to ±8 for display
  const clamped = Math.max(-8, Math.min(8, score));
  const pct = ((clamped + 8) / 16) * 100;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-slate-700/60 overflow-hidden">
        {/* colour gradient track */}
        <div className="absolute inset-0 rounded-full"
          style={{ background: 'linear-gradient(to right, #ef4444, #f59e0b, #22c55e)' }}
        />
        {/* needle */}
        <div
          className="absolute top-0 w-1 h-full bg-white rounded-full shadow-md transition-all duration-500"
          style={{ left: `calc(${pct}% - 2px)` }}
        />
      </div>
      <div className="text-center mt-1 text-xs text-slate-500">score: {score > 0 ? '+' : ''}{score}</div>
    </div>
  );
}

// ── Signal row ────────────────────────────────────────────────────────────────

function SignalRow({ s }: { s: BiasSignal }) {
  const colorClass = SENTIMENT_COLOR[s.sentiment] ?? SENTIMENT_COLOR.neutral;
  const icon = SIGNAL_ICONS[s.key] ?? <Activity size={13} />;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-800/80 last:border-0">
      <div className="flex items-center gap-1.5 w-36 flex-shrink-0 text-xs text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {s.label}
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${colorClass}`}>
        {s.value}
      </span>
      <p className="text-xs text-slate-500 leading-relaxed">{s.note}</p>
    </div>
  );
}

// ── Gift Nifty mini card ──────────────────────────────────────────────────────

function GiftNiftyCard({ data }: { data: PreMarketBias['gift_nifty'] }) {
  const hasGap = data.gap_pct != null;
  const gapColor = !hasGap ? 'text-slate-400'
    : data.gap_pct! >= 0.3 ? 'text-emerald-400'
    : data.gap_pct! <= -0.3 ? 'text-red-400'
    : 'text-slate-300';

  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
      <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5"><Zap size={11} /> Gift Nifty Proxy</div>
      {hasGap ? (
        <>
          <div className={`text-lg font-bold tabular-nums ${gapColor}`}>
            {data.gap_pct! >= 0 ? '+' : ''}{data.gap_pct!.toFixed(2)}% gap
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Fut: {fmtPrice(data.ltp)} · Spot prev: {fmtPrice(data.prev_close)}
          </div>
          {data.basis_pct != null && (
            <div className="text-xs text-slate-600 mt-0.5">
              Basis: {data.basis_pct >= 0 ? '+' : ''}{data.basis_pct.toFixed(2)}%
              &nbsp;· Expiry: {data.expiry}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-slate-500">{data.note}</div>
      )}
    </div>
  );
}

// ── DXY + US10Y mini cards ────────────────────────────────────────────────────

function MacroRateCard({ data, label, unit = '' }: {
  data: { price: number | null; change_pct: number | null };
  label: string;
  unit?: string;
}) {
  const chg = data.change_pct;
  const chgColor = chg == null ? 'text-slate-400' : chg > 0 ? 'text-red-400' : 'text-emerald-400';
  // For DXY/yields: rising = bad for EM = red; falling = good = green

  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums text-slate-100">
        {data.price != null ? `${fmt2(data.price)}${unit}` : '—'}
      </div>
      <div className={`text-xs ${chgColor} tabular-nums`}>
        {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
      </div>
    </div>
  );
}

// ── USD/INR trend card ────────────────────────────────────────────────────────

function UsdInrTrendCard({ trend }: { trend: PreMarketBias['global_cues']['usd_inr_trend'] }) {
  const config = trend.trend === 'appreciating'
    ? { color: 'text-emerald-400', icon: <TrendingDown size={14} />, label: 'INR Strengthening' }
    : trend.trend === 'depreciating'
    ? { color: 'text-red-400', icon: <TrendingUp size={14} />, label: 'INR Weakening' }
    : { color: 'text-slate-400', icon: <Minus size={14} />, label: 'INR Sideways' };

  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
      <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5"><DollarSign size={11} /> USD/INR Trend</div>
      <div className={`flex items-center gap-1.5 text-base font-bold ${config.color}`}>
        {config.icon} {config.label}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">
        {trend.intraday_chg_pct != null
          ? `Intraday: ${trend.intraday_chg_pct >= 0 ? '+' : ''}${trend.intraday_chg_pct.toFixed(3)}%`
          : trend.note ?? '—'}
        {trend.severity && trend.severity !== 'flat' && (
          <span className="ml-1 text-slate-600">({trend.severity})</span>
        )}
      </div>
    </div>
  );
}

// ── FII dual-flow row ─────────────────────────────────────────────────────────

function FIIDualFlow({ fii_cash, fii_deriv }: {
  fii_cash: PreMarketBias['fii_cash'];
  fii_deriv: PreMarketBias['fii_deriv'];
}) {
  const cashColor = (fii_cash.fii_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400';
  const diiColor = (fii_cash.dii_net ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400';
  const foColor = fii_deriv.net_position === 'net_long' ? 'text-emerald-400'
    : fii_deriv.net_position === 'net_short' ? 'text-red-400' : 'text-slate-400';

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
        <div className="text-xs text-slate-400 mb-1">FII Cash</div>
        <div className={`text-sm font-bold tabular-nums ${cashColor}`}>
          {fii_cash.fii_net != null
            ? `${fii_cash.fii_net >= 0 ? '+' : ''}${fii_cash.fii_net.toFixed(0)} ×100Cr`
            : 'No data'}
        </div>
        {fii_cash.date && <div className="text-xs text-slate-600">{fii_cash.date}</div>}
      </div>
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
        <div className="text-xs text-slate-400 mb-1">DII Cash</div>
        <div className={`text-sm font-bold tabular-nums ${diiColor}`}>
          {fii_cash.dii_net != null
            ? `${fii_cash.dii_net >= 0 ? '+' : ''}${fii_cash.dii_net.toFixed(0)} ×100Cr`
            : 'No data'}
        </div>
        {fii_cash.fii_5d_net != null && (
          <div className="text-xs text-slate-600">FII 5d: {fii_cash.fii_5d_net >= 0 ? '+' : ''}{fii_cash.fii_5d_net.toFixed(0)}</div>
        )}
      </div>
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
        <div className="text-xs text-slate-400 mb-1">FII F&amp;O Pos.</div>
        <div className={`text-sm font-bold ${foColor}`}>
          {fii_deriv.net_position === 'net_long' ? 'Net Long'
           : fii_deriv.net_position === 'net_short' ? 'Net Short'
           : 'No data'}
        </div>
        {fii_deriv.index_fut_net != null && (
          <div className="text-xs text-slate-600">{fii_deriv.index_fut_net >= 0 ? '+' : ''}{fii_deriv.index_fut_net.toFixed(0)} lots</div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function PreMarketBiasPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['premarket-bias'],
    queryFn: getPreMarketBias,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="panel-card animate-pulse h-64 flex items-center justify-center text-slate-500 text-sm">
        Loading pre-market bias…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-card">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} className="text-red-400" />
          <h3 className="text-sm font-semibold text-slate-200">Pre-Market Bias</h3>
        </div>
        <p className="text-xs text-red-400">{(error as Error)?.message || 'Failed to load'}</p>
        <button onClick={() => refetch()} className="mt-2 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  }

  const biasCfg = BIAS_CONFIG[data.bias] ?? BIAS_CONFIG.neutral;
  const gc = data.global_cues;

  return (
    <div className="panel-card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Pre-Market Bias</h3>
          <p className="text-xs text-slate-500 mt-0.5">DXY · US10Y · USD/INR · Gift Nifty · FII Dual Flow</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${biasCfg.bg} ${biasCfg.color}`}>
            {biasCfg.label}
          </span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center justify-center w-6 h-6 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Bias meter */}
      <BiasMeter score={data.score} />

      {/* Signal breakdown */}
      <div>
        {data.signals.map(s => <SignalRow key={s.key} s={s} />)}
      </div>

      {/* Macro rates row: Gift Nifty + DXY + US10Y + USD/INR trend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <GiftNiftyCard data={data.gift_nifty} />
        <MacroRateCard data={gc.dxy} label="DXY" />
        <MacroRateCard data={gc.us10y} label="US 10Y Yield" unit="%" />
        <UsdInrTrendCard trend={gc.usd_inr_trend} />
      </div>

      {/* FII dual flow */}
      <FIIDualFlow fii_cash={data.fii_cash} fii_deriv={data.fii_deriv} />

      <p className="text-xs text-slate-600">
        Updated {new Date(data.timestamp).toLocaleString('en-IN', {
          hour: '2-digit', minute: '2-digit', hour12: true, day: '2-digit', month: 'short',
        })} IST · DXY & yields: rising = EM headwind (red). Gift Nifty via Upstox near-month futures.
      </p>
    </div>
  );
}
