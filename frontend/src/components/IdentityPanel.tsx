import { useState, useReducer, useEffect, useRef } from 'react';
import DidQrCode from './DidQrCode';
import { StrKey } from '@stellar/stellar-sdk';
import type { WalletState } from '../hooks/useWallet';
import type { ReputationRecord } from '../../../sdk/src/reputation';
import type { ScoreHistoryEntry } from '../../../sdk/src/reputation';
import type { DidDocument } from '../../../sdk/src/types';
import { useAddressHistory } from '../hooks/useAddressHistory';
import SkeletonCard from './SkeletonCard';
import FormField from './FormField';
import ReputationChart from './ReputationChart';
import IdentityDirectory from './IdentityDirectory';
import { formatTimestamp } from '../utils/formatDate';
import { handleError, isNetworkError } from '../utils/handleError';
import { useWalletContext } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { exportDidDocumentAsJsonLd } from '../../../sdk/src/serializers';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { useSorobanInvoke } from '../hooks/useSorobanInvoke';
import { downloadIdentityExport } from '../utils/exportIdentity';
import { RecoveryPhraseBackup } from './RecoveryPhraseBackup';
import { ProfilePictureUpload } from './ProfilePictureUpload';
import { IdentityClient, ReputationClient } from '../../../sdk/src';
import { getNetworkConfig } from '../network';
import { copyToClipboard } from '../utils/clipboard';

type IdentityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; did: DidDocument; reputation: ReputationRecord | null; scoreHistory: ScoreHistoryEntry[] }
  | { status: 'error'; message: string; errorType: 'network' | 'contract' };

type IdentityAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; did: DidDocument; reputation: ReputationRecord | null; scoreHistory: ScoreHistoryEntry[] }
  | { type: 'FETCH_ERROR'; message: string; errorType: 'network' | 'contract' }
  | { type: 'RESET' };

function identityReducer(_state: IdentityState, action: IdentityAction): IdentityState {
  switch (action.type) {
    case 'FETCH_START': return { status: 'loading' };
    case 'FETCH_SUCCESS': return { status: 'success', did: action.did, reputation: action.reputation, scoreHistory: action.scoreHistory };
    case 'FETCH_ERROR': return { status: 'error', message: action.message, errorType: action.errorType };
    case 'RESET': return { status: 'idle' };
  }
}

const MAX_METADATA_KEY_LEN = 64;
const MAX_METADATA_VALUE_LEN = 500;

interface MetadataValidationResult {
  valid: boolean;
  message: string | null;
  fieldErrors: Record<number, string>;
}

/** Validates DID metadata key/value entries: non-empty keys, length limits, no duplicates. */
function validateMetadataFields(
  entries: Array<{ key: string; value: string }>,
): MetadataValidationResult {
  const fieldErrors: Record<number, string> = {};
  const seenKeys = new Map<string, number>();

  entries.forEach((entry, idx) => {
    const key = entry.key.trim();
    const value = entry.value.trim();
    if (!key && !value) return; // fully blank row — ignored on submit

    if (!key) {
      fieldErrors[idx] = 'Key is required when a value is provided';
    } else if (key.length > MAX_METADATA_KEY_LEN) {
      fieldErrors[idx] = `Key must be ${MAX_METADATA_KEY_LEN} characters or fewer`;
    } else if (value.length > MAX_METADATA_VALUE_LEN) {
      fieldErrors[idx] = `Value must be ${MAX_METADATA_VALUE_LEN} characters or fewer`;
    } else if (seenKeys.has(key)) {
      fieldErrors[idx] = 'Duplicate metadata key';
      fieldErrors[seenKeys.get(key)!] = 'Duplicate metadata key';
    } else {
      seenKeys.set(key, idx);
    }
  });

  const valid = Object.keys(fieldErrors).length === 0;
  return {
    valid,
    message: valid ? null : 'Please fix the highlighted metadata fields.',
    fieldErrors,
  };
}

export default function IdentityPanel({ wallet: propWallet }: { wallet?: any } = {}) {
  const contextWallet = useWalletContext();
  const wallet = propWallet ?? contextWallet;
  const invokeContract = useSorobanInvoke(propWallet);
  const toast = useToast();
  const [identityState, dispatch] = useReducer(identityReducer, { status: 'idle' });
  const resolving = identityState.status === 'loading';
  const networkError = identityState.status === 'error'
    ? { type: identityState.errorType as 'network' | 'contract', message: identityState.message }
    : null;
  const reputation = identityState.status === 'success' ? identityState.reputation : null;
  const reputationLoading = identityState.status === 'loading';
  const scoreHistory = identityState.status === 'success' ? identityState.scoreHistory : [];
  const resolvedAddress = identityState.status === 'success' ? identityState.did.controller : null;
  const resolvedDoc = identityState.status === 'success' ? identityState.did : null;

  const [resolveAddress, setResolveAddress] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const { history, addAddress, clearHistory } = useAddressHistory();

  // ── Recent DID search/filter (#641) ────────────────────────────────────
  const [historyQuery, setHistoryQuery] = useState('');
  const [debouncedHistoryQuery, setDebouncedHistoryQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHistoryQuery(historyQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [historyQuery]);
  const filteredHistory = debouncedHistoryQuery
    ? history.filter((addr) => addr.toLowerCase().includes(debouncedHistoryQuery.toLowerCase()))
    : history;
  const clearHistoryFilter = () => setHistoryQuery('');

  const prevConnected = useRef(wallet.connected);
  useEffect(() => {
    if (prevConnected.current && !wallet.connected) {
      clearHistory();
    }
    prevConnected.current = wallet.connected;
  }, [wallet.connected, clearHistory]);

  const [createResult, setCreateResult] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // ── Creation wizard (#1299) ────────────────────────────────────────────
  const [createStep, setCreateStep] = useState(1);
  const [createDid, setCreateDid] = useState('');
  const [createDidError, setCreateDidError] = useState<string | null>(null);

  /** Validates the DID field on step 3: required, non-whitespace. */
  const validateCreateDid = (value: string): string | null => {
    if (!value.trim()) return 'DID is required';
    return null;
  };

  const handleCreateNext = () => {
    if (createStep === 3) {
      const error = validateCreateDid(createDid);
      setCreateDidError(error);
      if (error) return;
    }
    setCreateStep((s) => Math.min(s + 1, 3));
  };

  const handleCreateBack = () => {
    setCreateStep((s) => Math.max(s - 1, 1));
  };

  const [metadataEntries, setMetadataEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState<Array<{ key: string; value: string }>>([]);
  const [editingFieldErrors, setEditingFieldErrors] = useState<Record<number, string | null>>({});

  const [minScore, setMinScore] = useState("50");
  const [minReporters, setMinReporters] = useState("2");
  const [sybilResult, setSybilResult] = useState<boolean | null>(null);
  const [checkingsSybil, setCheckingSybil] = useState(false);

  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleResolve = async (addressOverride?: string) => {
    if (resolving) return; // guard against duplicate submissions
    const address = (addressOverride ?? resolveAddress).trim();
    if (!address) return;

    // Validate Stellar address format
    if (!StrKey.isValidEd25519PublicKey(address)) {
      const message = 'Invalid Stellar address format. Address must start with "G" and be 56 characters long.';
      dispatch({ type: 'FETCH_ERROR', message, errorType: 'contract' });
      toast.error(message);
      return;
    }

    addAddress(address);
    dispatch({ type: 'FETCH_START' });
    setSybilResult(null);
    try {
      const networkConfig = getNetworkConfig();
      const identityClient = new IdentityClient(networkConfig);
      const didDoc = await identityClient.resolveDid(address);

      let resolvedRep: ReputationRecord | null = null;
      let resolvedHistory: ScoreHistoryEntry[] = [];
      try {
        const reputationClient = new ReputationClient(networkConfig);
        resolvedRep = await reputationClient.getReputation(address, address);
        resolvedHistory = await reputationClient.getScoreHistory(address, address, address);
      } catch (e) {
        // reputation fetch failed — proceed with null
      }

      dispatch({ type: 'FETCH_SUCCESS', did: didDoc, reputation: resolvedRep, scoreHistory: resolvedHistory });
      toast.success('DID resolved.');
    } catch (e: unknown) {
      const message = handleError(e);
      dispatch({
        type: 'FETCH_ERROR',
        message,
        errorType: isNetworkError(e) ? 'network' : 'contract',
      });
      toast.error(message);
    }
  };

  const handleExportDid = () => {
    if (!resolvedDoc) return;
    const blob = new Blob([JSON.stringify(resolvedDoc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'did-document.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportIdentityData = () => {
    if (!resolvedDoc || !resolvedAddress) return;
    downloadIdentityExport({
      did: resolvedDoc,
      address: resolvedAddress,
      network: getNetworkConfig().name,
      reputation,
      scoreHistory,
    });
  };

  const handleAvatarLinked = async (cid: string) => {
    if (!wallet.connected || !wallet.publicKey) {
      throw new Error('Connect your wallet to link a profile picture.');
    }
    const networkConfig = getNetworkConfig();
    await invokeContract({
      contractId: networkConfig.identityRegistryId,
      method: 'update_did',
      args: [
        nativeToScVal(wallet.publicKey, { type: 'address' }),
        nativeToScVal(
          { ...(resolvedDoc?.metadata ?? {}), avatar: `ipfs://${cid}` },
          { type: 'map' }
        ),
      ],
    });
  };

  const handleExportJsonLd = () => {
    if (!resolvedDoc) return;
    const blob = new Blob([exportDidDocumentAsJsonLd(resolvedDoc)], { type: 'application/ld+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'did-document.jsonld';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyDid = async () => {
    if (!resolvedAddress) return;
    const did = `did:stellar:${resolvedAddress}`;
    const copiedSuccessfully = await copyToClipboard(did);
    if (copiedSuccessfully) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreate = async () => {
    if (creating) return; // guard against duplicate submissions
    if (!wallet.connected || !wallet.publicKey) return;

    // Step 3 validation: DID is required (#1299)
    const didError = validateCreateDid(createDid);
    setCreateDidError(didError);
    if (didError) {
      toast.error(didError);
      return;
    }

    setCreating(true);
    setCreateResult(null);
    try {
      const networkConfig = getNetworkConfig();
      const { fee: estimatedFee } = await invokeContract({
        contractId: networkConfig.identityRegistryId,
        method: "create_did",
        args: [
          nativeToScVal(wallet.publicKey, { type: "address" }),
          nativeToScVal({}, { type: "map" }),
        ],
      });

      setCreateResult(
        `DID created: did:stellar:${wallet.publicKey}\nEstimated fee: ${estimatedFee} stroops (${(estimatedFee / 10_000_000).toFixed(7)} XLM)`
      );
      toast.success('DID created successfully.');
    } catch (e: unknown) {
      const message = handleError(e);
      setCreateResult(`Error: ${message}`);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async () => {
    if (updating) return; // guard against duplicate submissions
    if (!wallet.connected || !wallet.publicKey) return;

    const validation = validateMetadataFields(metadataEntries);
    if (!validation.valid) {
      setMetadataError(validation.message);
      toast.error(validation.message ?? 'Invalid metadata.');
      return;
    }

    setMetadataError(null);
    setUpdating(true);
    setUpdateSuccess(false);
    try {
      // Build metadata object from entries
      const metadata: Record<string, string> = {};
      metadataEntries.forEach(entry => {
        if (entry.key.trim() && entry.value.trim()) {
          metadata[entry.key.trim()] = entry.value.trim();
        }
      });

      const networkConfig = getNetworkConfig();
      await invokeContract({
        contractId: networkConfig.identityRegistryId,
        method: "update_did",
        args: [
          nativeToScVal(wallet.publicKey, { type: "address" }),
          nativeToScVal(metadata, { type: "map" }),
        ],
      });

      // Wait for metadata to be indexed after transaction confirmation
      // Issue #665: Add small delay to ensure metadata is persisted on-chain
      await new Promise(r => setTimeout(r, 1000));

      const identityClient = new IdentityClient(networkConfig);
      let updatedDid;
      let retries = 3;
      let lastError: Error | null = null;

      // Retry logic to handle state propagation delays
      while (retries > 0) {
        try {
          updatedDid = await identityClient.resolveDid(wallet.publicKey);
          // Verify metadata was actually updated by checking if it contains expected keys
          const expectedKeys = metadataEntries
            .map(e => e.key.trim())
            .filter(k => k);
          const updatedKeys = Object.keys(updatedDid.metadata || {});
          const allKeysPresent = expectedKeys.every(key => updatedKeys.includes(key));

          if (allKeysPresent || retries === 1) {
            break;
          }
          retries--;
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (e) {
          lastError = e as Error;
          retries--;
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }

      if (!updatedDid) {
        throw lastError || new Error("Failed to fetch updated DID");
      }

      dispatch({ type: 'FETCH_SUCCESS', did: updatedDid, reputation: null, scoreHistory: [] });
      setUpdateSuccess(true);
      toast.success('DID metadata updated.');
      setTimeout(() => setUpdateSuccess(false), 3000);
    } catch (e: unknown) {
      const message = handleError(e);
      setMetadataError(message);
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSybilCheck = async () => {
    if (checkingsSybil) return; // guard against duplicate submissions
    if (!resolvedAddress) return;
    setCheckingSybil(true);
    setSybilResult(null);
    try {
      const networkConfig = getNetworkConfig();
      const reputationClient = new ReputationClient(networkConfig);
      const passes = await reputationClient.passesSybilCheck(
        resolvedAddress,
        resolvedAddress,
        Number(minScore),
        Number(minReporters)
      );
      setSybilResult(passes);
    } catch (e: unknown) {
      setSybilResult(null);
      toast.error(handleError(e));
    } finally {
      setCheckingSybil(false);
    }
  };

  const handleEditMetadata = () => {
    if (resolvedDoc?.metadata) {
      const entries = Object.entries(resolvedDoc.metadata).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEditingMetadata(entries);
    }
    setIsEditingMetadata(true);
    setEditingFieldErrors({});
  };

  const handleCancelEdit = () => {
    setIsEditingMetadata(false);
    setEditingMetadata([]);
    setEditingFieldErrors({});
  };

  // Warn user if navigating away while editing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditingMetadata) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditingMetadata]);

  const handleSaveMetadata = async () => {
    if (updating) return; // guard against duplicate submissions
    if (!wallet.connected || !wallet.publicKey) return;

    const validation = validateMetadataFields(editingMetadata);
    setEditingFieldErrors(validation.fieldErrors);
    if (!validation.valid) {
      setMetadataError(validation.message);
      toast.error(validation.message ?? 'Invalid metadata.');
      return;
    }

    setMetadataError(null);
    setUpdating(true);
    setUpdateSuccess(false);
    try {
      // Build metadata object from entries
      const metadata: Record<string, string> = {};
      editingMetadata.forEach(entry => {
        if (entry.key.trim() && entry.value.trim()) {
          metadata[entry.key.trim()] = entry.value.trim();
        }
      });

      const networkConfig = getNetworkConfig();
      await invokeContract({
        contractId: networkConfig.identityRegistryId,
        method: "update_did",
        args: [
          nativeToScVal(wallet.publicKey, { type: "address" }),
          nativeToScVal(metadata, { type: "map" }),
        ],
      });
      
      const identityClient = new IdentityClient(networkConfig);
      const updatedDid = await identityClient.resolveDid(wallet.publicKey);
      
      dispatch({ type: 'FETCH_SUCCESS', did: updatedDid, reputation: null, scoreHistory: [] });
      setUpdateSuccess(true);
      setIsEditingMetadata(false);
      setEditingMetadata([]);
      toast.success('DID metadata updated.');
      setTimeout(() => setUpdateSuccess(false), 3000);
    } catch (e: unknown) {
      const message = handleError(e);
      setMetadataError(message);
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Resolve DID</h2>
        {networkError && (
          <div
            role="alert"
            style={{
              background: networkError.type === "network" ? "var(--error-bg, #f8d7da)" : "var(--warning-bg, #fff3cd)",
              color: networkError.type === "network" ? "var(--error-text, #721c24)" : "var(--warning-text, #856404)",
              border: `1px solid ${networkError.type === "network" ? "var(--error-border, #f5c6cb)" : "var(--warning-border, #ffc107)"}`,
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              marginBottom: "1rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.9rem",
            }}
          >
            <span>
              {networkError.type === "network" ? "🌐 " : "⚠ "}
              {networkError.message}
            </span>
            <button
              onClick={() => {
                dispatch({ type: 'RESET' });
                handleResolve();
              }}
              style={{
                marginLeft: "1rem",
                padding: "0.3rem 0.75rem",
                fontSize: "0.85rem",
                background: networkError.type === "network" ? "var(--error)" : "var(--warning)",
                color: "white",
                border: "none",
                borderRadius: "0.25rem",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}
        <label htmlFor="resolve-address" className="visually-hidden">
          Stellar address to resolve
        </label>
        <input
          id="resolve-address"
          data-tour="resolve-did-input"
          data-tour-resolve-did="resolve-did"
          placeholder="Stellar address (G…)"
          value={resolveAddress}
          onChange={(e) => setResolveAddress(e.target.value)}
        />
        <button onClick={() => void handleResolve()} disabled={resolving || !resolveAddress}>
          {resolving ? 'Resolving…' : 'Resolve'}
        </button>
        {resolving && <SkeletonCard variant="identity" />}

        {history.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
            >
              {showHistory ? 'Hide' : 'Show'} Recent DIDs ({history.length})
            </button>

            {showHistory && (
              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  background: 'var(--card-bg-accent)',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-input)',
                }}
              >
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <label htmlFor="did-history-search" className="visually-hidden">
                    Search recent DIDs by address
                  </label>
                  <input
                    id="did-history-search"
                    type="search"
                    placeholder="Filter recent DIDs by address…"
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    style={{ flex: 1, fontSize: '0.85rem' }}
                  />
                  {historyQuery && (
                    <button
                      type="button"
                      onClick={clearHistoryFilter}
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                    >
                      Clear filter
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearHistory}
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                  >
                    Clear history
                  </button>
                </div>

                <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {filteredHistory.length} of {history.length} address{history.length === 1 ? '' : 'es'}
                </p>

                {filteredHistory.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    No recent DIDs match "{debouncedHistoryQuery}".
                  </p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {filteredHistory.map((addr) => (
                      <li key={addr}>
                        <button
                          type="button"
                          onClick={() => {
                            setResolveAddress(addr);
                            void handleResolve(addr);
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            padding: '0.3rem 0.5rem',
                            background: 'transparent',
                            border: '1px solid var(--border-input)',
                            borderRadius: '0.25rem',
                            cursor: 'pointer',
                          }}
                          title={addr}
                        >
                          {addr.slice(0, 10)}…{addr.slice(-6)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {!resolving && resolvedAddress && (
          <>
            <div
              data-tour="did-document"
              style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: 'var(--card-bg-accent)',
              borderRadius: '0.5rem',
              border: '1px solid var(--card-border-accent)'
            }}>
              <div
                style={{ flex: 1, wordBreak: 'break-all', fontSize: '0.9rem' }}
                title={`did:stellar:${resolvedAddress}`}
              >
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>did:stellar:</span>
                <span
                  className="did-identifier"
                  style={{ color: 'var(--accent-light)', fontWeight: 700 }}
                >
                  {/* Full address — hidden on mobile via CSS, shown on desktop */}
                  <span className="did-identifier-full">{resolvedAddress}</span>
                  {/* Truncated address — shown on mobile, hidden on desktop */}
                  <span className="did-identifier-short">
                    {`${resolvedAddress.slice(0, 8)}…${resolvedAddress.slice(-4)}`}
                  </span>
                </span>
              </div>
              <button
                onClick={handleCopyDid}
                aria-label="Copy full DID to clipboard"
                style={{
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.85rem',
                  minWidth: '80px',
                  background: copied ? 'var(--sybil-pass-bg)' : 'var(--button-bg)',
                  color: copied ? 'var(--sybil-pass-text)' : 'var(--button-text)',
                  border: copied ? '1px solid var(--sybil-pass-border)' : '1px solid var(--button-border)',
                }}
                title="Copy DID to clipboard"
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>
            {resolvedDoc && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.6 }}>
                <span><strong>Created:</strong> {formatTimestamp(resolvedDoc.createdAt)}</span>
                <br />
                <span><strong>Updated:</strong> {formatTimestamp(resolvedDoc.updatedAt)}</span>
              </div>
            )}
          </>
        )}

        {resolvedAddress && (
          <div style={{ marginTop: '0.75rem' }}>
            <button
              onClick={() => setShowQr((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={showQr}
            >
              Show QR Code
            </button>
            <button
              onClick={handleExportDid}
              disabled={!resolvedDoc}
              style={{ marginLeft: '0.5rem' }}
            >
              Export JSON
            </button>
            <button
              onClick={handleExportJsonLd}
              disabled={!resolvedDoc}
              style={{ marginLeft: '0.5rem' }}
            >
              Export JSON-LD
            </button>
            <button
              onClick={handleExportIdentityData}
              disabled={!resolvedDoc || !resolvedAddress}
              style={{ marginLeft: '0.5rem' }}
              title="Download the full identity record, including reputation and credentials"
            >
              Export Identity Data
            </button>
            {!isEditingMetadata && resolvedDoc?.metadata && Object.keys(resolvedDoc.metadata).length > 0 && (
              <button
                onClick={handleEditMetadata}
                style={{ marginLeft: '0.5rem' }}
              >
                Edit Metadata
              </button>
            )}
            {showQr && (
              <DidQrCode
                address={resolvedAddress}
                asModal
                onClose={() => setShowQr(false)}
              />
            )}
          </div>
        )}

        {reputationLoading && (
          <div style={{ marginTop: '1rem' }} aria-label="Loading reputation">
            <SkeletonCard rows={3} />
          </div>
        )}

        {!reputationLoading && reputation && (
          <div
            className="card"
            style={{ marginTop: '1rem', background: 'var(--card-bg-accent)', border: '1px solid var(--card-border-accent)' }}
          >
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--accent-light)' }}>Reputation</h3>
            <p>Score: {reputation.score}</p>
            <p>Reporters: {reputation.reporterCount}</p>
            <p>Last updated: {formatTimestamp(reputation.updatedAt)}</p>
            <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Score History
            </h4>
            <ReputationChart history={scoreHistory} />
          </div>
        )}

        {!reputationLoading && resolvedAddress && !reputation && (
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

        {resolvedDoc?.metadata && Object.keys(resolvedDoc.metadata).length > 0 && (
          <div
            className="card"
            style={{ marginTop: '1rem', background: 'var(--card-bg-accent)', border: '1px solid var(--card-border-accent)' }}
          >
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--accent-light)' }}>Metadata</h3>
            {!isEditingMetadata ? (
              <>
                {Object.entries(resolvedDoc.metadata).map(([key, value]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{key}:</span>
                    <span>{String(value)}</span>
                  </div>
                ))}
              </>
            ) : (
              <div>
                {editingMetadata.map((entry, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        aria-label={`Metadata key ${idx + 1}`}
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) => {
                          const newEntries = [...editingMetadata];
                          newEntries[idx].key = e.target.value;
                          setEditingMetadata(newEntries);
                        }}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border-light)', marginBottom: editingFieldErrors[idx] ? '0.25rem' : 0 }}
                      />
                      {editingFieldErrors[idx] && (
                        <p style={{ color: 'var(--error)', fontSize: '0.75rem', margin: '0.25rem 0 0 0' }}>
                          {editingFieldErrors[idx]}
                        </p>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        aria-label={`Metadata value ${idx + 1}`}
                        placeholder="Value"
                        value={entry.value}
                        onChange={(e) => {
                          const newEntries = [...editingMetadata];
                          newEntries[idx].value = e.target.value;
                          setEditingMetadata(newEntries);
                        }}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border-light)' }}
                      />
                    </div>
                  </div>
                ))}
                {metadataError && (
                  <div style={{
                    marginBottom: '0.75rem',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    background: 'var(--danger-bg)',
                    color: 'var(--danger-text)',
                    border: '1px solid var(--danger-border)',
                    fontSize: '0.9rem',
                  }}>
                    ✕ {metadataError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button
                    onClick={handleSaveMetadata}
                    disabled={updating}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'var(--accent-light)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      opacity: updating ? 0.6 : 1,
                    }}
                  >
                    {updating ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={updating}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'var(--border-input)',
                      color: 'var(--text-muted)',
                      border: 'none',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
              <FormField
                label="Min Score"
                type="number"
                min={0}
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                style={{ flex: 1 }}
              />
              <FormField
                label="Min Reporters"
                type="number"
                min={1}
                value={minReporters}
                onChange={(e) => setMinReporters(e.target.value)}
                style={{ flex: 1 }}
              />
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

      <IdentityDirectory
        wallet={wallet}
        onSelectIdentity={(controller) => {
          setResolveAddress(controller);
          void handleResolve(controller);
        }}
      />
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
            {createStep === 3 && (
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="create-did-input" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  DID <span aria-hidden="true">*</span>
                </label>
                <input
                  id="create-did-input"
                  type="text"
                  required
                  aria-required="true"
                  aria-invalid={createDidError ? true : undefined}
                  aria-describedby={createDidError ? 'create-did-error' : undefined}
                  placeholder="DID (required)"
                  value={createDid}
                  onChange={(e) => {
                    setCreateDid(e.target.value);
                    if (createDidError) setCreateDidError(validateCreateDid(e.target.value));
                  }}
                  onBlur={() => setCreateDidError(validateCreateDid(createDid))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: `1px solid ${createDidError ? 'var(--danger-border)' : 'var(--border-light)'}`,
                  }}
                />
                {createDidError && (
                  <p
                    id="create-did-error"
                    role="alert"
                    style={{ color: 'var(--danger-text)', fontSize: '0.75rem', margin: '0.25rem 0 0 0' }}
                  >
                    {createDidError}
                  </p>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {createStep > 1 && (
                <button type="button" onClick={handleCreateBack} disabled={creating}>
                  Back
                </button>
              )}
              {createStep < 3 ? (
                <button type="button" onClick={handleCreateNext}>
                  Next
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  data-tour="create-did-button"
                  data-tour-create-did="create-did"
                >
                  {creating ? 'Creating…' : 'Create DID'}
                </button>
              )}
            </div>
            {creating && <SkeletonCard variant="identity" />}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Connect your Freighter wallet to create a new on-chain DID.
          </p>
        )}
        <div data-tour="did-status">
          {!creating && createResult && <pre className="result">{createResult}</pre>}
        </div>
      </div>

      <div className="card">
        <h2>Update DID</h2>
        {wallet.connected && wallet.publicKey ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Updating{' '}
              <span style={{ color: 'var(--accent-light)' }}>
                did:stellar:{wallet.publicKey.slice(0, 6)}…{wallet.publicKey.slice(-4)}
              </span>
            </p>
            
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Metadata Key-Value Pairs
              </p>
              {metadataEntries.map((entry, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    aria-label={`Metadata key ${idx + 1}`}
                    placeholder="Key"
                    value={entry.key}
                    onChange={(e) => {
                      const newEntries = [...metadataEntries];
                      newEntries[idx].key = e.target.value;
                      setMetadataEntries(newEntries);
                      setMetadataError(null);
                    }}
                    style={{ flex: 1, padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border-light)' }}
                  />
                  <input
                    type="text"
                    aria-label={`Metadata value ${idx + 1}`}
                    placeholder="Value"
                    value={entry.value}
                    onChange={(e) => {
                      const newEntries = [...metadataEntries];
                      newEntries[idx].value = e.target.value;
                      setMetadataEntries(newEntries);
                    }}
                    style={{ flex: 1, padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border-light)' }}
                  />
                  <button
                    onClick={() => {
                      setMetadataEntries(metadataEntries.filter((_, i) => i !== idx));
                      setMetadataError(null);
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger-text)',
                      border: '1px solid var(--danger-border)',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              
              <button
                onClick={() => setMetadataEntries([...metadataEntries, { key: '', value: '' }])}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'var(--accent-light)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                + Add Field
              </button>
            </div>
            
            {metadataError && (
              <div style={{
                marginBottom: '1rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                background: 'var(--danger-bg)',
                color: 'var(--danger-text)',
                border: '1px solid var(--danger-border)',
                fontSize: '0.9rem',
              }}>
                ✕ {metadataError}
              </div>
            )}
            
            <button onClick={handleUpdate} disabled={updating}>
              {updating ? 'Updating…' : 'Update DID'}
            </button>
            {updating && <SkeletonCard variant="identity" />}
            {!updating && updateSuccess && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                background: 'var(--sybil-pass-bg)',
                color: 'var(--sybil-pass-text)',
                border: '1px solid var(--sybil-pass-border)',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}>
                ✓ DID updated successfully
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Connect your wallet to update your DID metadata.
          </p>
        )}
      </div>

      <div className="card">
        <ProfilePictureUpload
          address={resolvedAddress ?? wallet.publicKey ?? ''}
          currentCid={resolvedDoc?.metadata?.avatar?.replace(/^ipfs:\/\//, '') ?? null}
          onLinked={handleAvatarLinked}
        />
      </div>

      <div className="card">
        <RecoveryPhraseBackup />
      </div>
    </>
  );
}
