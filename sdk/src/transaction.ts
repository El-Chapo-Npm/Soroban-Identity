import { SorobanRpc, Transaction } from "@stellar/stellar-sdk";
import { SorobanIdentityError, wrapNetworkError } from "./errors";

export interface TxOptions {
  pollInterval?: number;
  pollRetries?: number;
  /**
   * Gas multiplier to apply to the estimated resource fee.
   * 
   * Useful for batch operations where simulation tends to underestimate
   * gas requirements. A value of 1.5 means the fee will be increased by 50%.
   * 
   * @default 1.0 (no adjustment)
   * @example
   * ```ts
   * // For batch operations with 20+ items
   * await executeTransaction(server, tx, signer, { gasMultiplier: 1.5 });
   * ```
   */
  gasMultiplier?: number;
}

function isNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /econnrefused|enotfound|fetch failed|econnreset|etimedout/.test(msg);
}

function getRpcUrl(server: SorobanRpc.Server): string {
  return (server as unknown as { serverURL: string }).serverURL ?? "unknown";
}

export async function executeTransaction(
  server: SorobanRpc.Server,
  tx: Transaction,
  signer: (tx: Transaction) => void,
  options?: TxOptions
): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
  // Resolve the RPC URL for error context — Server stores it as the `serverURL` property
  const rpcUrl: string = (server as unknown as { serverURL?: string }).serverURL ?? "unknown RPC";

  let prepared: Transaction;
  try {
    prepared = (await server.prepareTransaction(tx)) as Transaction;
    
    // Apply gas multiplier if specified (for batch operations)
    const gasMultiplier = options?.gasMultiplier ?? 1.0;
    if (gasMultiplier !== 1.0) {
      const currentFee = parseInt(prepared.fee, 10);
      const adjustedFee = Math.ceil(currentFee * gasMultiplier);
      // Create a new transaction with the adjusted fee
      prepared = new Transaction(prepared.toEnvelope(), prepared.networkPassphrase);
      (prepared as any)._fee = adjustedFee.toString();
    }
  } catch (err) {
    wrapNetworkError(err, rpcUrl, "prepareTransaction");
  }

  signer(prepared!);

  let result: SorobanRpc.Api.SendTransactionResponse;
  try {
    result = await server.sendTransaction(prepared!);
  } catch (err) {
    wrapNetworkError(err, rpcUrl, "sendTransaction");
  }

  if (result!.status !== "PENDING") {
    throw new Error(`Transaction failed: ${result!.status}`);
  }

  const retries = options?.pollRetries ?? 10;
  const interval = options?.pollInterval ?? 2000;

  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, interval));

    let status: SorobanRpc.Api.GetTransactionResponse;
    try {
      status = await server.getTransaction(result!.hash);
    } catch (err) {
      wrapNetworkError(err, rpcUrl, "getTransaction");
    }

    if (status!.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return status! as SorobanRpc.Api.GetSuccessfulTransactionResponse;
    }
    if (status!.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error("Transaction failed on-chain");
    }
  }

  throw new SorobanIdentityError(
    `Transaction confirmation timeout (hash: ${result!.hash}). The transaction was broadcast and may still succeed — check its status via this hash before resubmitting.`,
    { code: "TIMEOUT", txHash: result!.hash }
  );
}
