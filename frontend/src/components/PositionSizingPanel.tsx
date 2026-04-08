import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, AlertTriangle, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { fetcher } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────
interface PositionSizeResult {
  mode: string;
  capital: number;
  risk_pct: number;
  entry_premium: number;
  net_debit: number | null;
  max_loss_per_lot: number;
  max_risk_inr: number;
  raw_lots: number;
  adjusted_lots: number;
  vix_current: number;
  vix_factor: number;
  vix_level: 'normal' | 'elevated' | 'extreme';
  vix_note: string | null;
  capital_at_risk_inr: number;
  capital_at_risk_pct: number;
  kelly_pct: number | null;
  kelly_note: string;
  lot_size: number;
  error?: string;
}

interface ConfluenceEvent {
  id: number;
  timestamp: string;
  direction: string;
  signal_value: string;
  spot: number | null;
  atm_premium: number | null;
  is_confluence: boolean;
  confluence_count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 1_00_000
    ? `₹${(n / 1_00_000).toFixed(1)}L`
    : n >= 1_000
    ? `₹${(n / 1_000).toFixed(0)}K`
    : `₹${n.toFixed(0)}`;

// ─── Component ────────────────────────────────────────────────────────────────
export default function PositionSizingPanel() {
  const [capital, setCapital] = useState<string>('500000');
  const [riskPct, setRiskPct] = useState<number>(2);
  const [mode, setMode] = useState<'naked' | 'spread'>('naked');
  const [entryPremium, setEntryPremium] = useState<string>('');
  const [netDebit, setNetDebit] = useState<string>('');
  const [maxGain, setMaxGain] = useState<string>('');
  const [queryParams, setQueryParams] = useState<URLSearchParams | null>(null);

  // ── Confluence banner: latest high-confluence event within last 30 min ─────
  const { data: signalLog } = useQuery<ConfluenceEvent[]>({
    queryKey: ['signal-log-confluence'],
    queryFn: () => fetcher('/v1/nifty50/signal-log?limit=10'),
    refetchInterval: 60_000,
    retry: 1,
  });

  const recentConfluence = signalLog
    ?.filter(
      (e) =>
        e.is_confluence &&
        Date.now() - new Date(e.timestamp).getTime() < 30 * 60 * 1000,
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  // Auto-fill entry premium from confluence event
  useEffect(() => {
    if (recentConfluence?.atm_premium && !entryPremium) {
      setEntryPremium(String(recentConfluence.atm_premium));
    }
  }, [recentConfluence]);

  // ── Compute button: only fetches when user clicks ──────────────────────────
  const handleCompute = useCallback(() => {
    const cap = parseFloat(capital);
    const ep = parseFloat(entryPremium) || 0;
    const nd = parseFloat(netDebit) || undefined;
    const mg = parseFloat(maxGain) || undefined;

    if (!cap || cap <= 0) return;
    if (mode === 'naked' && ep <= 0) return;
    if (mode === 'spread' && (!nd || nd <= 0)) return;

    const p = new URLSearchParams({
      capital: String(cap),
      risk_pct: String(riskPct),
      mode,
      entry_premium: String(ep),
    });
    if (nd) p.set('net_debit', String(nd));
    if (mg) p.set('max_gain', String(mg));
    setQueryParams(p);
  }, [capital, riskPct, mode, entryPremium, netDebit, maxGain]);

  const { data: result, isFetching, isError } = useQuery<PositionSizeResult>({
    queryKey: ['position-sizing', queryParams?.toString()],
    queryFn: () => fetcher(`/v1/options/position-sizing?${queryParams}`),
    enabled: queryParams !== null,
    retry: 1,
    staleTime: Infinity,
  });

  // ── VIX level colours ──────────────────────────────────────────────────────
  const vixColour =
    result?.vix_level === 'extreme'
      ? 'border-red-500/60 bg-red-500/10'
      : result?.vix_level === 'elevated'
      ? 'border-amber-500/60 bg-amber-500/10'
      : 'border-emerald-500/30 bg-emerald-500/5';

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Position Sizing</h3>
      </div>

      {/* Confluence banner */}
      {recentConfluence && (
        <div
          className={`rounded border px-3 py-2 text-xs space-y-0.5 ${
            recentConfluence.direction === 'bullish'
              ? 'border-emerald-500/50 bg-emerald-500/10'
              : 'border-red-500/50 bg-red-500/10'
          }`}
        >
          <div className="flex items-center gap-1.5 font-semibold text-white">
            {recentConfluence.direction === 'bullish' ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
            )}
            High-confluence signal detected
          </div>
          <div className="text-white/70">{recentConfluence.signal_value}</div>
          {recentConfluence.atm_premium && (
            <div className="text-white/50">
              ATM premium at signal: ₹{recentConfluence.atm_premium.toFixed(1)} ·{' '}
              {new Date(recentConfluence.timestamp).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {entryPremium === String(recentConfluence.atm_premium) && (
                <span className="ml-1 text-amber-400">(locked to signal time)</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-3">
        {/* Capital */}
        <div className="space-y-1">
          <label className="text-[10px] text-white/50 uppercase tracking-wide">
            Capital (₹)
          </label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-400/50"
            placeholder="500000"
          />
        </div>

        {/* Risk % */}
        <div className="space-y-1">
          <label className="text-[10px] text-white/50 uppercase tracking-wide">
            Risk per trade
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              className="flex-1 accent-blue-400"
            />
            <span className="text-xs text-blue-300 w-8 text-right font-mono">{riskPct}%</span>
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 bg-white/5 rounded-lg">
        {(['naked', 'spread'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1 text-xs rounded transition-colors ${
              mode === m
                ? 'bg-blue-500/30 text-blue-300 font-medium'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            {m === 'naked' ? 'Premium at Risk' : 'Defined Risk (Spread)'}
          </button>
        ))}
      </div>

      {/* Premium inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] text-white/50 uppercase tracking-wide">
            {mode === 'spread' ? 'Long leg premium' : 'Entry premium'}
          </label>
          <input
            type="number"
            value={entryPremium}
            onChange={(e) => setEntryPremium(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-400/50"
            placeholder="e.g. 120"
          />
        </div>

        {mode === 'spread' && (
          <div className="space-y-1">
            <label className="text-[10px] text-white/50 uppercase tracking-wide">
              Net debit (max loss/unit)
            </label>
            <input
              type="number"
              value={netDebit}
              onChange={(e) => setNetDebit(e.target.value)}
              className="w-full bg-orange-500/10 border border-orange-500/30 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-400/60"
              placeholder="e.g. 60"
            />
          </div>
        )}

        {mode === 'spread' && (
          <div className="space-y-1">
            <label className="text-[10px] text-white/50 uppercase tracking-wide">
              Max gain / unit (for Kelly)
            </label>
            <input
              type="number"
              value={maxGain}
              onChange={(e) => setMaxGain(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-400/50"
              placeholder="optional"
            />
          </div>
        )}
      </div>

      {/* Compute button */}
      <button
        onClick={handleCompute}
        disabled={isFetching}
        className="w-full py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-300 text-xs font-medium rounded transition-colors disabled:opacity-50"
      >
        {isFetching ? 'Calculating…' : 'Calculate Lots'}
      </button>

      {/* Results */}
      {result && !result.error && (
        <div className="space-y-3">
          {/* VIX warning */}
          {result.vix_note && (
            <div className={`rounded border px-3 py-2 text-xs flex items-start gap-2 ${vixColour}`}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
              <span className="text-white/80">{result.vix_note}</span>
            </div>
          )}

          {/* Main output: adjusted lots large */}
          <div className="bg-white/5 rounded-lg p-4 text-center space-y-1">
            <div className="text-3xl font-bold text-white">
              {result.adjusted_lots}{' '}
              <span className="text-sm font-normal text-white/50">lots</span>
            </div>
            {result.vix_factor < 1 && (
              <div className="text-[11px] text-white/40">
                Raw: {result.raw_lots} lots → VIX-adjusted: {result.adjusted_lots} lots
              </div>
            )}
            <div className="text-xs text-white/50">
              {result.adjusted_lots} × {result.lot_size} = {result.adjusted_lots * result.lot_size} units
            </div>
          </div>

          {/* Capital at risk */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">Capital at risk</div>
              <div className="text-sm font-semibold text-white">{fmt(result.capital_at_risk_inr)}</div>
            </div>
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">% of capital</div>
              <div
                className={`text-sm font-semibold ${
                  result.capital_at_risk_pct > 3
                    ? 'text-red-400'
                    : result.capital_at_risk_pct > 2
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {result.capital_at_risk_pct.toFixed(2)}%
              </div>
            </div>
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">Max loss/lot</div>
              <div className="text-sm font-semibold text-white">{fmt(result.max_loss_per_lot)}</div>
            </div>
            <div className="bg-white/5 rounded p-2.5 space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">Max risk budget</div>
              <div className="text-sm font-semibold text-white">{fmt(result.max_risk_inr)}</div>
            </div>
          </div>

          {/* Kelly fraction — greyed out */}
          <div className="border border-white/5 rounded p-2.5 flex items-start gap-2 opacity-50">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-white/30" />
            <div className="space-y-0.5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">Kelly fraction</div>
              <div className="text-xs text-white/50">
                {result.kelly_pct !== null ? `${result.kelly_pct}%` : 'n/a (provide max gain)'}
                {' · '}
                <span className="italic">{result.kelly_note}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {result?.error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">{result.error}</div>
      )}

      {isError && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
          Failed to calculate — check inputs
        </div>
      )}
    </div>
  );
}
