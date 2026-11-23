import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginateCursor, encodeCursor, decodeCursor } from '../src/expiry.js';

const items = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}` }));

test('encodeCursor/decodeCursor round-trip an id', () => {
  const cursor = encodeCursor('item-3');
  assert.equal(decodeCursor(cursor), 'item-3');
});

test('decodeCursor falls back to treating an unrecognized string as a raw id', () => {
  assert.equal(decodeCursor('item-3'), 'item-3');
});

test('decodeCursor returns null for an absent cursor', () => {
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(undefined), null);
});

test('paginateCursor with no cursor returns the first page and an opaque nextCursor', () => {
  const { items: page, nextCursor, previousCursor } = paginateCursor(items, { limit: 3 });
  assert.deepEqual(page.map((i) => i.id), ['item-0', 'item-1', 'item-2']);
  assert.equal(decodeCursor(nextCursor), 'item-2');
  assert.equal(previousCursor, null);
});

test('paginateCursor walks forward across pages', () => {
  const page1 = paginateCursor(items, { limit: 3 });
  const page2 = paginateCursor(items, { limit: 3, cursor: page1.nextCursor });
  assert.deepEqual(page2.items.map((i) => i.id), ['item-3', 'item-4', 'item-5']);
  assert.notEqual(page2.nextCursor, null);
  assert.notEqual(page2.previousCursor, null);
});

test('paginateCursor returns nextCursor: null on the last page', () => {
  const { items: page, nextCursor } = paginateCursor(items, { limit: 3, cursor: encodeCursor('item-8') });
  assert.deepEqual(page.map((i) => i.id), ['item-9']);
  assert.equal(nextCursor, null);
});

test('paginateCursor handles an empty collection', () => {
  const result = paginateCursor([], { limit: 10 });
  assert.deepEqual(result.items, []);
  assert.equal(result.nextCursor, null);
  assert.equal(result.previousCursor, null);
});

test('paginateCursor direction:prev walks backward from a cursor, in forward order', () => {
  const forward = paginateCursor(items, { limit: 3, cursor: encodeCursor('item-5') });
  assert.deepEqual(forward.items.map((i) => i.id), ['item-6', 'item-7', 'item-8']);

  const backward = paginateCursor(items, { limit: 3, cursor: forward.previousCursor, direction: 'prev' });
  assert.deepEqual(backward.items.map((i) => i.id), ['item-3', 'item-4', 'item-5']);
});

test('paginateCursor direction:prev from an unresolvable cursor returns the last page', () => {
  const { items: page, previousCursor } = paginateCursor(items, { limit: 3, direction: 'prev' });
  assert.deepEqual(page.map((i) => i.id), ['item-7', 'item-8', 'item-9']);
  assert.notEqual(previousCursor, null);
});

test('paginateCursor direction:prev reports previousCursor: null once it reaches the start', () => {
  const { previousCursor } = paginateCursor(items, { limit: 20, direction: 'prev' });
  assert.equal(previousCursor, null);
});

test('an unresolvable forward cursor falls back to the first page rather than erroring', () => {
  const { items: page } = paginateCursor(items, { limit: 3, cursor: encodeCursor('does-not-exist') });
  assert.deepEqual(page.map((i) => i.id), ['item-0', 'item-1', 'item-2']);
});

test('paginateCursor clamps an out-of-range limit to the [1, 200] default/max', () => {
  // 0 is falsy, so it falls back to the default of 50 rather than clamping to 1.
  assert.equal(paginateCursor(items, { limit: 0 }).items.length, items.length);
  assert.equal(paginateCursor(items, { limit: -5 }).items.length, 1);
  assert.equal(paginateCursor(items, { limit: 9999 }).items.length, items.length);
});
