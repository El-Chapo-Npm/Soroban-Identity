import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { executeBatch } from '../src/batch.js';
import { createAndPersistCredential, readCredentials } from '../src/storage.js';

const testDataDir = path.resolve(process.cwd(), 'test-data-batch');
const config = {
  dataDir: testDataDir,
  auditLogPath: path.join(testDataDir, 'audit'),
  credentialStorePath: path.join(testDataDir, 'credentials.json'),
  auditLogRetentionDays: 3,
};

function credential(id, overrides = {}) {
  return { id, subject: undefined, expiresAt: 0, revoked: false, ...overrides };
}

test.beforeEach(async () => {
  if (fs.existsSync(testDataDir)) await fsPromises.rm(testDataDir, { recursive: true, force: true });
});

test.after(async () => {
  if (fs.existsSync(testDataDir)) await fsPromises.rm(testDataDir, { recursive: true, force: true });
});

test('executes issue, verify and revoke operations and reports one result per operation', async () => {
  await createAndPersistCredential(config, credential('existing-1'));

  const operations = [
    { id: 'a', type: 'issue', payload: credential('new-1') },
    { id: 'b', type: 'verify', payload: { credentialId: 'existing-1' } },
    { id: 'c', type: 'revoke', payload: { credentialId: 'existing-1' } },
  ];

  const result = await executeBatch({ operations, atomic: false }, { config });

  assert.equal(result.results.length, 3);
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.succeeded, 3);
  assert.equal(result.summary.failed, 0);

  assert.equal(result.results[0].status, 'issued');
  assert.equal(result.results[1].data.verified, true);
  assert.equal(result.results[2].data.revoked, true);

  const stored = await readCredentials(config);
  assert.ok(stored.some((c) => c.id === 'new-1'));
});

test('non-atomic batch continues after a failure and reports it as a partial failure', async () => {
  const operations = [
    { id: 'a', type: 'verify', payload: { credentialId: 'does-not-exist' } },
    { id: 'b', type: 'revoke', payload: { credentialId: 'does-not-exist' } },
    { id: 'c', type: 'issue', payload: credential('ok-1') },
  ];

  const result = await executeBatch({ operations, atomic: false }, { config });

  assert.equal(result.summary.succeeded, 2); // verify(not_found) and issue both "succeed" as operations
  assert.equal(result.summary.failed, 1); // revoke of a missing credential fails
  assert.equal(result.results[1].success, false);
  assert.equal(result.results[1].error.code, 'NOT_FOUND');
  assert.equal(result.results[2].success, true, 'later operations still run after an earlier failure');

  const stored = await readCredentials(config);
  assert.ok(stored.some((c) => c.id === 'ok-1'));
});

test('atomic batch aborts remaining operations after the first failure', async () => {
  const operations = [
    { id: 'a', type: 'issue', payload: credential('atomic-1') },
    { id: 'b', type: 'revoke', payload: { credentialId: 'does-not-exist' } },
    { id: 'c', type: 'issue', payload: credential('atomic-2') },
  ];

  const result = await executeBatch({ operations, atomic: true }, { config });

  assert.equal(result.aborted, true);
  assert.equal(result.results[2].status, 'skipped');
  assert.equal(result.results[2].error.code, 'BATCH_ABORTED');

  const stored = await readCredentials(config);
  assert.equal(stored.some((c) => c.id === 'atomic-2'), false, 'skipped operation never ran');
});

test('atomic batch compensates by revoking credentials issued earlier in the same batch', async () => {
  const operations = [
    { id: 'a', type: 'issue', payload: credential('rollback-1') },
    { id: 'b', type: 'revoke', payload: { credentialId: 'does-not-exist' } },
  ];

  await executeBatch({ operations, atomic: true }, { config });

  const stored = await readCredentials(config);
  const issued = stored.find((c) => c.id === 'rollback-1');
  assert.ok(issued, 'the credential is still present (revoked, not deleted)');
  assert.equal(issued.revoked, true, 'atomic rollback revokes what it already issued');
});

test('duplicate credential id surfaces a distinct error code, not a generic failure', async () => {
  await createAndPersistCredential(config, credential('dup-1'));

  const result = await executeBatch(
    { operations: [{ id: 'a', type: 'issue', payload: credential('dup-1') }], atomic: false },
    { config },
  );

  assert.equal(result.results[0].success, false);
  assert.equal(result.results[0].error.code, 'CREDENTIAL_ALREADY_EXISTS');
});

test('reports per-operation metrics through the injected metrics object', async () => {
  const observed = [];
  const metrics = {
    observeBatchOperation: (sample) => observed.push(sample),
    observeBatchRequest: () => {},
  };
  await executeBatch(
    { operations: [{ id: 'a', type: 'verify', payload: { credentialId: 'nope' } }], atomic: false },
    { config, metrics },
  );
  assert.deepEqual(observed, [{ type: 'verify', result: 'success' }]);
});

test('omitted webhookService/realtime do not throw (both are optional)', async () => {
  await assert.doesNotReject(() =>
    executeBatch({ operations: [{ id: 'a', type: 'issue', payload: credential('no-webhook-1') }], atomic: false }, { config }),
  );
});
