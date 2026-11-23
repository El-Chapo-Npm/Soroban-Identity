import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { buildSearchQuery, ElasticsearchClient, SearchIndexer } from '../src/search/elasticsearch.js';
import { handleRequest, verifyCredential, resetRateLimits, selectOrigin } from '../src/edge/worker.js';
import { FieldEncryptor, LocalKms, encryptBackup, decryptBackup } from '../src/encryption-at-rest.js';
import { ComplianceService } from '../src/compliance/index.js';

// #1114 search
test('builds fuzzy query with facets, filters and ranges', () => {
  const body = buildSearchQuery({ index: 'credentials', q: 'degre', filters: { type: 'Degree' }, ranges: { issuedAt: { gte: '2025-01-01' } } });
  assert.equal(body.query.bool.must[0].bool.should[0].multi_match.fuzziness, 'AUTO');
  assert.ok(body.query.bool.must[0].bool.should[1].nested);
  assert.deepEqual(body.query.bool.filter[0], { term: { type: 'Degree' } });
  assert.deepEqual(body.query.bool.filter[1], { range: { issuedAt: { gte: '2025-01-01' } } });
  assert.ok(body.aggs.issuer);
  assert.equal(buildSearchQuery({ index: 'dids', q: 'a b', mode: 'phrase' }).query.bool.must[0].multi_match.type, 'phrase');
  assert.throws(() => buildSearchQuery({ index: 'nope' }));
});

test('indexer flushes bulk ndjson and client parses facets', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('_search')) {
      return new Response(JSON.stringify({ hits: { total: { value: 1 }, hits: [{ _id: '1', _score: 2, _source: { title: 'x' } }] }, aggregations: { type: { buckets: [{ key: 'Degree', doc_count: 1 }] } } }));
    }
    return new Response(JSON.stringify({ errors: false, items: [] }));
  };
  const client = new ElasticsearchClient({ node: 'http://es:9200', fetchImpl });
  const indexer = new SearchIndexer(client, { batchSize: 2, flushIntervalMs: 0 });
  await indexer.index('credentials', '1', { title: 'x' });
  await indexer.remove('dids', 'd1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.body, /"_index":"soroban_credentials"/);
  const res = await client.search({ index: 'credentials', q: 'x' });
  assert.equal(res.total, 1);
  assert.deepEqual(res.facets.type, [{ value: 'Degree', count: 1 }]);
});

// #1115 edge
function hs256(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

test('edge verifies credentials and rejects tampering/expiry', async () => {
  const env = { CREDENTIAL_VERIFY_SECRET: 's3cret' };
  assert.equal((await verifyCredential(hs256({ sub: 'did:x' }, 's3cret'), env)).valid, true);
  assert.equal((await verifyCredential(hs256({ sub: 'did:x' }, 'other'), env)).reason, 'bad_signature');
  assert.equal((await verifyCredential(hs256({ exp: 1 }, 's3cret'), env)).reason, 'expired');
});

test('edge blocks bots, rate limits and geo-routes', async () => {
  resetRateLimits();
  const env = { EDGE_REQUESTS_PER_MINUTE: '1', ORIGIN_URL: 'https://origin', ORIGIN_REGIONS: '{"EU":"https://eu"}', CREDENTIAL_VERIFY_SECRET: 'k' };
  const bot = await handleRequest(new Request('https://e/edge/verify', { method: 'POST', headers: { 'user-agent': 'curl/8' } }), env, {});
  assert.equal(bot.status, 403);
  const mk = () => new Request('https://e/edge/verify', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0', 'CF-Connecting-IP': '1.1.1.1' }, body: '{}' });
  assert.equal((await handleRequest(mk(), env, {})).status, 422);
  assert.equal((await handleRequest(mk(), env, {})).status, 429);
  const eu = new Request('https://e/');
  Object.defineProperty(eu, 'cf', { value: { continent: 'EU' } });
  assert.equal(selectOrigin(eu, env), 'https://eu');
});

// #1116 encryption at rest
test('envelope encrypts fields per tenant and supports rotation', async () => {
  const audit = [];
  const kms = new LocalKms({ masterKey: crypto.randomBytes(32).toString('hex') });
  const enc = new FieldEncryptor({ kms, audit: (e) => audit.push(e) });
  const record = { id: 'c1', claims: { name: 'Ada' }, metadata: { email: 'a@b.c' } };
  const stored = await enc.encryptFields('t1', record, ['claims', 'metadata.email']);
  assert.ok(FieldEncryptor.isEncrypted(stored.claims));
  assert.ok(!JSON.stringify(stored).includes('Ada'));
  assert.deepEqual(await enc.decryptFields(stored, ['claims', 'metadata.email']), record);

  kms.rotate('t1');
  const rewrapped = await enc.rewrap(stored.claims);
  assert.match(rewrapped, /"ver":2/);
  assert.deepEqual(await enc.decrypt(rewrapped, 'claims'), { name: 'Ada' });
  await assert.rejects(enc.decrypt(stored.claims, 'wrong-context'));
  assert.ok(audit.some((e) => e.event === 'rewrap'));

  const backup = await encryptBackup(enc, 't1', Buffer.from('dump'));
  assert.equal((await decryptBackup(enc, backup)).toString(), 'dump');
});

// #1117 compliance
test('compliance export, erasure, consent, checks and trail integrity', async () => {
  const deleted = [];
  const store = {
    listSubjectData: async (id) => ({ credentials: [{ id: 'c1', subject: id }] }),
    deleteSubjectData: async (id) => { deleted.push(id); return { credentials: 1 }; },
    purgeOlderThan: async () => 3,
  };
  const svc = new ComplianceService({ store });
  svc.setConsent('did:a', 'analytics', true);
  svc.setConsent('did:a', 'analytics', false);
  assert.equal(svc.hasConsent('did:a', 'analytics'), false);
  svc.recordThirdPartySharing({ subjectId: 'did:a', recipient: 'verifier', purpose: 'kyc' });
  const exp = await svc.exportSubjectData('did:a');
  assert.equal(exp.data.credentials.length, 1);
  assert.equal(exp.thirdPartySharing.length, 1);
  const conf = await svc.forgetSubject('did:a');
  assert.deepEqual(deleted, ['did:a']);
  assert.match(conf.confirmation, /^[0-9a-f]{64}$/);
  assert.equal((await svc.applyRetention()).audit_logs, 3);
  assert.ok(svc.reportBreach({ description: 'x' }).notifyAuthorityBy);
  const evidence = svc.soc2Evidence({ encryptionAtRest: true, tlsEnforced: true, authRequired: true });
  assert.equal(evidence.find((e) => e.control === 'CC6.7').status, 'effective');
  assert.equal(svc.dashboard({}).totals.erasures, 1);
  assert.equal(svc.verifyTrail(), true);
  svc.trail[0].details.purpose = 'tampered';
  assert.equal(svc.verifyTrail(), false);
});
