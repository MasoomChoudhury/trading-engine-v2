import { useDerivedMetrics } from '../hooks/useIndicators';
import IndicatorCard from './IndicatorCard';

function interpretRSI(value: number): 'bullish' | 'bearish' | 'neutral' {
  if (value > 70) return 'bearish';
  if (value < 30) return 'bullish';
  return 'neutral';
}

function interpretCPR(status: string): 'bullish' | 'bearish' | 'neutral' {
  if (status === 'above_cpr') return 'bullish';
  if (status === 'below_cpr') return 'bearish';
  return 'neutral';
}

export default function DerivedMetrics() {
  const { data, isLoading } = useDerivedMetrics();

  if (isLoading || !data) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Derived Metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse bg-slate-800 rounded-lg p-4 h-24" />
          ))}
        </div>
      </div>
    );
  }

  const m = data.metrics as Record<string, any>;
  const spot = data.spot_price;

  const metrics = [
    { name: 'CPR Status', value: m.cpr_status?.replace(/_/g, ' ') ?? '—', interpretation: interpretCPR(m.cpr_status || '') },
    { name: 'CPR Width', value: m.cpr_width ? `${m.cpr_width.toFixed(2)} pts` : '—', approximation: true },
    { name: 'VWAP Status', value: m.vwap_status?.replace(/_/g, ' ') ?? '—', interpretation: 'neutral' as const },
    { name: 'VWAP', value: m.vwap_value?.toFixed(2) ?? '—', subValue: m.vwap_context || '', approximation: true },
    { name: 'Day Phase', value: m.day_phase?.replace(/_/g, ' ') ?? '—', interpretation: 'neutral' as const, approximation: true },
    { name: 'Opening Range', value: m.opening_range_status?.replace(/_/g, ' ') ?? '—',
      interpretation: m.opening_range_status === 'above_or' ? 'bullish' as const :
                     m.opening_range_status === 'below_or' ? 'bearish' as const : 'neutral' as const, approximation: true },
    { name: 'Momentum Burst', value: m.momentum_burst?.replace(/_/g, ' ') ?? '—',
      interpretation: m.momentum_burst === 'bullish' ? 'bullish' as const :
                     m.momentum_burst === 'bearish' ? 'bearish' as const : 'neutral' as const },
    { name: 'Gap Analysis', value: m.gap_direction?.replace(/_/g, ' ') ?? '—',
      interpretation: m.gap_direction === 'up_gap' ? 'bullish' as const :
                     m.gap_direction === 'down_gap' ? 'bearish' as const : 'neutral' as const },
    { name: 'PCR', value: m.pcr?.toFixed(3) ?? '—',
      subValue: m.pcr > 1 ? 'More puts bought' : m.pcr < 0.7 ? 'More calls bought' : 'Balanced',
      interpretation: m.pcr > 1 ? 'bearish' as const : m.pcr < 0.7 ? 'bullish' as const : 'neutral' as const },
    { name: 'Volume Profile', value: m.volume_profile_zone || '—', approximation: true },
    { name: 'Swing High', value: m.swing_high?.toFixed(2) ?? '—', approximation: true },
    { name: 'Swing Low', value: m.swing_low?.toFixed(2) ?? '—', approximation: true },
  ];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-200">Derived Metrics</h2>
        <span className="text-xs text-slate-500">
          Spot: <span className="text-white font-medium">{spot.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
        </span>
      </div>
      {data.approximation_note && (
        <p className="text-xs text-amber-500 mb-4 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
          Some metrics are approximations — full precision requires tick-level data.
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map((metric) => (
          <IndicatorCard
            key={metric.name}
            name={metric.name}
            value={metric.value}
            subValue={metric.subValue}
            interpretation={metric.interpretation}
            approximation={metric.approximation}
          />
        ))}
      </div>
    </div>
  );
}
