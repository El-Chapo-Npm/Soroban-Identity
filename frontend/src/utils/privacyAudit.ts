import { appendPrivacyAuditEntry } from './offlineStorage';

export type PrivacyActionType =
  | 'visibility-change'
  | 'attribute-disclosure-change'
  | 'verifier-whitelist-add'
  | 'verifier-whitelist-remove'
  | 'share-link-created'
  | 'share-link-revoked'
  | 'template-applied';

export interface PrivacyAuditEntry {
  id: string;
  action: PrivacyActionType;
  timestamp: number;
  credentialId?: string;
  verifierId?: string;
  details?: Record<string, unknown>;
}

export interface LogPrivacyActionParams {
  action: PrivacyActionType;
  credentialId?: string;
  verifierId?: string;
  details?: Record<string, unknown>;
}

const AUDIT_UPDATED_EVENT = 'privacy:audit-updated';

function generateId(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitAuditUpdated(entry: PrivacyAuditEntry): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  try {
    const event = new CustomEvent<PrivacyAuditEntry>(AUDIT_UPDATED_EVENT, {
      detail: entry,
    });
    window.dispatchEvent(event);
  } catch {
    // Ignore environments where CustomEvent is unavailable.
  }
}

/**
 * Records a privacy-relevant action in the offline audit log and notifies
 * any listeners via the 'privacy:audit-updated' window event.
 */
export async function logPrivacyAction(
  params: LogPrivacyActionParams
): Promise<PrivacyAuditEntry> {
  const entry: PrivacyAuditEntry = {
    id: generateId(),
    action: params.action,
    timestamp: Date.now(),
    credentialId: params.credentialId,
    verifierId: params.verifierId,
    details: params.details,
  };

  try {
    await appendPrivacyAuditEntry(entry);
  } catch (error) {
    // Still emit the event so the UI can reflect the attempted action,
    // but surface the persistence failure to the caller.
    emitAuditUpdated(entry);
    throw error;
  }

  emitAuditUpdated(entry);
  return entry;
}

/**
 * Retrieves the privacy audit log. Delegates to the offline storage layer
 * when it exposes a retrieval function; otherwise returns an empty list.
 */
export async function getAuditLog(): Promise<PrivacyAuditEntry[]> {
  const storage = await import('./offlineStorage');
  const maybeGet = (storage as Record<string, unknown>).getPrivacyAuditLog;
  if (typeof maybeGet === 'function') {
    const result = await (maybeGet as () => Promise<PrivacyAuditEntry[]>)();
    return Array.isArray(result) ? result : [];
  }
  return [];
}

/**
 * Subscribes to privacy audit log updates. Returns an unsubscribe function.
 */
export function subscribeToAuditLog(
  callback: (entry: PrivacyAuditEntry) => void
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => undefined;
  }

  const handler = (event: Event): void => {
    const customEvent = event as CustomEvent<PrivacyAuditEntry>;
    if (customEvent && customEvent.detail) {
      callback(customEvent.detail);
    }
  };

  window.addEventListener(AUDIT_UPDATED_EVENT, handler as EventListener);

  return () => {
    window.removeEventListener(AUDIT_UPDATED_EVENT, handler as EventListener);
  };
}