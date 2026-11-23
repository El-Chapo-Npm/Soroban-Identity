import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRpcEventFetcher,
  isEventStoreEmpty,
  replayContractEvents,
  replayIfEmpty,
  storePage,
} from '../src/indexer-replay.js';

const silent = { info() {}, warn() {}, error() {} };
const sample = (id, ledger = 1) => ({
  eventId: id, ledger, txHash: 't', topic: [], value: {}, observedAt: '2024-01-01T00:00:00Z',
});

/** Minimal in-memory stand-in for the two tables, keyed on the SQL text. */
function fakeDb({ rows = [], cursors = {}, failOnInsert = false } = {}) {
  const state = { rows: [...rows], cursors: { ...cursors }, log: [] };
  let snapshot = null;
  const client = {
    async query(sql, params = []) {
      state.log.push(sql.trim().split(/\s+/)[0]);
      if (/^BEGIN/i.test(sql)) {
        snapshot = { rows: [...state.rows], cursors: { ...state.cursors } };
        return { rows: [] };
      }
      if (/^COMMIT/i.test(sql)) {
        snapshot = null;
        return { rows: [] };
      }
      if (/^ROLLBACK/i.test(sql)) {
        if (snapshot) Object.assign(state, snapshot);
        snapshot = null;
        return { rows: [] };
      }
      if (/FROM contract_events LIMIT 1/.test(sql)) return { rows: state.rows.length ? [{ one: 1 }] : [] };
      if (/SELECT cursor FROM indexer_cursors/.test(sql)) {
        return { rows: params[0] in state.cursors ? [{ cursor: state.cursors[params[0]] }] : [] };
      }
      if (/INSERT INTO contract_events/.test(sql)) {
        if (failOnInsert) throw new Error('insert failed');
        let inserted = 0;
        params[0].forEach((id, i) => {
          if (state.rows.some((r) => r.event_id === id)) return;
          state.rows.push({ event_id: id, contract_id: params[1][i], ledger: params[2][i] });
          inserted += 1;
        });
        return { rows: [], rowCount: inserted };
      }
      if (/INSERT INTO indexer_cursors/.test(sql)) {
        state.cursors[params[0]] = params[1];
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };
  return Object.assign(client, { connect: async () => client, state });
}

/** Fake RPC serving `total` events per contract in pages. */
function fakeFetcher(total, calls = []) {
  return async ({ contractId, startLedger, cursor, limit }) => {
    calls.push({ contractId, startLedger, cursor, limit });
    const offset = cursor ? Number(cursor) : 0;
    const slice = [];
    for (let i = offset; i < Math.min(offset + limit, total); i += 1) slice.push(sample(`${contractId}-${i}`, i + 1));
    return { events: slice, cursor: slice.length ? String(offset + slice.length) : cursor };
  };
}

test('isEventStoreEmpty reflects table contents', async () => {
  assert.equal(await isEventStoreEmpty(fakeDb()), true);
  assert.equal(await isEventStoreEmpty(fakeDb({ rows: [{ event_id: 'x' }] })), false);
});

test('replays every page from ledger 0 and records the cursor', async () => {
  const db = fakeDb();
  const calls = [];
  const stats = await replayContractEvents({
    db, contractIds: ['C1'], fetchEvents: fakeFetcher(5, calls), pageSize: 2, logger: silent,
  });
  assert.equal(db.state.rows.length, 5);
  assert.equal(db.state.cursors.C1, '5');
  assert.equal(stats.events, 5);
  assert.equal(stats.inserted, 5);
  assert.equal(calls[0].startLedger, 0);
  assert.equal(calls[0].cursor, null);
  assert.equal(calls[1].startLedger, undefined); // cursor and startLedger are mutually exclusive
});

test('replay is idempotent when rows already exist', async () => {
  const db = fakeDb();
  const args = { db, contractIds: ['C1'], fetchEvents: fakeFetcher(3), pageSize: 10, logger: silent };
  await replayContractEvents(args);
  db.state.cursors = {};
  const again = await replayContractEvents(args);
  assert.equal(db.state.rows.length, 3);
  assert.equal(again.inserted, 0);
});

test('an interrupted replay resumes from the stored cursor', async () => {
  const db = fakeDb({ cursors: { C1: '2' } });
  const calls = [];
  await replayContractEvents({ db, contractIds: ['C1'], fetchEvents: fakeFetcher(5, calls), pageSize: 10, logger: silent });
  assert.equal(calls[0].cursor, '2');
  assert.deepEqual(db.state.rows.map((r) => r.event_id), ['C1-2', 'C1-3', 'C1-4']);
});

test('an empty page that still advances the cursor does not end the replay', async () => {
  const db = fakeDb();
  const pages = [
    { events: [], cursor: 'a' },
    { events: [sample('e1', 9)], cursor: 'b' },
    { events: [], cursor: 'b' },
  ];
  let i = 0;
  const stats = await replayContractEvents({
    db, contractIds: ['C1'], fetchEvents: async () => pages[i++], pageSize: 5, logger: silent,
  });
  assert.equal(stats.inserted, 1);
  assert.equal(db.state.cursors.C1, 'b');
});

test('a contract with no events terminates without a cursor', async () => {
  const db = fakeDb();
  const stats = await replayContractEvents({
    db, contractIds: ['C1'], fetchEvents: async () => ({ events: [], cursor: null }), logger: silent,
  });
  assert.equal(stats.pages, 1);
  assert.equal(db.state.rows.length, 0);
});

test('a failed page rolls back both the rows and the cursor', async () => {
  const db = fakeDb({ failOnInsert: true });
  await assert.rejects(
    replayContractEvents({ db, contractIds: ['C1'], fetchEvents: fakeFetcher(3), logger: silent }),
    /insert failed/,
  );
  assert.equal(db.state.rows.length, 0);
  assert.deepEqual(db.state.cursors, {});
  assert.ok(db.state.log.includes('ROLLBACK'));
});

test('restarts from the oldest retained ledger when startLedger is out of range', async () => {
  const db = fakeDb();
  const seen = [];
  const inner = fakeFetcher(2);
  const fetchEvents = async (args) => {
    seen.push(args.startLedger);
    if (!args.cursor && args.startLedger < 500) {
      throw new Error('startLedger must be within the ledger range: 500 - 900');
    }
    return inner(args);
  };
  const stats = await replayContractEvents({ db, contractIds: ['C1'], fetchEvents, logger: silent });
  assert.deepEqual(seen.slice(0, 2), [0, 500]);
  assert.equal(stats.inserted, 2);
});

test('other fetch errors propagate', async () => {
  await assert.rejects(
    replayContractEvents({
      db: fakeDb(), contractIds: ['C1'], logger: silent,
      fetchEvents: async () => { throw new Error('boom'); },
    }),
    /boom/,
  );
});

test('shouldStop halts between pages', async () => {
  const db = fakeDb();
  let checks = 0;
  const stats = await replayContractEvents({
    db, contractIds: ['C1'], fetchEvents: fakeFetcher(10), pageSize: 2, logger: silent,
    shouldStop: () => checks++ >= 1,
  });
  assert.equal(stats.stopped, true);
  assert.equal(db.state.rows.length, 2);
});

test('replayIfEmpty skips a populated store and a missing contract list', async () => {
  const fetchEvents = async () => assert.fail('must not fetch');
  assert.deepEqual(
    await replayIfEmpty({ db: fakeDb({ rows: [{ event_id: 'x' }] }), contractIds: ['C1'], fetchEvents, logger: silent }),
    { replayed: false, reason: 'not-empty' },
  );
  assert.deepEqual(
    await replayIfEmpty({ db: fakeDb(), contractIds: [], fetchEvents, logger: silent }),
    { replayed: false, reason: 'no-contracts' },
  );
});

test('replayIfEmpty replays an empty store', async () => {
  const db = fakeDb();
  const result = await replayIfEmpty({ db, contractIds: ['C1', 'C2'], fetchEvents: fakeFetcher(2), logger: silent });
  assert.equal(result.replayed, true);
  assert.equal(db.state.rows.length, 4);
});

test('storePage works against a plain client without connect()', async () => {
  const db = fakeDb();
  delete db.connect;
  const n = await storePage(db, 'C1', [sample('z')], 'c1');
  assert.equal(n, 1);
  assert.equal(db.state.log.includes('BEGIN'), false);
});

test('createRpcEventFetcher sends startLedger or cursor, never both', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        result: {
          events: [{ id: 'e1', ledger: 7, txHash: 'h', ledgerClosedAt: '2024-01-01T00:00:00Z', topic: [], value: 'not-xdr', pagingToken: 'p1' }],
          cursor: 'cur',
        },
      }),
    };
  };
  const fetchEvents = createRpcEventFetcher({ rpcUrl: 'http://rpc', fetchImpl });
  const first = await fetchEvents({ contractId: 'C1', startLedger: 0, cursor: null, limit: 50 });
  await fetchEvents({ contractId: 'C1', startLedger: undefined, cursor: 'cur', limit: 50 });
  assert.equal(bodies[0].params.startLedger, 0);
  assert.equal('cursor' in bodies[0].params.pagination, false);
  assert.equal('startLedger' in bodies[1].params, false);
  assert.equal(bodies[1].params.pagination.cursor, 'cur');
  assert.equal(first.cursor, 'cur');
  assert.equal(first.events[0].eventId, 'e1');
  assert.equal(first.events[0].txHash, 'h');
});

test('createRpcEventFetcher surfaces RPC and HTTP errors', async () => {
  const rpcError = createRpcEventFetcher({
    rpcUrl: 'http://rpc',
    fetchImpl: async () => ({ ok: true, json: async () => ({ error: { message: 'bad range' } }) }),
  });
  await assert.rejects(rpcError({ contractId: 'C', startLedger: 0, limit: 1 }), /bad range/);
  const http = createRpcEventFetcher({ rpcUrl: 'http://rpc', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(http({ contractId: 'C', startLedger: 0, limit: 1 }), /503/);
});
