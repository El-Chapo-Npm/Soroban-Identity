/**
 * W3C DID Core compliant resolver for the `did:stellar` method (#1359).
 *
 * `GET /did/:did` returns a DID Document (JSON-LD) containing a
 * `verificationMethod` derived from the controller's Stellar account key and
 * the `service` endpoints stored with the DID.
 *
 * The functions here are pure (no I/O) apart from `resolveDidDocument`, which
 * takes the lookup as an argument, so they can be tested without a network.
 *
 * Spec references:
 *   - DID Core:            https://www.w3.org/TR/did-core/
 *   - DID Resolution:      https://w3c-ccg.github.io/did-resolution/
 *   - Ed25519VerificationKey2020 / multibase: https://w3c.github.io/vc-di-eddsa/
 */

import { StrKey } from '@stellar/stellar-sdk';

export const DID_METHOD_PREFIX = 'did:stellar:';
export const DID_CONTEXT = 'https://www.w3.org/ns/did/v1';
export const ED25519_2020_CONTEXT = 'https://w3id.org/security/suites/ed25519-2020/v1';
export const DID_LD_JSON = 'application/did+ld+json';
export const DID_JSON = 'application/did+json';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// Multicodec prefix for an Ed25519 public key (0xed, varint-encoded as ed 01).
const ED25519_PUB_MULTICODEC = Uint8Array.from([0xed, 0x01]);

const FRAGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;
const MAX_SERVICES = 50;

/** Error carrying the DID Resolution error code and HTTP status. */
export class DidResolutionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'DidResolutionError';
    this.code = code;
    this.status = status;
  }
}

/** Base58btc (Bitcoin alphabet) encoding. */
export function base58btcEncode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // Treat the input as a big-endian number and repeatedly divide by 58.
  const digits = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/** Multibase (base58btc, prefix `z`) form of an Ed25519 public key. */
export function ed25519PublicKeyMultibase(rawKey) {
  const bytes = new Uint8Array(ED25519_PUB_MULTICODEC.length + rawKey.length);
  bytes.set(ED25519_PUB_MULTICODEC, 0);
  bytes.set(rawKey, ED25519_PUB_MULTICODEC.length);
  return `z${base58btcEncode(bytes)}`;
}

/**
 * Parse `did:stellar:G...` (or a bare `G...` account id) into its parts.
 *
 * @throws {DidResolutionError} `invalidDid` when the identifier is malformed.
 */
export function parseStellarDid(input) {
  const value = String(input ?? '').trim();
  const address = value.startsWith(DID_METHOD_PREFIX) ? value.slice(DID_METHOD_PREFIX.length) : value;

  if (value.startsWith('did:') && !value.startsWith(DID_METHOD_PREFIX)) {
    throw new DidResolutionError('methodNotSupported', 'Only the "stellar" DID method is supported.', 501);
  }
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new DidResolutionError('invalidDid', 'DID must be did:stellar: followed by a valid Stellar account id.', 400);
  }
  return { did: `${DID_METHOD_PREFIX}${address}`, address };
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Normalise stored service endpoints into DID Core `service` entries.
 * Entries that are malformed or use a non-https endpoint are dropped, so a
 * poisoned record cannot produce a document that violates the spec.
 */
export function buildServices(did, rawServices) {
  if (!Array.isArray(rawServices)) return [];
  const seen = new Set();
  const services = [];

  for (const raw of rawServices) {
    if (services.length >= MAX_SERVICES) break;
    if (!raw || typeof raw !== 'object') continue;

    const fragment = String(raw.id ?? '').replace(/^.*#/, '');
    const type = raw.type ?? raw.serviceType;
    const endpoint = raw.serviceEndpoint ?? raw.endpoint;
    if (!FRAGMENT_PATTERN.test(fragment) || typeof type !== 'string' || type === '') continue;
    if (!isHttpsUrl(endpoint)) continue;

    const id = `${did}#${fragment}`;
    if (seen.has(id)) continue; // ids must be unique within the document
    seen.add(id);
    services.push({ id, type, serviceEndpoint: endpoint });
  }
  return services;
}

/**
 * Build a DID Document from a stored DID record.
 *
 * A deactivated DID resolves to a minimal document with no keys or services,
 * as required by DID Core for deactivated identifiers.
 *
 * @param {string} didOrAddress
 * @param {object} record - stored record: `{ active, controller, services }`.
 * @returns {{ document: object, metadata: object }}
 */
export function buildDidDocument(didOrAddress, record = {}) {
  const { did, address } = parseStellarDid(didOrAddress);
  const metadata = {};
  if (record.createdAt != null) metadata.created = toIso(record.createdAt);
  if (record.updatedAt != null) metadata.updated = toIso(record.updatedAt);

  if (record.active === false) {
    metadata.deactivated = true;
    return { document: { '@context': [DID_CONTEXT], id: did }, metadata };
  }

  const keyId = `${did}#keys-1`;
  const document = {
    '@context': [DID_CONTEXT, ED25519_2020_CONTEXT],
    id: did,
    controller: controllerOf(record.controller, did),
    verificationMethod: [
      {
        id: keyId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: ed25519PublicKeyMultibase(StrKey.decodeEd25519PublicKey(address)),
      },
    ],
    authentication: [keyId],
    assertionMethod: [keyId],
    capabilityInvocation: [keyId],
  };

  const service = buildServices(did, record.services ?? record.metadata?.services);
  if (service.length > 0) document.service = service;
  return { document, metadata };
}

function controllerOf(controller, did) {
  if (typeof controller !== 'string' || controller === '') return did;
  try {
    return parseStellarDid(controller).did;
  } catch {
    return did; // never emit a controller we cannot vouch for
  }
}

function toIso(value) {
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Resolve a DID using `lookup(address)`, which returns the stored record or
 * null. Maps the outcome to a DID Resolution result with an HTTP status.
 *
 * @returns {Promise<{status: number, body: object, contentType: string}>}
 */
export async function resolveDidDocument(didOrAddress, lookup, { accept = '' } = {}) {
  const contentType = negotiateContentType(accept);
  if (!contentType) {
    return errorResult(406, 'representationNotSupported', 'Supported representations: application/did+ld+json, application/did+json.');
  }

  let parsed;
  try {
    parsed = parseStellarDid(didOrAddress);
  } catch (err) {
    if (err instanceof DidResolutionError) return errorResult(err.status, err.code, err.message);
    throw err;
  }

  const record = await lookup(parsed.address);
  if (!record) return errorResult(404, 'notFound', 'DID not found.');

  const { document, metadata } = buildDidDocument(parsed.did, record);
  const deactivated = metadata.deactivated === true;
  return {
    status: deactivated ? 410 : 200,
    contentType,
    body: document,
    resolutionMetadata: { contentType },
    documentMetadata: metadata,
  };
}

/** Pick the response media type from an Accept header; null if none acceptable. */
export function negotiateContentType(accept) {
  const header = String(accept ?? '').toLowerCase();
  if (header.trim() === '') return DID_LD_JSON;
  const wanted = header.split(',').map((part) => part.split(';')[0].trim());
  if (wanted.includes(DID_LD_JSON)) return DID_LD_JSON;
  if (wanted.includes(DID_JSON)) return DID_JSON;
  if (wanted.some((type) => type === '*/*' || type === 'application/*' || type === 'application/json' || type === 'application/ld+json')) {
    return DID_LD_JSON;
  }
  return null;
}

function errorResult(status, error, message) {
  return {
    status,
    contentType: 'application/json',
    body: { error, message },
  };
}
