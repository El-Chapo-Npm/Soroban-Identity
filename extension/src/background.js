// Background service worker for the credential verification browser extension.
//
// Responsibilities:
//   - Register a context menu entry for one-click verification.
//   - Call the existing server verification endpoints.
//   - Manage local credential storage (chrome.storage with an IndexedDB mirror).
//   - Sync with the web app via the API using the same auth/token flow.
//   - Update the action badge with the count of expiring credentials.

const DEFAULT_API_BASE = 'https://app.example.com';
const STORAGE_KEYS = {
  settings: 'settings',
  credentials: 'credentials',
  auth: 'auth',
  lastSync: 'lastSync',
};

// Number of days before expiry at which a credential is considered "expiring".
const EXPIRY_WARNING_DAYS = 30;

const CONTEXT_MENU_ID = 'verify-credential';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const storage = {
  async get(key, fallback) {
    const result = await chrome.storage.local.get(key);
    return result[key] === undefined ? fallback : result[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

// ---------------------------------------------------------------------------
// IndexedDB mirror
//
// chrome.storage.local has a small quota, so we keep a full copy of the
// credential list in IndexedDB for larger datasets and offline access.
// ---------------------------------------------------------------------------

const DB_NAME = 'credential-extension';
const DB_VERSION = 1;
const STORE_NAME = 'credentials';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPutAll(credentials) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const credential of credentials) {
      store.put(credential);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Settings / auth
// ---------------------------------------------------------------------------

async function getSettings() {
  return storage.get(STORAGE_KEYS.settings, {
    apiBaseUrl: DEFAULT_API_BASE,
    autoFill: true,
    badgeNotifications: true,
  });
}

async function getAuth() {
  return storage.get(STORAGE_KEYS.auth, null);
}

async function setAuth(auth) {
  await storage.set(STORAGE_KEYS.auth, auth);
}

async function clearAuth() {
  await storage.remove(STORAGE_KEYS.auth);
}

// ---------------------------------------------------------------------------
// API client
//
// Uses the same bearer-token flow as the web app: the token is obtained from
// the web app (via the content script / message bridge) and stored locally.
// ---------------------------------------------------------------------------

async function apiFetch(path, options = {}) {
  const settings = await getSettings();
  const auth = await getAuth();
  const base = (settings.apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, '');

  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers || {}
  );
  if (auth && auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const response = await fetch(`${base}${path}`, Object.assign({}, options, { headers }));

  if (response.status === 401) {
    // Token expired or revoked; drop it so the user can re-authenticate.
    await clearAuth();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

async function getCredentials() {
  const credentials = await storage.get(STORAGE_KEYS.credentials, null);
  if (credentials) {
    return credentials;
  }
  // Fall back to the IndexedDB mirror if chrome.storage was cleared.
  try {
    const mirrored = await idbGetAll();
    if (mirrored.length) {
      await storage.set(STORAGE_KEYS.credentials, mirrored);
    }
    return mirrored;
  } catch (err) {
    return [];
  }
}

async function saveCredentials(credentials) {
  await storage.set(STORAGE_KEYS.credentials, credentials);
  try {
    await idbPutAll(credentials);
  } catch (err) {
    // IndexedDB mirror is best-effort; chrome.storage remains the source.
    console.warn('Failed to mirror credentials to IndexedDB', err);
  }
  await updateBadge();
}

async function upsertCredential(credential) {
  const credentials = await getCredentials();
  const index = credentials.findIndex((c) => c.id === credential.id);
  if (index >= 0) {
    credentials[index] = Object.assign({}, credentials[index], credential);
  } else {
    credentials.push(credential);
  }
  await saveCredentials(credentials);
  return credential;
}

// ---------------------------------------------------------------------------
// Expiry logic (mirrors the web app's expiry calculation)
// ---------------------------------------------------------------------------

function daysUntilExpiry(credential) {
  const raw = credential.expiresAt || credential.expiryDate || credential.expirationDate;
  if (!raw) {
    return null;
  }
  const expiry = new Date(raw).getTime();
  if (Number.isNaN(expiry)) {
    return null;
  }
  const diffMs = expiry - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function isExpiring(credential) {
  const days = daysUntilExpiry(credential);
  return days !== null && days <= EXPIRY_WARNING_DAYS;
}

function countExpiring(credentials) {
  return credentials.filter(isExpiring).length;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function updateBadge() {
  const settings = await getSettings();
  if (!settings.badgeNotifications) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const credentials = await getCredentials();
  const count = countExpiring(credentials);

  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: count > 0 ? '#d93025' : '#1a73e8' });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
}

// ---------------------------------------------------------------------------
// Sync with the web app
// ---------------------------------------------------------------------------

async function syncCredentials() {
  const auth = await getAuth();
  if (!auth || !auth.token) {
    return { ok: false, reason: 'not-authenticated' };
  }

  try {
    const data = await apiFetch('/api/credentials');
    const credentials = Array.isArray(data) ? data : data.credentials || [];
    await saveCredentials(credentials);
    await storage.set(STORAGE_KEYS.lastSync, Date.now());
    return { ok: true, count: credentials.length };
  } catch (err) {
    console.warn('Credential sync failed', err);
    return { ok: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyCredential(credentialId) {
  const credentials = await getCredentials();
  const credential = credentials.find((c) => c.id === credentialId);
  if (!credential) {
    return { ok: false, reason: 'not-found' };
  }

  try {
    const result = await apiFetch('/api/credentials/verify', {
      method: 'POST',
      body: JSON.stringify({ id: credentialId }),
    });
    await upsertCredential(
      Object.assign({}, credential, {
        verified: true,
        verificationResult: result,
        lastVerifiedAt: Date.now(),
      })
    );
    return { ok: true, result };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Verify credential with CredVerify',
      contexts: ['selection', 'page', 'editable'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  const selection = (info.selectionText || '').trim();
  let credentialId = null;

  if (selection) {
    const credentials = await getCredentials();
    const match = credentials.find(
      (c) =>
        c.id === selection ||
        c.name === selection ||
        (c.credentialNumber && c.credentialNumber === selection)
    );
    if (match) {
      credentialId = match.id;
    }
  }

  if (!credentialId) {
    // Ask the content script to look for a credential on the page.
    if (tab && tab.id !== undefined) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'FIND_CREDENTIAL',
          selection,
        });
        if (response && response.credentialId) {
          credentialId = response.credentialId;
        }
      } catch (err) {
        // No content script on this page.
      }
    }
  }

  if (!credentialId) {
    notifyTab(tab, { type: 'VERIFY_RESULT', ok: false, reason: 'no-credential' });
    return;
  }

  const result = await verifyCredential(credentialId);
  notifyTab(tab, Object.assign({ type: 'VERIFY_RESULT', credentialId }, result));
});

function notifyTab(tab, message) {
  if (!tab || tab.id === undefined) {
    return;
  }
  chrome.tabs.sendMessage(tab.id, message).catch(() => {
    // Content script may not be present; ignore.
  });
}

// ---------------------------------------------------------------------------
// Messaging bridge with content scripts and the web app
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  (async () => {
    switch (message.type) {
      case 'GET_CREDENTIALS':
        sendResponse({ ok: true, credentials: await getCredentials() });
        break;
      case 'GET_CREDENTIALS_FOR_ORIGIN': {
        const credentials = await getCredentials();
        const origin = message.origin || (sender.origin || '');
        const matches = credentials.filter(
          (c) => !c.origins || !c.origins.length || c.origins.includes(origin)
        );
        sendResponse({ ok: true, credentials: matches });
        break;
      }
      case 'VERIFY_CREDENTIAL': {
        const result = await verifyCredential(message.credentialId);
        sendResponse(result);
        break;
      }
      case 'SYNC_CREDENTIALS':
        sendResponse(await syncCredentials());
        break;
      case 'SET_AUTH':
        await setAuth(message.auth);
        await syncCredentials();
        sendResponse({ ok: true });
        break;
      case 'CLEAR_AUTH':
        await clearAuth();
        await updateBadge();
        sendResponse({ ok: true });
        break;
      case 'GET_SETTINGS':
        sendResponse({ ok: true, settings: await getSettings() });
        break;
      case 'SET_SETTINGS': {
        const settings = Object.assign(await getSettings(), message.settings || {});
        await storage.set(STORAGE_KEYS.settings, settings);
        await updateBadge();
        sendResponse({ ok: true, settings });
        break;
      }
      case 'AUTOFILL_CREDENTIAL': {
        const credentials = await getCredentials();
        const credential = credentials.find((c) => c.id === message.credentialId);
        sendResponse({ ok: !!credential, credential });
        break;
      }
      default:
        sendResponse({ ok: false, reason: 'unknown-message' });
    }
  })();

  // Keep the message channel open for the async response.
  return true;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  registerContextMenu();
  await updateBadge();
  await syncCredentials();
});

chrome.runtime.onStartup.addListener(async () => {
  registerContextMenu();
  await updateBadge();
  await syncCredentials();
});

// Periodically refresh credentials and the badge.
const SYNC_ALARM = 'credential-sync';
chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    await syncCredentials();
    await updateBadge();
  }
});

// Keep the badge fresh as credentials approach expiry.
updateBadge();
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>