// Service Worker for Soroban Identity PWA
// Handles offline caching and sync

const CACHE_PREFIX = 'soroban-identity-';
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const API_CACHE = `${CACHE_PREFIX}api-${CACHE_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, API_CACHE];

// App shell. Every entry must exist in the production build: cache.addAll()
// is all-or-nothing, so a single 404 leaves the precache empty.
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];
const APP_SHELL_URL = '/index.html';

// API responses (#1079): network first, falling back to the last good copy
// when offline or when the network is slower than API_NETWORK_TIMEOUT_MS.
const API_PATH_PREFIX = '/api/';
const API_NETWORK_TIMEOUT_MS = 4000;
const API_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const API_CACHE_MAX_ENTRIES = 100;
const CACHED_AT_HEADER = 'sw-cached-at';
// Set on responses served from the API cache so the app can flag stale data.
const CACHE_STATUS_HEADER = 'x-sw-cache';

// TTLs per data type (milliseconds) - aligned with L2/L3 cache policies
const CACHE_TTLS = {
  static: 7 * 24 * 60 * 60 * 1000, // 7 days for static assets
  api: 5 * 60 * 1000, // 5 minutes for API responses
  public: 60 * 60 * 1000, // 1 hour for public data
};

// Cache hit rate monitoring counters
const cacheStats = {
  hits: 0,
  misses: 0,
  revalidations: 0,
};

function recordCacheHit() {
  cacheStats.hits += 1;
}

function recordCacheMiss() {
  cacheStats.misses += 1;
}

function recordRevalidation() {
  cacheStats.revalidations += 1;
}

function getCacheHitRate() {
  const total = cacheStats.hits + cacheStats.misses;
  return total === 0 ? 0 : cacheStats.hits / total;
}

// Store a response with a timestamp header for TTL-based expiry
async function putWithTimestamp(cacheName, request, response) {
  const headers = new Headers(response.headers);
  headers.set('x-sw-cached-at', Date.now().toString());
  const body = await response.clone().blob();
  const cachedResponse = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(cacheName);
  await cache.put(request, cachedResponse);
}

// Check whether a cached response has exceeded its TTL
function isExpired(response, ttl) {
  const cachedAt = response.headers.get('x-sw-cached-at');
  if (!cachedAt) {
    return true;
  }
  return Date.now() - parseInt(cachedAt, 10) > ttl;
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((error) => {
        console.warn('Failed to cache some static assets:', error);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - remove this app's caches from older versions. Caches
// with other names on the same origin are left alone.
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, STATIC_CACHE_NAME, API_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(cacheName)) {
            return caches.delete(cacheName);
          }
          return undefined;
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Skip cross-origin requests and non-GET methods
  if (!request.url.startsWith(self.location.origin) || request.method !== 'GET') {
    return;
  }

  const { pathname } = new URL(request.url);
  if (pathname.startsWith(API_PATH_PREFIX)) {
    event.respondWith(handleApiRequest(event));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  event.respondWith(handleStaticRequest(event));
});

/**
 * Network first for API calls. A successful response replaces the cached
 * copy; on failure or timeout the cached copy is served, marked with
 * `x-sw-cache: offline`. With no usable copy, an offline 503 is returned.
 */
async function handleApiRequest(event) {
  const { request } = event;
  const network = fetch(request);
  event.waitUntil(
    network
      .then((response) => {
        if (isCacheableApiResponse(request, response)) {
          return storeApiResponse(request, response.clone());
        }
        return undefined;
      })
      .catch(() => undefined)
  );

  try {
    return await withTimeout(network, API_NETWORK_TIMEOUT_MS);
  } catch (error) {
    const cached = await matchFreshApiResponse(request);
    if (cached) return cached;
    if (error && error.name === 'TimeoutError') {
      // Nothing cached: keep waiting on the slow network.
      return network.catch(() => offlineApiResponse());
    }
    return offlineApiResponse();
  }
}

/**
 * Only plain, successful, same-origin responses to unauthenticated requests
 * are stored, and never ones the server marks no-store or private.
 */
function isCacheableApiResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  if (request.headers.has('authorization')) return false;
  const cacheControl = response.headers.get('cache-control') || '';
  return !/no-store|private/i.test(cacheControl);
}

async function storeApiResponse(request, response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  const body = await response.blob();
  const cache = await caches.open(API_CACHE);
  // Delete first so the entry moves to the end and trimming stays oldest-first.
  await cache.delete(request);
  await cache.put(
    request,
    new Response(body, { status: response.status, statusText: response.statusText, headers })
  );
  await trimCache(cache, API_CACHE_MAX_ENTRIES);
}

async function matchFreshApiResponse(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  if (!cached) return null;
  const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER));
  if (!cachedAt || Date.now() - cachedAt > API_CACHE_MAX_AGE_MS) {
    await cache.delete(request);
    return null;
  }
  const headers = new Headers(cached.headers);
  headers.set(CACHE_STATUS_HEADER, 'offline');
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

function offlineApiResponse() {
  return new Response(
    JSON.stringify({ code: 'OFFLINE', message: 'You are offline and this data has not been cached yet.' }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json', [CACHE_STATUS_HEADER]: 'miss' },
    }
  );
}

/**
 * Network first for page loads so a deploy is picked up immediately; the
 * cached app shell is served when offline. Every route serves the same
 * shell (see _redirects), so it is cached under one key.
 */
async function handleNavigation(event) {
  try {
    const response = await fetch(event.request);
    if (response && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(APP_SHELL_URL, copy)));
    }
    return response;
  } catch {
    const shell = (await caches.match(APP_SHELL_URL)) || (await caches.match('/'));
    return shell || offlineTextResponse();
  }
}

// Cache first strategy for static assets
async function handleStaticRequest(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  try {
    const response = await fetch(event.request);
    if (response && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  } catch {
    return offlineTextResponse();
  }
}

function offlineTextResponse() {
  return new Response('Offline - Unable to load', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: new Headers({
      'Content-Type': 'text/plain',
    }),
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Network did not respond within ${ms}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// Background sync for offline data
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-credentials') {
    event.waitUntil(
      syncCredentials().catch((error) => {
        console.error('Background sync failed:', error);
      })
    );
  }
});

async function syncCredentials() {
  try {
    // Get pending operations from IndexedDB
    const db = await openDB();
    const pendingOps = await getPendingOperations(db);

    if (pendingOps.length === 0) {
      return;
    }

    // Retry failed operations
    for (const op of pendingOps) {
      try {
        await fetch(op.url, {
          method: op.method,
          headers: op.headers,
          body: op.body ? JSON.stringify(op.body) : undefined,
        });

        // Remove successful operation from queue
        await removePendingOperation(db, op.id);
      } catch (error) {
        console.error(`Failed to sync operation ${op.id}:`, error);
      }
    }

    // Notify clients that sync is complete
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        count: pendingOps.length,
      });
    });
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('soroban-identity', 2);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-operations')) {
        db.createObjectStore('pending-operations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('credentials')) {
        db.createObjectStore('credentials', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dids')) {
        db.createObjectStore('dids', { keyPath: 'id' });
      }
    };
  });
}

function getPendingOperations(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending-operations'], 'readonly');
    const store = tx.objectStore('pending-operations');
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function removePendingOperation(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending-operations'], 'readwrite');
    const store = tx.objectStore('pending-operations');
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(null);
  });
}

// Push notifications for credential expiry
self.addEventListener('push', (event) => {
  let data = { title: 'Soroban Identity Alert', body: 'A credential status update has occurred.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192x192.png',
    badge: '/icon-96x96.png',
    data: data.url || '/',
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === event.notification.data && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data || '/');
      }
    })
  );
});

// Message handler for client communication
self.addEventListener('message', (event) => {
  if (!event.data) {
    return;
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Drop cached API data, e.g. when the wallet disconnects.
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

