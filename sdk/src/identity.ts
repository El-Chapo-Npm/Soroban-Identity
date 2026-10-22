import {
  Account,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  CallOptions,
  DidDocument,
  DidValidationResult,
  IdentityStorageStats,
  ResolveDidOptions,
  SorobanIdentityConfig,
  SorobanResponse,
  WriteResult,
} from "./types";
import { validateConfig } from "./types";
import { retryWithBackoff, validateStellarAddress, pollTransactionStatus, runConcurrent } from "./utils";
import { ContractError, SorobanIdentityError, wrapError } from "./errors";
import { IDENTITY_REGISTRY_ERRORS } from "./error-codes";
import { BaseClient } from "./base-client";
import {
  buildCreateDidArgs,
  buildUpdateDidArgs,
  buildResolveDidArgs,
  buildHasActiveDidArgs,
  buildDeactivateDidArgs,
  buildDidExistsArgs,
  buildRegisterDidMethodArgs,
  buildResolveDidStringArgs,
  buildGetDidMethodsArgs,
  buildInitiateSignerRotationArgs,
  buildApproveSignerRotationArgs,
  buildCompleteSignerRotationArgs,
} from "./contract-args";

const PROBE_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

/** DID methods supported out of the box by the universal resolver. */
const SUPPORTED_DID_METHODS = ["stellar", "ethr", "web"] as const;
type SupportedDidMethod = (typeof SUPPORTED_DID_METHODS)[number];

/** Matches a syntactically valid DID, capturing the method segment. */
const DID_PATTERN = /^did:([a-z0-9]+):([A-Za-z0-9._:%-]+)$/;

function parseDid(did: string): { method: string; methodSpecificId: string } {
  const match = DID_PATTERN.exec(did);
  if (!match) {
    throw new SorobanIdentityError(
      `Invalid DID "${did}". Expected format did:<method>:<method-specific-id>.`,
      "VALIDATION_ERROR"
    );
  }
  return { method: match[1], methodSpecificId: match[2] };
}

function isTransientRpcError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (/\b(400|404)\b/.test(msg)) return false;
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("fetch failed")
  );
}

/** `IDENTITY_REGISTRY_ERRORS` code for "DID not found". */
const DID_NOT_FOUND_CODE = 1;

/**
 * A DID resolved immediately after `createDid` can briefly appear "not found"
 * if the RPC node that serves the read hasn't caught up with the node the
 * write landed on. Treat NOT_FOUND as retryable here (unlike other reads) so
 * that window resolves itself instead of surfacing a false negative.
 */
function isRetryableResolveError(err: unknown): boolean {
  if (isTransientRpcError(err)) return true;
  if (err instanceof ContractError) return err.code === DID_NOT_FOUND_CODE;
  if (err instanceof SorobanIdentityError) return err.code === "NOT_FOUND";
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client for the identity-registry contract.
 *
 * @example
 * ```ts
 * import { IdentityClient, TESTNET_CONFIG } from '@soroban-identity/sdk';
 * const identity = new IdentityClient({ ...TESTNET_CONFIG, identityRegistryId: '...' });
 * const { did } = await identity.createDid(keypair, { email: 'a@b.c' });
 * ```
 */
export class IdentityClient extends BaseClient {
  constructor(config: SorobanIdentityConfig) {
    validateConfig(config, { contractIdField: "identityRegistryId" });
    super(config, config.identityRegistryId);
  }

  async isInitialized(): Promise<boolean> {
    try {
      return await this.executeWithFailover(async (server) => {
        const account = new Account(PROBE_ADDRESS, "0");
        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: this.config.networkPassphrase,
        })
          .addOperation(
            this.contract.call(
              "has_active_did",
              ...buildHasActiveDidArgs({ controller: PROBE_ADDRESS })
            )
          )
          .setTimeout(10)
          .build();
        const result = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(result)) {
          const err: string = (result as { error: string }).error ?? "";
          if (err.includes("not initialized") || err.includes("NotInitialized") || err.includes("#0")) {
            return false;
          }
        }
        return true;
      });
    } catch {
      return false;
    }
  }

  /**
   * Create a new DID for the given keypair.
   *
   * @param keypair  The Stellar keypair whose public key will own the DID.
   * @param metadata Arbitrary `string → string` map embedded in the DID document.
   * @param options  Per-call overrides.
   * @returns The resolved DID and the estimated transaction fee.
   * @throws {SorobanIdentityError} with code `VALIDATION_ERROR` if a DID already exists.
   */
  async createDid(
    keypair: Keypair,
    metadata: Record<string, string> = {},
    options?: CallOptions
  ): Promise<SorobanResponse<{ did: string } & WriteResult>> {
    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "create_did",
          ...buildCreateDidArgs({ controller: keypair.publicKey(), metadata })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    const estimatedFee = parseInt(prepared.fee, 10);
    const estimatedFeeXlm = (estimatedFee / 10_000_000).toFixed(7);
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
      const confirmed = await this.server.getTransaction(txHash) as SorobanRpc.Api.GetSuccessfulTransactionResponse;
      const did = scValToNative(confirmed.returnValue!) as string;
      return { data: { did, estimatedFee, estimatedFeeXlm }, txHash };
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("DID already exists")) {
        throw new SorobanIdentityError(
          `A DID already exists for address ${keypair.publicKey()}. Each address can only have one DID.`,
          "VALIDATION_ERROR"
        );
      }
      throw wrapError(e);
    }
  }

  /**
   * Update metadata on an existing DID.
   *
   * @param keypair  Controller of the DID being updated.
   * @param metadata Replacement metadata map.
   * @param options  Per-call overrides.
   * @throws {SorobanIdentityError} with code `NOT_FOUND` or `UNAUTHORIZED`.
   */
  async updateDid(
    keypair: Keypair,
    metadata: Record<string, string>,
    options?: CallOptions
  ): Promise<SorobanResponse<void>> {
    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "update_did",
          ...buildUpdateDidArgs({ controller: keypair.publicKey(), metadata })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("DID not found")) {
        throw new SorobanIdentityError(
          `No DID found for address ${keypair.publicKey()}. Create one first with createDid.`,
          "NOT_FOUND"
        );
      }
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not the controller of this DID.`,
          "UNAUTHORIZED"
        );
      }
      throw wrapError(e);
    }
    return { data: undefined, txHash };
  }

  /**
   * Resolve a DID document by controller address.
   *
   * @param controllerAddress The Stellar address that controls the DID.
   * @param options           Per-call overrides.
   * @throws {SorobanIdentityError} with code `NOT_FOUND` if no DID exists.
   */
  async resolveDid(controllerAddress: string, options?: CallOptions): Promise<DidDocument> {
    validateStellarAddress(controllerAddress);
    const account = new Account(controllerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "resolve_did",
          ...buildResolveDidArgs({ controller: controllerAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const maxRetries = options?.maxRetries ?? this.config.maxRetries ?? 5;
    const baseDelayMs = options?.baseDelayMs ?? this.config.baseDelayMs ?? 500;
    const backoffFactor = options?.backoffFactor ?? this.config.backoffFactor ?? 2;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.server.simulateTransaction(tx);
        const isSimulationError = SorobanRpc.Api.isSimulationError(result);
        this.debug('sdk.simulation_result', { operation: 'identity.simulateTransaction', success: !isSimulationError });
        if (isSimulationError) {
          const errMsg = result.error ?? "";
          const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
          if (contractErr) throw contractErr;
          if (errMsg.includes("DidDeactivated")) {
            throw new SorobanIdentityError(`DID for address ${controllerAddress} has been deactivated.`, "VALIDATION_ERROR");
          }
          if (errMsg.includes("DidNotFound")) {
            throw new SorobanIdentityError(`NOT_FOUND: No DID found for address ${controllerAddress}.`, "NOT_FOUND");
          }
          throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
        }
        const retval = (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval;
        if (retval && typeof retval === "object" && "id" in (retval as unknown as Record<string, unknown>)) {
          return retval as unknown as DidDocument;
        }
        return scValToNative(retval) as DidDocument;
      } catch (err) {
        if (attempt === maxRetries || !isRetryableResolveError(err)) throw err;
        lastError = err;
        const delayMs = Math.floor(baseDelayMs * Math.pow(backoffFactor, attempt) + Math.random() * 100);
        this.debug(`[identity] resolveDID retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`, {});
        await sleep(delayMs);
      }
    }
    throw lastError;
  }

  /**
   * Check if an address has an active (non-deactivated) DID.
   */
  async hasActiveDid(controllerAddress: string, options?: CallOptions): Promise<boolean> {
    validateStellarAddress(controllerAddress);
    const account = new Account(controllerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "has_active_did",
          ...buildHasActiveDidArgs({ controller: controllerAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) return false;

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as boolean;
  }

  /**
   * Get the total count of active DIDs registered.
   */
  async getDidCount(options?: CallOptions): Promise<number> {
    const account = new Account(this.config.identityRegistryId, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call("get_did_count"))
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError("Failed to get DID count", "UNKNOWN");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as number;
  }

  /**
   * Deactivate the DID owned by `keypair`. Deactivation is irreversible.
   */
  async deactivateDid(keypair: Keypair): Promise<SorobanResponse<void>> {
    const isActive = await this.hasActiveDid(keypair.publicKey());
    if (!isActive) {
      throw new SorobanIdentityError(
        `DID for ${keypair.publicKey()} is already inactive or does not exist`,
        "VALIDATION_ERROR"
      );
    }

    const account = await this.server.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "deactivate_did",
          ...buildDeactivateDidArgs({ controller: keypair.publicKey() })
        )
      )
      .setTimeout(this.config.txTimeout ?? 30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(keypair);

    const result = await this.server.sendTransaction(prepared);
    this.debug('sdk.submission_outcome', { operation: 'identity.deactivateDid.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    await pollTransactionStatus(this.server, txHash, {
      maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
      retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
      exponentialBackoff: this.config.pollingExponentialBackoff,
    });
    return { data: undefined, txHash };
  }

  /**
   * List DID documents with offset-based pagination.
   */
  async listDIDs(
    callerAddress: string,
    page = 1,
    pageSize = 20,
    options?: CallOptions
  ): Promise<DidDocument[]> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const offset = (Math.max(1, page) - 1) * pageSize;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "list_dids",
          nativeToScVal(offset, { type: "u32" }),
          nativeToScVal(pageSize, { type: "u32" })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.listDIDs', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as DidDocument[];
  }

  /**
   * Get storage usage statistics for the identity registry.
   */
  async getStorageStats(callerAddress: string, options?: CallOptions): Promise<IdentityStorageStats> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call("get_storage_stats"))
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as IdentityStorageStats;
  }

  /**
   * Resolve multiple DID documents in parallel.
   */
  async resolveMany(
    addresses: string[],
    options?: CallOptions & { concurrency?: number }
  ): Promise<DidDocument[]> {
    const concurrency = options?.concurrency ?? this.config.maxConcurrentRequests ?? 5;
    return runConcurrent(
      addresses,
      (address) => this.resolveDid(address, options),
      concurrency
    );
  }

  /**
   * Register a DID method (e.g. `did:soroban`, `did:key`) with the resolver.
   *
   * @param keypair  Admin keypair authorized to register methods.
   * @param method   The DID method name (without the `did:` prefix).
   * @param options  Per-call overrides.
   * @throws {SorobanIdentityError} with code `UNAUTHORIZED` if the caller is not an admin.
   */
  async registerDidMethod(
    keypair: Keypair,
    method: string,
    options?: CallOptions
  ): Promise<SorobanResponse<void>> {
    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "register_did_method",
          ...buildRegisterDidMethodArgs({ method })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.registerDidMethod.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not authorized to register DID methods.`,
          "UNAUTHORIZED"
        );
      }
      if (msg.includes("MethodAlreadyRegistered") || msg.includes("already registered")) {
        throw new SorobanIdentityError(
          `DID method "${method}" is already registered.`,
          "VALIDATION_ERROR"
        );
      }
      throw wrapError(e);
    }
    return { data: undefined, txHash };
  }

  /**
   * Resolve a DID string (e.g. `did:soroban:GABC...`) to its DID document.
   *
   * @param didString The full DID string to resolve.
   * @param options   Per-call overrides.
   * @throws {SorobanIdentityError} with code `NOT_FOUND` if the DID cannot be resolved.
   */
  async resolveDidString(didString: string, options?: CallOptions): Promise<DidDocument> {
    if (!didString.startsWith("did:")) {
      throw new SorobanIdentityError(
        `Invalid DID string "${didString}": must start with "did:".`,
        "VALIDATION_ERROR"
      );
    }
    const account = new Account(PROBE_ADDRESS, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "resolve_did_string",
          ...buildResolveDidStringArgs({ didString })
        )
      )
      .setTimeout(timeout)
      .build();

    const maxRetries = options?.maxRetries ?? this.config.maxRetries ?? 5;
    const baseDelayMs = options?.baseDelayMs ?? this.config.baseDelayMs ?? 500;
    const backoffFactor = options?.backoffFactor ?? this.config.backoffFactor ?? 2;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.server.simulateTransaction(tx);
        const isSimulationError = SorobanRpc.Api.isSimulationError(result);
        this.debug('sdk.simulation_result', { operation: 'identity.resolveDidString', success: !isSimulationError });
        if (isSimulationError) {
          const errMsg = result.error ?? "";
          const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
          if (contractErr) throw contractErr;
          if (errMsg.includes("UnsupportedDidMethod")) {
            throw new SorobanIdentityError(
              `DID method in "${didString}" is not supported by the resolver.`,
              "VALIDATION_ERROR"
            );
          }
          if (errMsg.includes("DidNotFound")) {
            throw new SorobanIdentityError(`NOT_FOUND: No DID found for "${didString}".`, "NOT_FOUND");
          }
          throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
        }
        const retval = (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval;
        if (retval && typeof retval === "object" && "id" in (retval as unknown as Record<string, unknown>)) {
          return retval as unknown as DidDocument;
        }
        return scValToNative(retval) as DidDocument;
      } catch (err) {
        if (attempt === maxRetries || !isRetryableResolveError(err)) throw err;
        lastError = err;
        const delayMs = Math.floor(baseDelayMs * Math.pow(backoffFactor, attempt) + Math.random() * 100);
        this.debug(`[identity] resolveDidString retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`, {});
        await sleep(delayMs);
      }
    }
    throw lastError;
  }

  /**
   * List all DID methods supported by the resolver.
   */
  async getDidMethods(options?: CallOptions): Promise<string[]> {
    const account = new Account(PROBE_ADDRESS, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "get_did_methods",
          ...buildGetDidMethodsArgs()
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.getDidMethods', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as string[];
  }

  /**
   * Initiate a signer rotation for a DID. The rotation must be approved by the
   * required threshold of signers before it can be completed.
   *
   * @param keypair     Controller of the DID whose signer set is being rotated.
   * @param newSigners  The proposed signer set (address → weight).
   * @param threshold   The new signature threshold.
   * @param options     Per-call overrides.
   * @throws {SorobanIdentityError} with code `NOT_FOUND` or `UNAUTHORIZED`.
   */
  async initiateSignerRotation(
    keypair: Keypair,
    newSigners: Record<string, number>,
    threshold: number,
    options?: CallOptions
  ): Promise<SorobanResponse<{ rotationId: string } & WriteResult>> {
    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "initiate_signer_rotation",
          ...buildInitiateSignerRotationArgs({
            controller: keypair.publicKey(),
            newSigners,
            threshold,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    const estimatedFee = parseInt(prepared.fee, 10);
    const estimatedFeeXlm = (estimatedFee / 10_000_000).toFixed(7);
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.initiateSignerRotation.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
      const confirmed = await this.server.getTransaction(txHash) as SorobanRpc.Api.GetSuccessfulTransactionResponse;
      const rotationId = scValToNative(confirmed.returnValue!) as string;
      return { data: { rotationId, estimatedFee, estimatedFeeXlm }, txHash };
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("DID not found")) {
        throw new SorobanIdentityError(
          `No DID found for address ${keypair.publicKey()}. Create one first with createDid.`,
          "NOT_FOUND"
        );
      }
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not the controller of this DID.`,
          "UNAUTHORIZED"
        );
      }
      if (msg.includes("InvalidThreshold") || msg.includes("invalid threshold")) {
        throw new SorobanIdentityError(
          `Invalid threshold ${threshold} for the proposed signer set.`,
          "VALIDATION_ERROR"
        );
      }
      throw wrapError(e);
    }
  }

  /**
   * Approve a pending signer rotation. Each approval contributes the signer's
   * configured weight toward the rotation threshold.
   *
   * @param keypair    A signer approving the rotation.
   * @param rotationId The rotation to approve.
   * @param options    Per-call overrides.
   * @throws {SorobanIdentityError} with code `NOT_FOUND` or `UNAUTHORIZED`.
   */
  async approveSignerRotation(
    keypair: Keypair,
    rotationId: string,
    options?: CallOptions
  ): Promise<SorobanResponse<void>> {
    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "approve_signer_rotation",
          ...buildApproveSignerRotationArgs({ rotationId })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.approveSignerRotation.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RotationNotFound") || msg.includes("rotation not found")) {
        throw new SorobanIdentityError(
          `Signer rotation "${rotationId}" was not found.`,
          "NOT_FOUND"
        );
      }
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not authorized to approve this rotation.`,
          "UNAUTHORIZED"
        );
      }
      if (msg.includes("RotationExpired") || msg.includes("expired")) {
        throw new SorobanIdentityError(
          `Signer rotation "${rotationId}" has expired.`,
          "VALIDATION_ERROR"
        );
      }
      throw wrapError(e);
    }
    return { data: undefined, txHash };
  }

  /**
   * Complete a signer rotation once the approval threshold has been met.
   *
   * @param keypair    The controller completing the rotation.
   * @param rotationId The rotation to complete.
   * @param options    Per-call overrides.
   * @throws {SorobanIdentityError} with code `NOT_FOUND`, `UNAUTHORIZED` or `VALIDATION_ERROR`.
   */
  async completeSignerRotation(
    keypair: Keypair,
    rotationId: string,
    options?: CallOptions
  ): Promise<SorobanResponse<void>> {
    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "complete_signer_rotation",
          ...buildCompleteSignerRotationArgs({ rotationId })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.completeSignerRotation.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RotationNotFound") || msg.includes("rotation not found")) {
        throw new SorobanIdentityError(
          `Signer rotation "${rotationId}" was not found.`,
          "NOT_FOUND"
        );
      }
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not authorized to complete this rotation.`,
          "UNAUTHORIZED"
        );
      }
      if (msg.includes("ThresholdNotMet") || msg.includes("threshold not met")) {
        throw new SorobanIdentityError(
          `Signer rotation "${rotationId}" has not met its approval threshold.`,
          "VALIDATION_ERROR"
        );
      }
      if (msg.includes("RotationExpired") || msg.includes("expired")) {
        throw new SorobanIdentityError(
          `Signer rotation "${rotationId}" has expired.`,
          "VALIDATION_ERROR"
        );
      }
      throw wrapError(e);
    }
    return { data: undefined, txHash };
  }

  /**
   * Resolve a DID using the universal resolver, supporting multiple DID
   * methods (`did:stellar`, `did:ethr`, `did:web`) plus any registered
   * custom resolver plugins.
   *
   * Resolution order:
   *   1. The on-chain resolver for the DID's method (if registered).
   *   2. Custom resolver plugins registered via {@link registerResolverPlugin}.
   *   3. The configured fallback chain, in order.
   *
   * @param did     The DID to resolve, e.g. `did:stellar:GABC...`.
   * @param options Per-call overrides, including cache bypass.
   * @returns The resolved DID document.
   * @throws {SorobanIdentityError} with code `VALIDATION_ERROR` for malformed
   *   DIDs or unsupported methods, and `NOT_FOUND` when no resolver succeeds.
   */
  async resolveDID(did: string, options?: ResolveDidOptions): Promise<DidDocument> {
    const { method } = parseDid(did);
    const account = new Account(PROBE_ADDRESS, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const args: xdr.ScVal[] = [
      nativeToScVal(did, { type: "string" }),
      nativeToScVal(method, { type: "string" }),
      nativeToScVal(Boolean(options?.useCache ?? true), { type: "bool" }),
    ];
    if (options?.fallbackChain && options.fallbackChain.length > 0) {
      args.push(
        nativeToScVal(options.fallbackChain, { type: "string" }) as unknown as xdr.ScVal
      );
    }

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call("resolve_did_universal", ...args))
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.resolveDID', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      if (errMsg.includes("UnsupportedDidMethod")) {
        throw new SorobanIdentityError(
          `Unsupported DID method "${method}". Supported methods: ${SUPPORTED_DID_METHODS.join(", ")}.`,
          "VALIDATION_ERROR"
        );
      }
      if (errMsg.includes("DidNotFound") || errMsg.includes("ResolverNotFound")) {
        throw new SorobanIdentityError(`NOT_FOUND: No resolver could resolve DID ${did}.`, "NOT_FOUND");
      }
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as DidDocument;
  }

  /**
   * Register a custom resolver plugin for a DID method on-chain.
   *
   * @param keypair        Controller authorizing the registration.
   * @param method         DID method the plugin handles (e.g. `"ion"`).
   * @param resolverAddress Address of the resolver contract/plugin.
   * @param options        Per-call overrides.
   */
  async registerResolverPlugin(
    keypair: Keypair,
    method: string,
    resolverAddress: string,
    options?: CallOptions
  ): Promise<SorobanResponse<void>> {
    if (!/^[a-z0-9]+$/.test(method)) {
      throw new SorobanIdentityError(
        `Invalid DID method "${method}". Methods must be lowercase alphanumeric.`,
        "VALIDATION_ERROR"
      );
    }
    validateStellarAddress(resolverAddress);

    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "register_resolver_plugin",
          nativeToScVal(keypair.publicKey(), { type: "address" }),
          nativeToScVal(method, { type: "string" }),
          nativeToScVal(resolverAddress, { type: "address" })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.registerResolverPlugin.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not authorized to register resolver plugins.`,
          "UNAUTHORIZED"
        );
      }
      throw wrapError(e);
    }
    return { data: undefined, txHash };
  }

  /**
   * Configure the resolver fallback chain used when the primary resolver for
   * a DID method fails.
   *
   * @param keypair Controller authorizing the change.
   * @param chain   Ordered list of resolver identifiers (methods or plugin
   *                names) to try in sequence.
   * @param options Per-call overrides.
   */
  async setFallbackChain(
    keypair: Keypair,
    chain: string[],
    options?: CallOptions
  ): Promise<SorobanResponse<void>> {
    if (!Array.isArray(chain) || chain.length === 0) {
      throw new SorobanIdentityError(
        "Fallback chain must contain at least one resolver identifier.",
        "VALIDATION_ERROR"
      );
    }
    for (const entry of chain) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new SorobanIdentityError(
          "Fallback chain entries must be non-empty strings.",
          "VALIDATION_ERROR"
        );
      }
    }

    const account = await this.server.getAccount(keypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "set_fallback_chain",
          nativeToScVal(keypair.publicKey(), { type: "address" }),
          nativeToScVal(chain, { type: "string" }) as unknown as xdr.ScVal
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
    prepared.sign(keypair);

    const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
    this.debug('sdk.submission_outcome', { operation: 'identity.setFallbackChain.sendTransaction', status: result.status });
    if (result.status !== "PENDING") {
      throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
    }

    const txHash = result.hash;
    try {
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
    } catch (e: unknown) {
      if (e instanceof SorobanIdentityError && e.code === "TIMEOUT") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("require_auth") || msg.includes("not authorized")) {
        throw new SorobanIdentityError(
          `Address ${keypair.publicKey()} is not authorized to set the fallback chain.`,
          "UNAUTHORIZED"
        );
      }
      throw wrapError(e);
    }
    return { data: undefined, txHash };
  }

  /**
   * Read a DID document from the resolver cache, if present.
   *
   * @param did     The DID to look up.
   * @param options Per-call overrides.
   * @returns The cached DID document, or `null` if not cached / expired.
   */
  async getCachedDID(did: string, options?: CallOptions): Promise<DidDocument | null> {
    parseDid(did);
    const account = new Account(PROBE_ADDRESS, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "get_cached_did",
          nativeToScVal(did, { type: "string" })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.getCachedDID', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    const retval = (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval;
    const native = scValToNative(retval) as DidDocument | null | undefined;
    return native ?? null;
  }

  /**
   * Validate a DID document against the resolver's structural rules.
   *
   * @param document The DID document to validate.
   * @param options  Per-call overrides.
   * @returns The validation result reported by the contract.
   */
  async validateDIDDocument(
    document: DidDocument,
    options?: CallOptions
  ): Promise<DidValidationResult> {
    if (!document || typeof document !== "object") {
      throw new SorobanIdentityError(
        "DID document must be a non-null object.",
        "VALIDATION_ERROR"
      );
    }
    const account = new Account(PROBE_ADDRESS, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "validate_did_document",
          nativeToScVal(document as unknown as Record<string, unknown>, { type: "map" })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'identity.validateDIDDocument', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, IDENTITY_REGISTRY_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as DidValidationResult;
  }

  /**
   * Liveness probe — calls the on-chain `ping()` function.
   */
  async ping(options?: CallOptions): Promise<number> {
    const account = new Account(PROBE_ADDRESS, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call("ping"))
      .setTimeout(timeout)
      .build();
    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new SorobanIdentityError(
        "Health check failed: identity-registry not responding",
        "CONTRACT_ERROR"
      );
    }
    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as number;
  }
}
