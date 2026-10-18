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

/**
 * Checks credentials for the connected wallet and notifies when any
 * expire within the next 7 days. Re-checks every 5 minutes and immediately
 * after batch operations (#1066).
 */
export function useCredentialExpiryCheck(
  publicKey: string | null,
  fetchCredentials: (address: string) => Promise<Credential[]>
) {
  const [notification, setNotification] = useState<ExpiryNotification | null>(null);
  const readIdsRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    if (!publicKey) return;
    try {
      const credentials = await fetchCredentials(publicKey);
      const now = Date.now();
      // Deduplicate by credential ID so batch operations never double-count (#1066)
      const uniqueById = new Map<string, Credential>();
      for (const cred of credentials) {
        if (cred && cred.id) {
          uniqueById.set(cred.id, cred);
        }
      }
      const expiring = Array.from(uniqueById.values()).filter((c) => {
        if (c.expiresAt === 0 || c.revoked) return false;
        const expiryMs = c.expiresAt * 1000;
        return expiryMs > now && expiryMs - now <= SEVEN_DAYS_MS;
      });
      if (expiring.length > 0) {
        const unreadCount = expiring.filter((c) => !readIdsRef.current.has(c.id)).length;
        setNotification((prev: ExpiryNotification | null) =>
          prev?.dismissed
            ? prev
            : {
                count: unreadCount,
                credentials: expiring,
                readIds: Array.from(readIdsRef.current),
                dismissed: unreadCount === 0,
              }
        );
      } else {
        setNotification(null);
      }
    } catch {
      // silently ignore fetch errors
    }
  }, [publicKey, fetchCredentials]);

  const applyBatchUpdate = useCallback(
    (detail: BatchUpdateDetail) => {
      setNotification((prev: ExpiryNotification | null) => {
        const now = Date.now();
        const currentMap = new Map<string, Credential>();
        for (const c of prev?.credentials ?? []) {
          currentMap.set(c.id, c);
        }

        if (Array.isArray(detail.revokedIds)) {
          for (const revokedId of detail.revokedIds) {
            currentMap.delete(revokedId);
          }
        }

        if (Array.isArray(detail.issued)) {
          for (const cred of detail.issued) {
            if (!cred || !cred.id) continue;
            if (cred.revoked || cred.expiresAt === 0) {
              currentMap.delete(cred.id);
              continue;
            }
            const expiryMs = cred.expiresAt * 1000;
            if (expiryMs > now && expiryMs - now <= SEVEN_DAYS_MS) {
              currentMap.set(cred.id, cred);
            }
          }
        }

        const updatedCredentials = Array.from(currentMap.values());
        const nextCount =
          typeof detail.deltaCount === "number"
            ? Math.max(0, (prev?.count ?? 0) + detail.deltaCount)
            : updatedCredentials.length;

        if (nextCount === 0 && updatedCredentials.length === 0) {
          return null;
        }

        return {
          count: nextCount,
          credentials: updatedCredentials,
          dismissed: false,
        };
      });
      void check();
    },
    [check]
  );

  useEffect(() => {
    if (!publicKey) {
      readIdsRef.current.clear();
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

  const markAsRead = useCallback((credentialId: string) => {
    readIdsRef.current.add(credentialId);
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
