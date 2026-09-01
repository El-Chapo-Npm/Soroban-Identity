import { eventMatchesFilter, normalizeContractEvent } from './sse.js';
import { logger } from './logger.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

/**
 * The ledger cursor to resume from: the `Last-Event-ID` header (the standard
 * SSE reconnection mechanism, honoured here too so the same client logic can
 * drive either transport) or a `lastEventId`/`since` query param, in that
 * order. Anything unparseable falls back to 0 (start from the beginning).
 */
function parseLastEventId(req, url) {
  const raw = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId') ?? url.searchParams.get('since');
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveTimeout(url, config) {
  const min = MIN_TIMEOUT_MS;
  const max = config?.longPollMaxTimeoutMs ?? MAX_TIMEOUT_MS;
  const defaultMs = config?.longPollDefaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requested = Number.parseInt(url.searchParams.get('timeout') ?? '', 10);
  if (!Number.isFinite(requested)) return defaultMs;
  return Math.min(max, Math.max(min, requested));
}

/**
 * Handles GET /events/poll: an HTTP long-polling alternative to the /events
 * SSE stream (#750), for clients or intermediaries that can't hold an
 * open text/event-stream connection.
 *
 * The response is held open — polling soroban.getEvents() on
 * config.eventPollIntervalMs, exactly like the SSE handler — until at least
 * one matching event arrives or the timeout elapses, then answers once with
 * a JSON batch and closes. The returned `lastEventId` is the cursor to send
 * back on the next call (via the `Last-Event-ID` header or a `since` query
 * param) so a client resumes without re-receiving events or losing any that
 * arrived between calls.
 */
export function handleLongPollRequest(req, res, url, { config, soroban }) {
  const contractId = url.searchParams.get('contractId') || undefined;
  const topicParam = url.searchParams.get('topic');
  const topics = topicParam ? topicParam.split(',') : undefined;

  let nextLedger = parseLastEventId(req, url);
  const timeoutMs = resolveTimeout(url, config);
  const pollIntervalMs = config.eventPollIntervalMs > 0 ? config.eventPollIntervalMs : 5000;

  let closed = false;
  let polling = false;
  let pollTimer = null;
  let deadlineTimer = null;

  function cleanup() {
    if (pollTimer) clearInterval(pollTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    pollTimer = null;
    deadlineTimer = null;
  }

  function finish(events, { timedOut }) {
    if (closed) return;
    closed = true;
    cleanup();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ events, lastEventId: String(nextLedger), count: events.length, timedOut }));
  }

  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      const rawEvents = await soroban.getEvents(nextLedger);
      const matched = [];
      for (const raw of rawEvents) {
        const event = normalizeContractEvent(raw);
        if (!event) continue;
        if (event.ledger >= nextLedger) nextLedger = event.ledger + 1;
        if (!eventMatchesFilter(event, { contractId, topics })) continue;
        matched.push(event);
      }
      if (matched.length > 0) finish(matched, { timedOut: false });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to poll contract events for long-poll request');
    } finally {
      polling = false;
    }
  }

  deadlineTimer = setTimeout(() => finish([], { timedOut: true }), timeoutMs);
  if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
  pollTimer = setInterval(poll, pollIntervalMs);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
  void poll();

  function onClientClose() {
    if (closed) return;
    closed = true;
    cleanup();
  }
  req.on('close', onClientClose);
  res.on('close', onClientClose);
}
