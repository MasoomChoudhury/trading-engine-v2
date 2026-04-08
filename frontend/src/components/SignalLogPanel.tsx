import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { fetcher } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────
interface SignalEntry {
  id: number;
  timestamp: string;
  source: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  signal_value: string;
  spot: number | null;
  atm_premium: number | null;
  is_confluence: boolean;
  confluence_count: number;
  confluence_sources: string[] | null;
  outcome_30m: number | null;
  outcome_eod: number | null;
  outcome_next_open: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function directionIcon(d: string) {
  if (d === 'bullish') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (d === 'bearish') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-white/30" />;
}

function directionColor(d: string) {
  if (d === 'bullish') return 'text-emerald-400';
  if (d === 'bearish') return 'text-red-400';
  return 'text-white/40';
}

function outcomeColor(v: number | null) {
  if (v === null) return 'text-white/20';
  if (v > 0.15) return 'text-emerald-400';
  if (v < -0.15) return 'text-red-400';
  return 'text-white/50';
}

function fmtOutcome(v: number | null) {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) + ' ' + fmtTime(ts);
}

function sourceColor(src: string) {
  const map: Record<string, string> = {
    GEX: 'bg-purple-500/20 text-purple-300',
    MTF: 'bg-blue-500/20 text-blue-300',
    FII: 'bg-amber-500/20 text-amber-300',
    CVD: 'bg-cyan-500/20 text-cyan-300',
    Sweep: 'bg-rose-500/20 text-rose-300',
    CONFLUENCE: 'bg-yellow-500/25 text-yellow-300',
  };
  return map[src] ?? 'bg-white/10 text-white/50';
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SignalLogPanel() {
  const [expanded, setExpanded] = useState(true);

  const { data: entries = [], isLoading, isError } = useQuery<SignalEntry[]>({
    queryKey: ['signal-log'],
    queryFn: () => fetcher('/v1/nifty50/signal-log?limit=50'),
    refetchInterval: 60_000,
    retry: 1,
  });

  const confluenceCount = entries.filter((e) => e.is_confluence).length;
  const recentConfluence = entries.find((e) => e.is_confluence);

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-lg overflow-hidden">
      {/* Header — clickable to collapse */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">Signal Log</span>
          {confluenceCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded-full font-medium">
              <Zap className="w-3 h-3" />
              {confluenceCount} confluence
            </span>
          )}
          <span className="text-[10px] text-white/30">{entries.length} events</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-white/30" />
        ) : (
          <ChevronDown className="w-4 h-4 text-white/30" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Recent confluence callout */}
          {recentConfluence && (
            <div
              className={`rounded border px-3 py-2 text-xs ${
                recentConfluence.direction === 'bullish'
                  ? 'border-emerald-500/40 bg-emerald-500/8'
                  : 'border-red-500/40 bg-red-500/8'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-white mb-0.5">
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                Latest confluence
              </div>
              <div className={`${directionColor(recentConfluence.direction)}`}>
                {recentConfluence.signal_value}
              </div>
              <div className="text-white/40 mt-0.5">{fmtDate(recentConfluence.timestamp)}</div>
            </div>
          )}

          {/* Table */}
          {isLoading && (
            <div className="text-xs text-white/30 py-4 text-center">Loading signals…</div>
          )}
          {isError && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
              Failed to load signal log
            </div>
          )}

          {!isLoading && entries.length === 0 && (
            <div className="text-xs text-white/30 py-4 text-center">
              No signals logged yet — data populates during market hours
            </div>
          )}

          {!isLoading && entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left text-[10px] text-white/30 uppercase pb-1.5 pr-2">Time</th>
                    <th className="text-left text-[10px] text-white/30 uppercase pb-1.5 pr-2">Source</th>
                    <th className="text-left text-[10px] text-white/30 uppercase pb-1.5 pr-2">Dir</th>
                    <th className="text-left text-[10px] text-white/30 uppercase pb-1.5 pr-2 max-w-[160px]">Signal</th>
                    <th className="text-right text-[10px] text-white/30 uppercase pb-1.5 pr-2">Spot</th>
                    <th className="text-right text-[10px] text-white/30 uppercase pb-1.5 pr-2">+30m</th>
                    <th className="text-right text-[10px] text-white/30 uppercase pb-1.5 pr-2">EOD</th>
                    <th className="text-right text-[10px] text-white/30 uppercase pb-1.5">Next↑</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/3">
                  {entries.map((e) => (
                    <tr
                      key={e.id}
                      className={`${
                        e.is_confluence
                          ? 'bg-yellow-500/5 border-l-2 border-yellow-500/50'
                          : ''
                      }`}
                    >
                      <td className="py-1.5 pr-2 text-white/40 whitespace-nowrap">
                        {fmtDate(e.timestamp)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sourceColor(
                            e.source,
                          )}`}
                        >
                          {e.source}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">{directionIcon(e.direction)}</td>
                      <td className="py-1.5 pr-2 max-w-[160px]">
                        <span
                          className={`truncate block ${
                            e.is_confluence ? 'text-yellow-200 font-medium' : 'text-white/70'
                          }`}
                          title={e.signal_value}
                        >
                          {e.signal_value}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right text-white/50 font-mono">
                        {e.spot ? e.spot.toLocaleString('en-IN') : '—'}
                      </td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${outcomeColor(e.outcome_30m)}`}>
                        {fmtOutcome(e.outcome_30m)}
                      </td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${outcomeColor(e.outcome_eod)}`}>
                        {fmtOutcome(e.outcome_eod)}
                      </td>
                      <td className={`py-1.5 text-right font-mono ${outcomeColor(e.outcome_next_open)}`}>
                        {fmtOutcome(e.outcome_next_open)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend */}
          <div className="text-[10px] text-white/25 border-t border-white/5 pt-2 space-y-0.5">
            <div>
              Outcomes show Nifty spot % move after signal. Rows outlined in gold = confluence (3+ sources).
            </div>
            <div>Event-driven: one row per state change, not per poll cycle.</div>
          </div>
        </div>
      )}
    </div>
  );
}
