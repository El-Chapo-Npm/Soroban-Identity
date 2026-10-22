import {
  Account,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import type {
  CallOptions,
  Credential,
  CredentialListOptions,
  CredentialStorageStats,
  CredentialType,
  Page,
  PaginationOptions,
  RevokedCredential,
  RevocationRecord,
  RevokeOptions,
  SorobanIdentityConfig,
  SorobanResponse,
  VerifyResult,
  WriteResult,
} from "./types";
import { validateConfig, RevocationReason, REVOCATION_REASONS } from "./types";
import { createHash } from "node:crypto";
import { retryWithBackoff, validateStellarAddress, pollTransactionStatus, runConcurrent } from "./utils";
import { ContractError, SorobanIdentityError, wrapError, ClaimsValidationError } from "./errors";
import { CREDENTIAL_MANAGER_ERRORS } from "./error-codes";
import { BaseClient } from "./base-client";
import {
  buildIssueCredentialArgs,
  buildRevokeCredentialArgs,
  buildRevokeCredentialWithReasonArgs,
  buildGetRevocationRecordArgs,
  buildGetRevokedByReasonArgs,
  buildRevokeBatchArgs,
  buildRenewCredentialArgs,
  buildVerifyCredentialArgs,
  buildGetCredentialArgs,
  buildGetSubjectCredentialsArgs,
  buildIsIssuerArgs,
  buildGetCredentialCountArgs,
  buildListSubjectCredentialsArgs,
  buildListIssuersArgs,
  buildGetIssuerCredentialsArgs,
  buildListIssuerCredentialsArgs,
  buildGetRevocationsArgs,
  buildCancelActivationArgs,
  buildGetPendingActivationsArgs,
  buildGetMerkleRootArgs,
  buildUpdateMerkleRootArgs,
  buildVerifyMerkleProofArgs,
  buildRegisterOracleArgs,
  buildSetFeedSchemaArgs,
  buildSetOracleFeeArgs,
  buildSetFallbackOraclesArgs,
  buildRequestOffchainDataArgs,
  buildOracleCallbackArgs,
  buildIsResponseFreshArgs,
  buildRegisterTemplateArgs,
  buildPublishTemplateVersionArgs,
  buildValidateAgainstTemplateArgs,
  buildListTemplateForSaleArgs,
  buildBuyTemplateArgs,
  buildSetSignersArgs,
  buildUpdateSignersArgs,
  buildValidateThresholdArgs,
  buildAggregateSignaturesArgs,
  buildBatchRevokeArgs,
  buildGenerateRevocationProofArgs,
  buildVerifyRevocationProofArgs,
  buildGetRevocationStatsArgs,
} from "./contract-args";

const PROBE_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

/** All parameters required for a single {@link CredentialClient.issueCredential} call. */
export interface CredentialInput {
  issuerKeypair: Keypair;
  subjectAddress: string;
  credentialType: CredentialType;
  claims: Record<string, string>;
  claimsHashHex: string;
  expiresAt?: number;
  options?: CallOptions & { nonce?: string; schemaId?: string };
  signatureHex?: string;
}

/** Options for {@link CredentialClient.issueCredentialBatch}. */
export interface BatchOptions {
  /** Maximum parallel in-flight issuances per chunk. Defaults to `5`. */
  concurrency?: number;
}

/** Return type of {@link CredentialClient.issueCredentialBatch}. */
export interface BatchResult {
  succeeded: Array<SorobanResponse<{ credentialId: string } & WriteResult>>;
  failed: Array<{ input: CredentialInput; error: SorobanIdentityError }>;
}

/**
 * A single sibling hash on the path from a leaf to the merkle root.
 *
 * `position` records whether the sibling sits to the `'left'` or `'right'`
 * of the node being hashed at that level, which is required to reconstruct
 * the parent deterministically.
 */
export interface MerkleProofNode {
  /** Sibling hash as a 64-char lowercase hex string (32 bytes). */
  hash: string;
  /** Whether the sibling is the left or right child of the parent. */
  position: "left" | "right";
}

/**
 * A merkle inclusion proof for a single credential within a batch.
 *
 * The tree is a standard binary merkle tree over the batch's credential IDs:
 * - **Leaf**: `SHA-256(0x00 || credentialIdBytes)` (32-byte credential ID).
 * - **Internal node**: `SHA-256(0x01 || leftHash || rightHash)`.
 * - **Odd level**: the final unpaired node is promoted unchanged to the next level.
 *
 * Domain-separation prefixes (`0x00` for leaves, `0x01` for internal nodes)
 * prevent second-preimage attacks between leaf and internal hashes.
 */
export interface MerkleProof {
  /** The credential ID this proof is for, as a 64-char hex string. */
  credentialId: string;
  /** Sibling hashes ordered from the leaf level up to the root. */
  path: MerkleProofNode[];
  /** The merkle root the proof resolves to, as a 64-char hex string. */
  root: string;
  /** Zero-based index of the credential within the batch. */
  index: number;
  /** Total number of credentials in the batch. */
  leafCount: number;
}

/** A merkle tree built off-chain over a batch of credential IDs. */
export interface MerkleTree {
  /** The merkle root as a 64-char lowercase hex string. */
  root: string;
  /** Leaf hashes (hex) in batch order. */
  leaves: string[];
  /** All tree levels, `levels[0]` being the leaves and the last level the root. */
  levels: string[][];
}

/**
 * Options for {@link CredentialClient.batchRevoke}. #1121
 */
export interface BatchRevokeOptions extends CallOptions {
  /** Revocation reason code recorded for every credential in the batch. */
  reason?: RevocationReason;
}

/**
 * Result of {@link CredentialClient.batchRevoke}. #1121
 */
export interface BatchRevokeResult {
  /** Hex-encoded credential IDs that were revoked. */
  revoked: string[];
  /** Number of credentials revoked in this call. */
  count: number;
  /** The on-chain transaction hash. */
  txHash: string;
}

/**
 * A bitmap-based revocation proof. #1121
 *
 * The contract stores revocations in a bitmap keyed by issuer; a proof
 * consists of the word index within the bitmap, the bit position within that
 * word, and the word value itself, which lets a verifier check the bit
 * without reading the whole list.
 */
export interface RevocationProof {
  /** Hex-encoded credential ID the proof is for. */
  credentialId: string;
  /** Index of the bitmap word containing the credential's bit. */
  wordIndex: number;
  /** Bit position (0-255) within the word. */
  bitIndex: number;
  /** The bitmap word value as a bigint. */
  word: bigint;
  /** Whether the bit is set (credential revoked). */
  revoked: boolean;
}

/**
 * Aggregated revocation statistics for an issuer. #1121
 */
export interface RevocationStats {
  /** Total number of revoked credentials. */
  totalRevoked: number;
  /** Number of bitmap words currently allocated. */
  wordCount: number;
  /** Per-reason revocation counts, keyed by {@link RevocationReason}. */
  byReason: Record<number, number>;
}

/**
 * Converts a JavaScript Date or millisecond timestamp to Unix seconds.
 */
export function toCredentialExpiry(dateOrMs: Date | number): number {
  const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : dateOrMs;
  return Math.floor(ms / 1000);
}

const MERKLE_LEAF_PREFIX = Buffer.from([0x00]);
const MERKLE_NODE_PREFIX = Buffer.from([0x01]);

function normalizeCredentialIdHex(credentialId: string): string {
  const hex = credentialId.startsWith("0x") ? credentialId.slice(2) : credentialId;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new SorobanIdentityError(
      "InvalidCredentialId: credential ID must be a 64-character hex string (32 bytes)",
      "VALIDATION_ERROR"
    );
  }
  return hex.toLowerCase();
}

function hashMerkleLeaf(credentialIdHex: string): string {
  const idBytes = Buffer.from(normalizeCredentialIdHex(credentialIdHex), "hex");
  return createHash("sha256")
    .update(Buffer.concat([MERKLE_LEAF_PREFIX, idBytes]))
    .digest("hex");
}

function hashMerkleNode(leftHex: string, rightHex: string): string {
  return createHash("sha256")
    .update(
      Buffer.concat([
        MERKLE_NODE_PREFIX,
        Buffer.from(leftHex, "hex"),
        Buffer.from(rightHex, "hex"),
      ])
    )
    .digest("hex");
}

/**
 * Build a merkle tree off-chain over a batch of credential IDs.
 *
 * The tree uses SHA-256 with domain separation (see {@link MerkleProof}).
 * When a level has an odd number of nodes the trailing node is promoted
 * unchanged to the next level.
 *
 * @param credentialIds Hex-encoded 32-byte credential IDs (with or without `0x`).
 * @returns The {@link MerkleTree} including the root and all levels.
 * @throws {SorobanIdentityError} with code `VALIDATION_ERROR` if the batch is
 *   empty or any ID is malformed.
 */
export function buildMerkleTree(credentialIds: string[]): MerkleTree {
  if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
    throw new SorobanIdentityError(
      "InvalidBatch: at least one credential ID is required to build a merkle tree",
      "VALIDATION_ERROR"
    );
  }
  const leaves = credentialIds.map(hashMerkleLeaf);
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashMerkleNode(current[i]!, current[i + 1]!));
      } else {
        next.push(current[i]!);
      }
    }
    levels.push(next);
    current = next;
  }
  return { root: current[0]!, leaves, levels };
}

/**
 * Generate a merkle inclusion proof for a single credential within a batch.
 *
 * The tree is built entirely off-chain; only the resulting root needs to be
 * stored on-chain (see {@link CredentialClient.updateMerkleRoot}).
 *
 * @param credentialIds All credential IDs in the batch.
 * @param credentialId  The credential to prove membership for.
 * @returns The {@link MerkleProof} for `credentialId`.
 * @throws {SorobanIdentityError} with code `VALIDATION_ERROR` if the batch is
 *   empty, any ID is malformed, or `credentialId` is not part of the batch.
 *
 * @example
 * ```ts
 * const proof = generateMerkleProof(batchIds, batchIds[3]);
 * const ok = verifyMerkleProof(proof, proof.root); // true
 * ```
 */
export function generateMerkleProof(
  credentialIds: string[],
  credentialId: string
): MerkleProof {
  const target = normalizeCredentialIdHex(credentialId);
  const normalized = credentialIds.map(normalizeCredentialIdHex);
  const index = normalized.indexOf(target);
  if (index === -1) {
    throw new SorobanIdentityError(
      `InvalidProof: credential ${credentialId} is not part of the batch`,
      "VALIDATION_ERROR"
    );
  }

  const tree = buildMerkleTree(normalized);
  const path: MerkleProofNode[] = [];
  let idx = index;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level]!;
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    if (siblingIdx < nodes.length) {
      path.push({
        hash: nodes[siblingIdx]!,
        position: isRightNode ? "left" : "right",
      });
    }
    idx = Math.floor(idx / 2);
  }

  return {
    credentialId: target,
    path,
    root: tree.root,
    index,
    leafCount: normalized.length,
  };
}

/**
 * Verify a merkle inclusion proof client-side, without any network calls.
 *
 * Recomputes the root from the leaf hash of `proof.credentialId` and the
 * sibling path, then compares it to `root`.
 *
 * @param proof The proof returned by {@link generateMerkleProof}.
 * @param root  The expected merkle root (64-char hex). Defaults to `proof.root`
 *              when omitted.
 * @returns `true` when the proof resolves to `root`.
 */
export function verifyMerkleProof(proof: MerkleProof, root?: string): boolean {
  if (!proof || !Array.isArray(proof.path)) return false;
  let current: string;
  try {
    current = hashMerkleLeaf(proof.credentialId);
  } catch {
    return false;
  }
  for (const node of proof.path) {
    if (!node || !/^[0-9a-fA-F]{64}$/.test(node.hash)) return false;
    const sibling = node.hash.toLowerCase();
    current =
      node.position === "left"
        ? hashMerkleNode(sibling, current)
        : hashMerkleNode(current, sibling);
  }
  const expected = (root ?? proof.root).toLowerCase();
  return current === expected;
}

/** Contract error codes returned by credential-manager — see {@link CREDENTIAL_MANAGER_ERRORS}. */
const CREDENTIAL_NOT_FOUND_CODE = 3;
const CREDENTIAL_REVOKED_CODE = 4;
const CREDENTIAL_EXPIRED_CODE = 9;
/** #731: credential has not yet reached its activation_time. */
const CREDENTIAL_NOT_YET_ACTIVE_CODE = 22;

/**
 * Client for the credential-manager contract.
 *
 * @example
 * ```ts
 * import { CredentialClient, TESTNET_CONFIG } from '@soroban-identity/sdk';
 * const credentials = new CredentialClient({ ...TESTNET_CONFIG, credentialManagerId: '...' });
 * const page = await credentials.listCredentialsBySubject(caller, subject, { limit: 50 });
 * ```
 */
export class CredentialClient extends BaseClient {
  constructor(config: SorobanIdentityConfig) {
    validateConfig(config, { contractIdField: "credentialManagerId" });
    super(config, config.credentialManagerId);
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
              "is_issuer",
              ...buildIsIssuerArgs({ address: PROBE_ADDRESS })
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
   * Estimate the XLM fee for issuing a credential without signing or submitting.
   */
  async estimateIssuanceFee(
    issuerKeypair: Keypair,
    subjectAddress: string,
    credentialType: CredentialType,
    claims: Record<string, string>,
    claimsHashHex: string,
    expiresAt = 0,
    options?: CallOptions
  ): Promise<{ fee: string; feeXLM: string }> {
    if (!/^[0-9a-fA-F]{64}$/.test(claimsHashHex)) {
      throw new SorobanIdentityError(
        "InvalidClaimsHashFormat: claimsHash must be a 64-character hex string (32 bytes)",
        "VALIDATION_ERROR"
      );
    }

    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const dummySignature = Buffer.alloc(64);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "issue_credential",
          ...buildIssueCredentialArgs({
            issuer: issuerKeypair.publicKey(),
            subject: subjectAddress,
            credentialType,
            claims,
            claimsHash: Buffer.from(claimsHashHex, "hex"),
            signature: dummySignature,
            expiresAt: BigInt(expiresAt),
          })
        )
      )
      .setTimeout(timeout)
      .build();

    const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx)) as import("@stellar/stellar-sdk").Transaction;
    const feeStroops = prepared.fee;
    const feeXLM = (parseInt(feeStroops, 10) / 10_000_000).toFixed(7);
    return { fee: feeStroops, feeXLM };
  }

  /**
   * Issue a credential to a subject. Caller must be a registered issuer.
   *
   * @param issuerKeypair   The registered issuer signing the transaction.
   * @param subjectAddress  The Stellar address receiving the credential.
   * @param credentialType  Credential category.
   * @param claims          Arbitrary `string → string` claims to embed.
   * @param claimsHashHex   64-char hex (32 bytes) SHA-256 of the off-chain claims payload.
   * @param expiresAt       Unix timestamp (seconds) after which the credential is invalid. Pass `0` for no expiry.
   * @param options         Per-call overrides. Also accepts `nonce` and `schemaId`.
   * @param signatureHex    Optional pre-computed 64-byte issuer signature as a 128-char hex string.
   */
  async issueCredential(
    issuerKeypair: Keypair,
    subjectAddress: string,
    credentialType: CredentialType,
    claims: Record<string, string>,
    claimsHashHex: string,
    expiresAt = 0,
    options?: CallOptions & { nonce?: string; schemaId?: string },
    signatureHex?: string
  ): Promise<SorobanResponse<{ credentialId: string } & WriteResult>> {
    if (!/^[0-9a-fA-F]{64}$/.test(claimsHashHex)) {
      throw new SorobanIdentityError(
        "InvalidClaimsHashFormat: claimsHash must be a 64-character hex string (32 bytes)",
        "VALIDATION_ERROR"
      );
    }

    if (signatureHex !== undefined) {
      if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
        throw new SorobanIdentityError(
          "InvalidSignatureFormat: signature must be a 128-character hex string (64 bytes)",
          "VALIDATION_ERROR"
        );
      }
    }

    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs ?? 30_000;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeoutMs);

    const work = async (): Promise<SorobanResponse<{ credentialId: string } & WriteResult>> => {
      if (options?.schemaId) {
        await this._validateClaimsAgainstSchema(options.schemaId, claims);
      }

      const account = await this.server.getAccount(issuerKeypair.publicKey());
      const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

      const signature = signatureHex
        ? Buffer.from(signatureHex, "hex")
        : (() => {
            const issuerBytes = Buffer.from(issuerKeypair.publicKey(), "utf8");
            const subjectBytes = Buffer.from(subjectAddress, "utf8");
            const claimsHashBytes = Buffer.from(claimsHashHex, "hex");
            const parts: Buffer[] = [issuerBytes, subjectBytes, claimsHashBytes];
            if (options?.nonce) {
              parts.push(Buffer.from(options.nonce, "utf8"));
            }
            const msg = Buffer.concat(parts);
            const digest = createHash("sha256").update(msg).digest();
            return issuerKeypair.sign(digest);
          })();

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            "issue_credential",
            ...buildIssueCredentialArgs({
              issuer: issuerKeypair.publicKey(),
              subject: subjectAddress,
              credentialType,
              claims,
              claimsHash: Buffer.from(claimsHashHex, "hex"),
              signature: Buffer.from(signature),
              expiresAt: BigInt(expiresAt),
            })
          )
        )
        .setTimeout(timeout)
        .build();

      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      const estimatedFee = parseInt(prepared.fee, 10);
      const estimatedFeeXlm = (estimatedFee / 10_000_000).toFixed(7);
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.sendTransaction', status: result.status });
      if (result.status !== "PENDING") {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, "CONTRACT_ERROR");
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash, {
        maxRetries: this.config.maxRetries ?? this.config.pollingRetries,
        retryIntervalMs: this.config.retryIntervalMs ?? this.config.pollingIntervalMs,
        exponentialBackoff: this.config.pollingExponentialBackoff,
      });
      const confirmed = await this.server.getTransaction(txHash) as SorobanRpc.Api.GetSuccessfulTransactionResponse;
      // Returns BytesN<32> — encode as hex
      const decoded = scValToNative(confirmed.returnValue!);
      const raw = decoded instanceof Uint8Array
        ? decoded
        : confirmed.returnValue instanceof Uint8Array
          ? confirmed.returnValue
          : Buffer.alloc(32);
      const credentialId = Buffer.from(raw).toString("hex");
      return { data: { credentialId, estimatedFee, estimatedFeeXlm }, txHash };
    };

    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          ac.signal.addEventListener('abort', () => {
            reject(new SorobanIdentityError(`issueCredential timed out after ${timeoutMs}ms`, "TIMEOUT"));
          });
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Revoke a credential that was issued by `issuerKeypair`.
   *
   * Pass `options.reason` to record a standardized {@link RevocationReason}
   * on-chain (#951); without it the contract records `Unspecified`.
   */
  async revokeCredential(
    issuerKeypair: Keypair,
    credentialId: string,
    options?: RevokeOptions
  ): Promise<SorobanResponse<RevokedCredential>> {
    const reason = options?.reason;
    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const idBytes = Buffer.from(credentialId, 'hex');

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        options?.reason === undefined
          ? this.contract.call(
              'revoke_credential',
              ...buildRevokeCredentialArgs({
                issuer: issuerKeypair.publicKey(),
                credentialId: idBytes,
                reason: RevocationReason.AdminRevoked,
              })
            )
          : this.contract.call(
              'revoke_credential_with_reason',
              ...buildRevokeCredentialWithReasonArgs({
                issuer: issuerKeypair.publicKey(),
                credentialId: idBytes,
                reason: reason!,
              })
            )
      )
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.revokeCredential', status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);

      const confirmed = await this.server.getTransaction(txHash) as SorobanRpc.Api.GetSuccessfulTransactionResponse;
      const revokedAt = new Date((confirmed as { createdAt: number }).createdAt * 1000).toISOString();

      const credential = await this.getCredential(issuerKeypair.publicKey(), credentialId, options);
      const revokedCredential: RevokedCredential = {
        ...credential,
        revokedAt,
        status: 'revoked',
        revocationReason: reason,
      };
      return { data: revokedCredential, txHash };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Renew a credential by extending its expiry without changing the credential ID.
   *
   * Only the original issuer may call this. The credential must not be revoked.
   * `newExpiresAt` must be strictly greater than the current `expires_at`.
   *
   * @param issuerKeypair  The registered issuer keypair that originally issued the credential.
   * @param credentialId   Hex-encoded credential ID (32 bytes).
   * @param newExpiresAt   New Unix timestamp (seconds). Use {@link toCredentialExpiry} to
   *                       convert from milliseconds. Must be > current expires_at.
   * @param options        Per-call overrides.
   * @returns `{ txHash }` — the on-chain transaction hash.
   * @throws {SorobanIdentityError} with code `NOT_FOUND` if credential does not exist,
   *   `UNAUTHORIZED` if the caller is not the issuer, `VALIDATION_ERROR` if the credential
   *   is revoked, or `INVALID_ARGUMENT` if newExpiresAt is not later than the current expiry.
   *
   * @example
   * ```ts
   * const { txHash } = await credentials.renewCredential(
   *   issuerKeypair,
   *   credentialId,
   *   toCredentialExpiry(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 days
   * );
   * ```
   */
  async renewCredential(
    issuerKeypair: Keypair,
    credentialId: string,
    newExpiresAt: number,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const idBytes = Buffer.from(credentialId, 'hex');

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'renew_credential',
          ...buildRenewCredentialArgs({
            issuer: issuerKeypair.publicKey(),
            credentialId: idBytes,
            newExpiresAt,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.renewCredential', status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);
      return { txHash };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Atomically revoke multiple credentials in a single transaction.
   * Maximum batch size is 50.
   */
  async revokeBatch(
    issuerKeypair: Keypair,
    ids: string[],
    reason: RevocationReason,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    if (ids.length > 50) {
      throw new SorobanIdentityError(
        `Batch size ${ids.length} exceeds maximum of 50`,
        'BATCH_TOO_LARGE'
      );
    }

    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const idBuffers = ids.map((id) => Buffer.from(id, 'hex'));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'revoke_credentials_batch',
          ...buildRevokeBatchArgs({
            issuer: issuerKeypair.publicKey(),
            credentialIds: idBuffers,
            reason,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.revokeBatch', status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);
      return { txHash };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Cancel the pending time-locked activation for a credential. #731
   *
   * Only the original issuer may call this. The credential's `activation_time`
   * must not yet have been reached. Once cancelled the credential is
   * permanently inactive — it cannot be reactivated.
   *
   * @param issuerKeypair  Keypair of the registered issuer that issued the credential.
   * @param credentialId   Hex-encoded credential ID (32 bytes).
   * @param options        Per-call overrides.
   * @returns `{ txHash }` — the on-chain transaction hash.
   *
   * @throws {SorobanIdentityError} with code `NOT_FOUND` if the credential does not exist,
   *   `UNAUTHORIZED` if the caller is not the issuer,
   *   `VALIDATION_ERROR` if the credential is revoked or already cancelled, or
   *   `INVALID_ARGUMENT` if `activation_time` has already passed.
   */
  async cancelActivation(
    issuerKeypair: Keypair,
    credentialId: string,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const idBytes = Buffer.from(credentialId, 'hex');

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'cancel_activation',
          ...buildCancelActivationArgs({ issuer: issuerKeypair.publicKey(), credentialId: idBytes })
        )
      )
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.cancelActivation', status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);
      return { txHash };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Return the credential IDs of all pending time-locked credentials for a
   * subject — those whose `activation_time` is set, still in the future, and
   * not yet cancelled. #731
   *
   * This is a read-only simulation call and does not require signing.
   */
  async getPendingActivations(
    callerAddress: string,
    subjectAddress: string,
    options?: CallOptions
  ): Promise<string[]> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(subjectAddress);
    const account = new Account(callerAddress, '0');
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'get_pending_activations',
          ...buildGetPendingActivationsArgs({ subject: subjectAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      const errMsg = (result as { error: string }).error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }

    const retval = scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    );

    if (!Array.isArray(retval)) return [];
    return retval.map((raw: unknown) =>
      Buffer.from(raw as Uint8Array).toString('hex')
    );
  }

  private async _validateClaimsAgainstSchema(
    schemaId: string,
    claims: Record<string, string>
  ): Promise<void> {
    // Lazy-load ajv to avoid bundling it for callers who don't use schemaId
    let Ajv: any;
    try {
      const moduleName = "ajv";
      ({ default: Ajv } = await import(moduleName));
    } catch {
      throw new SorobanIdentityError(
        "ClaimsValidationError: ajv is required for schema validation. Install it with: npm install ajv",
        "INVALID_INPUT"
      );
    }

    let schema: Record<string, unknown>;
    try {
      const res = await fetch(schemaId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      schema = (await res.json()) as Record<string, unknown>;
    } catch (e) {
      throw new SorobanIdentityError(
        `ClaimsValidationError: failed to fetch schema ${schemaId}: ${e instanceof Error ? e.message : String(e)}`,
        "INVALID_INPUT"
      );
    }

    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const valid = validate(claims);
    if (!valid) {
      const fieldErrors: Record<string, string> = {};
      for (const err of validate.errors ?? []) {
        const field = err.instancePath?.replace(/^\//, "") || err.params?.missingProperty as string || "root";
        fieldErrors[field] = err.message ?? "invalid";
      }
      throw new ClaimsValidationError(
        `Claims failed schema validation for schemaId: ${schemaId}`,
        fieldErrors
      );
    }
  }

  /**
   * Verify a credential and get a typed result describing any failure reason.
   *
   * Issue #666: Add retry logic to handle state propagation delays when immediately
   * verifying a freshly issued credential.
   */
  async verifyCredential(
    callerAddress: string,
    credentialId: string,
    options?: CallOptions
  ): Promise<VerifyResult> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const idBytes = Buffer.from(credentialId, "hex");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "verify_credential",
          ...buildVerifyCredentialArgs({ credentialId: idBytes })
        )
      )
      .setTimeout(timeout)
      .build();

    let lastError: { error: string } | null = null;
    let retries = 3;

    // Retry logic for handling state propagation delays
    while (retries > 0) {
      const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
      const isSimulationError = SorobanRpc.Api.isSimulationError(result);
      this.debug('sdk.simulation_result', { operation: 'credentials.simulateTransaction', success: !isSimulationError });

      if (isSimulationError) {
        const error: string = (result as { error: string }).error ?? "";
        lastError = result as { error: string };
        const contractErr = ContractError.extract(error, CREDENTIAL_MANAGER_ERRORS);

        if (contractErr) {
          // Don't retry on these errors - they're definitive
          if (contractErr.code === CREDENTIAL_NOT_FOUND_CODE && retries > 1) {
            // Issue #666: Retry if credential not found, as it might not be indexed yet
            retries--;
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          if (contractErr.code === CREDENTIAL_REVOKED_CODE) return { valid: false, reason: 'revoked' };
          if (contractErr.code === CREDENTIAL_EXPIRED_CODE) return { valid: false, reason: 'expired' };
          if (contractErr.code === CREDENTIAL_NOT_FOUND_CODE) return { valid: false, reason: 'not_found' };
          // #731: credential has not yet reached its activation_time
          if (contractErr.code === CREDENTIAL_NOT_YET_ACTIVE_CODE) return { valid: false, reason: 'not_yet_active' };
          return { valid: false, reason: 'unknown' };
        }

        const lowerError = error.toLowerCase();
        if ((lowerError.includes('not found') || lowerError.includes('credentialnotfound')) && retries > 1) {
          // Retry on not found errors due to state propagation delays
          retries--;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        if (lowerError.includes('not found') || lowerError.includes('credentialnotfound')) {
          return { valid: false, reason: 'not_found' };
        }
        return { valid: false, reason: 'unknown' };
      }

      const retval = scValToNative(
        (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
      );

      if (retval !== false) {
        return { valid: true };
      }

      // Contract returned false — fetch the credential to determine why
      try {
        const credential = await this.getCredential(callerAddress, credentialId, options);
        if (credential.revoked) return { valid: false, reason: 'revoked' };
        if (credential.expiresAt > 0 && credential.expiresAt < Math.floor(Date.now() / 1000)) {
          return { valid: false, reason: 'expired' };
        }
        return { valid: false, reason: 'unknown' };
      } catch (e) {
        if (retries > 1) {
          retries--;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        return { valid: false, reason: 'unknown' };
      }
    }

    // If all retries exhausted, return the last error
    if (lastError) {
      const error = lastError.error;
      if (error.toLowerCase().includes('not found') || error.toLowerCase().includes('credentialnotfound')) {
        return { valid: false, reason: 'not_found' };
      }
    }
    return { valid: false, reason: 'unknown' };
  }

  /**
   * Verify multiple credentials in a batch with partial success handling.
   * Up to 50 credentials can be verified in a single call.
   */
  async verifyCredentialBatch(
    callerAddress: string,
    credentialIds: string[],
    options?: CallOptions & { concurrency?: number }
  ): Promise<Array<{ id: string } & VerifyResult>> {
    if (!Array.isArray(credentialIds)) {
      throw new SorobanIdentityError("credentialIds must be an array", "INVALID_INPUT");
    }
    if (credentialIds.length > 50) {
      throw new SorobanIdentityError("credentialIds cannot exceed 50 items", "INVALID_INPUT");
    }
    const concurrency = options?.concurrency ?? 5;
    return runConcurrent(
      credentialIds,
      async (id) => {
        try {
          const result = await this.verifyCredential(callerAddress, id, options);
          return { id, ...result };
        } catch {
          return { id, valid: false, reason: "unknown" };
        }
      },
      concurrency
    );
  }

  /**
   * Get all credentials issued to a subject address.
   */
  async getCredentialsBySubject(
    callerAddress: string,
    subjectAddress: string,
    options?: CallOptions
  ): Promise<Credential[]> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(subjectAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const idsTx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "get_subject_credentials",
          ...buildGetSubjectCredentialsArgs({ subject: subjectAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const idsResult = await retryWithBackoff(() => this.server.simulateTransaction(idsTx));
    const idsSimulationError = SorobanRpc.Api.isSimulationError(idsResult);
    this.debug('sdk.simulation_result', { operation: 'credentials.getCredentialsBySubject.ids', success: !idsSimulationError });
    if (idsSimulationError) {
      const errMsg = idsResult.error ?? "";
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    const ids = scValToNative(
      (idsResult as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as Uint8Array[];

    if (!ids || ids.length === 0) return [];

    return Promise.all(
      ids.map((raw) =>
        this.getCredential(callerAddress, Buffer.from(raw).toString("hex"), options)
      )
    );
  }

  /**
   * Find credentials issued to a subject that contain a specific claim key/value pair.
   *
   * **Performance caveat:** Claim values are not indexed on-chain. This method
   * fetches all credentials for the subject via {@link CredentialClient.getCredentialsBySubject}
   * and filters them client-side. For subjects with many credentials, prefer
   * building an off-chain index using contract events (`CRED.issued`).
   *
   * @param callerAddress  Stellar address used to build the read simulations.
   * @param subjectAddress The subject whose credentials to search.
   * @param claimKey       The claim key to match (case-sensitive).
   * @param claimValue     The expected claim value (case-sensitive).
   * @param options        Per-call overrides (currently `timeoutSeconds`).
   * @returns Array of {@link Credential} records where `claims[claimKey] === claimValue`.
   * @throws {SorobanIdentityError} on simulation failure.
   *
   * @example
   * ```ts
   * // Find all KYC credentials where country=NG
   * const results = await credentials.getCredentialsByClaimKey(
   *   caller,
   *   subject,
   *   'country',
   *   'NG'
   * );
   * ```
   */
  async getCredentialsByClaimKey(
    callerAddress: string,
    subjectAddress: string,
    claimKey: string,
    claimValue: string,
    options?: CallOptions
  ): Promise<Credential[]> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(subjectAddress);
    const all = await this.getCredentialsBySubject(callerAddress, subjectAddress, options);
    return all.filter((cred) => {
      const claims = cred.claims as Record<string, string>;
      return claims[claimKey] === claimValue;
    });
  }

  /**
   * Get a credential by ID.
   */
  async getCredential(
    callerAddress: string,
    credentialId: string,
    options?: CallOptions
  ): Promise<Credential> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const idBytes = Buffer.from(credentialId, "hex");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "get_credential",
          ...buildGetCredentialArgs({ credentialId: idBytes })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'credentials.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const error: string = (result as { error: string }).error ?? "";
      const contractErr = ContractError.extract(error, CREDENTIAL_MANAGER_ERRORS);
      if (!contractErr) {
        const lower = error.toLowerCase();
        if (
          lower.includes("credentialnotfound") ||
          lower.includes("credential not found") ||
          lower.includes("not found")
        ) {
          throw new SorobanIdentityError(
            `CredentialNotFound: credential ${credentialId} does not exist`,
            "NOT_FOUND"
          );
        }
        throw new SorobanIdentityError(`Simulation failed: ${error}`, "CONTRACT_ERROR");
      }
      if (contractErr.code === CREDENTIAL_NOT_FOUND_CODE) {
        throw new SorobanIdentityError("CredentialNotFound: credential does not exist", "NOT_FOUND");
      }
      if (contractErr.code === CREDENTIAL_REVOKED_CODE) {
        throw new SorobanIdentityError("CredentialRevoked: credential has been revoked", "VALIDATION_ERROR");
      }
      throw contractErr;
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as Credential;
  }

  /**
   * Check if an address is a registered issuer.
   */
  async isIssuer(
    callerAddress: string,
    targetAddress: string,
    options?: CallOptions
  ): Promise<boolean> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(targetAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "is_issuer",
          ...buildIsIssuerArgs({ address: targetAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'credentials.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as boolean;
  }

  /**
   * Verify multiple credentials in parallel with a configurable concurrency limit.
   */
  async verifyMany(
    callerAddress: string,
    credentialIds: string[],
    options?: CallOptions & { concurrency?: number }
  ): Promise<VerifyResult[]> {
    validateStellarAddress(callerAddress);
    const concurrency = options?.concurrency ?? this.config.maxConcurrentRequests ?? 5;
    return runConcurrent(
      credentialIds,
      (id) => this.verifyCredential(callerAddress, id, options),
      concurrency
    );
  }

  /** @deprecated Use {@link verifyMany} instead. */
  async verifyCredentialsBatch(
    callerAddress: string,
    credentialIds: string[],
    options?: CallOptions
  ): Promise<VerifyResult[]> {
    validateStellarAddress(callerAddress);
    return Promise.all(
      credentialIds.map((id) => this.verifyCredential(callerAddress, id, options))
    );
  }

  /**
   * Get the total number of credentials issued to a subject.
   */
  async getCredentialCount(
    callerAddress: string,
    subjectAddress: string,
    options?: CallOptions
  ): Promise<number> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(subjectAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "get_credential_count",
          ...buildGetCredentialCountArgs({ subject: subjectAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'credentials.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as number;
  }

  /**
   * Get the list of all registered issuers.
   */
  async getIssuers(callerAddress: string, options?: CallOptions): Promise<string[]> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call("get_issuers"))
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    const isSimulationError = SorobanRpc.Api.isSimulationError(result);
    this.debug('sdk.simulation_result', { operation: 'credentials.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse)
        .result!.retval
    ) as string[];
  }


  /**
   * Return all revoked credential IDs for an issuer/subject pair.
   *
   * Active credentials are not included; when the pair has no revocations the
   * contract returns an empty vector and this method resolves to `[]`.
   */
  async getRevocations(
    issuerAddress: string,
    subjectAddress: string,
    options?: CallOptions
  ): Promise<string[]> {
    validateStellarAddress(issuerAddress);
    validateStellarAddress(subjectAddress);
    const account = await this.server.getAccount(issuerAddress);
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'get_revocations',
          ...buildGetRevocationsArgs({ issuer: issuerAddress, subject: subjectAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      const errMsg = result.error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }

    const ids = scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as Uint8Array[];
    return (ids ?? []).map((raw) => Buffer.from(raw).toString('hex'));
  }

  /**
   * Get the on-chain revocation record (reason, revoker, timestamp) for a
   * credential. Resolves to `null` when the credential has not been revoked. #951
   */
  async getRevocationRecord(
    callerAddress: string,
    credentialId: string,
    options?: CallOptions
  ): Promise<RevocationRecord | null> {
    const raw = await this.simulateRead(
      callerAddress,
      'get_revocation_record',
      buildGetRevocationRecordArgs({ credentialId: Buffer.from(credentialId, 'hex') }),
      options
    ) as { credential_id: Uint8Array; reason: number; revoked_by?: string; revoked_at: bigint; issuer?: string; subject?: string } | null;
    if (!raw) return null;
    const reasonIdx = Number(raw.reason);
    const reason = REVOCATION_REASONS[reasonIdx] ?? RevocationReason.AdminRevoked;
    return {
      credentialId: Buffer.from(raw.credential_id).toString('hex'),
      issuer: raw.issuer ?? '',
      subject: raw.subject ?? '',
      reason,
      revokedBy: raw.revoked_by,
      revokedAt: Number(raw.revoked_at),
    };
  }

  /**
   * List the IDs of all credentials revoked for a given {@link RevocationReason}. #951
   */
  async getRevokedByReason(
    callerAddress: string,
    reason: RevocationReason,
    options?: CallOptions
  ): Promise<string[]> {
    const ids = await this.simulateRead(
      callerAddress,
      'get_revoked_by_reason',
      buildGetRevokedByReasonArgs({ reason }),
      options
    ) as Uint8Array[] | null;
    return (ids ?? []).map((id) => Buffer.from(id).toString('hex'));
  }

  /** Simulate a read-only contract call and return the decoded return value. */
  private async simulateRead(
    callerAddress: string,
    method: string,
    args: unknown[],
    options?: CallOptions
  ): Promise<unknown> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...(args as never[])))
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      const errMsg = result.error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }
    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    );
  }

  /**
   * Get storage usage statistics for the credential manager.
   */
  async getStorageStats(callerAddress: string, options?: CallOptions): Promise<CredentialStorageStats> {
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
    this.debug('sdk.simulation_result', { operation: 'credentials.simulateTransaction', success: !isSimulationError });
    if (isSimulationError) {
      const errMsg = result.error ?? "";
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, "CONTRACT_ERROR");
    }

    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as CredentialStorageStats;
  }

  /**
   * Cursor-paginated, optionally type-filtered credential IDs for a subject.
   */
  async listCredentialsBySubject(
    callerAddress: string,
    subjectAddress: string,
    options?: CredentialListOptions
  ): Promise<Page<string>> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(subjectAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const cursorArg = options?.cursor === undefined
      ? nativeToScVal(null, { type: 'option' })
      : nativeToScVal({ Some: options.cursor }, {
          type: { Some: ['u64'] } as never,
        });
    const filterArg = options?.credentialType === undefined
      ? nativeToScVal(null, { type: 'option' })
      : nativeToScVal({ Some: options.credentialType }, {
          type: { Some: ['symbol'] } as never,
        });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'list_subject_credentials',
          ...buildListSubjectCredentialsArgs({
            subject: subjectAddress,
            cursor: cursorArg,
            limit: options?.limit ?? 0,
            filter: filterArg,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      const errMsg = result.error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }

    const raw = scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as { items: Uint8Array[]; next_cursor: number | null };

    return {
      items: raw.items.map((b) => Buffer.from(b).toString('hex')),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  /**
   * Cursor-paginated list of registered issuers.
   */
  async listIssuers(
    callerAddress: string,
    options?: PaginationOptions
  ): Promise<Page<string>> {
    validateStellarAddress(callerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const cursorArg = options?.cursor === undefined
      ? nativeToScVal(null, { type: 'option' })
      : nativeToScVal({ Some: options.cursor }, {
          type: { Some: ['u64'] } as never,
        });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'list_issuers',
          ...buildListIssuersArgs({
            cursor: cursorArg,
            limit: options?.limit ?? 0,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      const errMsg = result.error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }

    const raw = scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as { items: string[]; next_cursor: number | null };

    return { items: raw.items, nextCursor: raw.next_cursor ?? null };
  }

  /**
   * Get all credentials issued by an issuer address.
   */
  async getCredentialsByIssuer(
    callerAddress: string,
    issuerAddress: string,
    options?: CallOptions
  ): Promise<Credential[]> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(issuerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const idsTx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'get_issuer_credentials',
          ...buildGetIssuerCredentialsArgs({ issuer: issuerAddress })
        )
      )
      .setTimeout(timeout)
      .build();

    const idsResult = await retryWithBackoff(() => this.server.simulateTransaction(idsTx));
    const idsSimulationError = SorobanRpc.Api.isSimulationError(idsResult);
    this.debug('sdk.simulation_result', { operation: 'credentials.getCredentialsByIssuer.ids', success: !idsSimulationError });
    if (idsSimulationError) {
      const errMsg = idsResult.error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }

    const ids = scValToNative(
      (idsResult as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as Uint8Array[];

    if (!ids || ids.length === 0) return [];

    return Promise.all(
      ids.map((raw) =>
        this.getCredential(callerAddress, Buffer.from(raw).toString('hex'), options)
      )
    );
  }

  /**
   * Cursor-paginated credential IDs issued by an issuer.
   */
  async listCredentialsByIssuer(
    callerAddress: string,
    issuerAddress: string,
    options?: PaginationOptions
  ): Promise<Page<string>> {
    validateStellarAddress(callerAddress);
    validateStellarAddress(issuerAddress);
    const account = new Account(callerAddress, "0");
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;
    const cursorArg = options?.cursor === undefined
      ? nativeToScVal(null, { type: 'option' })
      : nativeToScVal({ Some: options.cursor }, { type: { Some: ['u64'] } as never });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'list_issuer_credentials',
          ...buildListIssuerCredentialsArgs({
            issuer: issuerAddress,
            cursor: cursorArg,
            limit: options?.limit ?? 0,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    const result = await retryWithBackoff(() => this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(result)) {
      const errMsg = result.error ?? '';
      const contractErr = ContractError.extract(errMsg, CREDENTIAL_MANAGER_ERRORS);
      if (contractErr) throw contractErr;
      throw new SorobanIdentityError(`Simulation failed: ${errMsg}`, 'CONTRACT_ERROR');
    }

    const raw = scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as { items: Uint8Array[]; next_cursor: number | null };

    return {
      items: raw.items.map((b) => Buffer.from(b).toString('hex')),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  /**
   * Issue multiple credentials in controlled-concurrency chunks.
   */
  async issueCredentialBatch(items: CredentialInput[], opts?: BatchOptions): Promise<BatchResult> {
    const concurrency = opts?.concurrency ?? 5;
    const succeeded: BatchResult["succeeded"] = [];
    const failed: BatchResult["failed"] = [];

    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map((item) =>
          this.issueCredential(
            item.issuerKeypair,
            item.subjectAddress,
            item.credentialType,
            item.claims,
            item.claimsHashHex,
            item.expiresAt ?? 0,
            item.options,
            item.signatureHex
          )
        )
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j]!;
        if (result.status === "fulfilled") {
          succeeded.push(result.value);
        } else {
          const error =
            result.reason instanceof SorobanIdentityError
              ? result.reason
              : new SorobanIdentityError(
                  result.reason instanceof Error ? result.reason.message : String(result.reason),
                  "UNKNOWN",
                  result.reason
                );
          failed.push({ input: chunk[j]!, error });
        }
      }
    }

    return { succeeded, failed };
  }

  /**
   * Read the on-chain merkle root stored for a credential batch. #1056
   *
   * @param callerAddress Any valid Stellar address used to build the read simulation.
   * @param batchId       Identifier of the batch whose root to fetch.
   * @param options       Per-call overrides.
   * @returns The merkle root as a 64-char lowercase hex string, or `null` when
   *   no root has been stored for the batch.
   */
  async getMerkleRoot(
    callerAddress: string,
    batchId: string,
    options?: CallOptions
  ): Promise<string | null> {
    const raw = await this.simulateRead(
      callerAddress,
      'get_merkle_root',
      buildGetMerkleRootArgs({ batchId }),
      options
    ) as Uint8Array | null;
    if (!raw) return null;
    return Buffer.from(raw).toString('hex');
  }

  /**
   * Store or incrementally update the merkle root for a credential batch. #1056
   *
   * Only a registered issuer may call this. Passing a `proof` lets the contract
   * verify the update against the previous root before persisting the new one,
   * which keeps incremental updates cheap (O(log n) hashing on-chain).
   *
   * @param issuerKeypair The registered issuer signing the transaction.
   * @param batchId       Identifier of the batch to update.
   * @param newRoot       New merkle root as a 64-char hex string (32 bytes).
   * @param options       Optional inclusion proof for the incremental update.
   * @returns `{ txHash }` — the on-chain transaction hash.
   */
  async updateMerkleRoot(
    issuerKeypair: Keypair,
    batchId: string,
    newRoot: string,
    options?: CallOptions & { proof?: MerkleProof }
  ): Promise<{ txHash: string }> {
    const rootHex = normalizeCredentialIdHex(newRoot);
    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'update_merkle_root',
          ...buildUpdateMerkleRootArgs({
            issuer: issuerKeypair.publicKey(),
            batchId,
            newRoot: Buffer.from(rootHex, 'hex'),
            proof: options?.proof,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.updateMerkleRoot', status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);
      return { txHash };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Verify a merkle inclusion proof against the on-chain root for a batch. #1056
   *
   * This is a read-only simulation; the proof is checked by the contract so the
   * caller does not need to trust a locally-cached root.
   */
  async verifyMerkleProofOnChain(
    callerAddress: string,
    batchId: string,
    proof: MerkleProof,
    options?: CallOptions
  ): Promise<boolean> {
    const result = await this.simulateRead(
      callerAddress,
      'verify_merkle_proof',
      buildVerifyMerkleProofArgs({ batchId, proof }),
      options
    );
    return result === true;
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
        "Health check failed: credential-manager not responding",
        "CONTRACT_ERROR"
      );
    }
    return scValToNative(
      (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval
    ) as number;
  }

  /**
   * Returns all revoked credential IDs for the given issuer.
   *
   * Closes #553: because on-chain `verify_credential` results must not be
   * cached indefinitely, consumers can call this method periodically (or
   * subscribe to `credential_revoked` events via {@link SorobanEventListener})
   * to detect newly-revoked credentials and invalidate local caches.
   *
   * The list is derived by iterating the issuer's on-chain credential index
   * and filtering for entries where `revoked === true`. For large issuers
   * use the paginated form via {@link CredentialClient.listIssuerCredentials}
   * and filter client-side, or subscribe to the `credential_revoked` event
   * stream for push-based invalidation.
   *
   * @param callerAddress  Any valid Stellar address (used as the fee-payer account).
   * @param issuerAddress  The issuer whose revocation list to fetch.
   * @param options        Per-call overrides (currently `timeoutSeconds`).
   * @returns Array of hex-encoded 32-byte credential IDs that have been revoked.
   *
   * @example
   * ```ts
   * // closes #553 — re-verify or invalidate any locally-cached result for these IDs
   * const revoked = await credentials.getRevocationList(caller, issuerAddress);
   * for (const id of revoked) {
   *   cache.invalidate(id);
   * }
   * ```
   */
  async getRevocationList(
    callerAddress: string,
    issuerAddress: string,
    options?: CallOptions
  ): Promise<string[]> {
    validateStellarAddress(issuerAddress);
    // Fetch all credentials for this issuer and return the revoked IDs.
    // Closes #553: consumers must re-verify or subscribe to credential_revoked
    // events rather than cache verify_credential results indefinitely.
    const allCredentials = await this.getCredentialsByIssuer(callerAddress, issuerAddress, options);
    return allCredentials
      .filter((cred) => cred.revoked)
      .map((cred) => cred.id);
  }

  // ---------------------------------------------------------------------------
  // #1124 — Oracle integration for off-chain data
  // ---------------------------------------------------------------------------

  /**
   * Register an oracle node with the credential-manager contract. #1124
   *
   * @param adminKeypair  The contract admin signing the transaction.
   * @param oracleAddress Stellar address of the oracle node.
   * @param options       Per-call overrides.
   * @returns `{ txHash }` — the on-chain transaction hash.
   */
  async registerOracle(
    adminKeypair: Keypair,
    oracleAddress: string,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    validateStellarAddress(oracleAddress);
    return this.submitWrite(
      adminKeypair,
      'register_oracle',
      buildRegisterOracleArgs({ admin: adminKeypair.publicKey(), oracle: oracleAddress }),
      options,
      'credentials.registerOracle'
    );
  }

  /**
   * Define the data-feed schema for an oracle. #1124
   */
  async setFeedSchema(
    adminKeypair: Keypair,
    oracleAddress: string,
    feedId: string,
    schema: string,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    validateStellarAddress(oracleAddress);
    return this.submitWrite(
      adminKeypair,
      'set_feed_schema',
      buildSetFeedSchemaArgs({
        admin: adminKeypair.publicKey(),
        oracle: oracleAddress,
        feedId,
        schema,
      }),
      options,
      'credentials.setFeedSchema'
    );
  }

  /**
   * Configure the fee charged by an oracle for a data request. #1124
   */
  async setOracleFee(
    adminKeypair: Keypair,
    oracleAddress: string,
    feeStroops: number | bigint,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    validateStellarAddress(oracleAddress);
    return this.submitWrite(
      adminKeypair,
      'set_oracle_fee',
      buildSetOracleFeeArgs({
        admin: adminKeypair.publicKey(),
        oracle: oracleAddress,
        fee: BigInt(feeStroops),
      }),
      options,
      'credentials.setOracleFee'
    );
  }

  /**
   * Configure the ordered list of fallback oracles used when the primary
   * oracle is unavailable. #1124
   */
  async setFallbackOracles(
    adminKeypair: Keypair,
    oracleAddress: string,
    fallbacks: string[],
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    validateStellarAddress(oracleAddress);
    for (const fb of fallbacks) validateStellarAddress(fb);
    return this.submitWrite(
      adminKeypair,
      'set_fallback_oracles',
      buildSetFallbackOraclesArgs({
        admin: adminKeypair.publicKey(),
        oracle: oracleAddress,
        fallbacks,
      }),
      options,
      'credentials.setFallbackOracles'
    );
  }

  /**
   * Request off-chain data from a registered oracle. #1124
   *
   * @returns `{ txHash, requestId }` — the transaction hash and the on-chain
   *   request identifier used to correlate the oracle callback.
   */
  async requestOffchainData(
    requesterKeypair: Keypair,
    oracleAddress: string,
    feedId: string,
    payload: string,
    options?: CallOptions
  ): Promise<{ txHash: string; requestId: string }> {
    validateStellarAddress(oracleAddress);
    const { txHash, returnValue } = await this.submitWriteWithResult(
      requesterKeypair,
      'request_offchain_data',
      buildRequestOffchainDataArgs({
        requester: requesterKeypair.publicKey(),
        oracle: oracleAddress,
        feedId,
        payload,
      }),
      options,
      'credentials.requestOffchainData'
    );
    const raw = returnValue instanceof Uint8Array ? returnValue : Buffer.alloc(32);
    return { txHash, requestId: Buffer.from(raw).toString('hex') };
  }

  /**
   * Submit an oracle data-verification callback on-chain. #1124
   *
   * @param oracleKeypair The oracle node signing the callback.
   * @param requestId     Hex-encoded request ID returned by {@link requestOffchainData}.
   * @param dataHashHex   64-char hex SHA-256 of the off-chain data payload.
   * @param timestamp     Unix seconds at which the data was observed.
   */
  async oracleCallback(
    oracleKeypair: Keypair,
    requestId: string,
    dataHashHex: string,
    timestamp: number,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    if (!/^[0-9a-fA-F]{64}$/.test(dataHashHex)) {
      throw new SorobanIdentityError(
        'InvalidDataHashFormat: dataHash must be a 64-character hex string (32 bytes)',
        'VALIDATION_ERROR'
      );
    }
    return this.submitWrite(
      oracleKeypair,
      'oracle_callback',
      buildOracleCallbackArgs({
        oracle: oracleKeypair.publicKey(),
        requestId: Buffer.from(requestId, 'hex'),
        dataHash: Buffer.from(dataHashHex, 'hex'),
        timestamp,
      }),
      options,
      'credentials.oracleCallback'
    );
  }

  /**
   * Check whether an oracle response is still within its staleness window. #1124
   */
  async isResponseFresh(
    callerAddress: string,
    requestId: string,
    maxAgeSeconds: number,
    options?: CallOptions
  ): Promise<boolean> {
    const result = await this.simulateRead(
      callerAddress,
      'is_response_fresh',
      buildIsResponseFreshArgs({
        requestId: Buffer.from(requestId, 'hex'),
        maxAgeSeconds,
      }),
      options
    );
    return result === true;
  }

  // ---------------------------------------------------------------------------
  // #1125 — Credential templates on-chain
  // ---------------------------------------------------------------------------

  /**
   * Register a reusable credential template on-chain. #1125
   *
   * @returns `{ txHash, templateId }` — the transaction hash and the new
   *   template identifier.
   */
  async registerTemplate(
    issuerKeypair: Keypair,
    name: string,
    schema: string,
    parentTemplateId?: string,
    options?: CallOptions
  ): Promise<{ txHash: string; templateId: string }> {
    const { txHash, returnValue } = await this.submitWriteWithResult(
      issuerKeypair,
      'register_template',
      buildRegisterTemplateArgs({
        issuer: issuerKeypair.publicKey(),
        name,
        schema,
        parentTemplateId,
      }),
      options,
      'credentials.registerTemplate'
    );
    const raw = returnValue instanceof Uint8Array ? returnValue : Buffer.alloc(32);
    return { txHash, templateId: Buffer.from(raw).toString('hex') };
  }

  /**
   * Publish a new version of an existing credential template. #1125
   */
  async publishTemplateVersion(
    issuerKeypair: Keypair,
    templateId: string,
    schema: string,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    return this.submitWrite(
      issuerKeypair,
      'publish_template_version',
      buildPublishTemplateVersionArgs({
        issuer: issuerKeypair.publicKey(),
        templateId: Buffer.from(templateId, 'hex'),
        schema,
      }),
      options,
      'credentials.publishTemplateVersion'
    );
  }

  /**
   * Validate a set of claims against an on-chain credential template. #1125
   *
   * Read-only simulation; resolves to `true` when the claims satisfy the
   * template's validation rules (including inherited rules).
   */
  async validateAgainstTemplate(
    callerAddress: string,
    templateId: string,
    claims: Record<string, string>,
    options?: CallOptions
  ): Promise<boolean> {
    const result = await this.simulateRead(
      callerAddress,
      'validate_against_template',
      buildValidateAgainstTemplateArgs({
        templateId: Buffer.from(templateId, 'hex'),
        claims,
      }),
      options
    );
    return result === true;
  }

  /**
   * List a credential template for sale on the template marketplace. #1125
   */
  async listTemplateForSale(
    issuerKeypair: Keypair,
    templateId: string,
    priceStroops: number | bigint,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    return this.submitWrite(
      issuerKeypair,
      'list_template_for_sale',
      buildListTemplateForSaleArgs({
        issuer: issuerKeypair.publicKey(),
        templateId: Buffer.from(templateId, 'hex'),
        price: BigInt(priceStroops),
      }),
      options,
      'credentials.listTemplateForSale'
    );
  }

  /**
   * Purchase a credential template from the marketplace. #1125
   */
  async buyTemplate(
    buyerKeypair: Keypair,
    templateId: string,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    return this.submitWrite(
      buyerKeypair,
      'buy_template',
      buildBuyTemplateArgs({
        buyer: buyerKeypair.publicKey(),
        templateId: Buffer.from(templateId, 'hex'),
      }),
      options,
      'credentials.buyTemplate'
    );
  }

  // ---------------------------------------------------------------------------
  // #1126 — Threshold signature support
  // ---------------------------------------------------------------------------

  /**
   * Configure the initial signer set and threshold for an issuer. #1126
   *
   * @param signers   Map of signer address → weight.
   * @param threshold Minimum total weight required to authorize an operation.
   */
  async setSigners(
    adminKeypair: Keypair,
    issuerAddress: string,
    signers: Record<string, number>,
    threshold: number,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    validateStellarAddress(issuerAddress);
    for (const addr of Object.keys(signers)) validateStellarAddress(addr);
    return this.submitWrite(
      adminKeypair,
      'set_signers',
      buildSetSignersArgs({
        admin: adminKeypair.publicKey(),
        issuer: issuerAddress,
        signers,
        threshold,
      }),
      options,
      'credentials.setSigners'
    );
  }

  /**
   * Update the signer set and/or threshold for an issuer. #1126
   */
  async updateSigners(
    adminKeypair: Keypair,
    issuerAddress: string,
    signers: Record<string, number>,
    threshold: number,
    options?: CallOptions
  ): Promise<{ txHash: string }> {
    validateStellarAddress(issuerAddress);
    for (const addr of Object.keys(signers)) validateStellarAddress(addr);
    return this.submitWrite(
      adminKeypair,
      'update_signers',
      buildUpdateSignersArgs({
        admin: adminKeypair.publicKey(),
        issuer: issuerAddress,
        signers,
        threshold,
      }),
      options,
      'credentials.updateSigners'
    );
  }

  /**
   * Validate that a set of signatures meets the configured threshold. #1126
   *
   * Read-only simulation; resolves to `true` when the aggregated signer weight
   * meets or exceeds the issuer's threshold and no signature has expired.
   */
  async validateThreshold(
    callerAddress: string,
    issuerAddress: string,
    messageHashHex: string,
    signaturesHex: string[],
    options?: CallOptions
  ): Promise<boolean> {
    validateStellarAddress(issuerAddress);
    if (!/^[0-9a-fA-F]{64}$/.test(messageHashHex)) {
      throw new SorobanIdentityError(
        'InvalidMessageHashFormat: messageHash must be a 64-character hex string (32 bytes)',
        'VALIDATION_ERROR'
      );
    }
    const result = await this.simulateRead(
      callerAddress,
      'validate_threshold',
      buildValidateThresholdArgs({
        issuer: issuerAddress,
        messageHash: Buffer.from(messageHashHex, 'hex'),
        signatures: signaturesHex.map((s) => Buffer.from(s, 'hex')),
      }),
      options
    );
    return result === true;
  }

  /**
   * Aggregate multiple signatures into a single threshold signature. #1126
   *
   * @returns The aggregated signature as a hex string.
   */
  async aggregateSignatures(
    callerAddress: string,
    issuerAddress: string,
    messageHashHex: string,
    signaturesHex: string[],
    options?: CallOptions
  ): Promise<string> {
    validateStellarAddress(issuerAddress);
    if (!/^[0-9a-fA-F]{64}$/.test(messageHashHex)) {
      throw new SorobanIdentityError(
        'InvalidMessageHashFormat: messageHash must be a 64-character hex string (32 bytes)',
        'VALIDATION_ERROR'
      );
    }
    const result = await this.simulateRead(
      callerAddress,
      'aggregate_signatures',
      buildAggregateSignaturesArgs({
        issuer: issuerAddress,
        messageHash: Buffer.from(messageHashHex, 'hex'),
        signatures: signaturesHex.map((s) => Buffer.from(s, 'hex')),
      }),
      options
    );
    if (result instanceof Uint8Array) return Buffer.from(result).toString('hex');
    if (typeof result === 'string') return result;
    throw new SorobanIdentityError(
      'Unexpected aggregate_signatures return value',
      'CONTRACT_ERROR'
    );
  }

  /**
   * Build, prepare, sign and submit a state-changing contract call, then wait
   * for confirmation. Shared by the oracle, template and threshold methods.
   */
  private async submitWrite(
    signerKeypair: Keypair,
    method: string,
    args: unknown[],
    options: CallOptions | undefined,
    operation: string
  ): Promise<{ txHash: string }> {
    const { txHash } = await this.submitWriteWithResult(
      signerKeypair,
      method,
      args,
      options,
      operation
    );
    return { txHash };
  }

  /**
   * Like {@link submitWrite} but also decodes and returns the contract's
   * return value (used for methods that yield a new on-chain ID).
   */
  private async submitWriteWithResult(
    signerKeypair: Keypair,
    method: string,
    args: unknown[],
    options: CallOptions | undefined,
    operation: string
  ): Promise<{ txHash: string; returnValue: unknown }> {
    const account = await this.server.getAccount(signerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...(args as never[])))
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(signerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation, status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);

      const confirmed = await this.server.getTransaction(txHash) as SorobanRpc.Api.GetSuccessfulTransactionResponse;
      const returnValue = confirmed.returnValue
        ? scValToNative(confirmed.returnValue)
        : undefined;
      return { txHash, returnValue };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Revoke multiple credentials in a single transaction using the on-chain
   * bitmap-based revocation list. #1121
   *
   * Unlike {@link revokeBatch}, this entry point writes into the gas-efficient
   * bitmap storage and records a single reason code for the whole batch.
   *
   * @param issuerKeypair The registered issuer signing the transaction.
   * @param credentialIds Hex-encoded 32-byte credential IDs to revoke.
   * @param options       Per-call overrides plus an optional `reason`.
   * @returns The revoked IDs, their count, and the transaction hash.
   */
  async batchRevoke(
    issuerKeypair: Keypair,
    credentialIds: string[],
    options?: BatchRevokeOptions
  ): Promise<BatchRevokeResult> {
    if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
      throw new SorobanIdentityError(
        'InvalidBatch: at least one credential ID is required',
        'VALIDATION_ERROR'
      );
    }
    const normalized = credentialIds.map(normalizeCredentialIdHex);
    const account = await this.server.getAccount(issuerKeypair.publicKey());
    const timeout = options?.timeoutSeconds ?? this.config.txTimeout ?? 30;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'batch_revoke',
          ...buildBatchRevokeArgs({
            issuer: issuerKeypair.publicKey(),
            credentialIds: normalized.map((id) => Buffer.from(id, 'hex')),
            reason: options?.reason,
          })
        )
      )
      .setTimeout(timeout)
      .build();

    try {
      const prepared = await retryWithBackoff(() => this.server.prepareTransaction(tx));
      prepared.sign(issuerKeypair);

      const result = await retryWithBackoff(() => this.server.sendTransaction(prepared));
      this.debug('sdk.submission_outcome', { operation: 'credentials.batchRevoke', status: result.status });
      if (result.status !== 'PENDING') {
        throw new SorobanIdentityError(`Transaction failed: ${result.status}`, 'CONTRACT_ERROR');
      }

      const txHash = result.hash;
      await pollTransactionStatus(this.server, txHash);
      return { revoked: normalized, count: normalized.length, txHash };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Generate a bitmap revocation proof for a credential. #1121
   *
   * The proof is produced by the contract from the on-chain bitmap and can be
   * checked locally with {@link verifyRevocationProof} or on-chain with
   * {@link verifyRevocationProofOnChain}.
   *
   * @param callerAddress Any valid Stellar address used to build the read simulation.
   * @param issuerAddress The issuer whose bitmap to query.
   * @param credentialId  Hex-encoded 32-byte credential ID.
   * @param options       Per-call overrides.
   * @returns The {@link RevocationProof}, or `null` when no proof is available.
   */
  async generateRevocationProof(
    callerAddress: string,
    issuerAddress: string,
    credentialId: string,
    options?: CallOptions
  ): Promise<RevocationProof | null> {
    validateStellarAddress(issuerAddress);
    const idHex = normalizeCredentialIdHex(credentialId);
    const raw = await this.simulateRead(
      callerAddress,
      'generate_revocation_proof',
      buildGenerateRevocationProofArgs({
        issuer: issuerAddress,
        credentialId: Buffer.from(idHex, 'hex'),
      }),
      options
    ) as
      | { credential_id: Uint8Array; word_index: number; bit_index: number; word: bigint; revoked: boolean }
      | null;
    if (!raw) return null;
    return {
      credentialId: Buffer.from(raw.credential_id).toString('hex'),
      wordIndex: Number(raw.word_index),
      bitIndex: Number(raw.bit_index),
      word: BigInt(raw.word),
      revoked: Boolean(raw.revoked),
    };
  }

  /**
   * Verify a bitmap revocation proof client-side, without any network calls. #1121
   *
   * Recomputes the bit from `proof.word` and compares it to `proof.revoked`.
   *
   * @param proof The proof returned by {@link generateRevocationProof}.
   * @returns `true` when the proof is internally consistent.
   */
  verifyRevocationProof(proof: RevocationProof): boolean {
    if (!proof || typeof proof.wordIndex !== 'number' || typeof proof.bitIndex !== 'number') {
      return false;
    }
    if (proof.bitIndex < 0 || proof.bitIndex > 255) return false;
    const bit = (proof.word >> BigInt(proof.bitIndex)) & BigInt(1);
    return (bit === BigInt(1)) === proof.revoked;
  }

  /**
   * Verify a bitmap revocation proof against the on-chain bitmap. #1121
   *
   * This is a read-only simulation; the proof is checked by the contract so the
   * caller does not need to trust a locally-cached bitmap.
   */
  async verifyRevocationProofOnChain(
    callerAddress: string,
    issuerAddress: string,
    proof: RevocationProof,
    options?: CallOptions
  ): Promise<boolean> {
    validateStellarAddress(issuerAddress);
    const result = await this.simulateRead(
      callerAddress,
      'verify_revocation_proof',
      buildVerifyRevocationProofArgs({
        issuer: issuerAddress,
        credentialId: Buffer.from(normalizeCredentialIdHex(proof.credentialId), 'hex'),
        wordIndex: proof.wordIndex,
        bitIndex: proof.bitIndex,
        word: proof.word,
      }),
      options
    );
    return result === true;
  }

  /**
   * Fetch aggregated revocation statistics for an issuer from the bitmap. #1121
   *
   * @param callerAddress Any valid Stellar address used to build the read simulation.
   * @param issuerAddress The issuer whose statistics to fetch.
   * @param options       Per-call overrides.
   * @returns The {@link RevocationStats} for the issuer.
   */
  async getRevocationStats(
    callerAddress: string,
    issuerAddress: string,
    options?: CallOptions
  ): Promise<RevocationStats> {
    validateStellarAddress(issuerAddress);
    const raw = await this.simulateRead(
      callerAddress,
      'get_revocation_stats',
      buildGetRevocationStatsArgs({ issuer: issuerAddress }),
      options
    ) as { total_revoked: number; word_count: number; by_reason: Array<[number, number]> } | null;
    const byReason: Record<number, number> = {};
    for (const [reason, count] of raw?.by_reason ?? []) {
      byReason[Number(reason)] = Number(count);
    }
    return {
      totalRevoked: Number(raw?.total_revoked ?? 0),
      wordCount: Number(raw?.word_count ?? 0),
      byReason,
    };
  }
}
