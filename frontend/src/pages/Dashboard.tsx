import LivePrice from '../components/LivePrice';
import IndicatorCard from '../components/IndicatorCard';
import GEXPanel from '../components/GEXPanel';
import DerivedMetrics from '../components/DerivedMetrics';
import MarketStatusBanner from '../components/MarketStatusBanner';
import { useIndicators } from '../hooks/useIndicators';
import { Loader2 } from 'lucide-react';

function interpretRSI(value: number): 'bullish' | 'bearish' | 'neutral' {
  if (value > 70) return 'bearish';
  if (value < 30) return 'bullish';
  return 'neutral';
}

function interpretMACD(hist: number): 'bullish' | 'bearish' | 'neutral' {
  if (hist > 5) return 'bullish';
  if (hist < -5) return 'bearish';
  return 'neutral';
}

function interpretADX(adx: number, plusDI: number, minusDI: number): 'bullish' | 'bearish' | 'neutral' {
  if (adx < 20) return 'neutral';
  if (plusDI > minusDI) return 'bullish';
  return 'bearish';
}

function BollingerDisplay({ ind }: { ind: Record<string, any> }) {
  const upper = typeof ind.bb_upper === 'object' ? (ind.bb_upper as any).upper : ind.bb_upper;
  const middle = typeof ind.bb_upper === 'object' ? (ind.bb_upper as any).middle : ind.bb_middle;
  const lower = typeof ind.bb_upper === 'object' ? (ind.bb_upper as any).lower : ind.bb_lower;

  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Bollinger Bands (20,2)</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-emerald-400">Upper</span>
          <span className="tabular-nums text-white">{Number(upper ?? 0).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Middle</span>
          <span className="tabular-nums text-white">{Number(middle ?? 0).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-red-400">Lower</span>
          <span className="tabular-nums text-white">{Number(lower ?? 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

function StochDisplay({ ind }: { ind: Record<string, any> }) {
  const k = typeof ind.stoch_rsi_k === 'object' ? (ind.stoch_rsi_k as any).k : ind.stoch_rsi_k;
  const d = typeof ind.stoch_rsi_k === 'object' ? (ind.stoch_rsi_k as any).d : ind.stoch_rsi_d;

  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Stochastic RSI (14,3,3)</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">%K</span>
          <span className="tabular-nums text-white">{Number(k ?? 0).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">%D</span>
          <span className="tabular-nums text-white">{Number(d ?? 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: ind, isLoading } = useIndicators('5min');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <LivePrice />
      <MarketStatusBanner />
      <GEXPanel />

      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Technical Indicators</h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-blue-400" />
          </div>
        ) : !ind?.indicators ? (
          <p className="text-slate-500 text-center py-8">No indicator data available.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {ind.indicators.rsi_14 !== undefined && (
              <IndicatorCard
                name="RSI (14)" value={Number(ind.indicators.rsi_14).toFixed(1)} unit="%"
                interpretation={interpretRSI(Number(ind.indicators.rsi_14))}
              />
            )}
            {ind.indicators.ema_20 !== undefined && (
              <IndicatorCard
                name="EMA 20" value={Number(ind.indicators.ema_20).toFixed(2)}
                interpretation={(ind.spot_price ?? 0) > Number(ind.indicators.ema_20) ? 'bullish' : 'bearish'}
              />
            )}
            {ind.indicators.ema_21 !== undefined && (
              <IndicatorCard name="EMA 21" value={Number(ind.indicators.ema_21).toFixed(2)} />
            )}
            {ind.indicators.ema_50 !== undefined && (
              <IndicatorCard name="EMA 50" value={Number(ind.indicators.ema_50).toFixed(2)} />
            )}
            {ind.indicators.sma_200 !== undefined && (
              <IndicatorCard name="SMA 200" value={Number(ind.indicators.sma_200).toFixed(2)} />
            )}
            {ind.indicators.macd_line !== undefined && (
              <IndicatorCard
                name="MACD Line" value={Number(ind.indicators.macd_line).toFixed(2)}
                subValue={`Signal: ${Number(ind.indicators.macd_signal ?? 0).toFixed(2)}`}
                interpretation={interpretMACD(Number(ind.indicators.macd_histogram ?? 0))}
              />
            )}
            {ind.indicators.macd_histogram !== undefined && (
              <IndicatorCard
                name="MACD Histogram" value={Number(ind.indicators.macd_histogram).toFixed(2)}
                interpretation={interpretMACD(Number(ind.indicators.macd_histogram))}
              />
            )}
            {(ind.indicators.bb_upper !== undefined || typeof ind.indicators.bb_upper === 'object') && (
              <BollingerDisplay ind={ind.indicators} />
            )}
            {ind.indicators.supertrend !== undefined && (() => {
              const dir = String(ind.indicators.supertrend_direction ?? '');
              return (
              <IndicatorCard
                name="Supertrend (7,3)" value={Number(ind.indicators.supertrend).toFixed(2)}
                subValue={`Direction: ${dir || '—'}`}
                interpretation={dir === 'uptrend' ? 'bullish' : dir === 'downtrend' ? 'bearish' : 'neutral'}
              />
              );
            })()}
            {(ind.indicators.stoch_rsi_k !== undefined || typeof ind.indicators.stoch_rsi_k === 'object') && (
              <StochDisplay ind={ind.indicators} />
            )}
            {ind.indicators.adx_14 !== undefined && (
              <IndicatorCard
                name="ADX (14)" value={Number(ind.indicators.adx_14).toFixed(2)}
                subValue={`+DI: ${Number(ind.indicators.plus_di_14 ?? 0).toFixed(1)} / -DI: ${Number(ind.indicators.minus_di_14 ?? 0).toFixed(1)}`}
                interpretation={interpretADX(Number(ind.indicators.adx_14), Number(ind.indicators.plus_di_14 ?? 0), Number(ind.indicators.minus_di_14 ?? 0))}
              />
            )}
            {ind.indicators.atr_14 !== undefined && (
              <IndicatorCard name="ATR (14)" value={Number(ind.indicators.atr_14).toFixed(2)} unit="pts" />
            )}
            {ind.indicators.vwap !== undefined && (
              <IndicatorCard
                name="VWAP" value={Number(ind.indicators.vwap).toFixed(2)}
                interpretation={(ind.spot_price ?? 0) > Number(ind.indicators.vwap) ? 'bullish' : 'bearish'}
              />
            )}
          </div>
        )}

        {ind && (
          <p className="text-xs text-slate-600 mt-4">
            Data as of: {new Date(ind.timestamp).toLocaleString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit', hour12: true,
            })} IST · Interval: 5min
          </p>
        )}
      </div>

      <DerivedMetrics />
    </div>
  );
}
