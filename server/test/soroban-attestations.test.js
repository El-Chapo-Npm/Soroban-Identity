import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SorobanClient, parseAttestationList, parseAttestationRecord } from '../src/soroban.js';

function makeClient(invokeImpl) {
  const client = new SorobanClient({
    contracts: { credential: 'CREDENTIAL_CONTRACT' },
    rpcCacheTtlMs: 1000,
    eventPollIntervalMs: 0,
  }, null);
  client.invoke = invokeImpl;
  return client;
}

test('getAttestationById invokes get_attestation with attestation_id and normalizes its record', async () => {
  const calls = [];
  const client = makeClient(async (...args) => {
    calls.push(args);
    return JSON.stringify({
      id: '0x' + 'AB'.repeat(32),
      issuer: 'GISSUER',
      subject: 'GSUBJECT',
      claim_type: 'membership',
      value: 'gold',
      expiry: '1234',
      revoked: false,
      revoked_at: '0',
      revoked_by: null,
    });
  });

  const record = await client.getAttestationById('ab'.repeat(32));

  assert.deepEqual(calls, [['CREDENTIAL_CONTRACT', 'get_attestation', ['--attestation_id', 'abababababababababababababababababababababababababababababababab']]]);
  assert.equal(record.id, 'ab'.repeat(32));
  assert.equal(record.issuer, 'did:stellar:GISSUER');
  assert.equal(record.subject, 'did:stellar:GSUBJECT');
  assert.equal(record.claim, 'membership');
  assert.deepEqual(record.data, { membership: 'gold' });
  assert.equal(record.status, 'active');
  assert.equal(record.expiry, 1234);
});

test('getAttestationsForAccount invokes get_attestations_for_account and normalizes full records', async () => {
  const calls = [];
  const client = makeClient(async (...args) => {
    calls.push(args);
    return JSON.stringify([{ id: 'cd'.repeat(32), issuer: 'GISSUER', subject: 'GSUBJECT', claim_type: 'role', value: 'admin', revoked: true, revoked_at: '99' }]);
  });

  const records = await client.getAttestationsForAccount('GACCOUNT');

  assert.deepEqual(calls, [['CREDENTIAL_CONTRACT', 'get_attestations_for_account', ['--account', 'GACCOUNT']]]);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'cd'.repeat(32));
  assert.equal(records[0].status, 'revoked');
  assert.equal(records[0].revokedAt, 99);
});

test('attestation parsers accept byte ids and list response wrappers', () => {
  const record = parseAttestationRecord({ id: Array(32).fill(4), issuer: 'GISSUER', subject: 'GSUBJECT' });
  assert.equal(record.id, '04'.repeat(32));
  assert.equal(parseAttestationList({ result: [{ id: 'ef'.repeat(32), revoked: false }] }).length, 1);
});

test('attestation parser preserves all claims from claims-map records', () => {
  const claims = { role: 'admin', department: 'engineering' };
  const record = parseAttestationRecord({
    id: 'ab'.repeat(32),
    issuer: 'GISSUER',
    subject: 'GSUBJECT',
    claims,
  });

  assert.deepEqual(record.claims, claims);
  assert.deepEqual(record.data, claims);
  assert.equal(record.claim, 'role');
  assert.equal(record.value, 'admin');
});
