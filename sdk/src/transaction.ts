import { SorobanRpc, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { SorobanIdentityError } from "./errors";

export interface TxOptions {
  pollInterval?: number;
  pollRetries?: number;
}

/**
 * Signs a base64 XDR transaction envelope and returns the signed envelope,
 * also as base64 XDR. Matches the shape of real wallet APIs (e.g. Freighter's
 * `signTransaction`), which are async and return a new signed envelope rather
 * than mutating the `Transaction` object in place.
 */
export type TransactionSigner = (xdr: string) => Promise<string>;

export async function executeTransaction(
  server: SorobanRpc.Server,
  tx: Transaction,
  signer: TransactionSigner,
  options?: TxOptions
): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await signer(prepared.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, prepared.networkPassphrase) as Transaction;

  const result = await server.sendTransaction(signedTx);
  if (result.status !== "PENDING") {
    throw new Error(`Transaction failed: ${result.status}`);
  }

  const retries = options?.pollRetries ?? 10;
  const interval = options?.pollInterval ?? 2000;

  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const status = await server.getTransaction(result.hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return status as SorobanRpc.Api.GetSuccessfulTransactionResponse;
    }
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error("Transaction failed on-chain");
    }
  }
  throw new SorobanIdentityError(
    `Transaction confirmation timeout (hash: ${result.hash}). The transaction was broadcast and may still succeed — check its status via this hash before resubmitting.`,
    { code: "TIMEOUT", txHash: result.hash }
  );
}
