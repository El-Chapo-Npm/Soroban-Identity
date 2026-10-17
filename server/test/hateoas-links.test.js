import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from '../src/app.js';

async function withServer(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hateoas-test-'));
  const credentialStorePath = path.join(dir, 'credentials.json');
  const credentials = [
    { id: 'cred-active', subject: 'GSUBJECT', issuer: 'GISSUER', claims: {}, expiresAt: 0, revoked: false },
    { id: 'cred-revoked', subject: 'GSUBJECT', issuer: 'GISSUER', claims: {}, expiresAt: 0, revoked: true },
  ];
  await fs.writeFile(credentialStorePath, JSON.stringify({ credentials }));
  const app = createApp({
    config: {
      adminApiKey: 'test-admin-key',
      adminActor: 'admin',
      corsAllowedOrigins: ['*'],
      maxBodyBytes: 64 * 1024,
      dataDir: dir,
      credentialStorePath,
      auditLogPath: path.join(dir, 'audit'),
    },
    soroban: { getIssuers: async () => [], pingAllContracts: async () => ({}) },
    metrics: { renderPrometheus: () => '' },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  return `http://localhost:${server.address().port}`;
}

test('GET / exposes API discovery links in the body and the Link header', async (t) => {
  const base = await withServer(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body._links.credentials.href, '/credentials');
  assert.equal(body._links.dids.method, 'POST');
  assert.match(res.headers.get('link'), /<\/credentials>; rel="credentials"/);
});

test('an active credential links to every valid transition', async (t) => {
  const base = await withServer(t);
  const { _links } = await (await fetch(`${base}/credentials/cred-active`)).json();
  assert.deepEqual(Object.keys(_links).sort(), ['collection', 'revoke', 'self', 'status', 'update', 'verify']);
  assert.deepEqual(_links.revoke, { href: '/credentials/cred-active/revoke', method: 'POST' });
});

test('a revoked credential omits the revoke and update transitions', async (t) => {
  const base = await withServer(t);
  const { _links } = await (await fetch(`${base}/credentials/cred-revoked`)).json();
  assert.equal(_links.revoke, undefined);
  assert.equal(_links.update, undefined);
  assert.ok(_links.status);
});

test('links on /v2 requests carry the /v2 prefix', async (t) => {
  const base = await withServer(t);
  const body = await (await fetch(`${base}/v2/credentials/cred-active`)).json();
  assert.equal(body.data._links.self.href, '/v2/credentials/cred-active');
});

test('self and status links resolve to working endpoints', async (t) => {
  const base = await withServer(t);
  const { _links } = await (await fetch(`${base}/credentials/cred-active`)).json();
  assert.equal((await fetch(`${base}${_links.self.href}`)).status, 200);
  const status = await fetch(`${base}${_links.status.href}`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).credentialId, 'cred-active');
});

test('the credential collection links each item and the next page', async (t) => {
  const base = await withServer(t);
  const body = await (await fetch(`${base}/credentials?limit=1`)).json();
  assert.equal(body.items[0]._links.self.href, '/credentials/cred-active');
  assert.match(body._links.next.href, /^\/credentials\?limit=1&cursor=/);
});

test('a ?fields= projection is returned exactly, without _links', async (t) => {
  const base = await withServer(t);
  const single = await (await fetch(`${base}/credentials/cred-active?fields=id`)).json();
  assert.deepEqual(single, { id: 'cred-active' });
  const list = await (await fetch(`${base}/credentials?fields=id`)).json();
  assert.deepEqual(list.items, [{ id: 'cred-active' }, { id: 'cred-revoked' }]);
});
