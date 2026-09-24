import { sendJson } from '../http-utils.js';

/**
 * Handle Event Sourcing Stream & Query routes:
 * - GET /api/v1/events/stream  (Server-Sent Events for real-time subscribers)
 * - GET /api/v1/events         (Query historical events)
 * - GET /api/v1/events/replay  (Reconstruct state of aggregate via replay)
 */
export function handleEventSourcingRoutes(req, res, url, eventStore, eventReplayer) {
  const pathname = url.pathname;

  // Real-time SSE Event Stream
  if (req.method === 'GET' && pathname === '/api/v1/events/stream') {
    const tenantFilter = url.searchParams.get('tenant_id') || req.tenantId;
    const typeFilter = url.searchParams.get('type');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`data: ${JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    const onEvent = (event) => {
      if (tenantFilter && event.tenantId !== tenantFilter && tenantFilter !== 'all') return;
      if (typeFilter && event.type !== typeFilter) return;
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventStore.on('event', onEvent);

    req.on('close', () => {
      eventStore.off('event', onEvent);
    });

    return true;
  }

  // Query events
  if (req.method === 'GET' && pathname === '/api/v1/events') {
    const aggregateId = url.searchParams.get('aggregate_id');
    const tenantId = url.searchParams.get('tenant_id') || req.tenantId;
    const fromTimestamp = url.searchParams.get('from');

    eventStore
      .getEvents({ aggregateId, tenantId, fromTimestamp })
      .then((events) => {
        sendJson(res, 200, { count: events.length, events });
      })
      .catch((err) => {
        sendJson(res, 500, { error: 'EventQueryError', message: err.message });
      });

    return true;
  }

  // Replay aggregate state
  if (req.method === 'GET' && pathname === '/api/v1/events/replay') {
    const aggregateType = url.searchParams.get('type') || 'credential';
    const aggregateId = url.searchParams.get('id');

    if (!aggregateId) {
      sendJson(res, 400, { error: 'MissingAggregateId', message: 'Aggregate "id" query parameter is required' });
      return true;
    }

    const replayPromise = aggregateType === 'did'
      ? eventReplayer.reconstructDid(aggregateId)
      : eventReplayer.reconstructCredential(aggregateId);

    replayPromise
      .then((state) => {
        if (!state) {
          sendJson(res, 404, { error: 'AggregateNotFound', message: `No state reconstructed for ${aggregateId}` });
          return;
        }
        sendJson(res, 200, { aggregateId, aggregateType, state });
      })
      .catch((err) => {
        sendJson(res, 500, { error: 'ReplayError', message: err.message });
      });

    return true;
  }

  return false;
}
