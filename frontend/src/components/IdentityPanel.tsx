import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import ConfirmDialog from './ConfirmDialog';
import type { WalletState } from '../hooks/useWallet';
import type { ReputationRecord } from '../../../sdk/src/reputation';

interface Props {
  wallet: WalletState & {
    connect: () => void;
    signTransaction: (xdr: string) => Promise<string>;
  };
}

export default function IdentityPanel({ wallet }: Props) {
  const [resolveAddress, setResolveAddress] = useState('');
  const [resolveResult, setResolveResult] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [reputation, setReputation] = useState<ReputationRecord | null>(null);
  const [reputationLoading, setReputationLoading] = useState(false);

  const [createResult, setCreateResult] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [minScore, setMinScore] = useState("50");
  const [minReporters, setMinReporters] = useState("2");
  const [sybilResult, setSybilResult] = useState<boolean | null>(null);
  const [checkingsSybil, setCheckingSybil] = useState(false);

  // resolveAddress is considered "loaded" once a resolve has succeeded
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  const handleResolve = async () => {
    if (!resolveAddress.trim()) return;
    setResolving(true);
    setResolveResult(null);
    setReputation(null);
    setSybilResult(null);
    try {
      // TODO: wire IdentityClient.resolveDid() from SDK
      await new Promise((r) => setTimeout(r, 800));
      const mock = {
        id: `did:stellar:${resolveAddress}`,
        controller: resolveAddress,
        metadata: {},
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        active: true,
      };
      setResolveResult(JSON.stringify(mock, null, 2));

      // Fetch reputation alongside DID resolution
      setReputationLoading(true);
      try {
        // TODO: wire ReputationClient.getReputation() from SDK
        await new Promise((r) => setTimeout(r, 600));
        const mockRep: ReputationRecord = {
          subject: resolveAddress,
          score: 42,
          reporterCount: 3,
          updatedAt: Math.floor(Date.now() / 1000),
        };
        setReputation(mockRep);
      } catch {
        setReputation(null);
      } finally {
        setReputationLoading(false);
      }
      setResolvedAddress(resolveAddress.trim());
    } catch (e: unknown) {
      setResolveResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setResolvedAddress(null);
    } finally {
      setResolving(false);
    }
  };

  const handleCreate = async () => {
    if (!wallet.connected || !wallet.publicKey) return;
    setCreating(true);
    setCreateResult(null);
    try {
      // TODO: build tx via IdentityClient, sign via wallet.signTransaction(), submit
      await new Promise((r) => setTimeout(r, 1000));
      setCreateResult(`DID created: did:stellar:${wallet.publicKey}`);
    } catch (e: unknown) {
      setCreateResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    if (!wallet.connected || !wallet.publicKey) return;
    setDeleting(true);
    setCreateResult(null);
    try {
      // TODO: build deactivate tx via IdentityClient, sign via wallet.signTransaction(), submit
      await new Promise((r) => setTimeout(r, 1000));
      setCreateResult(`DID deactivated: did:stellar:${wallet.publicKey}`);
    } catch (e: unknown) {
      setCreateResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleSybilCheck = async () => {
    if (!resolvedAddress) return;
    setCheckingSybil(true);
    setSybilResult(null);
    try {
      // TODO: wire ReputationClient.passesSybilCheck() from SDK
      await new Promise((r) => setTimeout(r, 800));
      // Mock: passes if minScore <= 100 and minReporters <= 5
      const passes = Number(minScore) <= 100 && Number(minReporters) <= 5;
      setSybilResult(passes);
    } catch (e: unknown) {
      setSybilResult(null);
    } finally {
      setCheckingSybil(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Resolve DID</h2>
        <input
          placeholder="Stellar address (G…)"
          value={resolveAddress}
          onChange={(e) => setResolveAddress(e.target.value)}
        />
        <button onClick={handleResolve} disabled={resolving || !resolveAddress}>
          {resolving ? 'Resolving…' : 'Resolve'}
        </button>
        {resolveResult && <pre className="result">{resolveResult}</pre>}

        {reputationLoading && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
            Loading reputation…
          </p>
        )}

        {!reputationLoading && reputation && (
          <div
            className="card"
            style={{ marginTop: '1rem', background: 'var(--card-bg-accent)', border: '1px solid var(--card-border-accent)' }}
          >
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--accent-light)' }}>Reputation</h3>
            <p>Score: {reputation.score}</p>
            <p>Reporters: {reputation.reporterCount}</p>
            <p>
              Last updated:{' '}
              {new Date(reputation.updatedAt * 1000).toLocaleDateString()}
            </p>
          </div>
        )}

        {!reputationLoading && resolveResult && !reputation && (
          <div
            className="card"
            style={{ marginTop: '1rem', background: 'var(--card-bg-accent)', border: '1px solid var(--border-input)' }}
          >
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Reputation</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No reputation record found for this address.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Anti-Sybil Check</h2>
        {resolvedAddress ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Checking{' '}
              <span style={{ color: 'var(--accent-light)' }}>
                {resolvedAddress.slice(0, 6)}…{resolvedAddress.slice(-4)}
              </span>
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                  Min Score
                </label>
                <input
                  type="number"
                  min={0}
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                  Min Reporters
                </label>
                <input
                  type="number"
                  min={1}
                  value={minReporters}
                  onChange={(e) => setMinReporters(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <button onClick={handleSybilCheck} disabled={checkingsSybil}>
              {checkingsSybil ? 'Checking…' : 'Run Sybil Check'}
            </button>
            {sybilResult !== null && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.6rem 1rem',
                  borderRadius: '0.5rem',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  background: `var(${sybilResult ? '--sybil-pass-bg' : '--sybil-fail-bg'})`,
                  color: `var(${sybilResult ? '--sybil-pass-text' : '--sybil-fail-text'})`,
                  border: `1px solid var(${sybilResult ? '--sybil-pass-border' : '--sybil-fail-border'})`,
                }}
              >
                {sybilResult ? '✓ Passes sybil check' : '✗ Fails sybil check'}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Resolve a DID above to run the anti-sybil check.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Create DID</h2>
        {wallet.connected && wallet.publicKey ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Connected as{' '}
              <span style={{ color: 'var(--accent-light)' }}>
                {wallet.publicKey.slice(0, 6)}…{wallet.publicKey.slice(-4)}
              </span>
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleCreate} disabled={creating || deleting}>
                {creating ? 'Creating…' : 'Create DID'}
              </button>
              <button className="btn-danger" onClick={() => setConfirmDelete(true)} disabled={creating || deleting}>
                {deleting ? 'Deleting…' : 'Delete DID'}
              </button>
            </div>
            <div>
              <div className="qr-wrapper" aria-label="QR code for your DID">
                <QRCodeSVG value={`did:stellar:${wallet.publicKey}`} size={160} />
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem', wordBreak: 'break-all' }}>
                Scan to share did:stellar:{wallet.publicKey}
              </p>
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Connect your Freighter wallet to create a new on-chain DID.
          </p>
        )}
        {createResult && <pre className="result">{createResult}</pre>}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete identity?"
        message="This will deactivate your on-chain DID. This action cannot be undone."
        confirmLabel="Delete DID"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
