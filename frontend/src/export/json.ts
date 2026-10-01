import type { Credential, ExportOptions } from "./types";
import { credentialStatus, didFor, toIso } from "./format";

export const EXPORT_SCHEMA_VERSION = "1.0";

/**
 * W3C Verifiable Credential representation of an on-chain credential,
 * with the raw contract fields kept alongside under `sorobanIdentity`.
 */
export function toVerifiableCredential(cred: Credential) {
  return {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    id: `urn:soroban-identity:credential:${cred.id}`,
    type: ["VerifiableCredential", `${cred.credentialType}Credential`],
    issuer: didFor(cred.issuer),
    issuanceDate: toIso(cred.issuedAt),
    validFrom: toIso(cred.activationTime || cred.issuedAt),
    expirationDate: toIso(cred.expiresAt),
    credentialSubject: {
      id: didFor(cred.subject),
      ...cred.claims,
    },
    credentialStatus: {
      type: "SorobanRevocationStatus",
      status: credentialStatus(cred),
      revoked: cred.revoked,
      activationCancelled: cred.activationCancelled,
    },
    proof: {
      type: "Ed25519Signature",
      verificationMethod: didFor(cred.issuer),
      signatureValue: cred.signature,
      claimsHash: cred.claimsHash,
    },
    sorobanIdentity: { ...cred },
  };
}

function exportMetadata(options: ExportOptions, count: number) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "soroban-identity-app",
    network: options.network ?? null,
    contractId: options.contractId ?? null,
    count,
  };
}

export function credentialToJson(cred: Credential, options: ExportOptions = {}): string {
  return JSON.stringify(
    {
      metadata: exportMetadata(options, 1),
      credential: toVerifiableCredential(cred),
    },
    null,
    2
  );
}

export function credentialsToJson(creds: Credential[], options: ExportOptions = {}): string {
  return JSON.stringify(
    {
      metadata: exportMetadata(options, creds.length),
      credentials: creds.map(toVerifiableCredential),
    },
    null,
    2
  );
}
