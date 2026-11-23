import SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { Linking } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { STELLAR_CHAIN, WALLETCONNECT_PROJECT_ID } from '../config';

const SESSION_SERVICE = 'org.soroban-identity.walletconnect';
const SESSION_ACCOUNT = 'wc-session';

let client: SignClient | null = null;
let session: SessionTypes.Struct | null = null;

async function getClient() {
  client ??= await SignClient.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    metadata: { name: 'Soroban Identity', description: 'Decentralized identity on Stellar', url: 'https://soroban-identity.org', icons: [] },
  });
  return client;
}

async function persistSession(s: SessionTypes.Struct | null): Promise<void> {
  try {
    if (s) {
      await Keychain.setGenericPassword(SESSION_ACCOUNT, JSON.stringify(s), {
        service: SESSION_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } else {
      await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
    }
  } catch (err) {
    console.warn('Failed to persist WalletConnect session', err);
  }
}

async function loadPersistedSession(): Promise<SessionTypes.Struct | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    if (!creds) return null;
    return JSON.parse(creds.password) as SessionTypes.Struct;
  } catch (err) {
    console.warn('Failed to load WalletConnect session', err);
    return null;
  }
}

function getAccountAddress(s: SessionTypes.Struct): string {
  const account = s.namespaces?.stellar?.accounts?.[0];
  if (!account) throw new Error('Wallet session has no Stellar account');
  return account.split(':').pop()!;
}

/**
 * Restore a previously persisted WalletConnect session on app launch.
 * Returns the connected Stellar address, or null if no valid session exists.
 */
export async function restoreSession(): Promise<string | null> {
  try {
    const c = await getClient();
    const persisted = await loadPersistedSession();
    if (!persisted) return null;

    const active = c.session.getAll().find((s) => s.topic === persisted.topic);
    if (!active) {
      await persistSession(null);
      return null;
    }

    session = active;
    return getAccountAddress(active);
  } catch (err) {
    console.warn('Failed to restore WalletConnect session', err);
    session = null;
    return null;
  }
}

export async function connectWallet(): Promise<string> {
  try {
    const c = await getClient();
    const { uri, approval } = await c.connect({
      requiredNamespaces: {
        stellar: { chains: [STELLAR_CHAIN], methods: ['stellar_signXDR', 'stellar_signAndSubmitXDR'], events: [] },
      },
    });
    if (uri) await Linking.openURL(`lobstr://wc?uri=${encodeURIComponent(uri)}`).catch(() => undefined);
    session = await approval();
    await persistSession(session);
    return getAccountAddress(session);
  } catch (err) {
    session = null;
    throw new Error(`Wallet connection failed: ${(err as Error).message}`);
  }
}

/**
 * Handle an incoming deep link (e.g. sorobanidentity://wc?uri=...).
 * Returns true if the URL was a WalletConnect pairing URI that was handled.
 */
export async function handleDeepLink(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const wcUri = parsed.searchParams.get('uri');
    if (!wcUri || !wcUri.startsWith('wc:')) return false;

    const c = await getClient();
    const { approval } = await c.pair({ uri: wcUri });
    session = await approval();
    await persistSession(session);
    return true;
  } catch (err) {
    console.warn('Failed to handle WalletConnect deep link', err);
    return false;
  }
}

export async function signXdr(xdr: string): Promise<string> {
  if (!client || !session) throw new Error('Wallet not connected');
  try {
    const res = await client.request<{ signedXDR: string }>({
      topic: session.topic,
      chainId: STELLAR_CHAIN,
      request: { method: 'stellar_signXDR', params: { xdr } },
    });
    return res.signedXDR;
  } catch (err) {
    throw new Error(`Failed to sign transaction: ${(err as Error).message}`);
  }
}

export async function disconnectWallet(): Promise<void> {
  try {
    if (client && session) {
      await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected' } });
    }
  } catch (err) {
    console.warn('Failed to disconnect WalletConnect session', err);
  } finally {
    session = null;
    await persistSession(null);
  }
}
