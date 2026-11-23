import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEPRECATED_ENDPOINTS,
  DeprecationRegistry,
  matchDeprecatedEndpoint,
  setDeprecationHeaders,
} from '../src/deprecation.js';

function makeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

test('matchDeprecatedEndpoint matches the bare DELETE /credentials/:id form', () => {
  const rule = matchDeprecatedEndpoint('DELETE', '/credentials/abc123');
  assert.equal(rule?.name, 'bare_credential_delete');
});

test('matchDeprecatedEndpoint does not match the /revoke suffix form', () => {
  assert.equal(matchDeprecatedEndpoint('DELETE', '/credentials/abc123/revoke'), null);
  assert.equal(matchDeprecatedEndpoint('POST', '/credentials/abc123/revoke'), null);
});

test('matchDeprecatedEndpoint does not match a GET on the same path', () => {
  assert.equal(matchDeprecatedEndpoint('GET', '/credentials/abc123'), null);
});

test('setDeprecationHeaders sets Deprecation, Sunset, Link and X-Deprecated-* headers', () => {
  const res = makeRes();
  setDeprecationHeaders(res, DEPRECATED_ENDPOINTS[0]);
  assert.equal(res.headers.Deprecation, 'true');
  assert.equal(res.headers.Sunset, DEPRECATED_ENDPOINTS[0].sunsetDate);
  assert.match(res.headers.Link, /rel="deprecation"/);
  assert.equal(res.headers['X-Deprecated-Endpoint'], 'bare_credential_delete');
});

test('setDeprecationHeaders is a no-op for a null rule', () => {
  const res = makeRes();
  setDeprecationHeaders(res, null);
  assert.deepEqual(res.headers, {});
});

test('DeprecationRegistry.handle sets headers and invokes onUsage for a matched request', () => {
  const calls = [];
  const registry = new DeprecationRegistry({ onUsage: (info) => calls.push(info) });
  const res = makeRes();
  const req = { apiKeyId: 'key_1' };
  const rule = registry.match('DELETE', '/credentials/xyz');
  registry.handle(req, res, rule);
  assert.equal(res.headers.Deprecation, 'true');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rule.name, 'bare_credential_delete');
});

test('DeprecationRegistry.handle does nothing for an unmatched request', () => {
  const calls = [];
  const registry = new DeprecationRegistry({ onUsage: (info) => calls.push(info) });
  const res = makeRes();
  registry.handle({}, res, null);
  assert.deepEqual(res.headers, {});
  assert.equal(calls.length, 0);
});

test('shouldNotify returns true once per key per rule per day, then false', () => {
  const registry = new DeprecationRegistry();
  assert.equal(registry.shouldNotify('key_1', 'bare_credential_delete'), true);
  assert.equal(registry.shouldNotify('key_1', 'bare_credential_delete'), false);
  // A different key is independent.
  assert.equal(registry.shouldNotify('key_2', 'bare_credential_delete'), true);
});

test('shouldNotify returns false without an api key id', () => {
  const registry = new DeprecationRegistry();
  assert.equal(registry.shouldNotify(null, 'bare_credential_delete'), false);
  assert.equal(registry.shouldNotify(undefined, 'bare_credential_delete'), false);
});

test('a rule with method: null matches any HTTP method', () => {
  const rules = [{ name: 'any_method', method: null, pattern: /^\/legacy$/, sunsetDate: 'x', deprecatedSince: 'y', migrationUrl: 'z' }];
  assert.equal(matchDeprecatedEndpoint('GET', '/legacy', rules)?.name, 'any_method');
  assert.equal(matchDeprecatedEndpoint('POST', '/legacy', rules)?.name, 'any_method');
});
