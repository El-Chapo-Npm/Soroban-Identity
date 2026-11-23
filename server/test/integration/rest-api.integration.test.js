import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { SorobanClient } from '../../src/soroban.js';
import { createTestEnvironment, startQuickstart } from './setup.mjs';

const ADMIN_KEY = 'integration-admin-key';
const TEST_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('REST API integration (local Stellar quickstart)', () => {
  let quickstart;
  let env;
  let app;
  let issuers;

  before(async () => {
    quickstart = await startQuickstart();
    env = await createTestEnvironment(quickstart.rpcUrl);
    issuers = [];

    const soroban = new SorobanClient(env.config, null);
    const documents = new Map();
    const didCache = {
      client: null,
      async get(address) {
        return documents.get(String(address)) ?? null;
      },
      async set(address, document) {
        documents.set(String(address), document);
        return true;
      },
      async invalidate(didOrAddress) {
        return documents.delete(String(didOrAddress).replace(/^did:stellar:/, ''));
      },
      async invalidateAll() {
        const count = documents.size;
        documents.clear();
        return count;
      },
      getStats() {
        return { enabled: true, size: documents.size };
      },
    };
    soroban.didCache = didCache;
    soroban.pingAllContracts = async () => ({ identity: true, credential: true, reputation: true });
    soroban.getIssuers = async () => [...issuers];
    soroban.addIssuer = async (issuer) => {
      issuers.push(issuer);
    };
    soroban.removeIssuer = async (issuer) => {
      issuers = issuers.filter((item) => item !== issuer);
    };

    app = createApp({
      config: env.config,
      soroban,
      metrics: { renderPrometheus: () => '# HELP integration\n' },
      metricsAggregator: null,
      didCache,
    });
  });

  after(async () => {
    await env?.cleanup();
    await quickstart?.stop();
  });

  it('exposes healthy, ready and live probes backed by quickstart RPC', async () => {
    const health = await request(app).get('/health').expect(200);
    assert.equal(health.body.dependencies.rpc.status, 'up');
    assert.equal(health.body.dependencies.rpc.rpcStatus, 'healthy');
    assert.equal(health.body.dependencies.contracts.status, 'up');

    await request(app).get('/ready').expect(200);
    const live = await request(app).get('/live').expect(200);
    assert.equal(live.body.status, 'alive');
  });

  it('supports full credential CRUD', async () => {
    const id = 'integration-credential';
    const created = await request(app)
      .post('/credentials')
      .set('X-API-Key', ADMIN_KEY)
      .send({ id, subject: 'did:stellar:alice', credentialSubject: { name: 'Alice' } })
      .expect(201);
    assert.equal(created.body.id, id);

    const listed = await request(app).get('/credentials').set('X-API-Key', ADMIN_KEY).expect(200);
    assert.ok(listed.body.credentials?.some((credential) => credential.id === id));

    const read = await request(app).get(`/credentials/${id}`).set('X-API-Key', ADMIN_KEY).expect(200);
    assert.equal(read.body.id, id);

    const updated = await request(app)
      .patch(`/credentials/${id}`)
      .set('X-API-Key', ADMIN_KEY)
      .send({ metadata: { updated: true } })
      .expect(200);
    assert.equal(updated.body.metadata.updated, true);

    await request(app).delete(`/credentials/${id}`).set('X-API-Key', ADMIN_KEY).expect(200);
    const revoked = await request(app).get(`/credentials/${id}`).set('X-API-Key', ADMIN_KEY).expect(200);
    assert.ok(revoked.body.revoked);
  });

  it('supports full webhook CRUD', async () => {
    const created = await request(app)
      .post('/webhooks')
      .set('X-API-Key', ADMIN_KEY)
      .send({ url: 'https://example.test/hooks', events: ['credential.issued'] })
      .expect(201);
    const id = created.body.id;
    assert.ok(id);

    const listed = await request(app).get('/webhooks').set('X-API-Key', ADMIN_KEY).expect(200);
    assert.ok(listed.body.webhooks.some((webhook) => webhook.id === id));

    await request(app).get(`/webhooks/${id}`).set('X-API-Key', ADMIN_KEY).expect(200);
    await request(app).delete(`/webhooks/${id}`).set('X-API-Key', ADMIN_KEY).expect(200, { success: true, id });
    await request(app).get(`/webhooks/${id}`).set('X-API-Key', ADMIN_KEY).expect(404);
  });

  it('supports DID create, read and metadata update', async () => {
    const created = await request(app)
      .post('/dids')
      .set('X-API-Key', ADMIN_KEY)
      .send({ address: TEST_ADDRESS, metadata: { source: 'integration' } })
      .expect(201);
    assert.equal(created.body.id, `did:stellar:${TEST_ADDRESS}`);

    const read = await request(app).get(`/dids/${TEST_ADDRESS}`).expect(200);
    assert.equal(read.body.metadata.source, 'integration');

    const updated = await request(app)
      .patch(`/dids/${TEST_ADDRESS}`)
      .set('X-API-Key', ADMIN_KEY)
      .send({ metadata: { tier: 'pro' } })
      .expect(200);
    assert.equal(updated.body.metadata.tier, 'pro');
    assert.equal(updated.body.metadata.source, 'integration');
  });

  it('supports issuer create, read and delete', async () => {
    const issuer = TEST_ADDRESS;
    await request(app)
      .post('/admin/issuers')
      .set('X-API-Key', ADMIN_KEY)
      .send({ issuer })
      .expect(201);

    const listed = await request(app).get('/admin/issuers').set('X-API-Key', ADMIN_KEY).expect(200);
    assert.ok(listed.body.issuers.includes(issuer));

    await request(app)
      .delete('/admin/issuers')
      .query({ issuer })
      .set('X-API-Key', ADMIN_KEY)
      .expect(200);
    const empty = await request(app).get('/admin/issuers').set('X-API-Key', ADMIN_KEY).expect(200);
    assert.ok(!empty.body.issuers.includes(issuer));
  });

  it('supports API key create, read and revoke', async () => {
    const created = await request(app)
      .post('/admin/api-keys')
      .set('X-API-Key', ADMIN_KEY)
      .send({ name: 'integration-key', scopes: ['credentials:read'] })
      .expect(201);
    const id = created.body.id;
    assert.ok(id);

    await request(app).get('/admin/api-keys').set('X-API-Key', ADMIN_KEY).expect(200);
    await request(app).get(`/admin/api-keys/${id}`).set('X-API-Key', ADMIN_KEY).expect(200);
    await request(app).delete(`/admin/api-keys/${id}`).set('X-API-Key', ADMIN_KEY).expect(200);
    await request(app).get(`/admin/api-keys/${id}`).set('X-API-Key', ADMIN_KEY).expect(404);
  });
});
