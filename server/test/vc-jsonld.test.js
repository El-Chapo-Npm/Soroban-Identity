import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';

import { createApp } from '../src/app.js';
import { canonicalize } from '../src/jcs.js';
import {
  CREDENTIAL_STATUS_TYPE,
  CRYPTOSUITE,
  DATA_INTEGRITY_CONTEXT,
  VC_CONTEXT_V1,
  VC_CONTEXT_V2,
  attachProof,
  base58btcDecode,
  base58btcEncode,
  compactCredential,
  createVcSerializer,
  credentialStatus,
  credentialUri,
  expandCredential,
  loadProofKey,
  toDid,
  toVerifiableCredential,
  validateVerifiableCredential,
  verifyProof,
} from '../src/vc-jsonld.js';

/** A deterministic Ed25519 seed, so proof assertions are reproducible. */
const SEED = '9'.repeat(64);

const SAMPLE = {
  id: 'cred-123',
  subject: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS',
  issuer: 'GISSUERABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKL',
  type: 'KycCredential',
  claims: { level: 'full', country: 'NG' },
  issuedAt: 1700000000,
  expiresAt: 1800000000,
  revoked: false,
};

// ── JCS canonicalization ─────────────────────────────────────────────────────

test('canonicalization sorts object keys', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('canonicalization is stable regardless of insertion order', () => {
  // This is the whole point: two encoders must agree byte for byte, or the
  // signature over the result does not verify.
  const first = { z: 1, a: { y: 2, b: 3 } };
  const second = { a: { b: 3, y: 2 }, z: 1 };

  assert.equal(canonicalize(first), canonicalize(second));
});

test('canonicalization emits no insignificant whitespace', () => {
  assert.equal(canonicalize({ a: [1, 2], b: 'x' }), '{"a":[1,2],"b":"x"}');
});

test('canonicalization drops undefined members but keeps array holes as null', () => {
  assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalize([1, undefined, 2]), '[1,null,2]');
});

test('canonicalization renders -0 as 0', () => {
  assert.equal(canonicalize(-0), '0');
});

test('canonicalization refuses values JSON cannot represent', () => {
  // Silently emitting null would sign data the caller never intended.
  assert.throws(() => canonicalize(Number.NaN), TypeError);
  assert.throws(() => canonicalize(Number.POSITIVE_INFINITY), TypeError);
});

test('canonicalization honours toJSON', () => {
  const date = new Date('2024-01-01T00:00:00.000Z');
  assert.equal(canonicalize({ at: date }), '{"at":"2024-01-01T00:00:00.000Z"}');
});

// ── base58btc ────────────────────────────────────────────────────────────────

test('base58btc round-trips arbitrary bytes', () => {
  for (let i = 0; i < 50; i++) {
    const bytes = crypto.randomBytes(1 + (i % 40));
    assert.deepEqual(base58btcDecode(base58btcEncode(bytes)), bytes);
  }
});

test('base58btc preserves leading zero bytes', () => {
  const bytes = Buffer.from([0, 0, 1, 2, 3]);
  const encoded = base58btcEncode(bytes);

  assert.ok(encoded.startsWith('11'));
  assert.deepEqual(base58btcDecode(encoded), bytes);
});

// ── Mapping to the data model ────────────────────────────────────────────────

test('a credential is emitted with the VC context first', () => {
  // Order is normative — a context before the base one could redefine its
  // terms.
  const vc = toVerifiableCredential(SAMPLE);
  assert.equal(vc['@context'][0], VC_CONTEXT_V1);
});

test('type always includes VerifiableCredential alongside the specific type', () => {
  const vc = toVerifiableCredential(SAMPLE);
  assert.deepEqual(vc.type, ['VerifiableCredential', 'KycCredential']);
});

test('the specific type is not repeated when it is already VerifiableCredential', () => {
  const vc = toVerifiableCredential({ ...SAMPLE, type: 'VerifiableCredential' });
  assert.deepEqual(vc.type, ['VerifiableCredential']);
});

test('issuer and subject are expressed as DIDs', () => {
  const vc = toVerifiableCredential(SAMPLE);

  assert.equal(vc.issuer, `did:stellar:${SAMPLE.issuer}`);
  assert.equal(vc.credentialSubject.id, `did:stellar:${SAMPLE.subject}`);
});

test('a value that is already a DID is left alone', () => {
  assert.equal(toDid('did:stellar:GABC'), 'did:stellar:GABC');
  assert.equal(toDid('GABC'), 'did:stellar:GABC');
  assert.equal(toDid(undefined), undefined);
});

test('claims become properties of the credential subject', () => {
  const vc = toVerifiableCredential(SAMPLE);

  assert.equal(vc.credentialSubject.level, 'full');
  assert.equal(vc.credentialSubject.country, 'NG');
});

test('dates are emitted as XMLSchema dateTimes', () => {
  const vc = toVerifiableCredential(SAMPLE);

  assert.equal(vc.issuanceDate, new Date(1700000000 * 1000).toISOString());
  assert.equal(vc.expirationDate, new Date(1800000000 * 1000).toISOString());
});

test('a credential without an expiry omits expirationDate', () => {
  const vc = toVerifiableCredential({ ...SAMPLE, expiresAt: 0 });
  assert.equal(vc.expirationDate, undefined);
});

test('the v2 context uses validFrom and validUntil', () => {
  // v2 renamed these; emitting the v1 pair under a v2 context would make the
  // credential invalid against its own schema.
  const vc = toVerifiableCredential(SAMPLE, { baseContext: VC_CONTEXT_V2 });

  assert.equal(vc.validFrom, new Date(1700000000 * 1000).toISOString());
  assert.equal(vc.validUntil, new Date(1800000000 * 1000).toISOString());
  assert.equal(vc.issuanceDate, undefined);
  assert.equal(vc.expirationDate, undefined);
});

test('credential ids are urn: identifiers unless a base URL is configured', () => {
  assert.equal(credentialUri('cred-1'), 'urn:credential:cred-1');
  assert.equal(
    credentialUri('cred-1', 'https://api.example.org/'),
    'https://api.example.org/credentials/cred-1',
  );
});

test('every credential carries a status entry pointing back at the issuer', () => {
  const vc = toVerifiableCredential(SAMPLE, { baseUrl: 'https://api.example.org' });

  assert.equal(vc.credentialStatus.type, CREDENTIAL_STATUS_TYPE);
  assert.equal(
    vc.credentialStatus.id,
    'https://api.example.org/credentials/cred-123/status',
  );
});

// ── Multiple contexts ────────────────────────────────────────────────────────

test('configured extra contexts are appended after the base context', () => {
  const vc = toVerifiableCredential(SAMPLE, {
    extraContexts: ['https://example.org/vocab/v1'],
  });

  assert.deepEqual(vc['@context'], [VC_CONTEXT_V1, 'https://example.org/vocab/v1']);
});

test('a credential may declare its own additional contexts', () => {
  const vc = toVerifiableCredential({
    ...SAMPLE,
    metadata: { '@context': ['https://example.org/per-credential/v1'] },
  });

  assert.ok(vc['@context'].includes('https://example.org/per-credential/v1'));
});

test('a context named twice appears once', () => {
  const vc = toVerifiableCredential(
    { ...SAMPLE, metadata: { '@context': ['https://example.org/vocab/v1'] } },
    { extraContexts: ['https://example.org/vocab/v1'] },
  );

  const occurrences = vc['@context'].filter((c) => c === 'https://example.org/vocab/v1');
  assert.equal(occurrences.length, 1);
});

// ── Proofs ───────────────────────────────────────────────────────────────────

test('a signed credential carries a Data Integrity proof', () => {
  const { privateKey } = loadProofKey(SEED);
  const signed = attachProof(toVerifiableCredential(SAMPLE), {
    privateKey,
    verificationMethod: 'did:stellar:GISSUER#key-1',
  });

  assert.equal(signed.proof.type, 'DataIntegrityProof');
  assert.equal(signed.proof.cryptosuite, CRYPTOSUITE);
  assert.equal(signed.proof.proofPurpose, 'assertionMethod');
  assert.ok(signed.proof.proofValue.startsWith('z'));
});

test('a proof verifies against the issuing key', () => {
  const { privateKey } = loadProofKey(SEED);
  const publicKey = crypto.createPublicKey(privateKey);

  const signed = attachProof(toVerifiableCredential(SAMPLE), {
    privateKey,
    verificationMethod: 'did:stellar:GISSUER#key-1',
  });

  assert.equal(verifyProof(signed, publicKey), true);
});

test('tampering with a claim invalidates the proof', () => {
  const { privateKey } = loadProofKey(SEED);
  const publicKey = crypto.createPublicKey(privateKey);

  const signed = attachProof(toVerifiableCredential(SAMPLE), {
    privateKey,
    verificationMethod: 'did:stellar:GISSUER#key-1',
  });

  signed.credentialSubject.level = 'none';
  assert.equal(verifyProof(signed, publicKey), false);
});

test('tampering with the proof metadata invalidates the proof', () => {
  // Hashing the proof options separately is what binds them to the document,
  // so swapping the purpose after signing must not go unnoticed.
  const { privateKey } = loadProofKey(SEED);
  const publicKey = crypto.createPublicKey(privateKey);

  const signed = attachProof(toVerifiableCredential(SAMPLE), {
    privateKey,
    verificationMethod: 'did:stellar:GISSUER#key-1',
  });

  signed.proof.proofPurpose = 'authentication';
  assert.equal(verifyProof(signed, publicKey), false);
});

test('a proof from another key does not verify', () => {
  const { privateKey } = loadProofKey(SEED);
  const other = crypto.createPublicKey(loadProofKey('a'.repeat(64)).privateKey);

  const signed = attachProof(toVerifiableCredential(SAMPLE), {
    privateKey,
    verificationMethod: 'did:stellar:GISSUER#key-1',
  });

  assert.equal(verifyProof(signed, other), false);
});

test('reordering properties does not invalidate a proof', () => {
  // The signature is over the canonical form, so a credential that survives a
  // JSON round-trip through a different encoder must still verify.
  const { privateKey } = loadProofKey(SEED);
  const publicKey = crypto.createPublicKey(privateKey);

  const signed = attachProof(toVerifiableCredential(SAMPLE), {
    privateKey,
    verificationMethod: 'did:stellar:GISSUER#key-1',
  });

  // Rebuild the object with its keys in the opposite order. The bytes of a
  // naive JSON.stringify differ; the canonical form does not.
  const reordered = Object.fromEntries(Object.entries(signed).reverse());
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(signed));
  assert.equal(verifyProof(reordered, publicKey), true);
});

test('an unsigned or foreign-suite document does not verify', () => {
  const { privateKey } = loadProofKey(SEED);
  const publicKey = crypto.createPublicKey(privateKey);

  assert.equal(verifyProof(toVerifiableCredential(SAMPLE), publicKey), false);
  assert.equal(verifyProof({ proof: { proofValue: 'zabc', cryptosuite: 'other' } }, publicKey), false);
});

test('the proof key accepts hex and base64 seeds alike', () => {
  const hexKey = loadProofKey(SEED);
  const base64Key = loadProofKey(Buffer.from(SEED, 'hex').toString('base64'));

  assert.equal(hexKey.publicKeyMultibase, base64Key.publicKeyMultibase);
  assert.ok(hexKey.publicKeyMultibase.startsWith('z'));
});

test('a malformed proof key is rejected', () => {
  assert.throws(() => loadProofKey('too-short'), /32-byte Ed25519 seed/);
});

// ── Serializer ───────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    vcBaseContext: VC_CONTEXT_V1,
    vcExtraContexts: [],
    vcBaseUrl: '',
    vcProofPrivateKey: '',
    vcProofVerificationMethod: '',
    ...overrides,
  };
}

test('the serializer signs when a proof key is configured', () => {
  const serializer = createVcSerializer(makeConfig({ vcProofPrivateKey: SEED }));
  const vc = serializer.serialize(SAMPLE);

  assert.equal(serializer.signingEnabled, true);
  assert.ok(vc.proof);
  assert.ok(vc['@context'].includes(DATA_INTEGRITY_CONTEXT));
});

test('the serializer emits unsigned credentials when no key is configured', () => {
  // Better an honestly unsigned credential — it is still anchored on-chain —
  // than one carrying a fabricated proof.
  const serializer = createVcSerializer(makeConfig());
  const vc = serializer.serialize(SAMPLE);

  assert.equal(serializer.signingEnabled, false);
  assert.equal(vc.proof, undefined);
  assert.ok(!vc['@context'].includes(DATA_INTEGRITY_CONTEXT));
});

test('an invalid proof key degrades to unsigned rather than throwing', () => {
  const logged = [];
  const serializer = createVcSerializer(
    makeConfig({ vcProofPrivateKey: 'nonsense' }),
    { logger: { error: (_fields, message) => logged.push(message) } },
  );

  assert.equal(serializer.signingEnabled, false);
  assert.equal(logged.length, 1);
  assert.doesNotThrow(() => serializer.serialize(SAMPLE));
});

test('the verification method defaults to the issuer DID', () => {
  const serializer = createVcSerializer(makeConfig({ vcProofPrivateKey: SEED }));
  const vc = serializer.serialize(SAMPLE);

  assert.equal(vc.proof.verificationMethod, `did:stellar:${SAMPLE.issuer}#key-1`);
});

test('a configured verification method overrides the default', () => {
  const serializer = createVcSerializer(
    makeConfig({ vcProofPrivateKey: SEED, vcProofVerificationMethod: 'https://example.org/keys/1' }),
  );

  assert.equal(serializer.serialize(SAMPLE).proof.verificationMethod, 'https://example.org/keys/1');
});

// ── Status ───────────────────────────────────────────────────────────────────

test('an active credential reports active', () => {
  const status = credentialStatus({ expiresAt: 1800000000, revoked: false }, 1700000000);

  assert.equal(status.status, 'active');
  assert.equal(status.revoked, false);
  assert.equal(status.expired, false);
});

test('a past expiry reports expired', () => {
  const status = credentialStatus({ expiresAt: 1600000000 }, 1700000000);

  assert.equal(status.status, 'expired');
  assert.equal(status.expired, true);
});

test('revocation takes precedence over expiry', () => {
  // A verifier needs to act on the revocation, which is the stronger fact.
  const status = credentialStatus({ expiresAt: 1600000000, revoked: true }, 1700000000);

  assert.equal(status.status, 'revoked');
  assert.equal(status.revoked, true);
  assert.equal(status.expired, true);
});

test('a credential without an expiry never expires', () => {
  const status = credentialStatus({ expiresAt: 0 }, 1700000000);

  assert.equal(status.status, 'active');
  assert.equal(status.expiresAt, null);
});

// ── Expansion and compaction ─────────────────────────────────────────────────

test('expansion replaces known terms with their IRIs', () => {
  const expanded = expandCredential(toVerifiableCredential(SAMPLE));

  assert.equal(expanded['@id'], 'urn:credential:cred-123');
  assert.ok(expanded['@type'].includes('https://www.w3.org/2018/credentials#VerifiableCredential'));
  assert.ok('https://www.w3.org/2018/credentials#issuer' in expanded);
});

test('expansion leaves unknown terms in place rather than dropping them', () => {
  const expanded = expandCredential({ customTerm: 'value' });
  assert.equal(expanded.customTerm, 'value');
});

test('compaction is the inverse of expansion', () => {
  const vc = toVerifiableCredential(SAMPLE);
  const round = compactCredential(expandCredential(vc));

  assert.equal(round.id, vc.id);
  assert.equal(round.issuer, vc.issuer);
  assert.deepEqual(round.type, vc.type);
  assert.equal(round.credentialSubject.id, vc.credentialSubject.id);
});

test('compaction restores the context', () => {
  const compacted = compactCredential(expandCredential(toVerifiableCredential(SAMPLE)));
  assert.equal(compacted['@context'], VC_CONTEXT_V1);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a generated credential validates', () => {
  assert.deepEqual(validateVerifiableCredential(toVerifiableCredential(SAMPLE)), {
    valid: true,
    errors: [],
  });
});

test('a signed credential validates', () => {
  const serializer = createVcSerializer(makeConfig({ vcProofPrivateKey: SEED }));
  const result = validateVerifiableCredential(serializer.serialize(SAMPLE));

  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('validation reports every problem at once', () => {
  const result = validateVerifiableCredential({});

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 1, 'expected more than one error');
});

test('validation rejects a context that does not begin with the VC context', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc['@context'] = ['https://example.org/vocab/v1', VC_CONTEXT_V1];

  const result = validateVerifiableCredential(vc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('First @context entry')));
});

test('validation requires the VerifiableCredential type', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc.type = ['KycCredential'];

  assert.ok(
    validateVerifiableCredential(vc).errors.some((e) => e.includes('VerifiableCredential')),
  );
});

test('validation requires the issuer to be a URI', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc.issuer = 'not-a-uri';

  assert.ok(validateVerifiableCredential(vc).errors.some((e) => e.includes('issuer must be a URI')));
});

test('validation accepts an issuer object carrying a URI id', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc.issuer = { id: 'did:stellar:GABC', name: 'Example Issuer' };

  assert.equal(validateVerifiableCredential(vc).valid, true);
});

test('validation rejects an empty credential subject', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc.credentialSubject = {};

  assert.ok(
    validateVerifiableCredential(vc).errors.some((e) => e.includes('at least one claim')),
  );
});

test('validation rejects a malformed issuance date', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc.issuanceDate = 'last tuesday';

  assert.ok(validateVerifiableCredential(vc).errors.some((e) => e.includes('dateTime')));
});

test('validation checks the v2 date property under a v2 context', () => {
  const vc = toVerifiableCredential(SAMPLE, { baseContext: VC_CONTEXT_V2 });
  delete vc.validFrom;

  assert.ok(validateVerifiableCredential(vc).errors.some((e) => e.includes('validFrom')));
});

test('validation requires a proof to name its purpose and method', () => {
  const vc = toVerifiableCredential(SAMPLE);
  vc.proof = { type: 'DataIntegrityProof' };

  const { errors } = validateVerifiableCredential(vc);
  assert.ok(errors.some((e) => e.includes('proofPurpose')));
  assert.ok(errors.some((e) => e.includes('verificationMethod')));
});

test('validation rejects a non-object', () => {
  assert.equal(validateVerifiableCredential(null).valid, false);
  assert.equal(validateVerifiableCredential([]).valid, false);
});

// ── HTTP wiring ──────────────────────────────────────────────────────────────

const mockSoroban = {
  getIssuers: async () => [],
  pingAllContracts: async () => ({}),
};

async function withServer(config, run) {
  const app = createApp({
    config,
    soroban: mockSoroban,
    metrics: { renderPrometheus: () => '' },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    return await run(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

function serverConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    adminApiKey: 'test-admin-key',
    adminActor: 'admin',
    corsAllowedOrigins: ['*'],
    maxBodyBytes: 64 * 1024,
    credentialStorePath: ':memory:',
    auditLogPath: ':memory:',
    cspEnabled: false,
    vcBaseContext: VC_CONTEXT_V1,
    vcExtraContexts: [],
    vcBaseUrl: '',
    vcProofPrivateKey: '',
    vcProofVerificationMethod: '',
    ...overrides,
  };
}

test('the JSON-LD form is opt-in, so existing clients are unaffected', async () => {
  await withServer(serverConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/credentials`);
    assert.ok(!String(response.headers.get('content-type')).includes('ld+json'));

    const payload = await response.json();
    assert.ok('items' in payload);
  });
});

test('Accept: application/ld+json returns the JSON-LD form', async () => {
  await withServer(serverConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/credentials`, {
      headers: { Accept: 'application/ld+json' },
    });

    assert.ok(String(response.headers.get('content-type')).includes('application/ld+json'));
  });
});

test('?format=jsonld works where an Accept header cannot be set', async () => {
  await withServer(serverConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/credentials?format=jsonld`);
    assert.ok(String(response.headers.get('content-type')).includes('application/ld+json'));
  });
});

test('an unknown credential status is a 404', async () => {
  await withServer(serverConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/credentials/does-not-exist/status`);
    assert.equal(response.status, 404);
  });
});
