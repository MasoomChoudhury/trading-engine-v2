import { useWebSocket } from '../hooks/useWebSocket';
import { useQuery } from '@tanstack/react-query';
import { getHealth, getLivePrice } from '../lib/api';
import { TrendingUp, TrendingDown, Wifi, WifiOff, Database, Activity } from 'lucide-react';

export default function LivePrice() {
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/live`;
  const { price: wsPrice, connected } = useWebSocket(wsUrl);
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30000,
  });
  const { data: restPrice } = useQuery({
    queryKey: ['livePrice'],
    queryFn: getLivePrice,
    refetchInterval: 15000,
    enabled: !wsPrice,
  });

  const price = wsPrice ?? restPrice ?? null;
  const ltp = price?.ltp ?? 0;
  const change = price?.change ?? 0;
  const changePct = price?.change_pct ?? 0;
  const isUp = change >= 0;

  return (
    <div className="bg-slate-900 rounded-xl p-6 ring-1 ring-white/[0.06] shadow-lg shadow-black/20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-300">Nifty 50</h2>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1 text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? 'Live' : 'Offline'}
          </span>
          {health && (
            <>
              <span className={`flex items-center gap-1 text-xs ${health.database === 'ok' ? 'text-emerald-400' : 'text-amber-400'}`}>
                <Database size={12} /> DB
              </span>
              <span className={`flex items-center gap-1 text-xs ${health.websocket === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`}>
                <Activity size={12} /> WS
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-end gap-4">
        <span className="text-4xl font-bold tabular-nums">
          {ltp > 0 ? ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </span>
        <div className={`flex items-center gap-1 mb-1 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
          {isUp ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          <span className="font-semibold text-lg">
            {isUp ? '+' : ''}{change.toFixed(2)}
          </span>
          <span className="text-sm">({isUp ? '+' : ''}{changePct.toFixed(2)}%)</span>
        </div>
      </div>

      {price?.ltt && (
        <p className="text-xs text-slate-500 mt-2">
          Last update: {new Date(price.ltt).toLocaleTimeString('en-IN')}
        </p>
      )}
    </div>
  );
}
