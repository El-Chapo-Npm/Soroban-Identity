/**
 * Client construction and small helpers shared by the commands.
 */

import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  CredentialClient,
  IdentityClient,
  type SorobanIdentityConfig,
} from "@soroban-identity/sdk";
import { CliFailure, EXIT_CODES } from "./output";
import type { CliConfig } from "./config";

export function sdkConfig(config: CliConfig): SorobanIdentityConfig {
  return {
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    identityRegistryId: config.identityRegistryId,
    credentialManagerId: config.credentialManagerId,
    reputationId: config.reputationId,
    txTimeout: config.txTimeout,
  };
}

export function credentialsClient(config: CliConfig): CredentialClient {
  return new CredentialClient(sdkConfig(config));
}

export function identityClient(config: CliConfig): IdentityClient {
  return new IdentityClient(sdkConfig(config));
}

/** `S...` secret key → keypair, with a message that says what is wrong. */
export function keypairFromSecret(secret: string): Keypair {
  const value = secret.trim();
  if (!/^S[A-Z2-7]{55}$/.test(value)) {
    throw new CliFailure(
      "INVALID_SECRET",
      "secret key must be a 56-character Stellar secret (starts with S)",
      EXIT_CODES.usage
    );
  }
  try {
    return Keypair.fromSecret(value);
  } catch (error) {
    throw new CliFailure("INVALID_SECRET", `secret key rejected: ${(error as Error).message}`, EXIT_CODES.usage);
  }
}

/**
 * SHA-256 of the off-chain claims payload, as the contract expects it
 * (`claimsHash` is a 32-byte hash the issuer computes off-chain).
 *
 * Keys are sorted so the same claims object always hashes to the same value —
 * the SDK hands this hash straight to `issue_credential`.
 */
export function canonicalClaimsHash(claims: Record<string, string>): string {
  const canonical = Object.keys(claims)
    .sort()
    .map((key) => [key, claims[key]] as const);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** `--claim key=value` (repeatable) → object. */
export function parsePairs(values: string[] = [], flag = "claim"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of values) {
    const index = raw.indexOf("=");
    if (index <= 0) {
      throw new CliFailure(
        "INVALID_PAIR",
        `--${flag} expects key=value, got "${raw}"`,
        EXIT_CODES.usage
      );
    }
    out[raw.slice(0, index)] = raw.slice(index + 1);
  }
  return out;
}

/** `--expires-at` accepts a unix timestamp (seconds) or an ISO-8601 date. */
export function parseExpiry(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new CliFailure(
      "INVALID_EXPIRY",
      `--expires-at expects unix seconds or an ISO-8601 date, got "${value}"`,
      EXIT_CODES.usage
    );
  }
  return Math.floor(parsed / 1000);
}
