import type { Credential, ExportOptions } from "./types";
import { credentialStatus, didFor, toIso } from "./format";
import { EXPORT_SCHEMA_VERSION } from "./json";

const NAMESPACE = "urn:soroban-identity:credential-export:1.0";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function el(name: string, value: string | null, indent: string): string {
  if (value === null) return `${indent}<${name} xsi:nil="true"/>`;
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

function credentialElement(cred: Credential, indent: string): string {
  const inner = indent + "  ";
  const claims = Object.entries(cred.claims)
    .map(
      ([key, value]) =>
        `${inner}  <Claim key="${escapeXml(key)}">${escapeXml(value)}</Claim>`
    )
    .join("\n");

  return [
    `${indent}<Credential id="${escapeXml(cred.id)}" type="${escapeXml(cred.credentialType)}" version="${cred.version}">`,
    el("Subject", didFor(cred.subject), inner),
    el("Issuer", didFor(cred.issuer), inner),
    el("IssuedAt", toIso(cred.issuedAt), inner),
    el("ActivationTime", toIso(cred.activationTime), inner),
    el("ExpiresAt", toIso(cred.expiresAt), inner),
    el("Status", credentialStatus(cred), inner),
    el("Revoked", String(cred.revoked), inner),
    claims ? `${inner}<Claims>\n${claims}\n${inner}</Claims>` : `${inner}<Claims/>`,
    el("ClaimsHash", cred.claimsHash, inner),
    el("Signature", cred.signature, inner),
    `${indent}</Credential>`,
  ].join("\n");
}

/**
 * Serialise credentials to XML for enterprise systems (identity
 * management platforms, audit archives) that ingest XML rather than JSON.
 */
export function credentialsToXml(creds: Credential[], options: ExportOptions = {}): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<CredentialExport xmlns="${NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" schemaVersion="${EXPORT_SCHEMA_VERSION}">`,
    `  <Metadata>`,
    el("ExportedAt", new Date().toISOString(), "    "),
    el("Generator", "soroban-identity-app", "    "),
    el("Network", options.network ?? null, "    "),
    el("ContractId", options.contractId ?? null, "    "),
    el("Count", String(creds.length), "    "),
    `  </Metadata>`,
    `  <Credentials>`,
    ...creds.map((c) => credentialElement(c, "    ")),
    `  </Credentials>`,
    `</CredentialExport>`,
    "",
  ].join("\n");
}

export function credentialToXml(cred: Credential, options: ExportOptions = {}): string {
  return credentialsToXml([cred], options);
}
