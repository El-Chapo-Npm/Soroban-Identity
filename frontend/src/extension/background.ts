/**
 * Browser Extension Service Worker / Background Script (#1037)
 * Handles context menus, badge notifications for expiring credentials,
 * message routing between content scripts and popups, and local storage.
 */

import type {
  ExtensionCredential,
  ExtensionMessage,
  SyncCredentialsPayload,
  VerificationResultPayload,
} from './types';

// Declare chrome API globally for extension service worker context
declare const chrome: any;

const EXPIRY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ALARM_NAME = 'check-expiring-credentials';

// Initialize context menus and alarms on extension install or update
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
  // Setup context menu items
  chrome.contextMenus.create({
    id: 'verify-selection',
    title: 'Verify Selected Credential ID',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'autofill-credential',
    title: 'Auto-fill Identity Details',
    contexts: ['editable'],
  });

  chrome.contextMenus.create({
    id: 'open-web-app',
    title: 'Open Soroban Identity App',
    contexts: ['action'],
  });

  // Setup periodic alarm to check for expiring credentials (every 60 minutes)
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 60,
  });

  void updateExpiringBadge();
  });
}


// Update badge notifications for expiring credentials
export async function updateExpiringBadge(): Promise<number> {
  try {
    const data = await chrome.storage.local.get(['credentials']);
    const credentials: ExtensionCredential[] = data.credentials || [];
    const now = Date.now();

    const expiring = credentials.filter((c) => {
      const exp = c.expiresAt > 1e11 ? c.expiresAt : c.expiresAt * 1000;
      return exp > now && exp <= now + EXPIRY_THRESHOLD_MS;
    });

    const count = expiring.length;
    if (count > 0) {
      await chrome.action.setBadgeText({ text: String(count) });
      await chrome.action.setBadgeBackgroundColor({ color: '#eab308' }); // amber warning
      await chrome.action.setTitle({
        title: `Soroban Identity: ${count} credential(s) expiring soon!`,
      });
    } else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({
        title: 'Soroban Identity Verifier',
      });
    }

    return count;
  } catch {
    return 0;
  }
}

// Alarm listener
if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === ALARM_NAME) {
      void updateExpiringBadge();
    }
  });
}

// Context menu click listener
if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info: any, tab: any) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'verify-selection' && info.selectionText) {
      const credentialId = info.selectionText.trim();
      const result = await verifyCredentialId(credentialId);

      // Send result to content script to display an inline notification
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_VERIFICATION_RESULT',
        payload: result,
        source: 'soroban-identity-extension',
      });
    }

    if (info.menuItemId === 'autofill-credential') {
      const data = await chrome.storage.local.get(['credentials']);
      const credentials: ExtensionCredential[] = data.credentials || [];

      await chrome.tabs.sendMessage(tab.id, {
        type: 'AUTOFILL_FORM',
        payload: { credentials },
        source: 'soroban-identity-extension',
      });
    }

    if (info.menuItemId === 'open-web-app') {
      chrome.tabs.create({ url: 'https://identity.soroban.stellar.org' });
    }
  });
}

// Verify a credential ID against stored records and mock/RPC verification
export async function verifyCredentialId(
  credentialId: string
): Promise<VerificationResultPayload> {
  const data = typeof chrome !== 'undefined' && chrome.storage?.local
    ? await chrome.storage.local.get(['credentials'])
    : { credentials: [] };
  const credentials: ExtensionCredential[] = data.credentials || [];

  const found = credentials.find(
    (c) =>
      c.id.toLowerCase() === credentialId.toLowerCase() ||
      c.id.includes(credentialId) ||
      credentialId.includes(c.id)
  );

  const now = Date.now();
  if (found) {
    const exp = found.expiresAt > 1e11 ? found.expiresAt : found.expiresAt * 1000;
    const isExpired = exp > 0 && exp <= now;
    const isValid = found.status === 'valid' && !isExpired;

    return {
      credentialId: found.id,
      isValid,
      issuer: found.issuer,
      subject: found.subject,
      error: isExpired
        ? 'Credential has expired'
        : found.status === 'revoked'
        ? 'Credential has been revoked'
        : undefined,
      checkedAt: now,
    };
  }

  // Not in local storage: treat as generic lookup
  return {
    credentialId,
    isValid: credentialId.length >= 32, // basic checksum simulation
    error: credentialId.length < 32 ? 'Invalid credential ID format' : undefined,
    checkedAt: now,
  };
}

// Runtime message router
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage<any>,
    _sender: any,
    sendResponse: (res: any) => void
  ) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ type: 'PONG', payload: { version: '1.0.0' } });
        return true;

      case 'SYNC_CREDENTIALS': {
        const payload = message.payload as SyncCredentialsPayload;
        if (!payload?.credentials) {
          sendResponse({ success: false, error: 'No credentials provided' });
          return true;
        }

        chrome.storage.local
          .set({
            credentials: payload.credentials,
            lastSyncedAt: payload.syncedAt || Date.now(),
            appOrigin: payload.appOrigin,
          })
          .then(async () => {
            const expiringCount = await updateExpiringBadge();
            sendResponse({
              success: true,
              count: payload.credentials.length,
              expiringCount,
            });
          })
          .catch((err: Error) => {
            sendResponse({ success: false, error: err.message });
          });

        return true;
      }

      case 'GET_CREDENTIALS': {
        chrome.storage.local
          .get(['credentials', 'lastSyncedAt'])
          .then((data: any) => {
            sendResponse({
              credentials: data.credentials || [],
              lastSyncedAt: data.lastSyncedAt || 0,
            });
          })
          .catch((err: Error) => {
            sendResponse({ credentials: [], error: err.message });
          });

        return true;
      }

      case 'VERIFY_CREDENTIAL': {
        verifyCredentialId(message.payload?.credentialId || '')
          .then((res) => sendResponse(res))
          .catch((err: Error) =>
            sendResponse({ isValid: false, error: err.message, checkedAt: Date.now() })
          );

        return true;
      }

      case 'GET_EXPIRING_CREDENTIALS': {
        chrome.storage.local
          .get(['credentials'])
          .then((data: any) => {
            const credentials: ExtensionCredential[] = data.credentials || [];
            const now = Date.now();
            const expiring = credentials.filter((c) => {
              const exp = c.expiresAt > 1e11 ? c.expiresAt : c.expiresAt * 1000;
              return exp > now && exp <= now + EXPIRY_THRESHOLD_MS;
            });
            sendResponse({ expiring });
          })
          .catch((err: Error) => {
            sendResponse({ expiring: [], error: err.message });
          });

        return true;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
        return false;
    }
  }
);
}

