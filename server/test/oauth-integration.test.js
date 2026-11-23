import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from '../src/app.js';

const mockSoroban = {
  getIssuers: async () => [],
  addIssuer: async () => {},
  removeIssuer: async () => {},
  pingAllContracts: async () => ({ identity: true, credential: true, reputation: true }),
};

const mockMetrics = { renderPrometheus: () => '# mock metrics' };

async function withServer(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-http-test-'));
  const config = {
    adminApiKey: 'test-admin-key',
    adminActor: 'admin',
    corsAllowedOrigins: ['*'],
    maxBodyBytes: 64 * 1024,
    dataDir: dir,
    credentialStorePath: path.join(dir, 'credentials.json'),
    auditLogPath: path.join(dir, 'audit'),
    oauthAuthCodeTtlMs: 60_000,
    oauthAccessTokenTtlMs: 60_000,
    oauthRefreshTokenTtlMs: 60_000,
  };
  const app = createApp({ config, soroban: mockSoroban, metrics: mockMetrics });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  t.after(() => server.close());
  return base;
}

test('OAuth: registering a client requires admin:write', async (t) => {
  const base = await withServer(t);
  const res = await fetch(`${base}/oauth/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key:credentials:read' },
    body: JSON.stringify({ redirectUris: ['https://app.example.com/cb'] }),
  });
  assert.equal(res.status, 403);
});

test('OAuth: full authorization_code flow end to end over HTTP', async (t) => {
  const base = await withServer(t);

  const registerRes = await fetch(`${base}/oauth/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
    body: JSON.stringify({
      name: 'Partner',
      redirectUris: ['https://app.example.com/cb'],
      scopes: ['credentials:read'],
    }),
  });
  assert.equal(registerRes.status, 201);
  const client = await registerRes.json();
  assert.ok(client.clientId);
  assert.ok(client.clientSecret);

  const authorizeUrl = new URL(`${base}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', 'https://app.example.com/cb');
  authorizeUrl.searchParams.set('scope', 'credentials:read');
  authorizeUrl.searchParams.set('state', 'xyz');
  const authorizeRes = await fetch(authorizeUrl, {
    headers: { 'X-API-Key': 'test-admin-key' },
    redirect: 'manual',
  });
  assert.equal(authorizeRes.status, 302);
  const location = new URL(authorizeRes.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://app.example.com/cb');
  assert.equal(location.searchParams.get('state'), 'xyz');
  const code = location.searchParams.get('code');
  assert.ok(code);

  const tokenRes = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://app.example.com/cb',
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  assert.equal(tokenRes.status, 200);
  const tokens = await tokenRes.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);

  // The issued access token authenticates like an API key, scoped to what was granted.
  const readRes = await fetch(`${base}/admin/api-keys`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  assert.equal(readRes.status, 403); // token only has credentials:read, not admin:read

  const introspectRes = await fetch(`${base}/oauth/introspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tokens.access_token, client_id: client.clientId, client_secret: client.clientSecret }),
  });
  assert.equal(introspectRes.status, 200);
  const introspected = await introspectRes.json();
  assert.equal(introspected.active, true);
  assert.equal(introspected.scope, 'credentials:read');

  const refreshRes = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  assert.equal(refreshRes.status, 200);
  const rotated = await refreshRes.json();
  assert.notEqual(rotated.access_token, tokens.access_token);

  const revokeRes = await fetch(`${base}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: rotated.access_token, client_id: client.clientId, client_secret: client.clientSecret }),
  });
  assert.equal(revokeRes.status, 200);

  const introspectAfterRevoke = await fetch(`${base}/oauth/introspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: rotated.access_token, client_id: client.clientId, client_secret: client.clientSecret }),
  });
  assert.deepEqual(await introspectAfterRevoke.json(), { active: false });
});

test('OAuth: authorize rejects an unregistered redirect_uri without redirecting', async (t) => {
  const base = await withServer(t);
  const registerRes = await fetch(`${base}/oauth/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
    body: JSON.stringify({ redirectUris: ['https://app.example.com/cb'] }),
  });
  const client = await registerRes.json();

  const authorizeUrl = new URL(`${base}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', 'https://evil.example.com/cb');
  const res = await fetch(authorizeUrl, { headers: { 'X-API-Key': 'test-admin-key' }, redirect: 'manual' });
  assert.equal(res.status, 400);
});

test('OAuth: token endpoint rejects an invalid client_secret', async (t) => {
  const base = await withServer(t);
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: 'ac_bogus',
      redirect_uri: 'https://app.example.com/cb',
      client_id: 'client_bogus',
      client_secret: 'wrong',
    }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'invalid_client');
});

test('OAuth: token endpoint validates grant-specific required fields', async (t) => {
  const base = await withServer(t);
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: 'c', client_secret: 's' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'VALIDATION_FAILED');
});
