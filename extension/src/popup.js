// extension/src/popup.js
'use strict';

const STORAGE_KEY = 'credentials';
const SYNC_URL = 'https://app.example.com/settings/extensions';
const EXPIRING_THRESHOLD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read stored credentials from extension local storage.
 * @returns {Promise<Array<Object>>}
 */
function getStoredCredentials() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const items = result && result[STORAGE_KEY];
        resolve(Array.isArray(items) ? items : []);
      });
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      browser.storage.local
        .get(STORAGE_KEY)
        .then((result) => {
          const items = result && result[STORAGE_KEY];
          resolve(Array.isArray(items) ? items : []);
        })
        .catch(() => resolve([]));
    } else {
      resolve([]);
    }
  });
}

/**
 * Persist credentials to extension local storage.
 * @param {Array<Object>} credentials
 * @returns {Promise<void>}
 */
function saveStoredCredentials(credentials) {
  return new Promise((resolve) => {
    const payload = { [STORAGE_KEY]: credentials };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(payload, () => resolve());
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      browser.storage.local.set(payload).then(() => resolve()).catch(() => resolve());
    } else {
      resolve();
    }
  });
}

/**
 * Parse a date-ish value into a Date, or null when invalid.
 * @param {*} value
 * @returns {Date|null}
 */
function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Days remaining until expiry. Returns null when no valid expiry date.
 * @param {Object} credential
 * @returns {number|null}
 */
function daysUntilExpiry(credential) {
  const expiry = parseDate(credential && credential.expiresAt);
  if (!expiry) return null;
  return Math.ceil((expiry.getTime() - Date.now()) / MS_PER_DAY);
}

/**
 * Whether a credential is expiring soon (or already expired).
 * @param {Object} credential
 * @returns {boolean}
 */
function isExpiring(credential) {
  const days = daysUntilExpiry(credential);
  return days !== null && days <= EXPIRING_THRESHOLD_DAYS;
}

/**
 * Human-readable expiry label.
 * @param {Object} credential
 * @returns {string}
 */
function expiryLabel(credential) {
  const days = daysUntilExpiry(credential);
  if (days === null) return 'No expiry date';
  if (days < 0) return `Expired ${Math.abs(days)} day(s) ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

/**
 * Escape text for safe insertion into HTML.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the DOM node for a single credential row.
 * @param {Object} credential
 * @returns {HTMLElement}
 */
function renderCredentialItem(credential) {
  const item = document.createElement('li');
  item.className = 'credential-item';
  if (isExpiring(credential)) {
    item.classList.add('credential-item--expiring');
  }

  const info = document.createElement('div');
  info.className = 'credential-info';

  const title = document.createElement('span');
  title.className = 'credential-title';
  title.textContent = credential.name || credential.title || 'Untitled credential';
  info.appendChild(title);

  if (credential.issuer) {
    const issuer = document.createElement('span');
    issuer.className = 'credential-issuer';
    issuer.textContent = credential.issuer;
    info.appendChild(issuer);
  }

  const expiry = document.createElement('span');
  expiry.className = 'credential-expiry';
  if (isExpiring(credential)) {
    expiry.classList.add('credential-expiry--warning');
  }
  expiry.textContent = expiryLabel(credential);
  info.appendChild(expiry);

  item.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'credential-actions';

  const verifyButton = document.createElement('button');
  verifyButton.type = 'button';
  verifyButton.className = 'btn btn-verify';
  verifyButton.textContent = 'Verify';
  verifyButton.addEventListener('click', () => {
    verifyCredential(credential, verifyButton);
  });
  actions.appendChild(verifyButton);

  item.appendChild(actions);

  return item;
}

/**
 * Verify a credential by opening the verification page.
 * @param {Object} credential
 * @param {HTMLElement} button
 */
function verifyCredential(credential, button) {
  const verifyUrl =
    credential.verifyUrl ||
    (credential.id ? `https://app.example.com/verify/${encodeURIComponent(credential.id)}` : null);

  if (!verifyUrl) {
    setStatus('No verification URL available for this credential.', 'error');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Verifying…';
  }

  setStatus(`Opening verification for ${credential.name || 'credential'}…`, 'info');

  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: verifyUrl });
    } else if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.create) {
      browser.tabs.create({ url: verifyUrl });
    } else {
      window.open(verifyUrl, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    setStatus('Unable to open verification page.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Verify';
    }
  }
}

/**
 * Update the status message area.
 * @param {string} message
 * @param {'info'|'error'|'success'} [kind]
 */
function setStatus(message, kind) {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.className = 'status';
  if (kind) {
    statusEl.classList.add(`status--${kind}`);
  }
}

/**
 * Update the badge count for expiring credentials.
 * @param {number} count
 */
function updateBadge(count) {
  try {
    if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setBadgeText) {
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      if (chrome.action.setBadgeBackgroundColor) {
        chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
      }
    } else if (typeof browser !== 'undefined' && browser.browserAction && browser.browserAction.setBadgeText) {
      browser.browserAction.setBadgeText({ text: count > 0 ? String(count) : '' });
      if (browser.browserAction.setBadgeBackgroundColor) {
        browser.browserAction.setBadgeBackgroundColor({ color: '#d93025' });
      }
    }
  } catch (err) {
    // Badge API may be unavailable; ignore.
  }
}

/**
 * Render the full credential list plus warnings.
 * @param {Array<Object>} credentials
 */
function renderCredentials(credentials) {
  const listEl = document.getElementById('credential-list');
  const emptyEl = document.getElementById('empty-state');
  const warningEl = document.getElementById('expiry-warning');
  const countEl = document.getElementById('credential-count');

  if (!listEl) return;

  listEl.innerHTML = '';

  const items = Array.isArray(credentials) ? credentials : [];
  const expiring = items.filter(isExpiring);

  if (countEl) {
    countEl.textContent = `${items.length} credential${items.length === 1 ? '' : 's'}`;
  }

  if (warningEl) {
    if (expiring.length > 0) {
      warningEl.hidden = false;
      warningEl.textContent = `${expiring.length} credential${
        expiring.length === 1 ? '' : 's'
      } expiring soon or already expired.`;
    } else {
      warningEl.hidden = true;
      warningEl.textContent = '';
    }
  }

  updateBadge(expiring.length);

  if (items.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;

  items
    .slice()
    .sort((a, b) => {
      const aDays = daysUntilExpiry(a);
      const bDays = daysUntilExpiry(b);
      if (aDays === null && bDays === null) return 0;
      if (aDays === null) return 1;
      if (bDays === null) return -1;
      return aDays - bDays;
    })
    .forEach((credential) => {
      listEl.appendChild(renderCredentialItem(credential));
    });
}

/**
 * Open the web app sync/settings page.
 */
function openSyncPage() {
  const url = SYNC_URL;
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.create) {
      browser.tabs.create({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    setStatus('Unable to open the sync page.', 'error');
  }
}

/**
 * Sync credentials with the web app via the API.
 */
async function syncWithWebApp() {
  const syncButton = document.getElementById('sync-button');
  if (syncButton) {
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing…';
  }
  setStatus('Syncing credentials with the web app…', 'info');

  try {
    const response = await fetch('https://api.example.com/extensions/credentials', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    const data = await response.json();
    const incoming = Array.isArray(data) ? data : data && Array.isArray(data.credentials) ? data.credentials : [];

    await saveStoredCredentials(incoming);
    renderCredentials(incoming);
    setStatus(`Synced ${incoming.length} credential${incoming.length === 1 ? '' : 's'}.`, 'success');
  } catch (err) {
    setStatus('Sync failed. Open the web app to sign in and try again.', 'error');
  } finally {
    if (syncButton) {
      syncButton.disabled = false;
      syncButton.textContent = 'Sync with web app';
    }
  }
}

/**
 * Initialize the popup.
 */
async function init() {
  const syncButton = document.getElementById('sync-button');
  if (syncButton) {
    syncButton.addEventListener('click', () => {
      syncWithWebApp();
    });
  }

  const openSyncLink = document.getElementById('open-sync-link');
  if (openSyncLink) {
    openSyncLink.addEventListener('click', (event) => {
      event.preventDefault();
      openSyncPage();
    });
  }

  const refreshButton = document.getElementById('refresh-button');
  if (refreshButton) {
    refreshButton.addEventListener('click', async () => {
      const credentials = await getStoredCredentials();
      renderCredentials(credentials);
      setStatus('Credential list refreshed.', 'info');
    });
  }

  try {
    const credentials = await getStoredCredentials();
    renderCredentials(credentials);
  } catch (err) {
    setStatus('Unable to load stored credentials.', 'error');
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStoredCredentials,
    saveStoredCredentials,
    daysUntilExpiry,
    isExpiring,
    expiryLabel,
    escapeHtml,
    renderCredentials,
    renderCredentialItem,
    verifyCredential,
    openSyncPage,
    syncWithWebApp,
    updateBadge,
    init,
  };
}