/**
 * W3C Verifiable Credentials in JSON-LD form (#753)
 *
 * The server stores credentials in a compact internal shape that is convenient
 * for this codebase and meaningless to anyone else. The W3C VC Data Model is
 * the interchange format: expressing a credential in it lets any conforming
 * wallet or verifier consume one of ours without bespoke code.
 *
 * Two representations exist side by side:
 *
 *   internal   { id, subject, issuer, type, claims, expiresAt, revoked }
 *   JSON-LD    { @context, id, type[], issuer, issuanceDate,
 *                credentialSubject, credentialStatus, proof }
 *
 * `toVerifiableCredential` maps one to the other. The internal shape stays the
 * storage format so existing callers are unaffected.
 *
 * ## Proofs
 *
 * Proofs use `DataIntegrityProof` with the `eddsa-jcs-2022` cryptosuite. That
 * suite canonicalizes with JCS (RFC 8785) rather than JSON-LD's URDNA2015,
 * which matters here: URDNA2015 requires a full JSON-LD processor and network
 * context resolution, while JCS is self-contained and deterministic. Both are
 * W3C-registered; this one is implementable correctly without a dependency,
 * and a wrong canonicalization is worse than none.
 *
 * A credential is signed only when a proof key is configured. Without one the
 * credential is emitted unsigned — it is still anchored on-chain, which is the
 * project's primary integrity mechanism — rather than carrying a fabricated
 * proof.
 */

import crypto from 'node:crypto';

import { canonicalize } from './jcs.js';

/** The VC Data Model v1.1 context. */
export const VC_CONTEXT_V1 = 'https://www.w3.org/2018/credentials/v1';

/** The VC Data Model v2.0 context. */
export const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

/** Data Integrity proofs are defined in this context. */
export const DATA_INTEGRITY_CONTEXT = 'https://w3id.org/security/data-integrity/v2';

/** Status entries issued by this server. */
export const CREDENTIAL_STATUS_TYPE = 'SorobanCredentialStatus2024';

/** The type every Verifiable Presentation carries. */
export const PRESENTATION_TYPE = 'VerifiablePresentation';

/** JWT proof format, per the VC Data Model's JWT encoding. */
export const PROOF_FORMAT_JWT = 'jwt_vp';

/** Linked Data proof format, i.e. an embedded `proof` node. */
export const PROOF_FORMAT_LDP = 'ldp_vp';

/** Cryptosuite used for proofs. */
export const CRYPTOSUITE = 'eddsa-jcs-2022';

/** Multicodec prefix for an Ed25519 public key, per the multicodec table. */
const ED25519_PUB_MULTICODEC = Uint8Array.from([0xed, 0x01]);

/**
 * DER prefix for a PKCS#8-wrapped Ed25519 private key.
 *
 * Node's crypto accepts DER, not the bare 32-byte seed that Ed25519
 * implementations usually hand out, so the seed is wrapped with this fixed
 * header. The bytes encode: SEQUENCE, version 0, AlgorithmIdentifier(1.3.101.112),
 * OCTET STRING containing an OCTET STRING of length 32.
 */
const PKCS8_ED25519_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes as base58btc.
 *
 * Multibase's `z` prefix denotes this encoding, and it is what the Data
 * Integrity specification uses for `proofValue` and for key material.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base58btcEncode(bytes) {
  if (bytes.length === 0) return '';

  // Leading zero bytes carry no value in the base conversion but are
  // significant, and are re-attached as '1' characters afterwards.
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  const digits = [0];
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/**
 * Accept an Ed25519 seed as hex or base64 and return the raw 32 bytes.
 *
 * @param {string} value
 * @returns {Buffer}
 */
function decodeSeed(value) {
  const trimmed = String(value).trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');

  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;

  throw new Error(
    'VC proof key must be a 32-byte Ed25519 seed, hex or base64 encoded',
  );
}

/**
 * Build the signing material from a configured seed.
 *
 * @param {string} seedValue
 * @returns {{privateKey: crypto.KeyObject, publicKeyMultibase: string}}
 */
export function loadProofKey(seedValue) {
  const seed = decodeSeed(seedValue);

  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });

  // The raw public key sits at the end of the SPKI DER encoding.
  const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const rawPublicKey = spki.subarray(spki.length - 32);

  const multicodecKey = Buffer.concat([ED25519_PUB_MULTICODEC, rawPublicKey]);

  return {
    privateKey,
    publicKeyMultibase: `z${base58btcEncode(multicodecKey)}`,
  };
}

/**
 * Turn a Stellar account or DID into a DID.
 *
 * The data model requires `issuer` and `credentialSubject.id` to be URIs; a
 * bare Stellar account is not one.
 *
 * @param {string|undefined} value
 * @returns {string|undefined}
 */
export function toDid(value) {
  if (!value) return undefined;
  return String(value).startsWith('did:') ? value : `did:stellar:${value}`;
}

/**
 * Build the `id` URI for a credential.
 *
 * @param {string} credentialId
 * @param {string} [baseUrl] - When set, credentials get a resolvable https id
 * @returns {string}
 */
export function credentialUri(credentialId, baseUrl) {
  if (!baseUrl) return `urn:credential:${credentialId}`;
  return `${String(baseUrl).replace(/\/$/, '')}/credentials/${encodeURIComponent(credentialId)}`;
}

/**
 * Determine a credential's current status.
 *
 * Revocation takes precedence over expiry: a credential that was revoked and
 * has since expired is still most usefully described as revoked, because that
 * is the fact a verifier needs to act on.
 *
 * @param {object} credential
 * @param {number} [nowSeconds]
 * @returns {{status: 'revoked'|'expired'|'active', revoked: boolean, expired: boolean, expiresAt: number|null}}
 */
export function credentialStatus(credential, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = Number(credential?.expiresAt ?? 0) || null;
  const expired = Boolean(expiresAt && expiresAt < nowSeconds);
  const revoked = Boolean(credential?.revoked);

  return {
    status: revoked ? 'revoked' : expired ? 'expired' : 'active',
    revoked,
    expired,
    expiresAt,
  };
}

/**
 * Assemble the `@context` array.
 *
 * The base context comes first, as the data model requires. Extra contexts —
 * from configuration or from the credential itself — follow, de-duplicated so
 * a context named in both places appears once.
 *
 * @param {object} options
 * @returns {string[]}
 */
export function buildContext({ baseContext = VC_CONTEXT_V1, extraContexts = [], signed = false } = {}) {
  const contexts = [baseContext];

  // v2 defines Data Integrity terms itself; v1 needs the separate context or
  // the proof's terms are undefined.
  if (signed && baseContext === VC_CONTEXT_V1) contexts.push(DATA_INTEGRITY_CONTEXT);

  for (const context of extraContexts) {
    if (context && !contexts.includes(context)) contexts.push(context);
  }

  return contexts;
}

/**
 * Convert an internal credential record to a W3C Verifiable Credential.
 *
 * @param {object} credential - Internal record
 * @param {object} [options]
 * @param {string} [options.baseUrl]        - Makes ids and status resolvable
 * @param {string} [options.baseContext]    - VC_CONTEXT_V1 (default) or V2
 * @param {string[]} [options.extraContexts]
 * @param {number} [options.nowSeconds]
 * @returns {object} The credential in JSON-LD form, without a proof
 */
export function toVerifiableCredential(credential, options = {}) {
  const {
    baseUrl,
    baseContext = VC_CONTEXT_V1,
    extraContexts = [],
    nowSeconds = Math.floor(Date.now() / 1000),
  } = options;

  const isV2 = baseContext === VC_CONTEXT_V2;

  // A credential may declare its own extra contexts; they are additive to the
  // configured ones so a deployment-wide vocabulary and a per-credential one
  // can coexist.
  const credentialContexts = Array.isArray(credential?.metadata?.['@context'])
    ? credential.metadata['@context']
    : [];

  const types = ['VerifiableCredential'];
  if (credential?.type && credential.type !== 'VerifiableCredential') {
    types.push(credential.type);
  }

  const subjectDid = toDid(credential?.subject);
  const issuedAtSeconds = Number(credential?.issuedAt ?? 0) || nowSeconds;

  const vc = {
    '@context': buildContext({ baseContext, extraContexts: [...extraContexts, ...credentialContexts] }),
    id: credentialUri(credential?.id, baseUrl),
    type: types,
    issuer: toDid(credential?.issuer) ?? 'did:stellar:unknown',
    credentialSubject: {
      ...(subjectDid ? { id: subjectDid } : {}),
      ...(credential?.claims ?? {}),
    },
  };

  // v2 renamed the date properties; emitting the wrong pair for the declared
  // context makes the credential invalid against its own schema.
  const issuedIso = new Date(issuedAtSeconds * 1000).toISOString();
  if (isV2) vc.validFrom = issuedIso;
  else vc.issuanceDate = issuedIso;

  const expiresAt = Number(credential?.expiresAt ?? 0) || null;
  if (expiresAt) {
    const expiresIso = new Date(expiresAt * 1000).toISOString();
    if (isV2) vc.validUntil = expiresIso;
    else vc.expirationDate = expiresIso;
  }

  // A verifier must be able to check revocation without trusting the copy of
  // the credential it was handed, so the status entry points back at us.
  vc.credentialStatus = {
    id: `${credentialUri(credential?.id, baseUrl)}/status`,
    type: CREDENTIAL_STATUS_TYPE,
  };

  return vc;
}

/**
 * Build the `id` URI for a presentation.
 *
 * @param {string} presentationId
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function presentationUri(presentationId, baseUrl) {
  if (!baseUrl) return `urn:presentation:${presentationId}`;
  return `${String(baseUrl).replace(/\/$/, '')}/presentations/${encodeURIComponent(presentationId)}`;
}

/**
 * Normalize a credential reference into a full credential object.
 *
 * A presentation may carry credentials inline or by reference. References are
 * kept as `{ id }` subjects so the document stays valid JSON-LD; resolving
 * them is the verifier's job, since only it knows where to fetch from.
 *
 * @param {object|string} credential
 * @returns {object}
 */
function normalizePresentedCredential(credential) {
  if (typeof credential === 'string') return { id: credential };
  return credential;
}

/**
 * Assemble a W3C Verifiable Presentation.
 *
 * @param {object} presentation
 * @param {object[]|string[]} [presentation.verifiableCredential]
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {string} [options.holder]        - Holder account or DID
 * @param {string} [options.challenge]     - Verifier-supplied nonce
 * @param {string} [options.domain]        - Verifier-supplied domain
 * @param {string} [options.baseUrl]
 * @param {string} [options.baseContext]
 * @param {string[]} [options.extraContexts]
 * @param {number} [options.expiresAt]     - Seconds since epoch
 * @param {number} [options.nowSeconds]
 * @returns {object} The presentation in JSON-LD form, without a proof
 */
export function toVerifiablePresentation(presentation = {}, options = {}) {
  const {
    id,
    holder,
    challenge,
    domain,
    baseUrl,
    baseContext = VC_CONTEXT_V1,
    extraContexts = [],
    expiresAt,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = options;

  const isV2 = baseContext === VC_CONTEXT_V2;

  const credentials = Array.isArray(presentation?.verifiableCredential)
    ? presentation.verifiableCredential.map(normalizePresentedCredential)
    : [];

  const vp = {
    '@context': buildContext({ baseContext, extraContexts }),
    type: [PRESENTATION_TYPE],
  };

  if (id) vp.id = presentationUri(id, baseUrl);

  const holderDid = toDid(holder ?? presentation?.holder);
  if (holderDid) vp.holder = holderDid;

  // The challenge and domain bind the presentation to one exchange; a
  // verifier rejects a presentation replayed against a different one.
  if (challenge) vp.challenge = String(challenge);
  if (domain) vp.domain = String(domain);

  vp.verifiableCredential = credentials;

  const expiry = Number(expiresAt ?? presentation?.expiresAt ?? 0) || null;
  if (expiry) {
    const expiresIso = new Date(expiry * 1000).toISOString();
    if (isV2) vp.validUntil = expiresIso;
    else vp.expirationDate = expiresIso;
  }

  // Presentations are not issued, but v2 requires a validity start; v1 has no
  // equivalent property, so nothing is emitted there.
  if (isV2) vp.validFrom = new Date(nowSeconds * 1000).toISOString();

  return vp;
}

/**
 * Selectively disclose claims from a credential inside a presentation.
 *
 * Returns a copy of the credential whose `credentialSubject` retains only the
 * named claims. The original proof no longer covers the reduced document, so
 * it is dropped: a selective disclosure is only verifiable if the holder
 * re-signs it, or if the credential was issued with a scheme (such as BBS+)
 * that supports derived proofs. Dropping a stale proof is the honest option —
 * leaving it would make an unverifiable document look signed.
 *
 * @param {object} credential
 * @param {string[]} claims - Claim names to keep
 * @returns {object}
 */
export function selectivelyDisclose(credential, claims) {
  if (!credential || typeof credential !== 'object') {
    throw new Error('Credential must be an object');
  }

  const keep = new Set(Array.isArray(claims) ? claims : []);
  const { proof: _proof, ...rest } = credential;

  const subject = credential.credentialSubject;
  const subjects = Array.isArray(subject) ? subject : [subject];

  const disclosedSubjects = subjects.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const disclosed = {};
    for (const [key, value] of Object.entries(entry)) {
      // `id` identifies the subject rather than describing it, so it is not a
      // disclosable claim and is always retained.
      if (key === 'id' || keep.has(key)) disclosed[key] = value;
    }
    return disclosed;
  });

  return {
    ...rest,
    credentialSubject: Array.isArray(subject) ? disclosedSubjects : disclosedSubjects[0],
  };
}

/**
 * Attach a Data Integrity proof.
 *
 * Follows `eddsa-jcs-2022`: the proof options and the document are each
 * canonicalized and hashed, the two digests are concatenated, and that is what
 * gets signed. Hashing them separately is what binds the proof's own metadata
 * — its purpose, its verification method — to the document, so neither can be
 * swapped after the fact.
 *
 * @param {object} document - Credential without a proof
 * @param {object} options
 * @param {crypto.KeyObject} options.privateKey
 * @param {string} options.verificationMethod
 * @param {string} [options.proofPurpose]
 * @param {Date}   [options.created]
 * @returns {object} The document with `proof` attached
 */
export function attachProof(document, { privateKey, verificationMethod, proofPurpose = 'assertionMethod', created = new Date() }) {
  const proofOptions = {
    type: 'DataIntegrityProof',
    cryptosuite: CRYPTOSUITE,
    created: created.toISOString(),
    verificationMethod,
    proofPurpose,
  };

  // The proof itself is never part of the signed document.
  const { proof: _existing, ...unsigned } = document;

  const proofDigest = crypto.createHash('sha256').update(canonicalize(proofOptions)).digest();
  const documentDigest = crypto.createHash('sha256').update(canonicalize(unsigned)).digest();

  const signature = crypto.sign(
    null,
    Buffer.concat([proofDigest, documentDigest]),
    privateKey,
  );

  return {
    ...unsigned,
    proof: { ...proofOptions, proofValue: `z${base58btcEncode(signature)}` },
  };
}

/**
 * Verify a Data Integrity proof.
 *
 * @param {object} document - Credential including its proof
 * @param {crypto.KeyObject} publicKey
 * @returns {boolean}
 */
export function verifyProof(document, publicKey) {
  const { proof, ...unsigned } = document ?? {};
  if (!proof?.proofValue || proof.cryptosuite !== CRYPTOSUITE) return false;

  const { proofValue, ...proofOptions } = proof;

  let signature;
  try {
    signature = base58btcDecode(proofValue.slice(1));
  } catch {
    return false;
  }

  const proofDigest = crypto.createHash('sha256').update(canonicalize(proofOptions)).digest();
  const documentDigest = crypto.createHash('sha256').update(canonicalize(unsigned)).digest();

  try {
    return crypto.verify(
      null,
      Buffer.concat([proofDigest, documentDigest]),
      publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * Encode a presentation as a JWT (`jwt_vp`).
 *
 * The payload is the presentation with `iss`, `nbf`, `exp`, `jti`, `aud` and
 * `nonce` standing in for the JSON-LD equivalents, per the JWT encoding rules.
 * The signature is EdDSA over the base64url header and payload.
 *
 * @param {object} presentation - Presentation without a proof
 * @param {object} options
 * @param {crypto.KeyObject} options.privateKey
 * @param {string} [options.issuer]     - Defaults to the presentation's holder
 * @param {string} [options.audience]   - Defaults to the presentation's domain
 * @param {string} [options.nonce]      - Defaults to the presentation's challenge
 * @param {number} [options.nowSeconds]
 * @returns {string} The compact JWT
 */
export function presentationToJwt(presentation, { privateKey, issuer, audience, nonce, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!privateKey) throw new Error('A private key is required to sign a presentation JWT');

  const { proof: _proof, ...unsigned } = presentation ?? {};

  const header = { alg: 'EdDSA', typ: 'JWT' };

  const payload = { ...unsigned };
  const iss = issuer ?? unsigned.holder;
  if (iss) payload.iss = iss;
  if (unsigned.id) payload.jti = unsigned.id;
  payload.nbf = nowSeconds;

  const expiry = unsigned.expirationDate ?? unsigned.validUntil;
  if (expiry) payload.exp = Math.floor(Date.parse(expiry) / 1000);

  const aud = audience ?? unsigned.domain;
  if (aud) payload.aud = aud;

  const challenge = nonce ?? unsigned.challenge;
  if (challenge) payload.nonce = challenge;

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * Decode a presentation JWT without verifying it.
 *
 * @param {string} jwt
 * @returns {{header: object, payload: object, signature: Buffer, signingInput: string}}
 */
export function decodePresentationJwt(jwt) {
  const parts = String(jwt ?? '').split('.');
  if (parts.length !== 3) throw new Error('Presentation JWT must have three parts');

  const [headerPart, payloadPart, signaturePart] = parts;

  return {
    header: JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')),
    signature: Buffer.from(signaturePart, 'base64url'),
    signingInput: `${headerPart}.${payloadPart}`,
  };
}

/**
 * Verify a presentation JWT and return the presentation it carries.
 *
 * @param {string} jwt
 * @param {object} options
 * @param {crypto.KeyObject} options.publicKey
 * @param {string} [options.expectedChallenge]
 * @param {string} [options.expectedDomain]
 * @param {number} [options.nowSeconds]
 * @returns {{valid: boolean, errors: string[], presentation: object|null}}
 */
export function verifyPresentationJwt(jwt, { publicKey, expectedChallenge, expectedDomain, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const errors = [];
  let decoded;

  try {
    decoded = decodePresentationJwt(jwt);
  } catch (error) {
    return { valid: false, errors: [error.message], presentation: null };
  }

  if (decoded.header.alg !== 'EdDSA') {
    errors.push(`Unsupported JWT alg: ${decoded.header.alg}`);
  }

  if (publicKey) {
    let signatureValid = false;
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(decoded.signingInput),
        publicKey,
        decoded.signature,
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) errors.push('Invalid JWT signature');
  }

  const { iss, jti, nbf, exp, aud, nonce, ...rest } = decoded.payload;

  if (exp && Number(exp) < nowSeconds) errors.push('Presentation JWT has expired');
  if (nbf && Number(nbf) > nowSeconds) errors.push('Presentation JWT is not yet valid');

  if (expectedChallenge && nonce !== expectedChallenge) {
    errors.push('Presentation challenge does not match');
  }
  if (expectedDomain && aud !== expectedDomain) {
    errors.push('Presentation domain does not match');
  }

  const presentation = { ...rest };
  if (iss) presentation.holder = iss;
  if (jti) presentation.id = jti;
  if (nonce) presentation.challenge = nonce;
  if (aud) presentation.domain = aud;
  if (exp) presentation.expirationDate = new Date(Number(exp) * 1000).toISOString();

  return { valid: errors.length === 0, errors, presentation };
}

/**
 * Decode a base58btc string.
 *
 * @param {string} value
 * @returns {Buffer}
 */
export function base58btcDecode(value) {
  let leadingOnes = 0;
  while (leadingOnes < value.length && value[leadingOnes] === '1') leadingOnes++;

  const bytes = [0];
  for (let i = leadingOnes; i < value.length; i++) {
    const digit = BASE58_ALPHABET.indexOf(value[i]);
    if (digit === -1) throw new Error(`Invalid base58 character: ${value[i]}`);

    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  return Buffer.concat([Buffer.alloc(leadingOnes), Buffer.from(bytes.reverse())]);
}

/**
 * Terms defined by the VC context that this server emits, mapped to the IRIs
 * they expand to.
 *
 * This is a fixed table rather than a fetched context document: the server
 * emits a known, closed set of terms, and resolving contexts over the network
 * at request time would make credential serialization depend on an external
 * host being reachable.
 */
const TERM_IRIS = {
  id: '@id',
  type: '@type',
  VerifiableCredential: 'https://www.w3.org/2018/credentials#VerifiableCredential',
  issuer: 'https://www.w3.org/2018/credentials#issuer',
  issuanceDate: 'https://www.w3.org/2018/credentials#issuanceDate',
  expirationDate: 'https://www.w3.org/2018/credentials#expirationDate',
  validFrom: 'https://www.w3.org/ns/credentials#validFrom',
  validUntil: 'https://www.w3.org/ns/credentials#validUntil',
  credentialSubject: 'https://www.w3.org/2018/credentials#credentialSubject',
  credentialStatus: 'https://www.w3.org/2018/credentials#credentialStatus',
  proof: 'https://w3id.org/security#proof',
};

/**
 * Expand a credential to IRI-keyed form.
 *
 * This is a deliberately narrow expansion covering the terms this server
 * emits, not a general JSON-LD processor: it does not fetch remote contexts,
 * and terms it does not know are left under their original key so nothing is
 * silently dropped. It is enough to compare two credentials for semantic
 * equality regardless of which context aliases they were written with, which
 * is what expansion is for here.
 *
 * @param {object} credential
 * @returns {object}
 */
export function expandCredential(credential) {
  const expanded = {};

  for (const [key, value] of Object.entries(credential ?? {})) {
    if (key === '@context') continue;

    const iri = TERM_IRIS[key] ?? key;

    if (key === 'type') {
      const types = Array.isArray(value) ? value : [value];
      expanded['@type'] = types.map((t) => TERM_IRIS[t] ?? t);
      continue;
    }

    if (key === 'id') {
      expanded['@id'] = value;
      continue;
    }

    expanded[iri] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? expandCredential(value)
        : value;
  }

  return expanded;
}

/**
 * Compact an expanded credential back to term-keyed form.
 *
 * The inverse of `expandCredential`, and subject to the same narrow scope.
 *
 * @param {object} expanded
 * @param {string|string[]} [context]
 * @returns {object}
 */
export function compactCredential(expanded, context = VC_CONTEXT_V1) {
  const iriToTerm = new Map(Object.entries(TERM_IRIS).map(([term, iri]) => [iri, term]));

  function compactValue(node) {
    const compacted = {};

    for (const [key, value] of Object.entries(node ?? {})) {
      if (key === '@id') {
        compacted.id = value;
        continue;
      }

      if (key === '@type') {
        const types = (Array.isArray(value) ? value : [value]).map(
          (iri) => iriToTerm.get(iri) ?? iri,
        );
        compacted.type = types.length === 1 ? types[0] : types;
        continue;
      }

      const term = iriToTerm.get(key) ?? key;
      compacted[term] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? compactValue(value)
          : value;
    }

    return compacted;
  }

  return { '@context': context, ...compactValue(expanded) };
}

/**
 * Bind configuration to the serialization functions above.
 *
 * The proof key is parsed once at construction rather than per request, so a
 * malformed key surfaces at startup instead of on the first credential
 * anybody asks for.
 *
 * @param {object} config
 * @returns {{signingEnabled: boolean, serialize: Function, status: Function}}
 */
export function createVcSerializer(config, { logger = null } = {}) {
  let proofKey = null;

  if (config?.vcProofPrivateKey) {
    try {
      proofKey = loadProofKey(config.vcProofPrivateKey);
    } catch (error) {
      // Emitting unsigned credentials is a degraded but honest mode; refusing
      // to start would take out an otherwise healthy deployment over an
      // optional feature.
      logger?.error(
        { error: error.message },
        'VC_PROOF_PRIVATE_KEY is invalid; credentials will be emitted unsigned',
      );
    }
  }

  return {
    signingEnabled: Boolean(proofKey),

    /** Expose the public key so a verifier can be pointed at it. */
    publicKeyMultibase: proofKey?.publicKeyMultibase ?? null,

    /**
     * Serialize an internal credential record as a Verifiable Credential,
     * signing it when a proof key is configured.
     *
     * @param {object} credential
     * @param {object} [options] - Overrides passed to toVerifiableCredential
     * @returns {object}
     */
    serialize(credential, options = {}) {
      const vc = toVerifiableCredential(credential, {
        baseUrl: config.vcBaseUrl || undefined,
        baseContext: config.vcBaseContext,
        extraContexts: config.vcExtraContexts ?? [],
        ...options,
      });

      if (!proofKey) return vc;

      const verificationMethod =
        config.vcProofVerificationMethod || `${vc.issuer}#key-1`;

      // The proof's terms must be defined, so the context gains the Data
      // Integrity entry only once there is actually a proof to describe.
      const signed = attachProof(
        {
          ...vc,
          '@context': buildContext({
            baseContext: config.vcBaseContext,
            extraContexts: [
              ...(config.vcExtraContexts ?? []),
              ...(options.extraContexts ?? []),
            ],
            signed: true,
          }),
        },
        { privateKey: proofKey.privateKey, verificationMethod },
      );

      return signed;
    },

    /** @see credentialStatus */
    status: credentialStatus,

    /**
     * Serialize a presentation, signing it with the configured proof key when
     * one is available.
     *
     * @param {object} presentation
     * @param {object} [options]
     * @param {string} [options.proofFormat] - PROOF_FORMAT_LDP (default) or PROOF_FORMAT_JWT
     * @returns {object|string}
     */
    serializePresentation(presentation, options = {}) {
      const { proofFormat = PROOF_FORMAT_LDP, ...rest } = options;

      const vp = toVerifiablePresentation(presentation, {
        baseUrl: config.vcBaseUrl || undefined,
        baseContext: config.vcBaseContext,
        extraContexts: config.vcExtraContexts ?? [],
        ...rest,
      });

      if (!proofKey) return vp;

      const verificationMethod =
        config.vcProofVerificationMethod || `${vp.holder ?? 'did:stellar:unknown'}#key-1`;

      if (proofFormat === PROOF_FORMAT_JWT) {
        return presentationToJwt(vp, {
          privateKey: proofKey.privateKey,
          issuer: vp.holder,
          audience: vp.domain,
          nonce: vp.challenge,
        });
      }

      return attachProof(
        {
          ...vp,
          '@context': buildContext({
            baseContext: config.vcBaseContext,
            extraContexts: [
              ...(config.vcExtraContexts ?? []),
              ...(options.extraContexts ?? []),
            ],
            signed: true,
          }),
        },
        { privateKey: proofKey.privateKey, verificationMethod, proofPurpose: 'authentication' },
      );
    },
  };
}

/**
 * Check a presentation against the structural requirements of the VC Data Model.
 *
 * @param {object} presentation
 * @param {object} [options]
 * @param {string} [options.expectedChallenge]
 * @param {string} [options.expectedDomain]
 * @param {number} [options.nowSeconds]
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateVerifiablePresentation(presentation, { expectedChallenge, expectedDomain, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const errors = [];

  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
    return { valid: false, errors: ['Presentation must be a JSON object'] };
  }

  const contexts = presentation['@context'];
  if (!contexts) {
    errors.push('Missing @context');
  } else {
    const list = Array.isArray(contexts) ? contexts : [contexts];
    if (list[0] !== VC_CONTEXT_V1 && list[0] !== VC_CONTEXT_V2) {
      errors.push(`First @context entry must be ${VC_CONTEXT_V1} or ${VC_CONTEXT_V2}`);
    }
  }

  const types = presentation.type
    ? Array.isArray(presentation.type)
      ? presentation.type
      : [presentation.type]
    : [];
  if (!types.includes(PRESENTATION_TYPE)) {
    errors.push(`type must include '${PRESENTATION_TYPE}'`);
  }

  const credentials = presentation.verifiableCredential;
  if (credentials !== undefined) {
    if (!Array.isArray(credentials)) {
      errors.push('verifiableCredential must be an array');
    } else {
      for (const entry of credentials) {
        if (typeof entry === 'string') continue;
        if (!entry || typeof entry !== 'object') {
          errors.push('Each verifiableCredential must be an object or a URI string');
          continue;
        }
        const result = validateVerifiableCredential(entry);
        if (!result.valid) {
          errors.push(...result.errors.map((e) => `verifiableCredential: ${e}`));
        }
      }
    }
  }

  const expiry = presentation.expirationDate ?? presentation.validUntil;
  if (expiry) {
    if (Number.isNaN(Date.parse(expiry))) {
      errors.push('expirationDate must be an XMLSchema dateTime');
    } else if (Math.floor(Date.parse(expiry) / 1000) < nowSeconds) {
      errors.push('Presentation has expired');
    }
  }

  if (expectedChallenge && presentation.challenge !== expectedChallenge) {
    errors.push('Presentation challenge does not match');
  }
  if (expectedDomain && presentation.domain !== expectedDomain) {
    errors.push('Presentation domain does not match');
  }

  if (presentation.proof) {
    const proofs = Array.isArray(presentation.proof) ? presentation.proof : [presentation.proof];
    for (const proof of proofs) {
      if (!proof?.type) errors.push('proof must have a type');
      if (!proof?.proofPurpose) errors.push('proof must have a proofPurpose');
      if (!proof?.verificationMethod) errors.push('proof must have a verificationMethod');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verify a presentation end to end.
 *
 * Structural validation, the embedded proof (if any), and the challenge and
 * domain bindings are all checked; every failure is reported rather than the
 * first.
 *
 * @param {object} presentation
 * @param {object} options
 * @param {crypto.KeyObject} [options.publicKey] - Holder's key, for the proof
 * @param {string} [options.expectedChallenge]
 * @param {string} [options.expectedDomain]
 * @param {number} [options.nowSeconds]
 * @returns {{valid: boolean, errors: string[]}}
 */
export function verifyPresentation(presentation, { publicKey, expectedChallenge, expectedDomain, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const { valid, errors } = validateVerifiablePresentation(presentation, {
    expectedChallenge,
    expectedDomain,
    nowSeconds,
  });

  const collected = [...errors];

  if (presentation?.proof) {
    if (!publicKey) {
      collected.push('A public key is required to verify the presentation proof');
    } else if (!verifyProof(presentation, publicKey)) {
      collected.push('Invalid presentation proof');
    }
  }

  return { valid: collected.length === 0, errors: collected };
}

/**
 * Build a presentation from a template.
 *
 * Templates are plain objects with the presentation's fixed fields — context,
 * holder, extra types — plus an optional `requiredClaims` map keyed by
 * credential type, listing the claims each presented credential must expose.
 * The template is applied to the supplied credentials, and any credential
 * missing a required claim is rejected rather than silently included.
 *
 * @param {object} template
 * @param {object[]} credentials - Credentials to include
 * @param {object} [options]     - Passed through to toVerifiablePresentation
 * @returns {object}
 */
export function presentationFromTemplate(template, credentials, options = {}) {
  if (!template || typeof template !== 'object') {
    throw new Error('Presentation template must be an object');
  }

  const requiredClaims = template.requiredClaims ?? {};
  const included = [];

  for (const credential of credentials ?? []) {
    const types = Array.isArray(credential?.type) ? credential.type : [credential?.type];
    const required = types.map((t) => requiredClaims[t]).find(Boolean);

    if (required) {
      const subject = Array.isArray(credential.credentialSubject)
        ? credential.credentialSubject[0]
        : credential.credentialSubject;
      const missing = required.filter((claim) => !(claim in (subject ?? {})));
      if (missing.length > 0) {
        throw new Error(
          `Credential ${credential?.id ?? '(anonymous)'} is missing required claims: ${missing.join(', ')}`,
        );
      }
    }

    included.push(credential);
  }

  const presentation = toVerifiablePresentation(
    { verifiableCredential: included },
    {
      holder: template.holder,
      challenge: template.challenge,
      domain: template.domain,
      baseContext: template.baseContext,
      extraContexts: template.extraContexts,
      expiresAt: template.expiresAt,
      ...options,
    },
  );

  const extraTypes = Array.isArray(template.type) ? template.type : [];
  for (const type of extraTypes) {
    if (type !== PRESENTATION_TYPE && !presentation.type.includes(type)) {
      presentation.type.push(type);
    }
  }

  return presentation;
}

/**
 * Check a credential against the structural requirements of the VC Data Model.
 *
 * Returns every problem rather than the first, so a caller fixing a
 * hand-written credential sees the whole list in one pass.
 *
 * @param {object} credential
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateVerifiableCredential(credential) {
  const errors = [];

  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
    return { valid: false, errors: ['Credential must be a JSON object'] };
  }

  const contexts = credential['@context'];
  if (!contexts) {
    errors.push('Missing @context');
  } else {
    const list = Array.isArray(contexts) ? contexts : [contexts];
    if (list[0] !== VC_CONTEXT_V1 && list[0] !== VC_CONTEXT_V2) {
      // Order is normative: the base context must come first, or the terms
      // that follow may be redefined by whatever precedes it.
      errors.push(`First @context entry must be ${VC_CONTEXT_V1} or ${VC_CONTEXT_V2}`);
    }
  }

  const types = credential.type
    ? Array.isArray(credential.type)
      ? credential.type
      : [credential.type]
    : [];
  if (!types.includes('VerifiableCredential')) {
    errors.push("type must include 'VerifiableCredential'");
  }

  if (!credential.issuer) {
    errors.push('Missing issuer');
  } else {
    const issuerId = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
    if (!issuerId || !/^[a-z][a-z0-9+.-]*:/i.test(issuerId)) {
      errors.push('issuer must be a URI, or an object with a URI id');
    }
  }

  const isV2 = Array.isArray(contexts) ? contexts.includes(VC_CONTEXT_V2) : contexts === VC_CONTEXT_V2;
  const dateProperty = isV2 ? 'validFrom' : 'issuanceDate';
  if (!credential[dateProperty]) {
    errors.push(`Missing ${dateProperty}`);
  } else if (Number.isNaN(Date.parse(credential[dateProperty]))) {
    errors.push(`${dateProperty} must be an XMLSchema dateTime`);
  }

  const subject = credential.credentialSubject;
  if (!subject) {
    errors.push('Missing credentialSubject');
  } else {
    const subjects = Array.isArray(subject) ? subject : [subject];
    if (subjects.length === 0) errors.push('credentialSubject must not be empty');
    for (const entry of subjects) {
      if (!entry || typeof entry !== 'object') {
        errors.push('Each credentialSubject must be an object');
      } else if (Object.keys(entry).length === 0) {
        errors.push('Each credentialSubject must contain at least one claim');
      }
    }
  }

  if (credential.proof) {
    const proofs = Array.isArray(credential.proof) ? credential.proof : [credential.proof];
    for (const proof of proofs) {
      if (!proof?.type) errors.push('proof must have a type');
      if (!proof?.proofPurpose) errors.push('proof must have a proofPurpose');
      if (!proof?.verificationMethod) errors.push('proof must have a verificationMethod');
    }
  }

  return { valid: errors.length === 0, errors };
}
