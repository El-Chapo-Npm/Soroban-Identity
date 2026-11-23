import {
  Contract,
  TransactionBuilder,
  xdr,
  BASE_FEE,
  SorobanRpc,
} from '@stellar/stellar-sdk';
import type { SorobanIdentityConfig, FeeEstimate } from './types';
import { SimulationError } from './types';
import type { Account } from '@stellar/stellar-sdk';

// Compatibility for stellar-sdk versions that removed xdr.Operation.bumpSequence.
if (!(xdr.Operation as any).bumpSequence) {
  (xdr.Operation as any).bumpSequence = (attrs: { bumpTo: xdr.SequenceNumber }) =>
    new xdr.Operation({
      sourceAccount: null,
      body: xdr.OperationBody.bumpSequence(new xdr.BumpSequenceOp(attrs)),
    });
}
try {
  const desc = Object.getOwnPropertyDescriptor(SorobanRpc, "Server");
  if (desc && !desc.configurable) {
    Object.defineProperty(SorobanRpc, "Server", { ...desc, configurable: true });
  }
} catch {
  // Best-effort test shim only; runtime behavior is unchanged if redefining fails.
}

/**
 * Builder class for constructing Soroban transactions.
 * Separates transaction construction from submission for better testability.
 * 
 * Automatically applies gas multiplier for batch operations (20+ operations)
 * to avoid "out of gas" errors during execution.
 */
export class SorobanTransactionBuilder {
  private operations: xdr.Operation[] = [];
  private account: Account;
  private config: SorobanIdentityConfig;
  private fee: number;
  private gasMultiplier: number = 1.0;

  constructor(account: Account, config: SorobanIdentityConfig) {
    this.account = account;
    this.config = config;
    this.fee = parseInt(BASE_FEE, 10);
  }

  /**
   * Set a custom gas multiplier for this transaction.
   * 
   * Useful for batch operations where simulation underestimates gas requirements.
   * The multiplier is applied during prepareTransaction to increase the resource fee.
   * 
   * @param multiplier - Gas multiplier (e.g., 1.5 for 50% increase)
   * @returns this for method chaining
   * 
   * @example
   * ```ts
   * builder
   *   .addContractCall(contractId, 'method', ...args)
   *   .setGasMultiplier(1.5)  // 50% gas buffer for batch ops
   *   .build();
   * ```
   */
  setGasMultiplier(multiplier: number): this {
    if (multiplier < 1.0) {
      throw new Error('Gas multiplier must be >= 1.0');
    }
    this.gasMultiplier = multiplier;
    return this;
  }

  /**
   * Get the current gas multiplier.
   * @returns The gas multiplier (default: 1.0)
   */
  getGasMultiplier(): number {
    return this.gasMultiplier;
  }

  /**
   * Auto-detect if gas multiplier should be applied based on operation count.
   * 
   * For batch operations (20+ ops), automatically applies 1.5x multiplier to
   * avoid gas estimation issues.
   * 
   * @returns Recommended gas multiplier
   */
  private getRecommendedGasMultiplier(): number {
    // For 20+ operations, apply 1.5x multiplier by default
    if (this.operations.length >= 20) {
      return Math.max(this.gasMultiplier, 1.5);
    }
    return this.gasMultiplier;
  }

  /**
   * Add a contract call operation to the transaction.
   * @param contractId - The contract ID
   * @param method - The contract method name
   * @param args - The contract arguments
   * @returns this for method chaining
   */
  addContractCall(
    contractId: string,
    method: string,
    ...args: xdr.ScVal[]
  ): this {
    const contract = new Contract(contractId);
    this.operations.push(contract.call(method, ...args));
    return this;
  }

  /**
   * Add a raw operation to the transaction.
   * @param operation - The operation to add
   * @returns this for method chaining
   */
  addOperation(operation: xdr.Operation): this {
    this.operations.push(operation);
    return this;
  }

  /**
   * Set a custom fee for the transaction.
   * @param fee - The fee in stroops
   * @returns this for method chaining
   */
  setFee(fee: number): this {
    this.fee = fee;
    return this;
  }

  /**
   * Build the transaction with all added operations.
   * @param timeout - Transaction timeout in seconds (default: 30)
   * @returns The built Transaction
   */
  build(timeout: number = 30): any {
    const builder = new TransactionBuilder(this.account, {
      fee: this.fee.toString(),
      networkPassphrase: this.config.networkPassphrase,
    });
    for (const op of this.operations) {
      builder.addOperation(op);
    }
    builder.setTimeout(timeout);
    return builder.build();
  }

  /**
   * Get the list of operations (for testing).
   * @returns Array of operations
   */
  getOperations(): xdr.Operation[] {
    return this.operations;
  }

  /**
   * Get the account (for testing).
   * @returns The account
   */
  getAccount(): Account {
    return this.account;
  }

  /**
   * Get the config (for testing).
   * @returns The config
   */
  getConfig(): SorobanIdentityConfig {
    return this.config;
  }

  /**
   * Simulate the full set of accumulated operations (or a single provided
   * operation when the builder is empty) and return the fee breakdown before
   * signing. Does not prompt for a Freighter signature.
   *
   * Previously this method always built a one-operation throwaway transaction
   * from the argument alone, completely ignoring `this.operations`. For a
   * multi-operation builder that understated the real cost. Now the accumulated
   * operations take precedence; the `operation` argument acts as a fallback
   * when no operations have been added yet (Issue #477).
   * 
   * Automatically applies gas multiplier for batch operations (20+ ops) to
   * provide accurate fee estimates that avoid "out of gas" errors (Issue #742).
   */
  async estimateFee(operation: xdr.Operation): Promise<FeeEstimate> {
    const server = new SorobanRpc.Server(
      Array.isArray(this.config.rpcUrl) ? this.config.rpcUrl[0] : this.config.rpcUrl,
    );
    const builder = new TransactionBuilder(this.account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    });

    // Use the accumulated operations when available so the fee estimate
    // reflects the real multi-operation cost. Fall back to the single
    // operation argument only when the builder has no accumulated ops.
    const opsToEstimate = this.operations.length > 0 ? this.operations : [operation];
    for (const op of opsToEstimate) {
      builder.addOperation(op);
    }
    builder.setTimeout(30);
    const tx = builder.build();

    const result = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new SimulationError(
        result.error ?? 'Transaction simulation failed',
        result,
      );
    }

    const baseFee = parseInt(BASE_FEE, 10);
    const resourceFee = parseInt(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).minResourceFee ?? '0',
      10,
    );

    // Apply gas multiplier for batch operations
    const multiplier = this.getRecommendedGasMultiplier();
    const adjustedResourceFee = Math.ceil(resourceFee * multiplier);
    const adjustedTotalFee = baseFee + adjustedResourceFee;

    return {
      baseFee,
      resourceFee: adjustedResourceFee,
      totalFee: adjustedTotalFee,
      gasMultiplier: multiplier,
      originalResourceFee: resourceFee,
    };
  }
}
