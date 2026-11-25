import { StrKey } from '@stellar/stellar-sdk';
import { DID_RE, STELLAR_ACCOUNT_RE } from './validation.js';

export class DidValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'DidValidationError';
    this.details = details;
  }
}

/**
 * Accept a bare Stellar account or its `did:stellar:` form and return the
 * canonical account address used by the DID cache and Soroban resolver.
 */
export function validateDidInput(value, { field = 'did' } = {}) {
  const input = typeof value === 'string' ? value.trim() : '';
  const didMatch = DID_RE.exec(input);
  const address = didMatch?.[1] ?? (STELLAR_ACCOUNT_RE.test(input) ? input : undefined);
  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    const expected = 'Expected a valid Stellar account address or did:stellar:<STELLAR_ACCOUNT> identifier.';
    return {
      ok: false,
      message: `${field}: ${expected}`,
      details: [{ field, value, code: 'invalid_did' }],
    };
  }
  return { ok: true, address, did: `did:stellar:${address}` };
}
