import { useEffect, useState } from "react";

interface ServiceWorkerState {
  isSupported: boolean;
  isOnline: boolean;
  isRegistered: boolean;
  isUpdating: boolean;
}

/**
 * Hook to manage service worker registration and offline state
 */
export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: "serviceWorker" in navigator,
    isOnline: navigator.onLine,
    isRegistered: false,
    isUpdating: false,
  });

  useEffect(() => {
    if (!state.isSupported) return;

    // Register service worker
    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        setState((prev) => ({ ...prev, isRegistered: true }));

        // Listen for updates
        registration.addEventListener("updatefound", () => {
          setState((prev) => ({ ...prev, isUpdating: true }));
        });

        // Reload once when an updated worker takes over. On the very first
        // install there is no previous controller: clients.claim() fires
        // controllerchange too, and reloading then would be pointless (#1079).
        const hadController = Boolean(navigator.serviceWorker.controller);
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController || refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        console.log("Service Worker registered successfully");
      } catch (error) {
        console.error("Service Worker registration failed:", error);
      }
    };

    registerServiceWorker();
  }, [state.isSupported]);

  // Listen for online/offline status
  useEffect(() => {
    const handleOnline = () =>
      setState((prev) => ({ ...prev, isOnline: true }));
    const handleOffline = () =>
      setState((prev) => ({ ...prev, isOnline: false }));

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return state;
}

/**
 * Hook to handle background sync
 */
export function useBackgroundSync() {
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("SyncManager" in window)) {
      return;
    }

    // Listen for sync messages from service worker
    const handleSyncMessage = (event: MessageEvent) => {
      if (event.data.type === "SYNC_COMPLETE") {
        setIsSyncing(false);
        console.log(`Synced ${event.data.count} operations`);
      }
    };

    navigator.serviceWorker.addEventListener("message", handleSyncMessage);

    // Register background sync
    const registerSync = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.sync) {
          await registration.sync.register("sync-credentials");
        }
      } catch (error) {
        console.error("Background sync registration failed:", error);
      }
    };

    registerSync();

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleSyncMessage);
    };
  }, []);

  return { isSyncing };
}

/** Must match API_CACHE in public/sw.js. */
export const API_CACHE_NAME = "soroban-identity-api-v2";

/**
 * Hook to cache API responses
 */
export function useCacheAPI() {
  const cacheResponse = async (url: string, response: Response) => {
    if (!("caches" in window)) return;

    try {
      const cache = await caches.open(API_CACHE_NAME);
      // The service worker ignores entries without this timestamp.
      const headers = new Headers(response.headers);
      headers.set("sw-cached-at", String(Date.now()));
      const body = await response.clone().blob();
      await cache.put(
        url,
        new Response(body, { status: response.status, statusText: response.statusText, headers })
      );
    } catch (error) {
      console.error("Failed to cache response:", error);
    }
  };

  const getCachedResponse = async (url: string) => {
    if (!("caches" in window)) return null;

    try {
      const cache = await caches.open(API_CACHE_NAME);
      return await cache.match(url);
    } catch (error) {
      console.error("Failed to get cached response:", error);
      return null;
    }
  };

  const clearCache = async () => {
    if (!("caches" in window)) return;

    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) => {
          if (name.startsWith("soroban-identity")) {
            return caches.delete(name);
          }
        })
      );
    } catch (error) {
      console.error("Failed to clear cache:", error);
    }
  };

  return { cacheResponse, getCachedResponse, clearCache };
}
