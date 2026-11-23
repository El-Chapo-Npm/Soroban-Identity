import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeEtag, matchesIfNoneMatch, matchesIfMatch, parseEtagHeader } from '../src/etag.js';

test('computeEtag produces a stable, quoted strong tag for identical content', () => {
  const a = computeEtag({ id: 'cred-1', revoked: false });
  const b = computeEtag({ id: 'cred-1', revoked: false });
  assert.equal(a, b);
  assert.match(a, /^"[0-9a-f]{40}"$/);
});

test('computeEtag changes when content changes', () => {
  const a = computeEtag({ id: 'cred-1', revoked: false });
  const b = computeEtag({ id: 'cred-1', revoked: true });
  assert.notEqual(a, b);
});

test('computeEtag with weak:true produces a W/ prefixed tag', () => {
  const tag = computeEtag({ items: [] }, { weak: true });
  assert.match(tag, /^W\/"[0-9a-f]{40}"$/);
});

test('parseEtagHeader splits a comma-separated list and trims whitespace', () => {
  assert.deepEqual(parseEtagHeader('"a", "b" ,"c"'), ['"a"', '"b"', '"c"']);
});

test('parseEtagHeader returns null for a bare wildcard', () => {
  assert.equal(parseEtagHeader('*'), null);
});

test('parseEtagHeader returns an empty array for an absent header', () => {
  assert.deepEqual(parseEtagHeader(undefined), []);
});

test('matchesIfNoneMatch matches an exact tag', () => {
  const etag = computeEtag({ id: 1 });
  assert.equal(matchesIfNoneMatch(etag, etag), true);
});

test('matchesIfNoneMatch matches weakly, ignoring the W/ prefix', () => {
  const strong = computeEtag({ id: 1 });
  const weak = `W/${strong}`;
  assert.equal(matchesIfNoneMatch(weak, strong), true);
});

test('matchesIfNoneMatch treats bare * as matching anything', () => {
  assert.equal(matchesIfNoneMatch('*', computeEtag({ id: 1 })), true);
});

test('matchesIfNoneMatch is false when no tag matches', () => {
  assert.equal(matchesIfNoneMatch('"other"', computeEtag({ id: 1 })), false);
});

test('matchesIfNoneMatch is false when the header is absent', () => {
  assert.equal(matchesIfNoneMatch(undefined, computeEtag({ id: 1 })), false);
});

test('matchesIfMatch matches an identical strong tag', () => {
  const etag = computeEtag({ id: 1 });
  assert.equal(matchesIfMatch(etag, etag), true);
});

test('matchesIfMatch rejects a weak tag on either side', () => {
  const strong = computeEtag({ id: 1 });
  const weak = `W/${strong}`;
  assert.equal(matchesIfMatch(weak, strong), false);
  assert.equal(matchesIfMatch(strong, weak), false);
});

test('matchesIfMatch treats bare * as matching anything', () => {
  assert.equal(matchesIfMatch('*', computeEtag({ id: 1 })), true);
});

test('matchesIfMatch is false on mismatch', () => {
  assert.equal(matchesIfMatch('"stale"', computeEtag({ id: 1 })), false);
});
