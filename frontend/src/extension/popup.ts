/**
 * Browser Extension Popup Script (#1037)
 * Loads locally stored credentials, allows one-click verification,
 * filters by keyword, and initiates form auto-fill.
 */

import type { ExtensionCredential } from './types';

declare const chrome: any;

const EXPIRY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

document.addEventListener('DOMContentLoaded', async () => {
  const listContainer = document.getElementById('credential-list');
  const countBadge = document.getElementById('cred-count-badge');
  const expiringAlert = document.getElementById('expiring-alert');
  const expiringText = document.getElementById('expiring-text');
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const autofillBtn = document.getElementById('autofill-btn');
  const openAppBtn = document.getElementById('open-app-btn');

  let allCredentials: ExtensionCredential[] = [];

  // 1. Fetch credentials from storage
  try {
    const data = await chrome.storage.local.get(['credentials', 'lastSyncedAt']);
    allCredentials = data.credentials || [];
  } catch (e) {
    console.error('Failed to load extension storage', e);
  }

  // 2. Render badge & expiring alert
  if (countBadge) {
    countBadge.textContent = `${allCredentials.length} Stored`;
  }

  const now = Date.now();
  const expiring = allCredentials.filter((c) => {
    const exp = c.expiresAt > 1e11 ? c.expiresAt : c.expiresAt * 1000;
    return exp > now && exp <= now + EXPIRY_THRESHOLD_MS;
  });

  if (expiring.length > 0 && expiringAlert && expiringText) {
    expiringAlert.style.display = 'block';
    expiringText.textContent = `${expiring.length} credential(s) expire within 30 days!`;
  }

  // 3. Render list function
  function renderList(creds: ExtensionCredential[]) {
    if (!listContainer) return;

    if (creds.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          No matching credentials found.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = creds
      .map((c) => {
        const exp = c.expiresAt > 1e11 ? c.expiresAt : c.expiresAt * 1000;
        const isExpiring = exp > now && exp <= now + EXPIRY_THRESHOLD_MS;
        const isExpired = exp > 0 && exp <= now;
        const statusBadge = isExpired
          ? '<span class="badge" style="background:rgba(239,68,68,0.2);color:#ef4444;">Expired</span>'
          : isExpiring
          ? '<span class="badge badge-warning">Expiring</span>'
          : '<span class="badge badge-success">Valid</span>';

        return `
          <div class="credential-card" data-id="${c.id}">
            <div class="cred-header">
              <span>${c.credentialType || 'Credential'}</span>
              ${statusBadge}
            </div>
            <div class="cred-id">${c.id}</div>
            <div style="font-size: 11px; opacity: 0.8; margin-bottom: 6px;">
              Subject: ${c.subject ? c.subject.slice(0, 10) + '...' + c.subject.slice(-6) : 'Unknown'}
            </div>
            <div class="cred-actions">
              <button class="verify-btn" data-id="${c.id}">✓ Verify</button>
              <button class="btn-secondary copy-id-btn" data-id="${c.id}">Copy ID</button>
            </div>
          </div>
        `;
      })
      .join('');

    // Attach event listeners to buttons
    listContainer.querySelectorAll('.verify-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const id = target.getAttribute('data-id');
        if (!id) return;

        target.disabled = true;
        target.textContent = 'Verifying...';

        try {
          const res = await chrome.runtime.sendMessage({
            type: 'VERIFY_CREDENTIAL',
            payload: { credentialId: id },
          });

          target.textContent = res.isValid ? '✓ Valid' : '✗ Invalid';
          target.style.background = res.isValid ? '#10b981' : '#ef4444';
        } catch {
          target.textContent = 'Error';
        }
      });
    });

    listContainer.querySelectorAll('.copy-id-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const id = target.getAttribute('data-id');
        if (id) {
          navigator.clipboard.writeText(id);
          const orig = target.textContent;
          target.textContent = 'Copied!';
          setTimeout(() => {
            target.textContent = orig;
          }, 1500);
        }
      });
    });
  }

  // Initial render
  renderList(allCredentials);

  // 4. Live filter search
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) {
      renderList(allCredentials);
      return;
    }

    const filtered = allCredentials.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.credentialType.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.issuer.toLowerCase().includes(q)
    );
    renderList(filtered);
  });

  // 5. Auto-fill button
  autofillBtn?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'AUTOFILL_FORM',
          payload: { credentials: allCredentials },
        });
        window.close();
      }
    } catch (e) {
      console.error('Failed to trigger autofill', e);
    }
  });

  // 6. Open Web App button
  openAppBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://identity.soroban.stellar.org' });
  });
});
