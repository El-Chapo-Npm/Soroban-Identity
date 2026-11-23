import type { DidDocument } from "../../../sdk/src/types";
import type { ReputationRecord, ScoreHistoryEntry } from "../../../sdk/src/reputation";
import { downloadExport } from "./exportCredentials";

export const IDENTITY_EXPORT_SCHEMA_VERSION = "1.0";

export interface IdentityExportInput {
  did: DidDocument;
  address: string;
  network: string;
  reputation?: ReputationRecord | null;
  scoreHistory?: ScoreHistoryEntry[];
  /** Credentials are optional because the credentials panel owns that state. */
  credentials?: unknown[];
}

/**
 * Full, portable snapshot of a user's identity record.
 *
 * The existing "Export JSON" action writes just the DID document. This is a
 * superset: the DID document plus its address, network, reputation history and
 * any credentials supplied by the caller.
 */
export function buildIdentityExport(input: IdentityExportInput) {
  const { did, address, network, reputation, scoreHistory, credentials } = input;
  if (!address) throw new Error("An address is required to export identity data");

  return {
    schemaVersion: IDENTITY_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "soroban-identity-app",
    did: `did:stellar:${address}`,
    address,
    network,
    document: did,
    reputation: reputation ?? null,
    scoreHistory: scoreHistory ?? [],
    credentials: credentials ?? [],
  };
}

export function downloadIdentityExport(input: IdentityExportInput): void {
  const payload = buildIdentityExport(input);
  downloadExport(
    JSON.stringify(payload, null, 2),
    `soroban-identity-${input.address}.json`,
    "application/json",
  );
}
