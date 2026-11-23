import { useEffect, useState } from "react";
import type { WalletType } from "./useWallet";

export const WALLET_SESSION_KEY = "soroban_identity_wallet_session";

export interface PersistedWalletSession {
  publicKey: string;
  walletType: WalletType | null;
}

export function loadWalletSession(): PersistedWalletSession | null {
  try {
    const raw = sessionStorage.getItem(WALLET_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWalletSession>;
    if (typeof parsed.publicKey !== "string" || parsed.publicKey.length === 0) {
      return null;
    }
    const walletType =
      parsed.walletType === "freighter" || parsed.walletType === "walletconnect"
        ? parsed.walletType
        : null;
    return { publicKey: parsed.publicKey, walletType };
  } catch {
    return null;
  }
}

export function persistWalletSession(
  publicKey: string | null,
  walletType: WalletType | null,
): void {
  try {
    if (!publicKey) {
      sessionStorage.removeItem(WALLET_SESSION_KEY);
      return;
    }
    const session: PersistedWalletSession = { publicKey, walletType };
    sessionStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

export interface WalletConnectionError {
  code: string;
  message: string;
}

export interface WalletState {
  publicKey: string | null;
  networkPassphrase: string | null;
  connected: boolean;
  connecting: boolean;
  /** True while the automatic reconnect flow (on page load) is in progress. */
  reconnecting: boolean;
  txLoading: boolean;
  walletType: WalletType | null;
  error: string | WalletConnectionError | null;
  retryCount?: number;
}

export const DISCONNECTED_STATE: WalletState = {
  publicKey: null,
  networkPassphrase: null,
  connected: false,
  connecting: false,
  reconnecting: false,
  txLoading: false,
  walletType: null,
  error: null,
  retryCount: 0,
};

/**
 * Manages the raw wallet state atom.
 * Separated so connection and signing hooks can share a single state setter
 * without duplicating the shape definition.
 */
export function useWalletState() {
  const [state, setState] = useState<WalletState>(() => {
    const persisted = loadWalletSession();
    if (!persisted) return DISCONNECTED_STATE;
    return {
      ...DISCONNECTED_STATE,
      publicKey: persisted.publicKey,
      walletType: persisted.walletType,
      connected: true,
    };
  });

  useEffect(() => {
    persistWalletSession(state.publicKey, state.walletType);
  }, [state.publicKey, state.walletType]);

  return { state, setState };
}
