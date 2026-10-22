/**
 * Browser Extension Bridge for Web App (#1037)
 * Provides frontend APIs to detect the Soroban Identity extension,
 * sync credentials to the extension's local storage, and export the extension package.
 */

import type { ExtensionCredential } from './types';

export interface ExtensionSyncResult {
  success: boolean;
  count: number;
  expiringCount?: number;
  error?: string;
}

/**
 * Check if the Soroban Identity browser extension is installed and listening.
 */
export async function isExtensionInstalled(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const handler = (event: MessageEvent) => {
      if (
        event.data?.type === 'SOROBAN_IDENTITY_PONG' ||
        event.data?.type === 'SOROBAN_IDENTITY_EXTENSION_READY'
      ) {
        resolved = true;
        window.removeEventListener('message', handler);
        resolve(true);
      }
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: 'SOROBAN_IDENTITY_PING' }, '*');

    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler);
        resolve(false);
      }
    }, timeoutMs);
  });
}

/**
 * Synchronize credentials from the web application to the browser extension.
 */
export async function syncCredentialsToExtension(
  credentials: ExtensionCredential[],
  timeoutMs = 2500
): Promise<ExtensionSyncResult> {
  return new Promise((resolve) => {
    let resolved = false;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'SOROBAN_IDENTITY_SYNC_RESULT') {
        resolved = true;
        window.removeEventListener('message', handler);
        resolve({
          success: event.data.success ?? false,
          count: event.data.count ?? 0,
          expiringCount: event.data.expiringCount,
          error: event.data.error,
        });
      }
    };

    window.addEventListener('message', handler);

    window.postMessage(
      {
        type: 'SOROBAN_IDENTITY_SYNC_CREDENTIALS',
        credentials,
      },
      '*'
    );

    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler);
        resolve({
          success: false,
          count: 0,
          error: 'Extension synchronization timed out. Is the extension installed?',
        });
      }
    }, timeoutMs);
  });
}
