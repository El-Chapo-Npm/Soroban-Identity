import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { handleLongPollRequest } from '../src/long-poll.js';

function makeRes() {
  const res = new EventEmitter();
  res.writeHead = (status, headers) => { res._status = status; res._headers = headers; return res; };
  res.end = (body) => { res._body = body; res.emit('__end'); return res; };
  return res;
}

function waitForEnd(res) {
  return new Promise((resolve) => res.once('__end', resolve));
}

test('resolves immediately with matching events once available', async () => {
  const req = new EventEmitter();
  req.headers = {};
  const res = makeRes();
  const url = new URL('http://localhost/events/poll?contractId=C1');
  const soroban = {
    getEvents: async () => [
      { id: 'e1', contractId: 'C1', topic: ['IDENTITY', 'updated'], value: {}, ledger: 5, txHash: 'x', ledgerClosedAt: '2026-01-01T00:00:00Z' },
    ],
  };
  const config = { eventPollIntervalMs: 5, longPollDefaultTimeoutMs: 5000, longPollMaxTimeoutMs: 60000 };

  handleLongPollRequest(req, res, url, { config, soroban });
  await waitForEnd(res);

  assert.equal(res._status, 200);
  const body = JSON.parse(res._body);
  assert.equal(body.timedOut, false);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].contractId, 'C1');
  assert.equal(body.lastEventId, '6');
});

test('times out with an empty batch when nothing matches within the deadline', async () => {
  const req = new EventEmitter();
  req.headers = {};
  const res = makeRes();
  const url = new URL('http://localhost/events/poll?timeout=20');
  const soroban = { getEvents: async () => [] };
  const config = { eventPollIntervalMs: 5, longPollDefaultTimeoutMs: 30000, longPollMaxTimeoutMs: 60000 };

  handleLongPollRequest(req, res, url, { config, soroban });
  await waitForEnd(res);

  const body = JSON.parse(res._body);
  assert.equal(body.timedOut, true);
  assert.deepEqual(body.events, []);
});

test('filters by topic and only returns matching events', async () => {
  const req = new EventEmitter();
  req.headers = {};
  const res = makeRes();
  const url = new URL('http://localhost/events/poll?topic=IDENTITY');
  const soroban = {
    getEvents: async () => [
      { id: 'a', contractId: 'C1', topic: ['IDENTITY'], value: {}, ledger: 1, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      { id: 'b', contractId: 'C1', topic: ['OTHER'], value: {}, ledger: 2, ledgerClosedAt: '2026-01-01T00:00:00Z' },
    ],
  };
  const config = { eventPollIntervalMs: 5, longPollDefaultTimeoutMs: 5000, longPollMaxTimeoutMs: 60000 };

  handleLongPollRequest(req, res, url, { config, soroban });
  await waitForEnd(res);

  const body = JSON.parse(res._body);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].type, 'IDENTITY');
});

test('resumes from the Last-Event-ID header instead of the beginning', async () => {
  const req = new EventEmitter();
  req.headers = { 'last-event-id': '10' };
  const res = makeRes();
  const url = new URL('http://localhost/events/poll');
  let seenSince = null;
  const soroban = {
    getEvents: async (since) => {
      seenSince = since;
      return [];
    },
  };
  const config = { eventPollIntervalMs: 5, longPollDefaultTimeoutMs: 15, longPollMaxTimeoutMs: 60000 };

  handleLongPollRequest(req, res, url, { config, soroban });
  await waitForEnd(res);
  assert.equal(seenSince, 10);
});

test('clamps a requested timeout to the configured maximum', async () => {
  const req = new EventEmitter();
  req.headers = {};
  const res = makeRes();
  const url = new URL('http://localhost/events/poll?timeout=999999');
  const soroban = { getEvents: async () => [] };
  const config = { eventPollIntervalMs: 5, longPollDefaultTimeoutMs: 30000, longPollMaxTimeoutMs: 30 };

  const start = Date.now();
  handleLongPollRequest(req, res, url, { config, soroban });
  await waitForEnd(res);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `expected the clamped ~30ms timeout, took ${elapsed}ms`);
});

test('stops polling and never responds once the client disconnects first', async () => {
  const req = new EventEmitter();
  req.headers = {};
  const res = makeRes();
  const url = new URL('http://localhost/events/poll?timeout=5000');
  let calls = 0;
  const soroban = { getEvents: async () => { calls += 1; return []; } };
  const config = { eventPollIntervalMs: 10, longPollDefaultTimeoutMs: 5000, longPollMaxTimeoutMs: 60000 };

  handleLongPollRequest(req, res, url, { config, soroban });
  await new Promise((resolve) => setTimeout(resolve, 25));
  req.emit('close');
  const callsAtClose = calls;

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(res._status, undefined, 'response must never be written after client disconnect');
  assert.equal(calls, callsAtClose, 'polling must stop once the client has gone away');
});
