import { useMTFConfluence } from '../hooks/useIndicators';
import { ConfluenceLevel, MTFTimeframe } from '../lib/api';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

function scoreColor(score: number) {
  if (score >= 80) return '#34d399';   // emerald
  if (score >= 60) return '#60a5fa';   // blue
  if (score >= 40) return '#f59e0b';   // amber
  return '#f87171';                    // red
}

function levelColor(level: ConfluenceLevel): string {
  const map: Record<ConfluenceLevel, string> = {
    HIGH: 'text-emerald-300 border-emerald-700/60 bg-emerald-900/30',
    MODERATE: 'text-blue-300 border-blue-700/60 bg-blue-900/30',
    MIXED: 'text-amber-300 border-amber-700/60 bg-amber-900/30',
    OPPOSING: 'text-orange-300 border-orange-700/50 bg-orange-900/20',
    INVERSE: 'text-red-300 border-red-700/50 bg-red-900/20',
  };
  return map[level] ?? map.MIXED;
}

function DirectionIcon({ dir }: { dir: string }) {
  const d = dir.toLowerCase();
  if (d === 'bullish') return <TrendingUp size={14} className="text-emerald-400" />;
  if (d === 'bearish') return <TrendingDown size={14} className="text-red-400" />;
  return <Minus size={14} className="text-slate-400" />;
}

// Circular gauge SVG for the score
function ScoreGauge({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);

  return (
    <svg width="92" height="92" viewBox="0 0 92 92">
      <circle cx="46" cy="46" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
      <circle
        cx="46" cy="46" r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 46 46)"
      />
      <text x="46" y="46" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="18" fontWeight="700">
        {score}
      </text>
    </svg>
  );
}

const SIGNAL_LABELS: Record<string, string> = {
  rsi: 'RSI 14',
  macd: 'MACD Hist',
  ema_trend: 'EMA 20',
  supertrend: 'Supertrend',
  adx: 'ADX / DI',
  bb_position: 'Bollinger',
};

function SignalRow({ name, signal, score }: { name: string; signal: string; score: number }) {
  const color = score === 1 ? 'text-emerald-400'
    : score === -1 ? 'text-red-400'
    : 'text-slate-400';
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="text-slate-400">{SIGNAL_LABELS[name] ?? name}</span>
      <span className={`font-medium capitalize ${color}`}>{signal.replace(/_/g, ' ')}</span>
    </div>
  );
}

function TimeframeCard({ label, tf }: { label: string; tf: MTFTimeframe }) {
  const dir = tf.bullish_count > tf.bearish_count ? 'Bullish'
    : tf.bearish_count > tf.bullish_count ? 'Bearish'
    : 'Neutral';
  const dirColor = dir === 'Bullish' ? 'text-emerald-400'
    : dir === 'Bearish' ? 'text-red-400'
    : 'text-slate-400';

  return (
    <div className="bg-slate-800/60 border border-slate-700/40 rounded-lg p-3 flex-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        <span className={`text-xs font-bold ${dirColor}`}>{dir}</span>
      </div>
      <div className="space-y-0.5">
        {Object.entries(tf.signals).map(([name, sig]) => (
          <SignalRow key={name} name={name} signal={sig.signal} score={sig.score} />
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-slate-700/40 flex justify-between text-xs">
        <span className="text-emerald-400">{tf.bullish_count} bull</span>
        <span className="text-slate-400">{tf.neutral_count} neutral</span>
        <span className="text-red-400">{tf.bearish_count} bear</span>
      </div>
    </div>
  );
}

export default function MTFConfluencePanel() {
  const { data, isLoading, error } = useMTFConfluence();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="panel-header">MTF Confluence Score</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="panel">
        <div className="panel-header">MTF Confluence Score</div>
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          {data?.error ?? 'Insufficient candle data — indicators unavailable'}
        </div>
      </div>
    );
  }

  const { score, bias, confluence_level, recommendation, timeframes, summary } = data;
  const levelCls = levelColor(confluence_level);

  const shouldEnter = confluence_level === 'HIGH' || confluence_level === 'MODERATE';

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>MTF Confluence Score</span>
        <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${levelCls}`}>
          {confluence_level}
        </span>
      </div>

      {/* Score + summary */}
      <div className="flex items-center gap-6 mb-4">
        <ScoreGauge score={score} />
        <div>
          <div className="text-xs text-slate-400 mb-1">Overall Bias</div>
          <div className="flex items-center gap-1.5 mb-2">
            <DirectionIcon dir={bias} />
            <span className="text-lg font-bold text-slate-100 capitalize">{bias}</span>
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-slate-400">5min: </span>
              <span className={summary.direction_5min.toLowerCase() === 'bullish' ? 'text-emerald-400'
                : summary.direction_5min.toLowerCase() === 'bearish' ? 'text-red-400' : 'text-slate-400'}>
                {summary.direction_5min}
              </span>
            </div>
            <div>
              <span className="text-slate-400">1day: </span>
              <span className={summary.direction_1day.toLowerCase() === 'bullish' ? 'text-emerald-400'
                : summary.direction_1day.toLowerCase() === 'bearish' ? 'text-red-400' : 'text-slate-400'}>
                {summary.direction_1day}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation banner */}
      <div className={`flex items-start gap-2 rounded-lg p-3 mb-4 border ${
        shouldEnter
          ? 'bg-emerald-900/20 border-emerald-700/40'
          : 'bg-amber-900/20 border-amber-700/40'
      }`}>
        {!shouldEnter && <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />}
        <p className={`text-xs leading-relaxed ${shouldEnter ? 'text-emerald-300' : 'text-amber-300'}`}>
          {recommendation}
        </p>
      </div>

      {/* Per-timeframe breakdowns */}
      <div className="flex gap-3">
        <TimeframeCard label="5 Min" tf={timeframes['5min']} />
        <TimeframeCard label="1 Day" tf={timeframes['1day']} />
      </div>

      {/* Scale legend */}
      <div className="mt-3 grid grid-cols-5 gap-1 text-center text-xs">
        {(['HIGH', 'MODERATE', 'MIXED', 'OPPOSING', 'INVERSE'] as ConfluenceLevel[]).map(lvl => (
          <div key={lvl} className={`rounded px-1 py-0.5 border ${levelColor(lvl)} ${lvl === confluence_level ? 'font-bold' : 'opacity-40'}`}>
            {lvl}
          </div>
        ))}
      </div>
    </div>
  );
}
