import { useCallback, useState } from "react";
import SignClient from "@walletconnect/sign-client";
import type { FrontendNetworkConfig } from "../network";
import type { WalletState } from "./useWalletState";

interface UseWalletSigningOptions {
  networkConfig: FrontendNetworkConfig;
  state: WalletState;
  setState: React.Dispatch<React.SetStateAction<WalletState>>;
  wcClientRef: React.MutableRefObject<Awaited<
    ReturnType<typeof SignClient.init>
  > | null>;
  wcTopicRef: React.MutableRefObject<string | null>;
}

/**
 * Returns `true` for rejections that originate from the user dismissing the
 * Freighter prompt, rather than genuine errors.
 *
 * Freighter surfaces user rejections as errors whose message contains
 * "User declined" or "Transaction declined". We treat these as non-error
 * user-initiated cancellations and do not forward them to the ErrorBoundary.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("user declined") ||
    msg.includes("transaction declined") ||
    msg.includes("user rejected") ||
    msg.includes("cancelled") ||
    msg.includes("canceled")
  );
}

/** User-facing message shown when signing is attempted outside a user gesture. */
export const SIGNING_GESTURE_REQUIRED_MESSAGE =
  "Please click the button again to open the Freighter signing window.";

/**
 * Browsers block extension popups that are not opened from a direct user
 * gesture (click/keypress). Where the User Activation API is available we
 * check it so signing is only ever started from a click handler's activation
 * window. When the API is unavailable we cannot tell, so we allow the call.
 */
function hasUserGesture(): boolean {
  if (typeof navigator === "undefined") return true;
  const activation = (navigator as Navigator & {
    userActivation?: { isActive: boolean };
  }).userActivation;
  return activation ? activation.isActive : true;
}

/**
 * Handles transaction signing for whichever wallet is currently active.
 * Single responsibility: sign an XDR string and return the signed XDR.
 *
 * When the user rejects the Freighter signing prompt the hook sets
 * `signingError` with a user-facing message and the panel remains mounted
 * (the error does NOT propagate to the ErrorBoundary).
 */
export function useWalletSigning({
  networkConfig,
  state,
  setState,
  wcClientRef,
  wcTopicRef,
}: UseWalletSigningOptions) {
  const [signingError, setSigningError] = useState<string | null>(null);
  // Set to `true` whenever the most recent attempt was rejected by the user.
  // Callers must rebuild the transaction (fresh XDR) before retrying rather
  // than resubmitting the previously rejected XDR, which would broadcast a
  // duplicate transaction.
  const [signingRejected, setSigningRejected] = useState(false);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!state.connected) throw new Error("Wallet not connected");

      // Clear any previous rejection message/flag before each attempt so a
      // stale rejection never leaks into a new signing flow.
      setSigningError(null);
      setSigningRejected(false);
      setState((s) => ({ ...s, txLoading: true }));

      try {
        if (state.walletType === "walletconnect") {
          if (!wcClientRef.current || !wcTopicRef.current) {
            throw new Error("WalletConnect session not available");
          }
          const result = await wcClientRef.current.request<{
            signedXDR: string;
          }>({
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

        if (!hasUserGesture()) {
          // Do not call Freighter: the browser would block the popup and the
          // user would see no feedback. Ask for a fresh click instead.
          setSigningError(SIGNING_GESTURE_REQUIRED_MESSAGE);
          throw new Error(SIGNING_GESTURE_REQUIRED_MESSAGE);
        }

        try {
          return await window.freighter.signTransaction(xdr, {
            networkPassphrase: state.networkPassphrase,
          });
        } catch (freighterErr: unknown) {
          if (isUserRejection(freighterErr)) {
            // User cancelled — surface a friendly message, keep the panel alive.
            setSigningError("Transaction signing was cancelled.");
            // Mark the attempt as rejected so callers know they must rebuild
            // the transaction instead of resubmitting the old XDR.
            setSigningRejected(true);
            // Return a rejected promise so the caller knows signing did not
            // complete, but do NOT re-throw so the ErrorBoundary is bypassed.
            return Promise.reject(new Error("Transaction signing was cancelled."));
          }
          // Genuine Freighter error — re-throw so callers can handle it.
          throw freighterErr;
        }
      } finally {
        setState((s) => ({ ...s, txLoading: false }));
      }
    },
    [
      networkConfig.walletConnectChain,
      state.connected,
      state.walletType,
      state.networkPassphrase,
      setState,
      wcClientRef,
      wcTopicRef,
    ]
  );

  const clearSigningError = useCallback(() => {
    setSigningError(null);
    setSigningRejected(false);
  }, []);

  return {
    signTransaction,
    signingError,
    signingRejected,
    clearSigningError,
  };
}
