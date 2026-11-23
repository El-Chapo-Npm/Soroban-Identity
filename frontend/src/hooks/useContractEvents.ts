import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

export interface ContractEventFilter {
  contractId?: string;
  topic?: string[];
  eventTypes?: string[];
  onEvent?: (type: string, data: StreamedContractEvent) => void;
}

export interface StreamedContractEvent {
  id: string;
  type: string;
  contractId: string;
  topic: string[];
  value: unknown;
  ledger: number;
  txHash: string;
  timestamp: string;
  /** Gas/fee cost charged for the transaction, when provided by the payload. */
  fee?: string | number;
  /** Alternative fee field name used by some event payloads. */
  feeCharged?: string | number;
}

export interface ActivityFilters {
  /** Activity types to include (e.g. issued, verified, revoked). Empty/undefined = all. */
  eventTypes?: string[];
  /** Free-text search across type, txHash, contractId, topics and value. */
  search?: string;
  /** Inclusive lower bound for the event timestamp. */
  from?: string | Date;
  /** Inclusive upper bound for the event timestamp. */
  to?: string | Date;
}

export interface HistoryPage {
  events: StreamedContractEvent[];
  cursor?: string | null;
  hasMore: boolean;
}

export interface UseContractEventsOptions extends ContractEventFilter {
  /** Page size used when fetching history. Defaults to 20. */
  limit?: number;
  /** Base URL of the REST history endpoint. Defaults to VITE_HISTORY_URL or events URL with /history. */
  historyUrl?: string;
}

const MAX_EVENTS = 200;
const DEFAULT_PAGE_SIZE = 20;

function getEventTimestamp(event: StreamedContractEvent): number {
  const parsed = Date.parse(event.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toTimeBound(value?: string | Date): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function eventMatchesSearch(event: StreamedContractEvent, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    event.type,
    event.txHash,
    event.contractId,
    event.topic.join(' '),
    typeof event.value === 'string' ? event.value : JSON.stringify(event.value ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Client-side filter helper for activity type, text search and date range. */
export function filterEvents(
  events: StreamedContractEvent[],
  filters?: ActivityFilters,
): StreamedContractEvent[] {
  if (!filters) {
    return events;
  }
  const { eventTypes, search, from, to } = filters;
  const fromTime = toTimeBound(from);
  const toTime = toTimeBound(to);
  return events.filter((event) => {
    if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(event.type)) {
      return false;
    }
    if (search && !eventMatchesSearch(event, search)) {
      return false;
    }
    if (fromTime !== null || toTime !== null) {
      const time = getEventTimestamp(event);
      if (fromTime !== null && time < fromTime) {
        return false;
      }
      if (toTime !== null && time > toTime) {
        return false;
      }
    }
    return true;
  });
}

/** Returns the gas cost for an event, preferring feeCharged then fee. */
export function getEventFee(event: StreamedContractEvent): string | number | undefined {
  return event.feeCharged ?? event.fee;
}

export function useContractEvents(filter?: UseContractEventsOptions) {
  const [events, setEvents] = useState<StreamedContractEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const eventsUrl = import.meta.env.VITE_EVENTS_URL ?? 'http://localhost:3001/events';
  const pageSize = filter?.limit ?? DEFAULT_PAGE_SIZE;
  const historyUrl =
    filter?.historyUrl ??
    import.meta.env.VITE_HISTORY_URL ??
    `${eventsUrl.replace(/\/events\/?$/, '')}/history`;

  const topicKey = filter?.topic?.join(',') ?? '';
  const eventTypesKey = filter?.eventTypes?.join(',') ?? '';

  const streamUrl = useMemo(() => {
    const url = new URL(eventsUrl);
    if (filter?.contractId) {
      url.searchParams.set('contractId', filter.contractId);
    }
    if (filter?.topic && filter.topic.length > 0) {
      url.searchParams.set('topic', filter.topic.join(','));
    }
    return url.toString();
  }, [eventsUrl, filter?.contractId, topicKey]);

  const shouldIncludeEvent = useCallback((eventType: string): boolean => {
    const eventTypes = filterRef.current?.eventTypes;
    if (!eventTypes || eventTypes.length === 0) {
      return true;
    }
    return eventTypes.includes(eventType);
  }, []);

  const fetchHistory = useCallback(
    async (options?: { reset?: boolean }): Promise<HistoryPage | null> => {
      if (loadingRef.current) {
        return null;
      }
      loadingRef.current = true;
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const url = new URL(historyUrl);
        const currentFilter = filterRef.current;
        if (currentFilter?.contractId) {
          url.searchParams.set('contractId', currentFilter.contractId);
        }
        if (currentFilter?.topic && currentFilter.topic.length > 0) {
          url.searchParams.set('topic', currentFilter.topic.join(','));
        }
        if (currentFilter?.eventTypes && currentFilter.eventTypes.length > 0) {
          url.searchParams.set('eventTypes', currentFilter.eventTypes.join(','));
        }
        url.searchParams.set('limit', String(pageSize));
        if (!options?.reset && cursorRef.current) {
          url.searchParams.set('cursor', cursorRef.current);
        }

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`History request failed (${response.status})`);
        }
        const payload = (await response.json()) as
          | HistoryPage
          | { events?: StreamedContractEvent[]; cursor?: string | null; hasMore?: boolean };
        const pageEvents = Array.isArray(payload)
          ? (payload as StreamedContractEvent[])
          : payload.events ?? [];
        const nextCursor = Array.isArray(payload) ? null : payload.cursor ?? null;
        const more = Array.isArray(payload)
          ? pageEvents.length >= pageSize
          : payload.hasMore ?? Boolean(nextCursor);

        cursorRef.current = nextCursor;
        setHasMore(more);
        setEvents((prev) => {
          const base = options?.reset ? [] : prev;
          const seen = new Set(base.map((event) => event.id));
          const merged = [...base];
          for (const event of pageEvents) {
            if (!seen.has(event.id)) {
              seen.add(event.id);
              merged.push(event);
            }
          }
          return merged.slice(0, MAX_EVENTS);
        });
        return { events: pageEvents, cursor: nextCursor, hasMore: more };
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
        return null;
      } finally {
        loadingRef.current = false;
        setLoadingHistory(false);
      }
    },
    [historyUrl, pageSize],
  );

  const loadMore = useCallback(async (): Promise<HistoryPage | null> => {
    if (!hasMore && cursorRef.current !== null) {
      return null;
    }
    return fetchHistory();
  }, [fetchHistory, hasMore]);

  useEffect(() => {
    const source = new EventSource(streamUrl);
    sourceRef.current = source;

    source.addEventListener('connected', () => {
      setConnected(true);
      setError(null);
    });

    source.addEventListener('contract-event', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as StreamedContractEvent;
        if (shouldIncludeEvent(parsed.type)) {
          setEvents((prev) => [parsed, ...prev].slice(0, MAX_EVENTS));
          filterRef.current?.onEvent?.(parsed.type, parsed);
        }
      } catch {
        // Ignore invalid payloads
      }
    });

    source.addEventListener('heartbeat', () => {
      setConnected(true);
    });

    source.onerror = () => {
      setConnected(false);
      setError('Event stream disconnected');
    };

    const handleClose = () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };

    window.addEventListener('beforeunload', handleClose);
    window.addEventListener('pagehide', handleClose);

    return () => {
      window.removeEventListener('beforeunload', handleClose);
      window.removeEventListener('pagehide', handleClose);
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
    // shouldIncludeEvent and filterRef.current.onEvent are intentionally
    // excluded: shouldIncludeEvent reads live filterRef state and has no
    // dependencies, and eventTypesKey/streamUrl already capture every input
    // that should reopen the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, eventTypesKey]);

  return {
    events,
    connected,
    error,
    hasMore,
    loadingHistory,
    historyError,
    fetchHistory,
    loadMore,
    filterEvents: (filters?: ActivityFilters) => filterEvents(events, filters),
  };
}
