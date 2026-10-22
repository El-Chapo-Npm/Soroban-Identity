import { CredentialClient, IdentityClient } from '@soroban-identity/sdk';
import { SDK_CONFIG } from '../config';
import { cached, enqueue, isOnline } from './offline';
import { store } from '../store';
import {
  didLoaded,
  credentialsLoaded,
  writeQueued,
} from '../store/identitySlice';
import type { RootState } from '../store';

export const identity = new IdentityClient(SDK_CONFIG);
export const credentials = new CredentialClient(SDK_CONFIG);

/**
 * Resolve a DID and cache the result in Redux.
 * Uses the offline-first cache wrapper so results are available offline.
 */
export const loadDid = async (address: string) => {
  const did = await cached(`did:${address}`, () => identity.resolveDid(address));
  store.dispatch(didLoaded({ address, did }));
  return did;
};

/**
 * Load credentials for a subject and cache the result in Redux.
 * Uses the offline-first cache wrapper so results are available offline.
 */
export const loadCredentials = async (address: string) => {
  const creds = await cached(`creds:${address}`, () =>
    credentials.getCredentialsBySubject(address, address),
  );
  store.dispatch(credentialsLoaded({ address, credentials: creds }));
  return creds;
};

/**
 * Issue a credential. When offline, the operation is enqueued and
 * dispatched to the store so the UI can reflect the pending state.
 */
export const issueCredential = async (params: Parameters<CredentialClient['issueCredential']>[0]) => {
  if (!isOnline()) {
    const op = await enqueue('issueCredential', params);
    store.dispatch(writeQueued(op));
    return { queued: true as const, op };
  }
  const result = await credentials.issueCredential(params);
  return { queued: false as const, result };
};

/**
 * Revoke a credential. When offline, the operation is enqueued.
 */
export const revokeCredential = async (credentialId: string) => {
  if (!isOnline()) {
    const op = await enqueue('revokeCredential', { credentialId });
    store.dispatch(writeQueued(op));
    return { queued: true as const, op };
  }
  const result = await credentials.revokeCredential(credentialId);
  return { queued: false as const, result };
};

/**
 * Verify a credential. When offline, the operation is enqueued.
 */
export const verifyCredential = async (credentialId: string) => {
  if (!isOnline()) {
    const op = await enqueue('verifyCredential', { credentialId });
    store.dispatch(writeQueued(op));
    return { queued: true as const, op };
  }
  const result = await credentials.verifyCredential(credentialId);
  return { queued: false as const, result };
};

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectDid = (address: string) => (state: RootState) =>
  state.identity.dids[address];

export const selectCredentials = (address: string) => (state: RootState) =>
  state.identity.credentials[address];

export const selectPendingWrites = (state: RootState) => state.identity.pendingWrites;

export const selectHasPendingWrites = (state: RootState) =>
  state.identity.pendingWrites.length > 0;