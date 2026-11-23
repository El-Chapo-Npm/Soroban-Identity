import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFields, validateFields, selectFields, applyFieldFiltering } from '../src/field-filter.js';

test('parseFields splits, trims, and dedupes a comma-separated list', () => {
  assert.deepEqual(parseFields(' id, subject ,id'), ['id', 'subject']);
});

test('parseFields returns null for an empty or absent value', () => {
  assert.equal(parseFields(undefined), null);
  assert.equal(parseFields(''), null);
  assert.equal(parseFields('  ,  ,'), null);
});

test('validateFields flags unknown top-level fields, ignoring the nested part of a dotted path', () => {
  const unknown = validateFields(['id', 'claims.tier', 'bogus'], ['id', 'claims']);
  assert.deepEqual(unknown, ['bogus']);
});

test('selectFields projects top-level and nested paths, omitting missing values', () => {
  const resource = { id: '1', subject: 'alice', claims: { tier: 'gold', country: 'US' }, revoked: false };
  const result = selectFields(resource, ['id', 'claims.tier', 'missing.path']);
  assert.deepEqual(result, { id: '1', claims: { tier: 'gold' } });
});

test('selectFields keeps falsy-but-present values', () => {
  const result = selectFields({ revoked: false, count: 0 }, ['revoked', 'count']);
  assert.deepEqual(result, { revoked: false, count: 0 });
});

test('applyFieldFiltering with no fields param returns the input unchanged', () => {
  const data = { id: '1', subject: 'alice' };
  assert.deepEqual(applyFieldFiltering(data, undefined, ['id', 'subject']), { data });
});

test('applyFieldFiltering projects a single object', () => {
  const data = { id: '1', subject: 'alice', secret: 'x' };
  const result = applyFieldFiltering(data, 'id,subject', ['id', 'subject', 'secret']);
  assert.deepEqual(result, { data: { id: '1', subject: 'alice' } });
});

test('applyFieldFiltering projects every item of an array', () => {
  const data = [{ id: '1', extra: 'a' }, { id: '2', extra: 'b' }];
  const result = applyFieldFiltering(data, 'id', ['id', 'extra']);
  assert.deepEqual(result, { data: [{ id: '1' }, { id: '2' }] });
});

test('applyFieldFiltering reports unknown fields as an error instead of silently dropping them', () => {
  const result = applyFieldFiltering({ id: '1' }, 'id,bogus', ['id']);
  assert.equal(result.data, undefined);
  assert.match(result.error, /bogus/);
});
