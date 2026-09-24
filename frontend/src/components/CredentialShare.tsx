import React, { useState } from 'react';
import type { Credential } from '../../../sdk/src/types';
import { generateEncryptionKey, encryptCredentialData, trackShareEvent } from '../utils/credentialCrypto';
import { useToast } from '../context/ToastContext';

interface CredentialShareProps {
  credential: Credential;
  onClose?: () => void;
}

export const CredentialShare: React.FC<CredentialShareProps> = ({ credential, onClose }) => {
  const toast = useToast();
  const [expiryHours, setExpiryHours] = useState<number>(24);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      const { key, keyString } = await generateEncryptionKey();
      const expiryMs = expiryHours * 60 * 60 * 1000;
      const encryptedData = await encryptCredentialData(credential, key, expiryMs);

      // Deep link format: app.com/verify?c=<ciphertext>&k=<key>
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('c', encryptedData);
      url.searchParams.set('k', keyString);

      const generatedLink = url.toString();
      setShareUrl(generatedLink);

      trackShareEvent('credential_share_link_created', {
        credentialId: credential.id,
        credentialType: credential.credentialType,
        expiryHours,
      });

      toast.success('Shareable encrypted link generated!');
    } catch (err: unknown) {
      console.error('Failed to generate share link:', err);
      toast.error('Failed to encrypt credential.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      trackShareEvent('credential_share_link_copied', {
        credentialId: credential.id,
      });
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Copy failed:', err);
      toast.error('Failed to copy to clipboard.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '540px',
          background: 'var(--card-bg, #ffffff)',
          color: 'var(--text, #1e293b)',
          borderRadius: '0.75rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          padding: '1.5rem',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 id="share-modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            Share Credential Securely
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.25rem',
                cursor: 'pointer',
                color: 'var(--text-muted, #64748b)',
              }}
            >
              ✕
            </button>
          )}
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #64748b)', marginTop: 0, marginBottom: '1.25rem' }}>
          Generate an encrypted deep link. The raw claims are encrypted client-side using the Web Crypto API (AES-GCM-256) and can only be decrypted by someone with the link.
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Credential ID:
          </div>
          <code
            style={{
              display: 'block',
              padding: '0.5rem',
              backgroundColor: 'var(--bg-accent, #f1f5f9)',
              borderRadius: '0.375rem',
              fontSize: '0.8rem',
              wordBreak: 'break-all',
            }}
          >
            {credential.id}
          </code>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label
            htmlFor="expiry-select"
            style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}
          >
            Link Expiration (default 24h):
          </label>
          <select
            id="expiry-select"
            value={expiryHours}
            onChange={(e) => setExpiryHours(Number(e.target.value))}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--border-input, #cbd5e1)',
              backgroundColor: 'var(--card-bg, #ffffff)',
              color: 'var(--text, #1e293b)',
            }}
          >
            <option value={1}>1 hour</option>
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours (Default)</option>
            <option value={48}>48 hours</option>
            <option value={168}>7 days</option>
          </select>
        </div>

        {!shareUrl ? (
          <button
            type="button"
            onClick={handleGenerateLink}
            disabled={generating}
            style={{
              width: '100%',
              padding: '0.65rem 1rem',
              backgroundColor: 'var(--accent-light, #2563eb)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? 'Encrypting & Generating Link…' : 'Generate Encrypted Deep Link'}
          </button>
        ) : (
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
              Shareable Link:
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="text"
                readOnly
                value={shareUrl}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  fontSize: '0.8rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--border-input, #cbd5e1)',
                  backgroundColor: 'var(--bg-accent, #f8fafc)',
                  color: 'var(--text, #1e293b)',
                }}
              />
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: copied ? '#10b981' : 'var(--accent-light, #2563eb)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ Copied' : 'Copy Link'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)' }}>
                Valid for {expiryHours} hours
              </span>
              <button
                type="button"
                onClick={() => setShareUrl('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-light, #2563eb)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Create new link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialShare;
