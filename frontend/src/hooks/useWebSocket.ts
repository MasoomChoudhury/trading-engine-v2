import { useEffect, useRef, useState, useCallback } from 'react';

export interface WSMessage {
  type: string;
  symbol: string;
  ltp: number;
  ltt?: string;
  volume: number;
  oi: number;
  cp?: number;
  change: number;
  change_pct: number;
}

export function useWebSocket(url: string) {
  const [price, setPrice] = useState<WSMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30000);
        ws.addEventListener('close', () => clearInterval(ping));
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const data = JSON.parse(event.data);
          setPrice(data);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
    } catch {
      setConnected(false);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { price, connected };
}
