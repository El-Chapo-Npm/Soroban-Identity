import React, { useEffect, useMemo, useState } from 'react';

export type VerificationBadgeProps = {
  credentialId: string;
  apiBaseUrl?: string;
  title?: string;
  className?: string;
};

export type VerificationPayload = {
  status: 'verified' | 'unverified' | 'pending' | 'error';
  credentialId: string;
  verifiedAt?: string;
  issuer?: string;
  reason?: string;
};

export function getVerificationBadgeUrl({
  credentialId,
  apiBaseUrl = '/api',
}: {
  credentialId: string;
  apiBaseUrl?: string;
}) {
  return `${apiBaseUrl.replace(/\/$/, '')}/credentials/${encodeURIComponent(credentialId)}/verification`;
}

export function generateVerificationBadgeEmbedCode({
  credentialId,
  apiBaseUrl = '/api',
  title = 'Credential verification status',
}: {
  credentialId: string;
  apiBaseUrl?: string;
  title?: string;
}) {
  const url = getVerificationBadgeUrl({ credentialId, apiBaseUrl });
  return `<iframe src="${url}" title="${title}" style="border:0; width:180px; height:52px; border-radius:9999px; overflow:hidden;" loading="lazy"></iframe>`;
}

export function VerificationBadge({
  credentialId,
  apiBaseUrl = '/api',
  title = 'Credential verification status',
  className = '',
}: VerificationBadgeProps) {
  const [status, setStatus] = useState<VerificationPayload['status']>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const response = await fetch(getVerificationBadgeUrl({ credentialId, apiBaseUrl }));
        if (!response.ok) {
          throw new Error(`Verification request failed (${response.status})`);
        }
        const payload = (await response.json()) as VerificationPayload;
        if (!cancelled) {
          setStatus(payload.status ?? 'unverified');
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setStatus('error');
          setError(loadError instanceof Error ? loadError.message : 'Unknown verification error');
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [credentialId, apiBaseUrl]);

  const theme = useMemo(() => {
    switch (status) {
      case 'verified':
        return { label: 'Verified', bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' };
      case 'pending':
        return { label: 'Checking…', bg: '#fef3c7', fg: '#92400e', border: '#fde68a' };
      case 'error':
        return { label: 'Unavailable', bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' };
      case 'unverified':
      default:
        return { label: 'Unverified', bg: '#e5e7eb', fg: '#374151', border: '#d1d5db' };
    }
  }, [status]);

  return (
    <div
      className={['verification-badge', className].filter(Boolean).join(' ')}
      role="status"
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '9999px',
        border: `1px solid ${theme.border}`,
        background: theme.bg,
        color: theme.fg,
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontWeight: 700,
        lineHeight: 1.25,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.12)',
      }}
    >
      <span aria-hidden="true">●</span>
      <span>{theme.label}</span>
      {error ? <span style={{ fontWeight: 500 }}>({error})</span> : null}
    </div>
  );
}

export default VerificationBadge;
