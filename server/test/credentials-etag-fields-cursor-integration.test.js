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

async function withServer(t, { seedCount = 0 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'creds-http-test-'));
  const credentialStorePath = path.join(dir, 'credentials.json');
  if (seedCount > 0) {
    const credentials = Array.from({ length: seedCount }, (_, i) => ({
      id: `cred-${String(i).padStart(3, '0')}`,
      subject: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      issuer: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF',
      claims: { tier: `tier-${i}` },
      expiresAt: 0,
      revoked: false,
    }));
    await fs.writeFile(credentialStorePath, JSON.stringify({ credentials }));
  }
  const config = {
    adminApiKey: 'test-admin-key',
    adminActor: 'admin',
    corsAllowedOrigins: ['*'],
    maxBodyBytes: 64 * 1024,
    dataDir: dir,
    credentialStorePath,
    auditLogPath: path.join(dir, 'audit'),
  };
  const app = createApp({ config, soroban: mockSoroban, metrics: mockMetrics });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  t.after(() => server.close());
  return base;
}

test('GET /credentials/:id returns an ETag and 304s on a matching If-None-Match', async (t) => {
  const base = await withServer(t, { seedCount: 1 });
  const first = await fetch(`${base}/credentials/cred-000`);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag);

  const second = await fetch(`${base}/credentials/cred-000`, { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});

test('GET /credentials/:id supports sparse fieldsets, including dotted nested paths', async (t) => {
  const base = await withServer(t, { seedCount: 1 });
  const res = await fetch(`${base}/credentials/cred-000?fields=id,claims.tier`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { id: 'cred-000', claims: { tier: 'tier-0' } });
});

test('GET /credentials/:id rejects an unknown field name', async (t) => {
  const base = await withServer(t, { seedCount: 1 });
  const res = await fetch(`${base}/credentials/cred-000?fields=id,bogus`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'VALIDATION_FAILED');
});

test('DELETE /credentials/:id/revoke with a stale If-Match returns 412', async (t) => {
  const base = await withServer(t, { seedCount: 1 });
  const staleEtag = '"0000000000000000000000000000000000000000"';
  const res = await fetch(`${base}/credentials/cred-000/revoke`, {
    method: 'POST',
    headers: { 'X-API-Key': 'test-admin-key', 'If-Match': staleEtag },
  });
  assert.equal(res.status, 412);
});

test('DELETE /credentials/:id/revoke succeeds with a fresh If-Match', async (t) => {
  const base = await withServer(t, { seedCount: 1 });
  const current = await fetch(`${base}/credentials/cred-000`);
  const etag = current.headers.get('etag');

  const res = await fetch(`${base}/credentials/cred-000/revoke`, {
    method: 'POST',
    headers: { 'X-API-Key': 'test-admin-key', 'If-Match': etag },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.revoked, true);
});

test('GET /credentials paginates by cursor and walks backward with direction=prev', async (t) => {
  const base = await withServer(t, { seedCount: 5 });

  const page1 = await fetch(`${base}/credentials?limit=2`);
  assert.equal(page1.status, 200);
  const body1 = await page1.json();
  assert.deepEqual(body1.items.map((i) => i.id), ['cred-000', 'cred-001']);
  assert.ok(body1.nextCursor);
  assert.equal(body1.previousCursor, null);

  const page2 = await fetch(`${base}/credentials?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`);
  const body2 = await page2.json();
  assert.deepEqual(body2.items.map((i) => i.id), ['cred-002', 'cred-003']);

  const back = await fetch(
    `${base}/credentials?limit=2&cursor=${encodeURIComponent(body2.previousCursor)}&direction=prev`,
  );
  const backBody = await back.json();
  assert.deepEqual(backBody.items.map((i) => i.id), ['cred-000', 'cred-001']);
});

test('GET /credentials supports fields filtering across the whole page', async (t) => {
  const base = await withServer(t, { seedCount: 2 });
  const res = await fetch(`${base}/credentials?fields=id`);
  const body = await res.json();
  assert.deepEqual(body.items, [{ id: 'cred-000' }, { id: 'cred-001' }]);
});

test('GET /credentials returns a weak collection ETag honoured by If-None-Match', async (t) => {
  const base = await withServer(t, { seedCount: 2 });
  const first = await fetch(`${base}/credentials`);
  const etag = first.headers.get('etag');
  assert.ok(etag.startsWith('W/'));

  const second = await fetch(`${base}/credentials`, { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});
