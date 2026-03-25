import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface IndicatorCardProps {
  name: string;
  value: number | string;
  subValue?: string;
  unit?: string;
  interpretation?: 'bullish' | 'bearish' | 'neutral';
  approximation?: boolean;
  className?: string;
}

export default function IndicatorCard({
  name,
  value,
  subValue,
  unit,
  interpretation,
  approximation,
  className = '',
}: IndicatorCardProps) {
  const icon =
    interpretation === 'bullish' ? <TrendingUp size={14} className="text-emerald-400" /> :
    interpretation === 'bearish' ? <TrendingDown size={14} className="text-red-400" /> :
    <Minus size={14} className="text-slate-500" />;

  const borderColor =
    interpretation === 'bullish' ? 'border-emerald-900' :
    interpretation === 'bearish' ? 'border-red-900' :
    'border-slate-700';

  return (
    <div className={`bg-slate-900 border ${borderColor} rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{name}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums text-white">
          {typeof value === 'number' ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : value}
        </span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
      {subValue && <p className="text-xs text-slate-500 mt-1">{subValue}</p>}
      {approximation && (
        <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800">
          Approximation
        </span>
      )}
    </div>
  );
}
