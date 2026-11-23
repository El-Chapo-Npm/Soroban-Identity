import { useCallback } from "react";
import {
  BASE_FEE,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { getNetworkConfig } from "../network";
import { useWalletContext } from "../context/WalletContext";

export interface SorobanInvokeParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** Relative timeout passed to TransactionBuilder.setTimeout (seconds). */
  timeoutSeconds?: number;
  /** Delay between transaction-status polls (milliseconds). */
  pollIntervalMs?: number;
  /**
   * Optional wrapper for every RPC call. The credentials panel uses this to
   * retry 429/503 responses with backoff.
   */
  withRetry?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface SorobanInvokeResult {
  hash: string;
  /** Resource fee reported by prepareTransaction, in stroops. */
  fee: number;
  status: string;
  /** Raw return value of the confirmed invocation, when the contract returns one. */
  returnValue?: unknown;
}

type SigningWallet = {
  connected: boolean;
  publicKey: string | null;
  signTransaction: (xdr: string) => Promise<string>;
};

const identity = <T>(fn: () => Promise<T>): Promise<T> => fn();

/**
 * Builds, prepares, signs and submits a Soroban contract invocation.
 *
 * Signing always goes through `wallet.signTransaction`. When Freighter is the
 * connected wallet that call is Freighter's `signTransaction` (see
 * useWalletSigning), so no invoke path can silently fall back to a local key.
 * Callers should use this hook for every write to a contract.
 */
export function useSorobanInvoke(walletOverride?: SigningWallet) {
  const contextWallet = useWalletContext();
  // IdentityPanel accepts an injected wallet in tests; honour it when given.
  const wallet = walletOverride ?? contextWallet;

  return useCallback(
    async ({
      contractId,
      method,
      args,
      timeoutSeconds = 30,
      pollIntervalMs = 2000,
      withRetry = identity,
    }: SorobanInvokeParams): Promise<SorobanInvokeResult> => {
      if (!wallet.connected || !wallet.publicKey) {
        throw new Error("Wallet not connected");
      }

      const networkConfig = getNetworkConfig();
      const rpcUrl = Array.isArray(networkConfig.rpcUrl)
        ? networkConfig.rpcUrl[0]
        : networkConfig.rpcUrl;
      const server = new SorobanRpc.Server(rpcUrl);
      const account = await withRetry(() =>
        server.getAccount(wallet.publicKey as string),
      );

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: networkConfig.networkPassphrase,
      })
        .addOperation(new Contract(contractId).call(method, ...args))
        .setTimeout(timeoutSeconds)
        .build();

      const prepared = await withRetry(() => server.prepareTransaction(tx));
      const fee = Number.parseInt(prepared.fee, 10);

      // Freighter receives the prepared (simulated) XDR together with the
      // active network passphrase; the signed result is what gets submitted.
      const signedXdr = await wallet.signTransaction(prepared.toXDR());
      const signedTx = TransactionBuilder.fromXDR(
        signedXdr,
        networkConfig.networkPassphrase,
      );

      const sent = await withRetry(() =>
        server.sendTransaction(signedTx as never),
      );
      if (sent.status !== "PENDING") {
        throw new Error(`Transaction failed: ${sent.status}`);
      }

      let txStatus = await withRetry(() => server.getTransaction(sent.hash));
      while (txStatus.status === "NOT_FOUND") {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        txStatus = await withRetry(() => server.getTransaction(sent.hash));
      }
      if (txStatus.status === "FAILED") {
        throw new Error("Transaction failed on-chain");
      }

      return {
        hash: sent.hash,
        fee,
        status: txStatus.status,
        returnValue: (txStatus as { returnValue?: unknown }).returnValue,
      };
    },
    [wallet.connected, wallet.publicKey, wallet.signTransaction],
  );
}
