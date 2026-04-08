import { useCorrelationMatrix } from '../hooks/useIndicators';
import { CorrelationEntry } from '../lib/api';
import { TrendingUp, TrendingDown, Minus, Info, Link2, Link2Off } from 'lucide-react';

function corrColor(c: number | null): string {
  if (c == null) return 'text-slate-500';
  if (c > 0.7) return 'text-red-300';      // high coupling
  if (c > 0.4) return 'text-amber-300';    // moderate
  if (c > 0.1) return 'text-blue-300';     // mild
  return 'text-emerald-400';               // decoupled (good signal)
}

function corrBg(c: number | null): string {
  if (c == null) return 'bg-slate-800';
  if (c > 0.7) return 'bg-red-900/30';
  if (c > 0.4) return 'bg-amber-900/20';
  if (c > 0.1) return 'bg-blue-900/20';
  return 'bg-emerald-900/20';
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'rising') return <TrendingUp size={12} className="text-red-400" />;
  if (trend === 'falling') return <TrendingDown size={12} className="text-emerald-400" />;
  return <Minus size={12} className="text-slate-500" />;
}

function InterpIcon({ interp }: { interp: string }) {
  if (interp === 'high_coupling') return <Link2 size={14} className="text-red-400" />;
  if (interp === 'decoupled') return <Link2Off size={14} className="text-emerald-400" />;
  return <Minus size={14} className="text-slate-400" />;
}

function CorrCard({ entry, windows }: { entry: CorrelationEntry; windows: number[] }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/40 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <InterpIcon interp={entry.interpretation} />
          <span className="text-sm font-semibold text-slate-200">{entry.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <TrendIcon trend={entry.trend} />
          <span className="text-xs text-slate-400 capitalize">{entry.trend}</span>
        </div>
      </div>

      {/* Correlation values per window */}
      <div className="flex gap-2 mb-2">
        {windows.map(w => {
          const c = entry.correlations[String(w)];
          return (
            <div
              key={w}
              className={`flex-1 rounded px-2 py-1.5 text-center ${corrBg(c)}`}
            >
              <div className="text-xs text-slate-400 mb-0.5">{w}d</div>
              <div className={`text-sm font-bold tabular-nums ${corrColor(c)}`}>
                {c != null ? c.toFixed(2) : '—'}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">{entry.note}</p>
    </div>
  );
}

export default function CorrelationPanel() {
  const { data, isLoading, error } = useCorrelationMatrix();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">Nifty Global Correlation</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">Nifty Global Correlation</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Unable to compute correlations'}
        </div>
      </div>
    );
  }

  const { matrix, summary, windows } = data;
  const entries = Object.values(matrix) as CorrelationEntry[];

  // Find most notable signal
  const decoupled = entries.filter(e => e.interpretation === 'decoupled' || e.interpretation === 'mild_coupling');
  const coupled = entries.filter(e => e.interpretation === 'high_coupling');

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Nifty — Global Correlation Matrix</span>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {windows.map(w => (
            <span key={w} className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5">{w}d</span>
          ))}
        </div>
      </div>

      {/* Summary banner */}
      <div className={`flex items-start gap-2 rounded-lg p-3 mb-4 border ${
        coupled.length > 0
          ? 'bg-red-900/20 border-red-700/40'
          : decoupled.length > 0
          ? 'bg-emerald-900/20 border-emerald-700/40'
          : 'bg-slate-800/60 border-slate-700/40'
      }`}>
        <Info size={13} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs leading-relaxed text-slate-300">{summary}</p>
      </div>

      {/* Per-index cards */}
      <div className="space-y-3">
        {entries.map((e, i) => (
          <CorrCard key={i} entry={e} windows={windows} />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-4 gap-1.5 text-xs text-center">
        {[
          { label: '>0.7 Coupled', cls: 'text-red-300 bg-red-900/20 border-red-700/30' },
          { label: '0.4–0.7 Moderate', cls: 'text-amber-300 bg-amber-900/20 border-amber-700/30' },
          { label: '0.1–0.4 Mild', cls: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
          { label: '<0.1 Decoupled', cls: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
        ].map(item => (
          <div key={item.label} className={`rounded border px-1 py-0.5 ${item.cls}`}>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
