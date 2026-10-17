import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDataLoaders } from '../src/dataloader.js';
import { executeGraphQL } from '../src/graphql.js';
import { clearCredentialCache } from '../src/storage.js';

const SUBJECT = 'GSUBJECTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const CREDENTIALS = [
  { id: 'cred-1', subject: SUBJECT, issuer: 'GISSUER', revoked: false, expiresAt: 0 },
  { id: 'cred-2', subject: SUBJECT, issuer: 'GISSUER', revoked: true, expiresAt: 0 },
  { id: 'cred-3', subject: 'GOTHER', issuer: 'GISSUER', revoked: false, expiresAt: 0 },
];

/** Store reader that counts round trips. */
function countingReader(credentials = CREDENTIALS) {
  const reader = async () => {
    reader.calls += 1;
    return credentials;
  };
  reader.calls = 0;
  return reader;
}

test('credential, list, and reputation lookups share one store read', async () => {
  const readAll = countingReader();
  const loaders = createDataLoaders({ config: {}, readAll });

  const [one, many, rep, list] = await Promise.all([
    loaders.credentialLoader.load('cred-1'),
    loaders.credentialLoader.loadMany(['cred-2', 'missing']),
    loaders.reputationLoader.load(`did:stellar:${SUBJECT}`),
    loaders.prefetchCredentials(),
  ]);

  assert.equal(readAll.calls, 1);
  assert.equal(one.id, 'cred-1');
  assert.deepEqual(many.map((c) => c && c.id), ['cred-2', null]);
  assert.equal(rep.breakdown.credentialCount, 1, 'revoked credential is not counted');
  assert.equal(list.length, 3);
});

test('prefetch primes the by-id loader so later lookups make no read', async () => {
  const readAll = countingReader();
  const loaders = createDataLoaders({ config: {}, readAll });

  await loaders.prefetchCredentials();
  const cred = await loaders.credentialLoader.load('cred-3');
  const again = await loaders.prefetchCredentials();

  assert.equal(readAll.calls, 1);
  assert.equal(cred.subject, 'GOTHER');
  assert.equal(again.length, 3);
});

test('a failed prefetch is not memoised and can be retried', async () => {
  let calls = 0;
  const readAll = async () => {
    calls += 1;
    if (calls === 1) throw new Error('store unavailable');
    return CREDENTIALS;
  };
  const loaders = createDataLoaders({ config: {}, readAll });

  await assert.rejects(loaders.prefetchCredentials(), /store unavailable/);
  const list = await loaders.prefetchCredentials();

  assert.equal(calls, 2);
  assert.equal(list.length, 3);
});

test('invalidateCredentials forces the next lookup to re-read the store', async () => {
  const readAll = countingReader();
  const loaders = createDataLoaders({ config: {}, readAll });

  await loaders.credentialLoader.load('cred-1');
  loaders.invalidateCredentials();
  await loaders.credentialLoader.load('cred-1');
  await loaders.reputationLoader.load(SUBJECT);

  assert.equal(readAll.calls, 2);
});

test('reputation matches subjects stored with or without the did prefix', async () => {
  const readAll = countingReader([
    { id: 'a', subject: SUBJECT, revoked: false },
    { id: 'b', subject: `did:stellar:${SUBJECT}`, revoked: false },
  ]);
  const loaders = createDataLoaders({ config: {}, readAll });

  const [prefixed, bare] = await Promise.all([
    loaders.reputationLoader.load(`did:stellar:${SUBJECT}`),
    loaders.reputationLoader.load(SUBJECT),
  ]);

  assert.equal(prefixed.breakdown.credentialCount, 2);
  assert.equal(bare.breakdown.credentialCount, 1);
  assert.equal(readAll.calls, 1);
});

test('a GraphQL query touching several credential fields reads the store once', async () => {
  const readAll = countingReader();
  const loaders = createDataLoaders({ config: {}, readAll });

  const result = await executeGraphQL({
    query: `query {
      credential(id: "cred-1") { id subject }
      verifyCredential(id: "cred-2") { verified reason }
      credentials(limit: 10) { total }
      reputation(did: "${SUBJECT}") { score }
      serverInfo { version }
    }`,
    context: { config: {}, loaders },
  });

  assert.equal(result.errors, undefined);
  assert.equal(readAll.calls, 1);
  assert.deepEqual(Object.keys(result.data), [
    'credential',
    'verifyCredential',
    'credentials',
    'reputation',
    'serverInfo',
  ]);
  assert.deepEqual(result.data.credential, { id: 'cred-1', subject: SUBJECT });
  assert.deepEqual(result.data.verifyCredential, { verified: false, reason: 'revoked' });
  assert.equal(result.data.credentials.total, 3);
  assert.equal(typeof result.data.reputation.score, 'number');
});

test('a query with no credential fields does not prefetch', async () => {
  const readAll = countingReader();
  const loaders = createDataLoaders({ config: {}, readAll });

  const result = await executeGraphQL({
    query: '{ serverInfo { version } }',
    context: { config: {}, loaders },
  });

  assert.equal(result.data.serverInfo.version, '0.1.0');
  assert.equal(readAll.calls, 0);
});

test('a store failure surfaces as a GraphQL error, not an unhandled rejection', async () => {
  const loaders = createDataLoaders({
    config: {},
    readAll: async () => {
      throw new Error('disk on fire');
    },
  });

  const result = await executeGraphQL({
    query: '{ credential(id: "cred-1") { id } }',
    context: { config: {}, loaders },
  });

  assert.equal(result.errors[0].message, 'disk on fire');
});

test('issueCredential invalidates the request snapshot', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataloader-prefetch-'));
  t.after(async () => {
    clearCredentialCache();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const config = {
    dataDir: dir,
    credentialStorePath: path.join(dir, 'credentials.json'),
    auditLogPath: path.join(dir, 'audit', 'audit.log'),
  };
  const loaders = createDataLoaders({ config });

  assert.equal((await loaders.prefetchCredentials()).length, 0);

  const result = await executeGraphQL({
    query: 'mutation Issue($input: IssueCredentialInput!) { issueCredential(input: $input) { id } }',
    variables: { input: { id: 'new-1', subject: SUBJECT, issuer: 'GISSUER' } },
    context: { config, loaders },
  });

  assert.equal(result.errors, undefined);
  assert.equal(result.data.issueCredential.id, 'new-1');
  const fresh = await loaders.credentialLoader.load('new-1');
  assert.equal(fresh && fresh.id, 'new-1');
  const rep = await loaders.reputationLoader.load(SUBJECT);
  assert.equal(rep.breakdown.credentialCount, 1);
});
