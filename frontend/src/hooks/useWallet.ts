import { useState, useCallback, useRef, useEffect } from "react";
import SignClient from "@walletconnect/sign-client";
import type { FrontendNetworkConfig } from "../network";

// ── Freighter types ───────────────────────────────────────────────────────────

declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      signTransaction: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>;
      getNetwork: () => Promise<{ network: string; networkPassphrase: string }>;
    };
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export type WalletType = "freighter" | "walletconnect";

export interface WalletState {
  publicKey: string | null;
  networkPassphrase: string | null;
  connected: boolean;
  connecting: boolean;
  txLoading: boolean;
  walletType: WalletType | null;
  error: string | null;
}

// WalletConnect project ID — replace with your own from https://cloud.walletconnect.com
const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "YOUR_PROJECT_ID";

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWallet(networkConfig: FrontendNetworkConfig) {
  const [state, setState] = useState<WalletState>({
    publicKey: null,
    networkPassphrase: null,
    connected: false,
    connecting: false,
    txLoading: false,
    walletType: null,
    error: null,
  });

  // Hold WalletConnect session ref so signTransaction can access it
  const wcClientRef = useRef<Awaited<ReturnType<typeof SignClient.init>> | null>(null);
  const wcTopicRef = useRef<string | null>(null);

  // ── Freighter ───────────────────────────────────────────────────────────────

  const connectFreighter = useCallback(async () => {
    if (!window.freighter) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: "Freighter not found. Install it from freighter.app",
      }));
      return;
    }

    try {
      const isConnected = await window.freighter.isConnected();
      if (!isConnected) {
        setState((s) => ({
          ...s,
          connecting: false,
          error: "Please unlock Freighter and try again.",
        }));
        return;
      }

      const [publicKey, { networkPassphrase }] = await Promise.all([
        window.freighter.getPublicKey(),
        window.freighter.getNetwork(),
      ]);

      setState({
        publicKey,
        networkPassphrase,
        connected: true,
        connecting: false,
        txLoading: false,
        walletType: "freighter",
        error: null,
      });
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: e instanceof Error ? e.message : "Freighter connection failed",
      }));
    }
  }, []);

  // ── Freighter account-change detection ─────────────────────────────────────
  // Poll Freighter every 2 s while connected to detect mid-session account switches.

  useEffect(() => {
    if (state.walletType !== "freighter" || !state.connected) return;

    const interval = setInterval(async () => {
      if (!window.freighter) return;
      try {
        const currentKey = await window.freighter.getPublicKey();
        if (currentKey !== state.publicKey) {
          // Account switched — update state and clear cached data
          const { networkPassphrase } = await window.freighter.getNetwork();
          setState({
            publicKey: currentKey,
            networkPassphrase,
            connected: true,
            connecting: false,
            walletType: "freighter",
            txLoading: false,
            error: null,
          });
        }
      } catch {
        // Freighter became unavailable — disconnect gracefully
        setState({
          publicKey: null,
          networkPassphrase: null,
          connected: false,
          connecting: false,
          walletType: null,
          txLoading: false,
          error: null,
        });
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [state.walletType, state.connected, state.publicKey]);

  // ── WalletConnect ───────────────────────────────────────────────────────────

  const connectWalletConnect = useCallback(async () => {
    try {
      const client = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: "Soroban Identity",
          description: "Decentralized Identity for a Trustless World",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.ico`],
        },
      });

      wcClientRef.current = client;

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          stellar: {
            methods: ["stellar_signXDR"],
            chains: [networkConfig.walletConnectChain],
            events: ["accountsChanged"],
          },
        },
      });

      // Open QR modal — in production use @walletconnect/modal
      if (uri) {
        window.open(
          `https://walletconnect.com/wc?uri=${encodeURIComponent(uri)}`,
          "_blank"
        );
      }

      const session = await approval();
      wcTopicRef.current = session.topic;

      // Extract Stellar public key from namespace accounts (format: "stellar:<network>:GXXX...")
      const accounts = session.namespaces.stellar?.accounts ?? [];
      const publicKey = accounts[0]?.split(":")[2] ?? null;

      setState({
        publicKey,
        networkPassphrase: networkConfig.networkPassphrase,
        connected: true,
        connecting: false,
        txLoading: false,
        walletType: "walletconnect",
        error: null,
      });

      // Handle remote disconnect
      client.on("session_delete", () => {
        wcTopicRef.current = null;
        setState({
          publicKey: null,
          networkPassphrase: null,
          connected: false,
          connecting: false,
          txLoading: false,
          walletType: null,
          error: null,
        });
      });
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: e instanceof Error ? e.message : "WalletConnect connection failed",
      }));
    }
  }, [networkConfig.networkPassphrase, networkConfig.walletConnectChain]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const connect = useCallback(
    async (walletType: WalletType = "freighter") => {
      setState((s) => ({ ...s, connecting: true, error: null }));
      if (walletType === "walletconnect") {
        await connectWalletConnect();
      } else {
        await connectFreighter();
      }
    },
    [connectFreighter, connectWalletConnect]
  );

  const disconnect = useCallback(async () => {
    if (state.walletType === "walletconnect" && wcClientRef.current && wcTopicRef.current) {
      try {
        await wcClientRef.current.disconnect({
          topic: wcTopicRef.current,
          reason: { code: 6000, message: "User disconnected" },
        });
      } catch {
        // ignore — session may already be gone
      }
      wcClientRef.current = null;
      wcTopicRef.current = null;
    }

    setState({
      publicKey: null,
      networkPassphrase: null,
      connected: false,
      connecting: false,
      txLoading: false,
      walletType: null,
      error: null,
    });
  }, [state.walletType]);

  /**
   * Sign a transaction XDR string using whichever wallet is active.
   * Returns the signed XDR.
   */
  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!state.connected) throw new Error("Wallet not connected");

      setState((s) => ({ ...s, txLoading: true }));
      try {
        if (state.walletType === "walletconnect") {
          if (!wcClientRef.current || !wcTopicRef.current) {
            throw new Error("WalletConnect session not available");
          }
          const result = await wcClientRef.current.request<{ signedXDR: string }>({
            topic: wcTopicRef.current,
            chainId: networkConfig.walletConnectChain,
            request: {
              method: "stellar_signXDR",
              params: { xdr },
            },
          });
          return result.signedXDR;
        }

        // Freighter
        if (!window.freighter || !state.networkPassphrase) {
          throw new Error("Freighter not available");
        }
        return await window.freighter.signTransaction(xdr, {
          networkPassphrase: state.networkPassphrase,
        });
      } finally {
        setState((s) => ({ ...s, txLoading: false }));
      }
    },
    [
      networkConfig.walletConnectChain,
      state.connected,
      state.walletType,
      state.networkPassphrase,
    ]
  );

  return { ...state, connect, disconnect, signTransaction };
}
