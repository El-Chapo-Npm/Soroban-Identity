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
  };
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
