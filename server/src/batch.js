import {
  appendAuditLog,
  createAndPersistCredential,
  DuplicateCredentialError,
  readCredentials,
  revokeAndPersistCredential,
} from './storage.js';
import { logger } from './logger.js';

/**
 * Batch Operations Endpoint (#749)
 *
 * Executes a list of issue/verify/revoke operations from a single request,
 * returning a per-operation result so a caller never has to guess which of N
 * calls in a batch succeeded.
 *
 * Atomicity: the underlying store (storage.js) is a single JSON file with no
 * multi-record transaction support, so true rollback isn't available for
 * every operation type. `atomic: true` instead means: on the first failure,
 * stop executing the remaining operations, and compensate by revoking any
 * credentials this batch already issued (the one operation type with an
 * available inverse). A `revoke` that fails is typically "not found", which
 * has no side effect to undo. This is documented as a best-effort atomicity
 * rather than a true transaction.
 */
export async function executeBatch({ operations, atomic = false }, { config, webhookService = null, realtime = null, metrics = null }) {
  const results = [];
  const issuedInThisBatch = [];
  let aborted = false;

  for (const op of operations) {
    if (aborted) {
      results.push({
        id: op.id ?? null,
        type: op.type,
        success: false,
        status: 'skipped',
        error: { code: 'BATCH_ABORTED', message: 'Batch aborted after an earlier operation failed in atomic mode.' },
      });
      continue;
    }

    try {
      const result = await executeOperation(op, { config, webhookService, realtime });
      results.push({ id: op.id ?? null, type: op.type, success: true, status: result.status, data: result.data });
      metrics?.observeBatchOperation?.({ type: op.type, result: 'success' });
      if (op.type === 'issue') issuedInThisBatch.push(op.payload.id);
    } catch (error) {
      const failure = describeBatchError(error);
      results.push({ id: op.id ?? null, type: op.type, success: false, status: 'failed', error: failure });
      metrics?.observeBatchOperation?.({ type: op.type, result: 'failed' });

      if (atomic) {
        aborted = true;
        for (const credentialId of issuedInThisBatch) {
          try {
            await revokeAndPersistCredential(config, credentialId);
          } catch (rollbackError) {
            logger.error(
              { error: rollbackError.message, credentialId },
              'Batch rollback: failed to revoke a credential issued earlier in this atomic batch',
            );
          }
        }
      }
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  metrics?.observeBatchRequest?.({ atomic, aborted });

  return {
    results,
    summary: { total: operations.length, succeeded, failed: operations.length - succeeded },
    atomic,
    aborted,
  };
}

async function executeOperation(op, { config, webhookService, realtime }) {
  if (op.type === 'issue') {
    const credential = op.payload;
    await createAndPersistCredential(config, credential);
    await appendAuditLog(config, { action: 'issue_credential', credentialId: credential.id, batch: true });
    webhookService?.trigger('credential.issued', credential)?.catch(() => {});
    realtime?.emitCredentialEvent('issued', credential);
    return { status: 'issued', data: credential };
  }

  if (op.type === 'verify') {
    const { credentialId } = op.payload;
    const credentials = await readCredentials(config);
    const credential = credentials.find((c) => c.id === credentialId);
    if (!credential) return { status: 'verified', data: { verified: false, reason: 'not_found' } };
    if (credential.revoked) return { status: 'verified', data: { verified: false, reason: 'revoked' } };
    const now = Math.floor(Date.now() / 1000);
    if (credential.expiresAt > 0 && credential.expiresAt < now) {
      return { status: 'verified', data: { verified: false, reason: 'expired' } };
    }
    return { status: 'verified', data: { verified: true, credential } };
  }

  if (op.type === 'revoke') {
    const { credentialId } = op.payload;
    const revoked = await revokeAndPersistCredential(config, credentialId);
    if (!revoked) {
      const error = new Error(`Credential "${credentialId}" not found`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    await appendAuditLog(config, { action: 'revoke_credential', credentialId, batch: true });
    webhookService?.trigger('credential.revoked', { id: credentialId, revokedAt: revoked.revokedAt })?.catch(() => {});
    realtime?.emitCredentialEvent('revoked', revoked);
    return { status: 'revoked', data: { revoked: true, credential: revoked } };
  }

  const error = new Error(`Unknown batch operation type: ${op.type}`);
  error.code = 'UNKNOWN_OPERATION';
  throw error;
}

function describeBatchError(error) {
  if (error instanceof DuplicateCredentialError) {
    return { code: 'CREDENTIAL_ALREADY_EXISTS', message: error.message };
  }
  return { code: error.code ?? 'OPERATION_FAILED', message: error.message ?? 'Operation failed' };
}
