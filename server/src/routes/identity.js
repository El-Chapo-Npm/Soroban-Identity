import {
  readJson,
  requireAuth,
  sendJson,
  validateContentType,
} from '../http-utils.js';
import { validateDid, validateAttestationId, validateSignedXdr } from '../validation.js';
import { buildFeeBumpXdr, FeeBumpError, inspectSorobanInvocation } from '../fee-bump.js';
import { scValToNative } from '@stellar/stellar-sdk';

const MAX_BATCH_ATTESTATIONS = 50;

function handledJson(res, status, body) {
  sendJson(res, status, body);
  return true;
}

function errorResponse(res, status, code, message) {
  return handledJson(res, status, { error: code.toLowerCase(), code, message });
}

function batchLength(scVal) {
  const type = typeof scVal?.switch === 'function' ? scVal.switch().name : scVal?.type;
  if (type !== 'scvVec') return null;
  const items = typeof scVal.vec === 'function' ? scVal.vec() : scVal.vec;
  return Array.isArray(items) ? items.length : null;
}

function accountFromDid(value) {
  return String(value ?? '').replace(/^did:stellar:/, '');
}

function normalizeId(value) {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('hex');
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return Buffer.from(value).toString('hex');
  }
  return String(value ?? '').replace(/^0x/i, '').toLowerCase();
}

function invocationArgument(value) {
  try {
    return value && typeof value === 'object' ? scValToNative(value) : value;
  } catch {
    return undefined;
  }
}

function mergeAttestations(onChain, indexed) {
  const indexedById = new Map((indexed ?? []).map((item) => [normalizeId(item.id), item]));
  return (onChain ?? [])
    .filter((item) => item && item.status !== 'revoked' && item.revoked !== true)
    .map((item) => ({ ...(indexedById.get(normalizeId(item.id)) ?? {}), ...item }));
}

async function listAttestations(soroban, account, did) {
  const readIndexed = async () => {
    const { listAttestationsForDid } = await import('../storage.js');
    return listAttestationsForDid(did);
  };
  if (typeof soroban?.getAttestationsForAccount !== 'function') return readIndexed();
  try {
    const onChain = await soroban.getAttestationsForAccount(account);
    let indexed = [];
    try { indexed = await readIndexed(); } catch {}
    return mergeAttestations(onChain, indexed);
  } catch {
    // The local index is only an availability fallback for RPC outages or
    // deployments predating the contract list method.
    try { return await readIndexed(); } catch { return []; }
  }
}

async function getAttestation(soroban, id) {
  if (typeof soroban?.getAttestationById === 'function') {
    try {
      const record = await soroban.getAttestationById(id);
      if (record) return record;
    } catch {
      // Older deployments and RPC outages can still use the legacy index.
    }
  }
  const { getAttestationById } = await import('../storage.js');
  return getAttestationById(id);
}

function sameAccount(left, right) {
  return accountFromDid(left).toUpperCase() === accountFromDid(right).toUpperCase();
}

async function readBody(req, res, config) {
  if (validateContentType(req, res)) return null;
  try {
    const body = await readJson(req, config);
    if (body.__payloadTooLarge) {
      errorResponse(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit.');
      return null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      errorResponse(res, 400, 'INVALID_BODY', 'Request body must be a JSON object.');
      return null;
    }
    return body;
  } catch {
    errorResponse(res, 400, 'INVALID_JSON', 'Request body must contain valid JSON.');
    return null;
  }
}

function validateSignedTransaction(signedXdr, config, { contract, methods }) {
  const validated = validateSignedXdr(signedXdr);
  if (!validated.ok) return { error: validated.error };
  try {
    const invocation = inspectSorobanInvocation(validated.signedXdr, config.sorobanNetworkPassphrase);
    if (contract && invocation.contractId !== contract) {
      return { error: { error: 'contract_not_allowed', code: 'CONTRACT_NOT_ALLOWED', message: 'The transaction targets a contract not configured for this operation.' } };
    }
    if (methods && !methods.includes(invocation.functionName)) {
      return { error: { error: 'unsupported_contract_method', code: 'UNSUPPORTED_CONTRACT_METHOD', message: 'The transaction invokes a method not supported by this endpoint.' } };
    }
    return { signedXdr: validated.signedXdr, invocation };
  } catch (error) {
    const isFeeBumpError = error instanceof FeeBumpError;
    return { error: { error: isFeeBumpError ? error.code.toLowerCase() : 'invalid_xdr', code: isFeeBumpError ? error.code : 'INVALID_XDR', message: error.message } };
  }
}

/**
 * REST routes for identity and attestation operations. All writes submit a
 * user-signed XDR; the server never substitutes its own issuer signature.
 */
export function createIdentityRouter({ config, soroban, logger = console, realtime = null }) {
  return async function identityRouter(req, res, { pathname }) {
    const path = String(pathname ?? '').replace(/^\/v\d+(?=\/)/, '');

    if (req.method === 'GET' && path.startsWith('/identity/')) {
      const encodedDid = path.slice('/identity/'.length);
      if (!encodedDid || encodedDid.includes('/')) return false;
      let did;
      try { did = decodeURIComponent(encodedDid); } catch { return errorResponse(res, 400, 'INVALID_DID', 'DID path parameter is malformed.'); }
      const validDid = validateDid(did);
      if (!validDid.ok) return handledJson(res, 400, validDid.error);
      try {
        const [document, attestations] = await Promise.all([
          soroban?.resolveDid?.(validDid.did) ?? null,
          listAttestations(soroban, accountFromDid(validDid.did), validDid.did),
        ]);
        if (!document) return errorResponse(res, 404, 'DID_NOT_FOUND', 'DID was not found.');
        return handledJson(res, 200, { did: validDid.did, document, attestations });
      } catch (error) {
        logger.error?.({ error: error.message, did: validDid.did }, 'Failed to resolve identity');
        return errorResponse(res, 502, 'IDENTITY_RESOLUTION_FAILED', 'Identity resolution is temporarily unavailable.');
      }
    }

    if (req.method === 'POST' && path === '/identity') {
      if (!(await requireAuth(req, res, config, ['credentials:write']))) return true;
      const body = await readBody(req, res, config);
      if (!body) return true;
      const checked = validateSignedTransaction(body.signedXdr, config, {});
      if (checked.error) return handledJson(res, 400, checked.error);
      try {
        const transaction = await soroban.submitSignedXdr(checked.signedXdr);
        return handledJson(res, 200, transaction);
      } catch (error) {
        logger.error?.({ error: error.message }, 'Failed to submit signed identity transaction');
        return errorResponse(res, 502, 'TRANSACTION_SUBMISSION_FAILED', 'The signed identity transaction could not be submitted.');
      }
    }

    if (req.method === 'POST' && (path === '/attestation' || path === '/attestation/batch')) {
      if (!(await requireAuth(req, res, config, ['credentials:write']))) return true;
      const body = await readBody(req, res, config);
      if (!body) return true;
      const isBatch = path.endsWith('/batch');
      const contractId = config.contracts?.credential;
      if (!contractId) return errorResponse(res, 503, 'CONTRACT_NOT_CONFIGURED', 'Credential manager contract is not configured.');
      const checked = validateSignedTransaction(body.signedXdr, config, {
        contract: contractId,
        methods: isBatch ? ['issue_attestations_batch'] : ['issue_attestation'],
      });
      if (checked.error) return handledJson(res, 400, checked.error);
      const args = checked.invocation.args ?? [];
      if (args[0]?.type !== 'scvAddress') {
        return errorResponse(res, 400, 'INVALID_ATTESTATION_ISSUER', 'The signed attestation transaction must contain an issuer address.');
      }
      const signedIssuer = invocationArgument(args[0]);
      if (req.issuer && !sameAccount(req.issuer, signedIssuer)) {
        return errorResponse(res, 403, 'ATTESTATION_ISSUER_MISMATCH', 'The signed issuer must match the authenticated issuer.');
      }
      let count = 1;
      if (isBatch) {
        // Contract arguments are (issuer, entries); the vector is inspected
        // from the signed transaction itself, not a caller-supplied count.
        const entryVector = args[1];
        count = batchLength(entryVector);
        if (count === null || count === 0) return errorResponse(res, 400, 'INVALID_BATCH', 'Batch transaction must contain between 1 and 50 attestations.');
        if (count > MAX_BATCH_ATTESTATIONS) return errorResponse(res, 400, 'BATCH_TOO_LARGE', `At most ${MAX_BATCH_ATTESTATIONS} attestations may be issued in one transaction.`);
      }
      try {
        const transaction = await soroban.submitSignedXdr(checked.signedXdr);
        return handledJson(res, 202, { count, transaction });
      } catch (error) {
        logger.error?.({ error: error.message, batch: isBatch }, 'Failed to submit signed attestation transaction');
        return errorResponse(res, 502, 'TRANSACTION_SUBMISSION_FAILED', 'The signed attestation transaction could not be submitted.');
      }
    }

    const revokeMatch = path.match(/^\/attestation\/([^/]+)$/);
    if (req.method === 'DELETE' && revokeMatch) {
      if (!(await requireAuth(req, res, config, ['credentials:write']))) return true;
      let rawId;
      try { rawId = decodeURIComponent(revokeMatch[1]); } catch { return errorResponse(res, 400, 'INVALID_ATTESTATION_ID', 'Attestation id is malformed.'); }
      const validId = validateAttestationId(rawId);
      if (!validId.ok) return handledJson(res, 400, validId.error);
      const record = await getAttestation(soroban, validId.id);
      if (!record) return errorResponse(res, 404, 'ATTESTATION_NOT_FOUND', 'Attestation was not found.');
      const caller = req.issuer ?? req.userId;
      if (caller && !sameAccount(caller, record.issuer) && !req.apiKeyScopes?.includes('*')) {
        return errorResponse(res, 403, 'FORBIDDEN', 'Only the attestation issuer may revoke it.');
      }
      const body = await readBody(req, res, config);
      if (!body) return true;
      const checked = validateSignedTransaction(body.signedXdr, config, {
        contract: config.contracts?.credential,
        methods: ['revoke_attestation'],
      });
      if (checked.error) return handledJson(res, 400, checked.error);
      const args = checked.invocation.args ?? [];
      if (args.length !== 2 || args[0]?.type !== 'scvAddress' || args[1]?.type !== 'scvBytes') {
        return errorResponse(res, 400, 'INVALID_REVOKE_ARGUMENTS', 'The signed revocation must contain an issuer address and attestation byte ID.');
      }
      const signedIssuer = invocationArgument(args[0]);
      const signedId = invocationArgument(args[1]);
      if (!sameAccount(signedIssuer, record.issuer)) {
        return errorResponse(res, 400, 'ATTESTATION_ISSUER_MISMATCH', 'The signed revocation issuer does not match the attestation issuer.');
      }
      if (normalizeId(signedId) !== normalizeId(validId.id)) {
        return errorResponse(res, 400, 'ATTESTATION_ID_MISMATCH', 'The signed revocation id does not match the requested attestation id.');
      }
      try {
        const transaction = await soroban.submitSignedXdr(checked.signedXdr);
        realtime?.emitAttestationEvent?.('revoked', { id: validId.id, subject: record.subject, issuer: record.issuer });
        return handledJson(res, 200, { attestationId: validId.id, transaction });
      } catch (error) {
        logger.error?.({ error: error.message, attestationId: validId.id }, 'Failed to submit attestation revocation');
        return errorResponse(res, 502, 'TRANSACTION_SUBMISSION_FAILED', 'The revocation transaction could not be submitted.');
      }
    }

    if (req.method === 'POST' && path === '/transactions/fee-bump') {
      if (!(await requireAuth(req, res, config, ['credentials:write']))) return true;
      const body = await readBody(req, res, config);
      if (!body) return true;
      const requested = body.maxFeeStroops;
      if (requested !== undefined && (!Number.isSafeInteger(Number(requested)) || Number(requested) <= 0)) {
        return errorResponse(res, 400, 'INVALID_FEE_LIMIT', 'maxFeeStroops must be a positive integer.');
      }
      try {
        const result = buildFeeBumpXdr({
          signedXdr: body.signedXdr,
          config: { ...config, feeBumpRequestedMaxFeeStroops: requested },
        });
        return handledJson(res, 200, result);
      } catch (error) {
        if (error instanceof FeeBumpError) return errorResponse(res, error.status, error.code, error.message);
        logger.error?.({ error: error.message }, 'Failed to construct fee-bump transaction');
        return errorResponse(res, 500, 'FEE_BUMP_BUILD_FAILED', 'Fee-bump transaction could not be constructed.');
      }
    }

    return false;
  };
}
