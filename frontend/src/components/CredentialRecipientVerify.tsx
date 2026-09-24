import React, { useEffect, useState } from 'react';
import type { Credential } from '../../../sdk/src/types';
import { decryptCredentialData, trackShareEvent } from '../utils/credentialCrypto';
import { formatTimestamp } from '../utils/formatDate';

interface CredentialRecipientVerifyProps {
  ciphertext: string;
  secretKey: string;
  onClose?: () => void;
}

export type RecipientCredentialStatus = 'valid' | 'expired' | 'revoked';

export const CredentialRecipientVerify: React.FC<CredentialRecipientVerifyProps> = ({
  ciphertext,
  secretKey,
  onClose,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState<boolean>(false);
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function decryptAndVerify() {
      setLoading(true);
      setError(null);
      try {
        const result = await decryptCredentialData<Credential>(ciphertext, secretKey);
        if (!isMounted) return;

        setCredential(result.data);
        setLinkExpired(result.isExpired);
        setLinkExpiresAt(result.expiresAt);

        trackShareEvent('credential_deep_link_decrypted', {
          credentialId: result.data.id,
          credentialType: result.data.credentialType,
          isExpired: result.isExpired,
        });
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Decryption failed. Invalid link or corrupted key.';
        setError(msg);
        trackShareEvent('credential_deep_link_decrypt_error', {
          error: msg,
        });
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    if (ciphertext && secretKey) {
      void decryptAndVerify();
    } else {
      setError('Missing encrypted ciphertext (c) or secret key (k) in link.');
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [ciphertext, secretKey]);

  const getStatus = (cred: Credential): RecipientCredentialStatus => {
    if (cred.revoked) return 'revoked';
    if (linkExpired) return 'expired';
    if (cred.expiresAt > 0 && cred.expiresAt * 1000 < Date.now()) return 'expired';
    return 'valid';
  };

  const getStatusBadge = (status: RecipientCredentialStatus) => {
    switch (status) {
      case 'valid':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.6rem',
              borderRadius: '9999px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: '#dcfce7',
              color: '#15803d',
            }}
          >
            ● Valid
          </span>
        );
      case 'expired':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.6rem',
              borderRadius: '9999px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: '#fef3c7',
              color: '#b45309',
            }}
          >
            ● Expired
          </span>
        );
      case 'revoked':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.6rem',
              borderRadius: '9999px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: '#fee2e2',
              color: '#b91c1c',
            }}
          >
            ● Revoked
          </span>
        );
    }
  };

  return (
    <div
      role="region"
      aria-label="Encrypted Credential Verification"
      className="card"
      style={{
        margin: '1.5rem 0',
        padding: '1.5rem',
        border: '1px solid var(--border-input, #e2e8f0)',
        borderRadius: '0.5rem',
        backgroundColor: 'var(--card-bg, #ffffff)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
          🔐 Verified Credential Presentation
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.1rem',
              cursor: 'pointer',
              color: 'var(--text-muted, #64748b)',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {loading && (
        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
          <p>Decrypting credential using Web Crypto key…</p>
        </div>
      )}

      {error && !loading && (
        <div
          role="alert"
          style={{
            padding: '1rem',
            backgroundColor: '#fee2e2',
            color: '#b91c1c',
            borderRadius: '0.375rem',
            fontSize: '0.9rem',
          }}
        >
          <strong>Decryption Error:</strong> {error}
        </div>
      )}

      {credential && !loading && !error && (
        <div>
          {linkExpired && (
            <div
              role="alert"
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: '#fffbeb',
                color: '#b45309',
                borderRadius: '0.375rem',
                marginBottom: '1rem',
                fontSize: '0.85rem',
              }}
            >
              ⚠ Warning: This shared deep link expired at {linkExpiresAt ? new Date(linkExpiresAt).toLocaleString() : 'earlier'}.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              paddingBottom: '0.75rem',
              borderBottom: '1px solid var(--border-input, #e2e8f0)',
            }}
          >
            <div>
              <span style={{ fontSize: '1.1rem', fontWeight: 600, marginRight: '0.5rem' }}>
                {credential.credentialType} Credential
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {credential.id.slice(0, 8)}…{credential.id.slice(-6)}
              </span>
            </div>
            <div>{getStatusBadge(getStatus(credential))}</div>
          </div>

          <dl style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.35rem' }}>
              <dt style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: '120px' }}>Subject:</dt>
              <dd style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>{credential.subject}</dd>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.35rem' }}>
              <dt style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: '120px' }}>Issuer:</dt>
              <dd style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>{credential.issuer}</dd>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.35rem' }}>
              <dt style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: '120px' }}>Issued At:</dt>
              <dd style={{ margin: 0 }}>{formatTimestamp(credential.issuedAt)}</dd>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.35rem' }}>
              <dt style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: '120px' }}>Expires At:</dt>
              <dd style={{ margin: 0 }}>
                {credential.expiresAt === 0 ? 'No expiry' : formatTimestamp(credential.expiresAt)}
              </dd>
            </div>
          </dl>

          <h4 style={{ margin: '1rem 0 0.5rem', fontSize: '0.95rem' }}>Claims</h4>
          {credential.claims && Object.keys(credential.claims).length > 0 ? (
            <div
              style={{
                backgroundColor: 'var(--bg-accent, #f8fafc)',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid var(--border-input, #e2e8f0)',
              }}
            >
              <dl style={{ margin: 0, fontSize: '0.85rem' }}>
                {Object.entries(credential.claims).map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', gap: '1rem', marginBottom: '0.25rem' }}>
                    <dt style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: '120px' }}>{key}:</dt>
                    <dd style={{ margin: 0, color: 'var(--text)' }}>{val}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No claims found.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default CredentialRecipientVerify;
