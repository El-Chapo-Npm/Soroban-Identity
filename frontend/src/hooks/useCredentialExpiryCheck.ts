import { useState, useEffect, useCallback, useRef } from "react";
import type { Credential } from "../../../sdk/src/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface ExpiryNotification {
  count: number;
  credentials: Credential[];
  readIds: string[];
  dismissed: boolean;
}

export const BATCH_CREDENTIALS_UPDATED_EVENT = "credentials:batch-updated";

export interface BatchUpdateDetail {
  issued?: Credential[];
  revokedIds?: string[];
  /**
   * @deprecated Ignored for counting (#1081). A relative delta drifts from the
   * real number of unread credentials, so the badge is always recomputed from
   * the credential set instead. An event carrying only this still triggers a
   * re-check.
   */
  deltaCount?: number;
}

/**
 * Notify listeners (including the notification badge hook) that a batch
 * credential operation has completed so counts update immediately (#1066).
 */
export function notifyBatchCredentialsUpdated(detail: BatchUpdateDetail = {}): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent<BatchUpdateDetail>(BATCH_CREDENTIALS_UPDATED_EVENT, { detail }));
  }
}

function isExpiringSoon(credential: Credential, now: number): boolean {
  if (credential.expiresAt === 0 || credential.revoked) return false;
  const expiryMs = credential.expiresAt * 1000;
  return expiryMs > now && expiryMs - now <= SEVEN_DAYS_MS;
}

/**
 * Derive the notification from the expiring set and the read ids. The badge
 * count is always the number of unread expiring credentials, so no code path
 * can leave it out of step with the list (#1081).
 *
 * A dismissed notification stays dismissed unless an unread credential that
 * was not in the previous set appears.
 */
function buildNotification(
  prev: ExpiryNotification | null,
  expiring: Credential[],
  readIds: Set<string>
): ExpiryNotification | null {
  if (expiring.length === 0) return null;
  const unread = expiring.filter((c) => !readIds.has(c.id));
  const known = new Set((prev?.credentials ?? []).map((c) => c.id));
  const hasNewUnread = unread.some((c) => !known.has(c.id));
  return {
    count: unread.length,
    credentials: expiring,
    readIds: Array.from(readIds),
    dismissed: unread.length === 0 || (Boolean(prev?.dismissed) && !hasNewUnread),
  };
}

/**
 * Checks credentials for the connected wallet and notifies when any
 * expire within the next 7 days. Re-checks every 5 minutes and immediately
 * after batch operations (#1066).
 *
 * Batch results are kept locally and merged into every later fetch, so a
 * fetch that has not caught up with the batch yet cannot undo it, and a
 * fetch that started before the batch is discarded when it resolves (#1081).
 */
export function useCredentialExpiryCheck(
  publicKey: string | null,
  fetchCredentials: (address: string) => Promise<Credential[]>
) {
  const [notification, setNotification] = useState<ExpiryNotification | null>(null);
  const readIdsRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchedRef = useRef<Credential[]>([]);
  const batchIssuedRef = useRef<Map<string, Credential>>(new Map());
  const batchRevokedRef = useRef<Set<string>>(new Set());
  const checkSeqRef = useRef(0);

  /** Fetched credentials plus batch results, deduplicated by id. */
  const expiringNow = useCallback((): Credential[] => {
    const merged = new Map<string, Credential>();
    for (const cred of lastFetchedRef.current) {
      if (cred && cred.id) merged.set(cred.id, cred);
    }
    for (const cred of batchIssuedRef.current.values()) {
      if (!merged.has(cred.id)) merged.set(cred.id, cred);
    }
    for (const id of batchRevokedRef.current) {
      merged.delete(id);
    }
    const now = Date.now();
    return Array.from(merged.values()).filter((c) => isExpiringSoon(c, now));
  }, []);

  const recompute = useCallback(() => {
    const expiring = expiringNow();
    setNotification((prev) => buildNotification(prev, expiring, readIdsRef.current));
  }, [expiringNow]);

  const check = useCallback(async () => {
    if (!publicKey) return;
    const seq = ++checkSeqRef.current;
    try {
      const credentials = await fetchCredentials(publicKey);
      // A newer check or a batch update superseded this one.
      if (seq !== checkSeqRef.current) return;
      lastFetchedRef.current = Array.isArray(credentials) ? credentials : [];
      recompute();
    } catch {
      // silently ignore fetch errors
    }
  }, [publicKey, fetchCredentials, recompute]);

  const applyBatchUpdate = useCallback(
    (detail: BatchUpdateDetail) => {
      if (Array.isArray(detail.revokedIds)) {
        for (const id of detail.revokedIds) {
          batchRevokedRef.current.add(id);
          batchIssuedRef.current.delete(id);
        }
      }
      if (Array.isArray(detail.issued)) {
        for (const cred of detail.issued) {
          if (!cred || !cred.id) continue;
          if (cred.revoked) {
            batchRevokedRef.current.add(cred.id);
            batchIssuedRef.current.delete(cred.id);
          } else {
            batchIssuedRef.current.set(cred.id, cred);
            batchRevokedRef.current.delete(cred.id);
          }
        }
      }
      // Invalidate any check that started before this batch.
      checkSeqRef.current += 1;
      recompute();
      void check();
    },
    [check, recompute]
  );

  useEffect(() => {
    if (!publicKey) {
      readIdsRef.current.clear();
      lastFetchedRef.current = [];
      batchIssuedRef.current.clear();
      batchRevokedRef.current.clear();
      checkSeqRef.current += 1;
      setNotification(null);
      return;
    }
    check();
    intervalRef.current = setInterval(check, CHECK_INTERVAL_MS);

    const handleBatchEvent = (event: Event) => {
      const customEvent = event as CustomEvent<BatchUpdateDetail>;
      applyBatchUpdate(customEvent.detail ?? {});
    };

    if (typeof window !== "undefined") {
      window.addEventListener(BATCH_CREDENTIALS_UPDATED_EVENT, handleBatchEvent);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (typeof window !== "undefined") {
        window.removeEventListener(BATCH_CREDENTIALS_UPDATED_EVENT, handleBatchEvent);
      }
    };
  }, [publicKey, check, applyBatchUpdate]);

  const markBatchAsRead = useCallback((credentialIds: string[]) => {
    credentialIds.forEach((id) => readIdsRef.current.add(id));
    setNotification((prev: ExpiryNotification | null) => {
      if (!prev) return null;
      const unread = prev.credentials.filter((c) => !readIdsRef.current.has(c.id));
      return {
        ...prev,
        count: unread.length,
        readIds: Array.from(readIdsRef.current),
        dismissed: unread.length === 0 ? true : prev.dismissed,
      };
    });
  }, []);

  const markAsRead = useCallback(
    (credentialId: string) => markBatchAsRead([credentialId]),
    [markBatchAsRead]
  );

  const markAllAsRead = useCallback(() => {
    setNotification((prev: ExpiryNotification | null) => {
      if (!prev) return null;
      prev.credentials.forEach((c) => readIdsRef.current.add(c.id));
      return {
        ...prev,
        count: 0,
        readIds: Array.from(readIdsRef.current),
        dismissed: true,
      };
    });
  }, []);

  const dismiss = useCallback(() => {
    setNotification((prev: ExpiryNotification | null) =>
      prev ? { ...prev, count: 0, dismissed: true } : null
    );
  }, []);

  return { notification, dismiss, markAsRead, markBatchAsRead, markAllAsRead };
}
