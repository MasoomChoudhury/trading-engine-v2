import { useDerivedMetrics } from '../hooks/useIndicators';
import IndicatorCard from './IndicatorCard';

function interpretCPR(status: string): 'bullish' | 'bearish' | 'neutral' {
  if (status === 'above_cpr') return 'bullish';
  if (status === 'below_cpr') return 'bearish';
  return 'neutral';
}

/** Safely convert any value to a display string, applying .replace() only on actual strings. */
function safeReplace(val: unknown): string {
  if (typeof val === 'string') return val.replace(/_/g, ' ');
  if (val === null || val === undefined) return '—';
  return String(val);
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

  // The backend returns nested objects (e.g. m.cpr = {status, width, ...}),
  // so we safely drill into them with optional chaining.
  const cprStatus = m.cpr?.status ?? m.cpr_status;
  const cprWidth = m.cpr?.width ?? m.cpr_width;
  const vwapStatus = m.vwap?.status ?? m.vwap_status;
  const vwapValue = m.vwap?.true_vwap ?? m.vwap_value;
  const vwapContext = m.vwap?.context ?? m.vwap_context ?? '';
  const orStatus = m.opening_range?.status ?? m.opening_range_status;
  const momentumType = m.momentum_burst?.type ?? (typeof m.momentum_burst === 'string' ? m.momentum_burst : null);
  const gapStatus = m.gap_analysis?.status ?? m.gap_status ?? m.gap_direction;
  const dayPhase = typeof m.day_phase === 'string' ? m.day_phase : m.day_phase?.phase;
  const volumeZone = m.volume_profile?.poc ?? m.volume_profile_zone;
  const swingHigh = m.swing_pivots?.swing_high ?? m.swing_high;
  const swingLow = m.swing_pivots?.swing_low ?? m.swing_low;

  const metrics = [
    { name: 'CPR Status', value: safeReplace(cprStatus), interpretation: interpretCPR(cprStatus || '') },
    { name: 'CPR Width', value: cprWidth ? `${Number(cprWidth).toFixed(2)} pts` : '—', approximation: true },
    { name: 'VWAP Status', value: safeReplace(vwapStatus), interpretation: 'neutral' as const },
    { name: 'VWAP', value: vwapValue ? Number(vwapValue).toFixed(2) : '—', subValue: safeReplace(vwapContext), approximation: true },
    { name: 'Day Phase', value: safeReplace(dayPhase), interpretation: 'neutral' as const, approximation: true },
    {
      name: 'Opening Range', value: safeReplace(orStatus),
      interpretation: orStatus === 'above_or' ? 'bullish' as const :
        orStatus === 'below_or' ? 'bearish' as const : 'neutral' as const, approximation: true
    },
    {
      name: 'Momentum Burst', value: safeReplace(momentumType),
      interpretation: momentumType === 'bullish_burst' ? 'bullish' as const :
        momentumType === 'bearish_burst' ? 'bearish' as const : 'neutral' as const
    },
    {
      name: 'Gap Analysis', value: safeReplace(gapStatus),
      interpretation: gapStatus === 'gap_up' ? 'bullish' as const :
        gapStatus === 'gap_down' ? 'bearish' as const : 'neutral' as const
    },
    {
      name: 'PCR', value: m.pcr?.toFixed?.(3) ?? (typeof m.pcr === 'number' ? m.pcr.toFixed(3) : '—'),
      subValue: (typeof m.pcr === 'number') ? (m.pcr > 1 ? 'More puts bought' : m.pcr < 0.7 ? 'More calls bought' : 'Balanced') : '',
      interpretation: (typeof m.pcr === 'number') ? (m.pcr > 1 ? 'bearish' as const : m.pcr < 0.7 ? 'bullish' as const : 'neutral' as const) : 'neutral' as const
    },
    { name: 'Volume Profile', value: volumeZone ? String(typeof volumeZone === 'number' ? Number(volumeZone).toFixed(2) : volumeZone) : '—', approximation: true },
    { name: 'Swing High', value: swingHigh ? Number(swingHigh).toFixed(2) : '—', approximation: true },
    { name: 'Swing Low', value: swingLow ? Number(swingLow).toFixed(2) : '—', approximation: true },
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
