import LivePrice from '../components/LivePrice';
import IndicatorCard from '../components/IndicatorCard';
import GEXPanel from '../components/GEXPanel';
import DerivedMetrics from '../components/DerivedMetrics';
import MarketStatusBanner from '../components/MarketStatusBanner';
import IndiaVIXPanel from '../components/IndiaVIXPanel';
import GlobalCuesPanel from '../components/GlobalCuesPanel';
import { useIndicators, useMarketDepth } from '../hooks/useIndicators';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';

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

// ── Panel 9: Market Depth ─────────────────────────────────────────────────────

function MarketDepthPanel() {
  const { data, isLoading } = useMarketDepth();

  if (isLoading || !data) return (
    <div className="panel-card h-40 flex items-center justify-center text-slate-500 text-sm animate-pulse">
      Loading depth…
    </div>
  );

  const { bids, asks, buy_pressure_pct, bid_ask_ratio, spread, spread_pct, ltp } = data;

  const pressureColor = buy_pressure_pct >= 55 ? 'text-emerald-400' : buy_pressure_pct <= 45 ? 'text-red-400' : 'text-slate-300';

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Market Depth — Level 2</h3>
          <p className="text-xs text-slate-500 mt-0.5">LTP ₹{ltp?.toLocaleString('en-IN')}{spread_pct != null && ` · Spread ${spread_pct.toFixed(4)}%`}</p>
        </div>
        <div className={`text-sm font-bold ${pressureColor} flex items-center gap-1`}>
          {buy_pressure_pct >= 50 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {buy_pressure_pct?.toFixed(1)}% buy pressure
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Bids */}
        <div>
          <div className="text-xs font-medium text-emerald-400 mb-1.5 text-center">BID (Buy)</div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500"><th className="text-right pr-2">Price</th><th className="text-right">Qty</th></tr></thead>
            <tbody>
              {bids.map((b, i) => (
                <tr key={i} className="text-emerald-300">
                  <td className="text-right pr-2 font-mono py-0.5">₹{b.price.toLocaleString('en-IN')}</td>
                  <td className="text-right font-mono">{b.quantity.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Asks */}
        <div>
          <div className="text-xs font-medium text-red-400 mb-1.5 text-center">ASK (Sell)</div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500"><th className="text-right pr-2">Price</th><th className="text-right">Qty</th></tr></thead>
            <tbody>
              {asks.map((a, i) => (
                <tr key={i} className="text-red-300">
                  <td className="text-right pr-2 font-mono py-0.5">₹{a.price.toLocaleString('en-IN')}</td>
                  <td className="text-right font-mono">{a.quantity.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pressure bar */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Bid {data.total_bid_qty.toLocaleString('en-IN')}</span>
          <span>Ask {data.total_ask_qty.toLocaleString('en-IN')}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${buy_pressure_pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function BollingerDisplay({ ind }: { ind: Record<string, any> }) {
  const upper = typeof ind.bb_upper === 'object' ? (ind.bb_upper as any).upper : ind.bb_upper;
  const middle = typeof ind.bb_upper === 'object' ? (ind.bb_upper as any).middle : ind.bb_middle;
  const lower = typeof ind.bb_upper === 'object' ? (ind.bb_upper as any).lower : ind.bb_lower;

  return (
    <div className="stat-card">
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
    <div className="stat-card">
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
    <div className="p-6 space-y-6 max-w-7xl mx-auto page-enter">
      <GlobalCuesPanel />
      <LivePrice />
      <MarketStatusBanner />
      <GEXPanel />
      <IndiaVIXPanel />

      <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
        <h2 className="text-lg font-semibold text-slate-200 mb-4 tracking-tight">Technical Indicators</h2>

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

      {/* Panel 9: Market Depth */}
      <MarketDepthPanel />
    </div>
  );
}
