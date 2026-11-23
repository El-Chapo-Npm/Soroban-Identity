/**
 * Contract event replay for indexer recovery (#1360).
 *
 * On startup, if the `contract_events` table is empty (fresh database, wiped
 * volume, restore from nothing), replay every historical contract event the
 * RPC node still serves, starting from ledger 0, to rebuild indexer state.
 *
 * Properties:
 *   - Idempotent: rows are inserted with ON CONFLICT DO NOTHING on event_id.
 *   - Resumable: the paging cursor is written to `indexer_cursors` in the same
 *     transaction as each page, so an interrupted replay continues from the
 *     last committed page and the live indexer picks up from the same cursor.
 *   - Bounded: events are fetched and written one page at a time.
 *
 * Schema: migrations/002_contract_events.sql.
 *
 * Soroban RPC only retains a limited ledger window. When `startLedger` is
 * older than that window the node reports its oldest available ledger and the
 * replay restarts from there, logging a warning, rather than failing.
 */

import { scValToNative, xdr } from '@stellar/stellar-sdk';

export const DEFAULT_REPLAY_PAGE_SIZE = 200;

const LEDGER_RANGE_PATTERN = /ledger range:\s*(\d+)\s*-\s*(\d+)/i;

/** True when `contract_events` has no rows. */
export async function isEventStoreEmpty(db) {
  const result = await db.query('SELECT 1 FROM contract_events LIMIT 1');
  return (result?.rows?.length ?? 0) === 0;
}

async function getCursor(db, contractId) {
  const result = await db.query('SELECT cursor FROM indexer_cursors WHERE contract_id = $1', [contractId]);
  return result?.rows?.[0]?.cursor ?? null;
}

/** Run `fn(client)` in a transaction when the pool supports it. */
async function withTransaction(db, fn) {
  if (typeof db.connect !== 'function') return fn(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error is the one worth surfacing.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Persist one page of events and the cursor atomically.
 *
 * @returns {Promise<number>} rows actually inserted (duplicates excluded)
 */
export async function storePage(db, contractId, events, cursor) {
  return withTransaction(db, async (client) => {
    let inserted = 0;
    if (events.length > 0) {
      const result = await client.query(
        `INSERT INTO contract_events
           (event_id, contract_id, ledger, tx_hash, topic, value, observed_at)
         SELECT e.event_id, e.contract_id, e.ledger, e.tx_hash, e.topic::jsonb, e.value::jsonb, e.observed_at
         FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[], $5::text[], $6::text[], $7::timestamptz[])
           AS e(event_id, contract_id, ledger, tx_hash, topic, value, observed_at)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          events.map((e) => e.eventId),
          events.map((e) => e.contractId ?? contractId),
          events.map((e) => e.ledger),
          events.map((e) => e.txHash),
          events.map((e) => JSON.stringify(e.topic ?? [])),
          events.map((e) => JSON.stringify(e.value ?? {})),
          events.map((e) => e.observedAt),
        ],
      );
      inserted = result?.rowCount ?? events.length;
    }
    if (cursor) {
      await client.query(
        `INSERT INTO indexer_cursors (contract_id, cursor, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (contract_id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
        [contractId, cursor],
      );
    }
    return inserted;
  });
}

/**
 * Replay all events for each contract.
 *
 * @param {object} options
 * @param {{query: Function, connect?: Function}} options.db - pg Pool or client.
 * @param {Function} options.fetchEvents - `({contractId, startLedger, cursor, limit})`
 *   resolving to `{events, cursor}`; may throw an error whose message names the
 *   available ledger range.
 * @param {string[]} options.contractIds
 * @param {number} [options.startLedger=0]
 * @param {number} [options.pageSize]
 * @param {object} [options.logger]
 * @param {() => boolean} [options.shouldStop] - polled between pages.
 * @returns {Promise<{contracts: number, pages: number, events: number, inserted: number, stopped: boolean}>}
 */
export async function replayContractEvents({
  db,
  fetchEvents,
  contractIds,
  startLedger = 0,
  pageSize = DEFAULT_REPLAY_PAGE_SIZE,
  logger = console,
  shouldStop = () => false,
}) {
  if (!db || typeof db.query !== 'function') throw new TypeError('replayContractEvents requires a db with query()');
  if (typeof fetchEvents !== 'function') throw new TypeError('replayContractEvents requires fetchEvents()');
  const limit = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_REPLAY_PAGE_SIZE;
  const stats = { contracts: 0, pages: 0, events: 0, inserted: 0, stopped: false };

  for (const contractId of contractIds ?? []) {
    let cursor = await getCursor(db, contractId);
    let from = startLedger;
    stats.contracts += 1;

    for (;;) {
      if (shouldStop()) {
        stats.stopped = true;
        return stats;
      }

      let page;
      try {
        page = await fetchEvents({ contractId, startLedger: cursor ? undefined : from, cursor, limit });
      } catch (err) {
        const range = LEDGER_RANGE_PATTERN.exec(err?.message ?? '');
        if (!cursor && range && Number(range[1]) > from) {
          from = Number(range[1]);
          logger.warn?.(
            `[indexer-replay] ledger ${startLedger} is outside the RPC retention window for ${contractId}; replaying from ledger ${from}.`,
          );
          continue;
        }
        throw err;
      }

      // RPC scans a bounded ledger window per request, so a short or empty
      // page does not mean the history is exhausted. Only a missing or
      // unchanged cursor (no forward progress) ends the contract's replay.
      const events = page?.events ?? [];
      const nextCursor = page?.cursor ?? null;
      const inserted = await storePage(db, contractId, events, nextCursor);
      stats.pages += 1;
      stats.events += events.length;
      stats.inserted += inserted;

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
  }
  return stats;
}

/**
 * Replay only when the event store is empty. Safe to call on every startup.
 *
 * @returns {Promise<{replayed: boolean, reason?: string} & Partial<Awaited<ReturnType<typeof replayContractEvents>>>>}
 */
export async function replayIfEmpty(options) {
  const { db, contractIds, logger = console } = options;
  if (!contractIds || contractIds.length === 0) {
    return { replayed: false, reason: 'no-contracts' };
  }
  if (!(await isEventStoreEmpty(db))) {
    return { replayed: false, reason: 'not-empty' };
  }
  logger.info?.(`[indexer-replay] event store is empty; replaying history for ${contractIds.length} contract(s).`);
  const stats = await replayContractEvents(options);
  logger.info?.(
    `[indexer-replay] done: ${stats.events} event(s) in ${stats.pages} page(s), ${stats.inserted} inserted.`,
  );
  return { replayed: true, ...stats };
}

function decodeScVal(base64) {
  if (base64 == null) return null;
  try {
    return scValToNative(xdr.ScVal.fromXDR(base64, 'base64'));
  } catch {
    return base64;
  }
}

/** JSON-safe form of a decoded value (bigint and Buffer are not JSON-serialisable). */
function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data).toString('hex');
      return v;
    }) ?? 'null',
  );
}

/**
 * Soroban RPC `getEvents` adapter for {@link replayContractEvents}.
 *
 * @param {object} options
 * @param {string} options.rpcUrl
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createRpcEventFetcher({ rpcUrl, fetchImpl = globalThis.fetch }) {
  if (!rpcUrl) throw new TypeError('createRpcEventFetcher requires rpcUrl');
  let requestId = 0;

  return async function fetchEvents({ contractId, startLedger, cursor, limit }) {
    // RPC accepts either startLedger or a cursor, never both.
    const pagination = { limit, ...(cursor ? { cursor } : {}) };
    const params = {
      ...(cursor ? {} : { startLedger }),
      filters: [{ type: 'contract', contractIds: [contractId] }],
      pagination,
    };
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: (requestId += 1), method: 'getEvents', params }),
    });
    if (!response.ok) throw new Error(`RPC getEvents failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message ?? 'RPC getEvents error');

    const raw = payload.result?.events ?? [];
    const events = raw.map((e) => ({
      eventId: e.id,
      contractId: e.contractId ?? contractId,
      ledger: e.ledger,
      txHash: e.txHash,
      topic: jsonSafe((e.topic ?? []).map(decodeScVal)),
      value: jsonSafe(decodeScVal(e.value)),
      observedAt: e.ledgerClosedAt,
    }));
    const last = raw[raw.length - 1];
    return { events, cursor: payload.result?.cursor ?? last?.pagingToken ?? last?.id ?? null };
  };
}
