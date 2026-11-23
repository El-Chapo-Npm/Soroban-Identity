import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isExtensionInstalled, syncCredentialsToExtension } from '../extensionBridge';
import { verifyCredentialId, updateExpiringBadge } from '../background';

describe('Browser Extension Support (#1037)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('extensionBridge', () => {
    it('detects when extension is installed via ping/pong', async () => {
      // Mock window message event listener
      const messageHandler = (e: MessageEvent) => {
        if (e.data?.type === 'SOROBAN_IDENTITY_PING') {
          window.postMessage({ type: 'SOROBAN_IDENTITY_PONG', version: '1.0.0' }, '*');
        }
      };
      window.addEventListener('message', messageHandler);

      const installed = await isExtensionInstalled(300);
      expect(installed).toBe(true);

      window.removeEventListener('message', messageHandler);
    });

    it('returns false when extension does not respond to ping', async () => {
      const installed = await isExtensionInstalled(50);
      expect(installed).toBe(false);
    });

    it('syncs credentials to extension successfully', async () => {
      const messageHandler = (e: MessageEvent) => {
        if (e.data?.type === 'SOROBAN_IDENTITY_SYNC_CREDENTIALS') {
          window.postMessage(
            {
              type: 'SOROBAN_IDENTITY_SYNC_RESULT',
              success: true,
              count: e.data.credentials.length,
            },
            '*'
          );
        }
      };
      window.addEventListener('message', messageHandler);

      const result = await syncCredentialsToExtension([
        {
          id: 'cred-123',
          issuer: 'GABC...',
          subject: 'GDEF...',
          credentialType: 'KYC',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
          claims: {},
          status: 'valid',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);

      window.removeEventListener('message', messageHandler);
    });
  });

  describe('background verification and badges', () => {
    beforeEach(() => {
      // Mock chrome global
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              credentials: [
                {
                  id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                  issuer: 'GISSUER',
                  subject: 'GSUBJECT',
                  credentialType: 'KYC',
                  issuedAt: 1000,
                  expiresAt: Date.now() + 10 * 86400 * 1000, // expires in 10 days
                  status: 'valid',
                },
              ],
            }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
        action: {
          setBadgeText: vi.fn().mockResolvedValue(undefined),
          setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
          setTitle: vi.fn().mockResolvedValue(undefined),
        },
      };
    });

    it('verifies existing stored credential as valid', async () => {
      const res = await verifyCredentialId(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      );
      expect(res.isValid).toBe(true);
      expect(res.issuer).toBe('GISSUER');
    });

    it('updates badge notification count for credentials expiring within 30 days', async () => {
      const expiringCount = await updateExpiringBadge();
      expect(expiringCount).toBe(1);
      expect((globalThis as any).chrome.action.setBadgeText).toHaveBeenCalledWith({
        text: '1',
      });
      expect((globalThis as any).chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#eab308',
      });
    });
  });
});
