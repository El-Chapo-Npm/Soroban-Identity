import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  DID_JSON,
  DID_LD_JSON,
  base58btcEncode,
  buildDidDocument,
  buildServices,
  ed25519PublicKeyMultibase,
  negotiateContentType,
  parseStellarDid,
  resolveDidDocument,
} from '../src/did-resolver.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(text) {
  let value = 0n;
  for (const ch of text) value = value * 58n + BigInt(ALPHABET.indexOf(ch));
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  const zeros = text.length - text.replace(/^1+/, '').length;
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

const address = Keypair.random().publicKey();
const did = `did:stellar:${address}`;

test('base58btc matches known vectors', () => {
  assert.equal(base58btcEncode(new TextEncoder().encode('Hello World!')), '2NEpo7TZRRrLZSi2U');
  assert.equal(base58btcEncode(Uint8Array.from([0, 0, 1])), '112');
  assert.equal(base58btcEncode(new Uint8Array(0)), '');
});

test('publicKeyMultibase is z6Mk... and round-trips to the Stellar key', () => {
  const raw = StrKey.decodeEd25519PublicKey(address);
  const multibase = ed25519PublicKeyMultibase(raw);
  assert.ok(multibase.startsWith('z6Mk'));
  const decoded = base58Decode(multibase.slice(1));
  assert.deepEqual([...decoded.slice(0, 2)], [0xed, 0x01]);
  assert.deepEqual([...decoded.slice(2)], [...raw]);
});

test('parseStellarDid accepts did and bare address, rejects bad input', () => {
  assert.equal(parseStellarDid(did).address, address);
  assert.equal(parseStellarDid(address).did, did);
  assert.throws(() => parseStellarDid('did:stellar:not-a-key'), { code: 'invalidDid', status: 400 });
  assert.throws(() => parseStellarDid(''), { code: 'invalidDid' });
  assert.throws(() => parseStellarDid(`did:web:${address}`), { code: 'methodNotSupported', status: 501 });
});

test('buildDidDocument produces a DID Core document', () => {
  const { document } = buildDidDocument(did, {
    active: true,
    services: [{ id: 'hub', type: 'IdentityHub', serviceEndpoint: 'https://hub.example.com/x' }],
  });
  assert.equal(document['@context'][0], 'https://www.w3.org/ns/did/v1');
  assert.equal(document.id, did);
  assert.equal(document.controller, did);
  const [vm] = document.verificationMethod;
  assert.equal(vm.id, `${did}#keys-1`);
  assert.equal(vm.type, 'Ed25519VerificationKey2020');
  assert.equal(vm.controller, did);
  assert.deepEqual(document.authentication, [vm.id]);
  assert.deepEqual(document.assertionMethod, [vm.id]);
  assert.deepEqual(document.service, [
    { id: `${did}#hub`, type: 'IdentityHub', serviceEndpoint: 'https://hub.example.com/x' },
  ]);
});

test('document omits service when none are valid', () => {
  const { document } = buildDidDocument(did, { active: true });
  assert.equal('service' in document, false);
});

test('foreign or malformed controller falls back to the DID itself', () => {
  assert.equal(buildDidDocument(did, { controller: 'javascript:alert(1)' }).document.controller, did);
  const other = Keypair.random().publicKey();
  assert.equal(buildDidDocument(did, { controller: `did:stellar:${other}` }).document.controller, `did:stellar:${other}`);
});

test('deactivated DID yields a minimal document and metadata flag', () => {
  const { document, metadata } = buildDidDocument(did, { active: false });
  assert.deepEqual(document, { '@context': ['https://www.w3.org/ns/did/v1'], id: did });
  assert.equal(metadata.deactivated, true);
});

test('metadata timestamps accept seconds and ISO strings', () => {
  const { metadata } = buildDidDocument(did, { createdAt: 1700000000, updatedAt: '2024-01-02T03:04:05.000Z' });
  assert.equal(metadata.created, '2023-11-14T22:13:20.000Z');
  assert.equal(metadata.updated, '2024-01-02T03:04:05.000Z');
});

test('buildServices drops unsafe, malformed and duplicate entries', () => {
  const out = buildServices(did, [
    { id: 'a', type: 'T', serviceEndpoint: 'https://ok.example.com' },
    { id: 'a', type: 'T', serviceEndpoint: 'https://dup.example.com' },
    { id: 'b', type: 'T', serviceEndpoint: 'http://insecure.example.com' },
    { id: 'c', type: 'T', serviceEndpoint: 'https://user:pw@evil.example.com' },
    { id: 'bad id', type: 'T', serviceEndpoint: 'https://ok.example.com' },
    { id: 'd', serviceEndpoint: 'https://ok.example.com' },
    null,
    'x',
  ]);
  assert.deepEqual(out.map((s) => s.id), [`${did}#a`]);
  assert.deepEqual(buildServices(did, undefined), []);
});

test('negotiateContentType', () => {
  assert.equal(negotiateContentType(''), DID_LD_JSON);
  assert.equal(negotiateContentType('application/did+json'), DID_JSON);
  assert.equal(negotiateContentType('text/html, application/did+ld+json;q=0.9'), DID_LD_JSON);
  assert.equal(negotiateContentType('*/*'), DID_LD_JSON);
  assert.equal(negotiateContentType('text/html'), null);
});

test('resolveDidDocument maps outcomes to statuses', async () => {
  const found = await resolveDidDocument(did, async () => ({ active: true }));
  assert.equal(found.status, 200);
  assert.equal(found.contentType, DID_LD_JSON);
  assert.equal(found.body.id, did);

  assert.equal((await resolveDidDocument(did, async () => null)).status, 404);
  assert.equal((await resolveDidDocument('nope', async () => assert.fail('no lookup'))).status, 400);
  assert.equal((await resolveDidDocument(did, async () => ({ active: false }))).status, 410);
  assert.equal((await resolveDidDocument(did, async () => ({}), { accept: 'text/html' })).status, 406);
  assert.equal((await resolveDidDocument(did, async () => ({}), { accept: DID_JSON })).contentType, DID_JSON);
});

test('lookup errors propagate instead of being reported as not found', async () => {
  await assert.rejects(resolveDidDocument(did, async () => { throw new Error('rpc down'); }), /rpc down/);
});
