/**
 * Browser Extension Content Script (#1037)
 * Injected into web pages to support:
 * 1. Web app synchronization bridge via postMessage.
 * 2. Form detection and one-click auto-fill for credential and DID fields.
 * 3. In-page overlay notifications for context-menu credential verification.
 */

import type {
  ExtensionCredential,
  VerificationResultPayload,
} from './types';

declare const chrome: any;

// 1. Announce extension availability to web apps
try {
  window.postMessage({ type: 'SOROBAN_IDENTITY_EXTENSION_READY', version: '1.0.0' }, '*');
} catch {
  // ignore
}

// 2. Listen for messages from web application (e.g. Soroban Identity frontend)
window.addEventListener('message', async (event: MessageEvent) => {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;

  // Web app requesting to sync credentials into extension
  if (event.data.type === 'SOROBAN_IDENTITY_SYNC_CREDENTIALS') {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_CREDENTIALS',
        payload: {
          credentials: event.data.credentials,
          appOrigin: window.location.origin,
          syncedAt: Date.now(),
        },
      });

      window.postMessage(
        {
          type: 'SOROBAN_IDENTITY_SYNC_RESULT',
          success: response?.success ?? false,
          count: response?.count ?? 0,
          expiringCount: response?.expiringCount ?? 0,
        },
        '*'
      );
    } catch (err: unknown) {
      window.postMessage(
        {
          type: 'SOROBAN_IDENTITY_SYNC_RESULT',
          success: false,
          error: err instanceof Error ? err.message : 'Extension sync failed',
        },
        '*'
      );
    }
  }

  // Web app checking if extension is installed
  if (event.data.type === 'SOROBAN_IDENTITY_PING') {
    window.postMessage(
      {
        type: 'SOROBAN_IDENTITY_PONG',
        version: '1.0.0',
      },
      '*'
    );
  }
});

// 3. Listen for commands from extension background / context menu
chrome.runtime.onMessage.addListener(
  (
    message: { type: string; payload: any },
    _sender: any,
    sendResponse: (res?: any) => void
  ) => {
    if (message.type === 'SHOW_VERIFICATION_RESULT') {
      showVerificationBanner(message.payload as VerificationResultPayload);
      sendResponse({ received: true });
    }

    if (message.type === 'AUTOFILL_FORM') {
      const creds: ExtensionCredential[] = message.payload?.credentials || [];
      autoFillPageForms(creds);
      sendResponse({ autofilled: true });
    }
  }
);

// 4. In-page overlay verification notification banner
function showVerificationBanner(result: VerificationResultPayload): void {
  const existing = document.getElementById('soroban-verification-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'soroban-verification-banner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'assertive');

  const isValid = result.isValid;
  const bgColor = isValid ? '#065f46' : '#7f1d1d';
  const borderColor = isValid ? '#10b981' : '#ef4444';
  const icon = isValid ? '✅' : '❌';
  const title = isValid ? 'Credential Verified Valid' : 'Verification Failed';

  banner.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2147483647;
    min-width: 300px;
    max-width: 420px;
    padding: 14px 18px;
    background: ${bgColor};
    color: #ffffff;
    border: 1px solid ${borderColor};
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    animation: sorobanFadeIn 0.25s ease-out;
  `;

  banner.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
      <strong style="font-size: 14px; display: flex; align-items: center; gap: 6px;">
        ${icon} ${title}
      </strong>
      <button id="soroban-close-banner" style="background: none; border: none; color: #fff; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px;">&times;</button>
    </div>
    <div style="font-family: monospace; word-break: break-all; opacity: 0.9; font-size: 11px; margin-bottom: 4px;">
      ID: ${result.credentialId}
    </div>
    ${result.issuer ? `<div style="opacity: 0.9;">Issuer: ${result.issuer.slice(0, 10)}...${result.issuer.slice(-6)}</div>` : ''}
    ${result.error ? `<div style="color: #fca5a5; margin-top: 4px;">Reason: ${result.error}</div>` : ''}
    <div style="margin-top: 8px; font-size: 11px; opacity: 0.75; text-align: right;">
      Verified via Soroban Identity
    </div>
  `;

  document.body.appendChild(banner);

  const closeBtn = document.getElementById('soroban-close-banner');
  closeBtn?.addEventListener('click', () => banner.remove());

  // Auto-dismiss after 6 seconds
  setTimeout(() => {
    if (document.body.contains(banner)) {
      banner.remove();
    }
  }, 6000);
}

// 5. Auto-fill form fields
function autoFillPageForms(credentials: ExtensionCredential[]): void {
  if (credentials.length === 0) return;
  const primary = credentials[0];

  const selectors = [
    'input[name*="credential" i]',
    'input[name*="did" i]',
    'input[name*="stellar" i]',
    'input[name*="identity" i]',
    'input[id*="credential" i]',
    'input[data-credential]',
    'textarea[name*="credential" i]',
  ];

  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    selectors.join(',')
  );

  inputs.forEach((input) => {
    const name = (input.name || input.id || '').toLowerCase();

    if (name.includes('did') || name.includes('subject')) {
      fillInput(input, primary.subject);
    } else if (name.includes('issuer')) {
      fillInput(input, primary.issuer);
    } else {
      fillInput(input, primary.id);
    }
  });
}

function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Visual highlight
  const origOutline = el.style.outline;
  el.style.outline = '2px solid #10b981';
  setTimeout(() => {
    el.style.outline = origOutline;
  }, 1200);
}
