import type { Credential, CredentialField } from "./types";

export const DEFAULT_FIELD_LABELS: Record<CredentialField, string> = {
  id: "Credential ID",
  credentialType: "Type",
  subject: "Subject",
  issuer: "Issuer",
  issuedAt: "Issued",
  activationTime: "Active from",
  expiresAt: "Expires",
  status: "Status",
  claims: "Claims",
  claimsHash: "Claims hash",
  signature: "Signature",
};

export type CredentialStatus = "active" | "pending" | "cancelled" | "revoked" | "expired";

export function credentialStatus(cred: Credential, now = Date.now()): CredentialStatus {
  if (cred.revoked) return "revoked";
  if (cred.activationCancelled) return "cancelled";
  if (cred.expiresAt !== 0 && cred.expiresAt * 1000 < now) return "expired";
  if (cred.activationTime && cred.activationTime * 1000 > now) return "pending";
  return "active";
}

/** Contract timestamps are unix seconds; 0 means "never" (expiry) or "immediately" (activation). */
export function formatTimestamp(seconds: number, zero = "Never"): string {
  if (!seconds) return zero;
  return new Date(seconds * 1000).toISOString();
}

export function toIso(seconds: number): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

export function didFor(address: string): string {
  return `did:stellar:${address}`;
}

/** Plain-text value of a single field, used by the PDF renderer. */
export function fieldValue(cred: Credential, field: CredentialField): string {
  switch (field) {
    case "id":
      return cred.id;
    case "credentialType":
      return cred.credentialType;
    case "subject":
      return didFor(cred.subject);
    case "issuer":
      return didFor(cred.issuer);
    case "issuedAt":
      return formatTimestamp(cred.issuedAt);
    case "activationTime":
      return formatTimestamp(cred.activationTime, "On issuance");
    case "expiresAt":
      return formatTimestamp(cred.expiresAt);
    case "status":
      return credentialStatus(cred).toUpperCase();
    case "signature":
      return cred.signature;
    case "claimsHash":
      return cred.claimsHash;
    case "claims":
      return Object.entries(cred.claims)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
  }
}

export function exportBasename(cred: Credential): string {
  return `credential-${cred.credentialType.toLowerCase()}-${cred.id.slice(0, 12)}`;
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
