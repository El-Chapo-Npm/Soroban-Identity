import { useEffect, useRef, useState } from 'react';

export interface AnalyticsSummary {
  totalIssued?: number;
  totalVerified?: number;
  verificationSuccessRate?: number;
  verificationFailureRate?: number;
  activeCredentials?: number;
  [key: string]: unknown;
}

export interface ContractEvent {
  type: string;
  contractId?: string;
  [key: string]: unknown;
}

export interface UseAnalyticsStreamResult {
  summary: AnalyticsSummary | null;
  connected: boolean;
  error: string | null;
}

type StreamMessage =
  | { type: 'summary'; data: AnalyticsSummary }
  | { type: 'contract-event'; data: ContractEvent }
  | { type: string; data?: unknown };

const DEFAULT_ANALYTICS_URL = 'http://localhost:3001';
const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 1000;

function getAnalyticsBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const url = env?.VITE_ANALYTICS_URL;
  return (url && url.trim()) || DEFAULT_ANALYTICS_URL;
}

function getSseUrl(): string {
  const base = getAnalyticsBaseUrl().replace(/\/+$/, '');
  return `${base}/stream`;
}

function getWsUrl(): string {
  const base = getAnalyticsBaseUrl().replace(/\/+$/, '');
  if (base.startsWith('https://')) {
    return `${base.replace(/^https:\/\//, 'wss://')}/ws`;
  }
  if (base.startsWith('http://')) {
    return `${base.replace(/^http:\/\//, 'ws://')}/ws`;
  }
  return `${base}/ws`;
}

function parseMessage(raw: string): StreamMessage | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as StreamMessage;
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function useAnalyticsStream(): UseAnalyticsStreamResult {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    const handleMessage = (raw: string) => {
      const message = parseMessage(raw);
      if (!message) return;

      if (message.type === 'summary') {
        const data = (message as { data?: AnalyticsSummary }).data;
        if (data && typeof data === 'object') {
          setSummary((prev) => ({ ...(prev ?? {}), ...data }));
        }
      } else if (message.type === 'contract-event') {
        // Contract events are surfaced through the summary stream; no-op here
        // beyond acknowledging receipt so consumers can extend if needed.
      }
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeConnections = () => {
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {
          // ignore
        }
        eventSourceRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };

    const scheduleReconnect = (connect: () => void) => {
      if (!mountedRef.current) return;
      clearReconnectTimer();
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** attempt, MAX_RECONNECT_DELAY);
      reconnectAttemptsRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);
    };

    const connectSse = () => {
      if (!mountedRef.current) return;
      closeConnections();

      let source: EventSource;
      try {
        source = new EventSource(getSseUrl());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open analytics stream');
        scheduleReconnect(connectSse);
        return;
      }

      eventSourceRef.current = source;

      source.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        setError(null);
      };

      source.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        handleMessage(event.data);
      };

      source.onerror = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        setError('Analytics stream disconnected');
        try {
          source.close();
        } catch {
          // ignore
        }
        if (eventSourceRef.current === source) {
          eventSourceRef.current = null;
        }
        scheduleReconnect(connectSse);
      };
    };

    const connectWs = () => {
      if (!mountedRef.current) return;
      closeConnections();

      let socket: WebSocket;
      try {
        socket = new WebSocket(getWsUrl());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open analytics socket');
        scheduleReconnect(connectWs);
        return;
      }

      wsRef.current = socket;

      socket.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        setError(null);
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        handleMessage(typeof event.data === 'string' ? event.data : String(event.data));
      };

      socket.onerror = () => {
        if (!mountedRef.current) return;
        setError('Analytics socket error');
      };

      socket.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        scheduleReconnect(connectWs);
      };
    };

    const hasEventSource = typeof EventSource !== 'undefined';
    const hasWebSocket = typeof WebSocket !== 'undefined';

    if (hasEventSource) {
      connectSse();
    } else if (hasWebSocket) {
      connectWs();
    } else {
      setError('Real-time analytics not supported in this environment');
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      closeConnections();
      setConnected(false);
    };
  }, []);

  return { summary, connected, error };
}

export default useAnalyticsStream;