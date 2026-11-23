import { sendJson } from '../http-utils.js';

/**
 * Handle Event Sourcing Stream & Query routes:
 * - GET /api/v1/events/stream       (Server-Sent Events for real-time subscribers)
 * - GET /api/v1/events/subscribe    (Long-poll subscription for new events)
 * - GET /api/v1/events              (Query historical events)
 * - GET /api/v1/events/replay       (Reconstruct state of aggregate via replay)
 * - GET /api/v1/events/projections  (Read models / projections)
 * - GET /api/v1/events/projections/:name (Single projection read model)
 */
export function handleEventSourcingRoutes(req, res, url, eventStore, eventReplayer, projections) {
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

  // Long-poll subscription for new events
  if (req.method === 'GET' && pathname === '/api/v1/events/subscribe') {
    const tenantFilter = url.searchParams.get('tenant_id') || req.tenantId;
    const typeFilter = url.searchParams.get('type');
    const sinceId = url.searchParams.get('since_id');
    const timeoutMs = Math.min(parseInt(url.searchParams.get('timeout') || '30000', 10) || 30000, 60000);

    const matches = (event) => {
      if (tenantFilter && event.tenantId !== tenantFilter && tenantFilter !== 'all') return false;
      if (typeFilter && event.type !== typeFilter) return false;
      return true;
    };

    let settled = false;
    const finish = (events) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      eventStore.off('event', onEvent);
      sendJson(res, 200, { count: events.length, events });
    };

    const onEvent = (event) => {
      if (matches(event)) finish([event]);
    };

    const timer = setTimeout(() => finish([]), timeoutMs);

    eventStore.on('event', onEvent);
    req.on('close', () => {
      settled = true;
      clearTimeout(timer);
      eventStore.off('event', onEvent);
    });

    // If a since_id is provided, immediately return any already-stored events after it.
    if (sinceId && typeof eventStore.getEvents === 'function') {
      eventStore
        .getEvents({ tenantId: tenantFilter, fromTimestamp: null })
        .then((events) => {
          const pending = (events || []).filter((e) => matches(e) && e.id && e.id > sinceId);
          if (pending.length > 0) finish(pending);
        })
        .catch(() => {});
    }

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

  // List projection read models
  if (req.method === 'GET' && pathname === '/api/v1/events/projections') {
    if (!projections) {
      sendJson(res, 503, { error: 'ProjectionsUnavailable', message: 'Projection read models are not configured' });
      return true;
    }
    const names = typeof projections.list === 'function' ? projections.list() : Object.keys(projections);
    const models = {};
    for (const name of names) {
      models[name] = typeof projections.get === 'function' ? projections.get(name) : projections[name];
    }
    sendJson(res, 200, { count: names.length, projections: models });
    return true;
  }

  // Fetch a single projection read model
  if (req.method === 'GET' && pathname.startsWith('/api/v1/events/projections/')) {
    if (!projections) {
      sendJson(res, 503, { error: 'ProjectionsUnavailable', message: 'Projection read models are not configured' });
      return true;
    }
    const name = decodeURIComponent(pathname.slice('/api/v1/events/projections/'.length));
    const model = typeof projections.get === 'function' ? projections.get(name) : projections[name];
    if (model === undefined) {
      sendJson(res, 404, { error: 'ProjectionNotFound', message: `No projection named "${name}"` });
      return true;
    }
    sendJson(res, 200, { projection: name, model });
    return true;
  }

  return false;
}
