import { useGlobalCues } from '../hooks/useIndicators';
import { Globe, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { GlobalCueItem } from '../lib/api';

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPrice(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toFixed(decimals);
}

function ChangeIcon({ pct }: { pct: number | null }) {
  if (pct == null) return <Minus size={12} className="text-slate-500" />;
  if (pct > 0) return <TrendingUp size={12} className="text-emerald-400" />;
  if (pct < 0) return <TrendingDown size={12} className="text-red-400" />;
  return <Minus size={12} className="text-slate-500" />;
}

function CueCard({ item, label }: { item: GlobalCueItem; label: string }) {
  const pos = item.change_pct == null ? null : item.change_pct >= 0;
  const changeColor = pos == null ? 'text-slate-400' : pos ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="bg-slate-800/60 rounded-lg p-3 flex flex-col gap-1">
      <div className="text-xs text-slate-400 font-medium truncate">{label}</div>
      <div className="text-base font-bold text-slate-100 tabular-nums">
        {fmtPrice(item.price)}
      </div>
      <div className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${changeColor}`}>
        <ChangeIcon pct={item.change_pct} />
        {item.change != null && item.change_pct != null ? (
          <>
            {item.change >= 0 ? '+' : ''}{fmt(item.change, 2)}
            <span className="text-slate-500 font-normal ml-0.5">
              ({item.change_pct >= 0 ? '+' : ''}{fmt(item.change_pct, 2)}%)
            </span>
          </>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </div>
    </div>
  );
}

function NACard({ label, note }: { label: string; note: string }) {
  return (
    <div className="bg-slate-800/40 rounded-lg p-3 flex flex-col gap-1 border border-dashed border-slate-700/50">
      <div className="text-xs text-slate-400 font-medium">{label}</div>
      <div className="text-base font-bold text-slate-500">N/A</div>
      <div className="text-xs text-slate-600">{note}</div>
    </div>
  );
}

const SENTIMENT_CONFIG = {
  bullish: { icon: '🟢', label: 'US Markets Bullish', color: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-700/40' },
  bearish: { icon: '🔴', label: 'US Markets Bearish', color: 'text-red-400', bg: 'bg-red-900/30 border-red-700/40' },
  mixed: { icon: '🟡', label: 'US Markets Mixed', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-700/40' },
} as const;

export default function GlobalCuesPanel() {
  const { data, isLoading, error } = useGlobalCues();

  if (isLoading) {
    return (
      <div className="panel-card animate-pulse h-40 flex items-center justify-center text-slate-500 text-sm">
        Loading global cues…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-card">
        <div className="flex items-center gap-2 mb-2">
          <Globe size={16} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">Global Cues</h3>
        </div>
        <p className="text-xs text-slate-500">Failed to load global cues. {(error as Error)?.message}</p>
      </div>
    );
  }

  const sentiment = data.sentiment ?? 'mixed';
  const sentCfg = SENTIMENT_CONFIG[sentiment];

  return (
    <div className="panel-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">Global Cues</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${sentCfg.bg} ${sentCfg.color}`}>
            {sentCfg.icon} {sentCfg.label}
          </span>
        </div>
        <span className="text-xs text-slate-500">
          {new Date(data.timestamp).toLocaleString('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true,
          })} IST
        </span>
      </div>

      {/* Row 1: US markets */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <CueCard item={data.dow} label="Dow Jones" />
        <CueCard item={data.nasdaq} label="Nasdaq" />
        <CueCard item={data.sp500} label="S&P 500" />
        <CueCard item={data.usd_inr} label="USD/INR" />
      </div>

      {/* Row 2: Asian + macro rates */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <CueCard item={data.nikkei} label="Nikkei 225" />
        <CueCard item={data.hang_seng} label="Hang Seng" />
        {data.dxy && <CueCard item={data.dxy} label="DXY" />}
        {data.us10y && <CueCard item={data.us10y} label="US 10Y Yield %" />}
      </div>

      {/* EM headwind signal */}
      {data.em_headwind && (() => {
        const sig = data.em_headwind.signal;
        const isHeadwind = sig.includes('headwind');
        const isTailwind = sig.includes('tailwind');
        if (sig === 'neutral') return null;
        return (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs mb-2 ${
            isHeadwind ? 'bg-red-900/20 border border-red-800/30 text-red-300'
            : 'bg-emerald-900/20 border border-emerald-800/30 text-emerald-300'}`}>
            <span className="font-semibold flex-shrink-0">
              {isHeadwind ? '⚠ EM Headwind' : '✓ EM Tailwind'}
            </span>
            <span className="text-slate-400">{data.em_headwind.reasons.join(' · ')}</span>
          </div>
        );
      })()}

      <p className="text-xs text-slate-600 mt-2">
        Source: Yahoo Finance · Prices delayed 15–20 min
      </p>
    </div>
  );
}
