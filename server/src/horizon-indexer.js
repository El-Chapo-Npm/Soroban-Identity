'use strict';

const { Horizon } = require('@stellar/stellar-sdk');

/**
 * Horizon event indexer service.
 *
 * Polls Horizon's `/contract_events` endpoint for configured contract IDs,
 * decodes event topics/values, and upserts rows into the `contract_events`
 * table idempotently. Supports configurable poll interval, exponential
 * backoff on errors, graceful shutdown, and a start/stop API.
 */

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_PAGE_LIMIT = 200;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 60000;

/**
 * Decode a base64-encoded XDR ScVal into a plain JS value where possible.
 * Falls back to the raw base64 string if decoding fails.
 *
 * @param {string} base64Xdr
 * @returns {*}
 */
function decodeScVal(base64Xdr) {
  if (base64Xdr == null) return null;
  try {
    // Lazy require to avoid hard dependency at module load time.
    const { xdr, scValToNative } = require('@stellar/stellar-sdk');
    const scVal = xdr.ScVal.fromXDR(base64Xdr, 'base64');
    return scValToNative(scVal);
  } catch (err) {
    return base64Xdr;
  }
}

/**
 * Decode an array of base64-encoded topics.
 *
 * @param {string[]} topics
 * @returns {*[]}
 */
function decodeTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return topics.map(decodeScVal);
}

/**
 * Normalize a raw Horizon contract event into a row suitable for the
 * `contract_events` table.
 *
 * @param {object} event
 * @returns {object}
 */
function normalizeEvent(event) {
  return {
    id: event.id,
    contract_id: event.contractId || event.contract_id || null,
    ledger: event.ledger != null ? Number(event.ledger) : null,
    ledger_closed_at: event.ledgerClosedAt || event.ledger_closed_at || null,
    paging_token: event.pagingToken || event.paging_token || null,
    type: event.type || null,
    topics: decodeTopics(event.topic || event.topics),
    value: decodeScVal(event.value),
    in_successful_contract_call:
      event.inSuccessfulContractCall != null
        ? event.inSuccessfulContractCall
        : event.in_successful_contract_call != null
          ? event.in_successful_contract_call
          : null,
    raw: event,
  };
}

class HorizonIndexer {
  /**
   * @param {object} options
   * @param {object} options.db - Database client with a `query(text, params)` method.
   * @param {string} [options.horizonUrl] - Horizon base URL.
   * @param {string[]} [options.contractIds] - Contract IDs to index.
   * @param {number} [options.pollIntervalMs] - Poll interval in milliseconds.
   * @param {number} [options.pageLimit] - Page size for Horizon requests.
   * @param {number} [options.backoffBaseMs] - Base backoff delay.
   * @param {number} [options.backoffMaxMs] - Max backoff delay.
   * @param {object} [options.logger] - Logger with info/warn/error methods.
   */
  constructor(options = {}) {
    if (!options.db || typeof options.db.query !== 'function') {
      throw new Error('HorizonIndexer requires a db client with a query() method');
    }

    this.db = options.db;
    this.horizonUrl =
      options.horizonUrl ||
      process.env.HORIZON_URL ||
      'https://horizon.stellar.org';
    this.contractIds =
      options.contractIds ||
      (process.env.HORIZON_INDEXER_CONTRACT_IDS
        ? process.env.HORIZON_INDEXER_CONTRACT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
        : []);
    this.pollIntervalMs =
      options.pollIntervalMs != null
        ? options.pollIntervalMs
        : Number(process.env.HORIZON_INDEXER_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
    this.pageLimit =
      options.pageLimit != null
        ? options.pageLimit
        : Number(process.env.HORIZON_INDEXER_PAGE_LIMIT) || DEFAULT_PAGE_LIMIT;
    this.backoffBaseMs =
      options.backoffBaseMs != null ? options.backoffBaseMs : DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs =
      options.backoffMaxMs != null ? options.backoffMaxMs : DEFAULT_BACKOFF_MAX_MS;
    this.logger = options.logger || console;

    this.server = new Horizon.Server(this.horizonUrl);

    this.running = false;
    this.stopping = false;
    this.timer = null;
    this.currentBackoffMs = this.backoffBaseMs;
    this._loopPromise = null;
  }

  /**
   * Read the persisted cursor for a given contract from the database.
   *
   * @param {string} contractId
   * @returns {Promise<string|null>}
   */
  async getCursor(contractId) {
    const result = await this.db.query(
      'SELECT cursor FROM horizon_indexer_cursors WHERE contract_id = $1',
      [contractId]
    );
    if (result && result.rows && result.rows.length > 0) {
      return result.rows[0].cursor || null;
    }
    return null;
  }

  /**
   * Persist the cursor for a given contract.
   *
   * @param {string} contractId
   * @param {string} cursor
   * @returns {Promise<void>}
   */
  async setCursor(contractId, cursor) {
    await this.db.query(
      `INSERT INTO horizon_indexer_cursors (contract_id, cursor, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (contract_id)
       DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
      [contractId, cursor]
    );
  }

  /**
   * Upsert a batch of normalized events into the `contract_events` table.
   * Idempotent on the event `id` primary key.
   *
   * @param {object[]} events
   * @returns {Promise<number>} number of rows upserted
   */
  async upsertEvents(events) {
    if (!events.length) return 0;

    let count = 0;
    for (const ev of events) {
      if (!ev.id) continue;
      await this.db.query(
        `INSERT INTO contract_events
           (id, contract_id, ledger, ledger_closed_at, paging_token, type, topics, value, in_successful_contract_call, raw, indexed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (id) DO UPDATE SET
           contract_id = EXCLUDED.contract_id,
           ledger = EXCLUDED.ledger,
           ledger_closed_at = EXCLUDED.ledger_closed_at,
           paging_token = EXCLUDED.paging_token,
           type = EXCLUDED.type,
           topics = EXCLUDED.topics,
           value = EXCLUDED.value,
           in_successful_contract_call = EXCLUDED.in_successful_contract_call,
           raw = EXCLUDED.raw,
           indexed_at = NOW()`,
        [
          ev.id,
          ev.contract_id,
          ev.ledger,
          ev.ledger_closed_at,
          ev.paging_token,
          ev.type,
          JSON.stringify(ev.topics),
          JSON.stringify(ev.value),
          ev.in_successful_contract_call,
          JSON.stringify(ev.raw),
        ]
      );
      count += 1;
    }
    return count;
  }

  /**
   * Fetch a single page of contract events for a contract starting at cursor.
   *
   * @param {string} contractId
   * @param {string|null} cursor
   * @returns {Promise<{events: object[], nextCursor: string|null}>}
   */
  async fetchPage(contractId, cursor) {
    const builder = this.server.contractEvents()
      .forContract(contractId)
      .limit(this.pageLimit)
      .order('asc');

    if (cursor) {
      builder.cursor(cursor);
    }

    const response = await builder.call();
    const records = (response && response.records) || [];
    const nextCursor =
      records.length > 0
        ? records[records.length - 1].pagingToken ||
          records[records.length - 1].paging_token ||
          cursor
        : cursor;

    return { events: records, nextCursor };
  }

  /**
   * Poll a single contract until caught up (no more records).
   *
   * @param {string} contractId
   * @returns {Promise<void>}
   */
  async pollContract(contractId) {
    let cursor = await this.getCursor(contractId);
    let hasMore = true;

    while (hasMore && !this.stopping) {
      const { events, nextCursor } = await this.fetchPage(contractId, cursor);

      if (events.length === 0) {
        hasMore = false;
        break;
      }

      const normalized = events.map(normalizeEvent);
      await this.upsertEvents(normalized);

      if (nextCursor && nextCursor !== cursor) {
        cursor = nextCursor;
        await this.setCursor(contractId, cursor);
      } else {
        hasMore = false;
      }

      if (events.length < this.pageLimit) {
        hasMore = false;
      }
    }
  }

  /**
   * Run one full polling cycle across all configured contracts.
   *
   * @returns {Promise<void>}
   */
  async pollOnce() {
    if (!this.contractIds.length) {
      this.logger.warn('[horizon-indexer] No contract IDs configured; skipping poll.');
      return;
    }

    for (const contractId of this.contractIds) {
      if (this.stopping) break;
      await this.pollContract(contractId);
    }
  }

  /**
   * Schedule the next poll cycle.
   *
   * @param {number} delayMs
   */
  scheduleNext(delayMs) {
    if (!this.running || this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._runCycle();
    }, delayMs);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Execute a poll cycle with error handling and backoff.
   *
   * @returns {Promise<void>}
   */
  async _runCycle() {
    if (!this.running || this.stopping) return;

    try {
      await this.pollOnce();
      this.currentBackoffMs = this.backoffBaseMs;
      this.scheduleNext(this.pollIntervalMs);
    } catch (err) {
      this.logger.error('[horizon-indexer] Poll cycle failed:', err && err.message ? err.message : err);
      const delay = Math.min(this.currentBackoffMs, this.backoffMaxMs);
      this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.backoffMaxMs);
      this.scheduleNext(delay);
    }
  }

  /**
   * Start the indexer loop.
   */
  start() {
    if (this.running) {
      this.logger.warn('[horizon-indexer] Already running.');
      return;
    }
    this.running = true;
    this.stopping = false;
    this.currentBackoffMs = this.backoffBaseMs;
    this.logger.info(
      `[horizon-indexer] Starting with ${this.contractIds.length} contract(s), poll interval ${this.pollIntervalMs}ms.`
    );
    this._loopPromise = this._runCycle();
  }

  /**
   * Stop the indexer loop gracefully, waiting for the current cycle to finish.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.running) return;
    this.logger.info('[horizon-indexer] Stopping...');
    this.stopping = true;
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this._loopPromise) {
      try {
        await this._loopPromise;
      } catch (err) {
        // Errors already logged in _runCycle.
      }
      this._loopPromise = null;
    }

    this.logger.info('[horizon-indexer] Stopped.');
  }
}

module.exports = {
  HorizonIndexer,
  decodeScVal,
  decodeTopics,
  normalizeEvent,
};