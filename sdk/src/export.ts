/**
 * Credential export formats (#939): canonical JSON, XML and a minimal PDF.
 *
 * No runtime dependency is added for any of the three. The XML serialiser and
 * the PDF writer are small on purpose, and both are exercised by tests that
 * parse the bytes they produce rather than trusting a string snapshot:
 *
 * - JSON: a fixed key order plus `schemaVersion`, so two exports of the same
 *   credential are byte-identical.
 * - XML: hand-written serialiser with entity escaping, schema in
 *   `docs/credential-export.xsd`.
 * - PDF: a single-page PDF 1.4 document (catalog, page tree, content stream,
 *   xref table), written byte by byte so the xref offsets are correct.
 */

import type { Credential, RevokedCredential } from "./types";

/** Bumped when the shape of an export changes in a way consumers must notice. */
export const EXPORT_SCHEMA_VERSION = 1;

export type ExportFormat = "json" | "xml" | "pdf";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["json", "xml", "pdf"];

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  json: "application/json",
  xml: "application/xml",
  pdf: "application/pdf",
};

export type CredentialStatus =
  | "valid"
  | "revoked"
  | "expired"
  | "not-yet-active"
  | "cancelled";

/**
 * The format-neutral view of a credential that all three serialisers share.
 *
 * Timestamps become ISO-8601 strings (or `null` for "never"), because `0` means
 * "no expiry"/"no time lock" in the contract and would be indistinguishable from
 * the unix epoch in an export.
 */
export interface ExportedCredential {
  schemaVersion: number;
  id: string;
  subject: string;
  issuer: string;
  credentialType: string;
  claims: Record<string, string>;
  claimsHash: string;
  signature: string;
  issuedAt: string;
  expiresAt: string | null;
  activationTime: string | null;
  version: number;
  revoked: boolean;
  /** Present only for revoked credentials. */
  revokedAt?: string;
  status: CredentialStatus;
  /** When the export was produced — makes a downloaded file self-describing. */
  exportedAt: string;
}

function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function optionalIso(seconds: number | undefined): string | null {
  return seconds && seconds > 0 ? toIso(seconds) : null;
}

export function credentialStatus(
  credential: Credential,
  now: Date = new Date()
): CredentialStatus {
  if (credential.revoked) return "revoked";
  if (credential.activationCancelled) return "cancelled";
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (credential.expiresAt > 0 && nowSeconds >= credential.expiresAt) return "expired";
  if (credential.activationTime > 0 && nowSeconds < credential.activationTime) {
    return "not-yet-active";
  }
  return "valid";
}

/** Builds the shared export model. `now` is injectable so tests stay stable. */
export function toExportModel(
  credential: Credential | RevokedCredential,
  now: Date = new Date()
): ExportedCredential {
  const revokedAt = (credential as RevokedCredential).revokedAt;
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    id: credential.id,
    subject: credential.subject,
    issuer: credential.issuer,
    credentialType: String(credential.credentialType),
    claims: { ...credential.claims },
    claimsHash: credential.claimsHash,
    signature: credential.signature,
    issuedAt: toIso(credential.issuedAt),
    expiresAt: optionalIso(credential.expiresAt),
    activationTime: optionalIso(credential.activationTime),
    version: credential.version,
    revoked: credential.revoked,
    ...(revokedAt ? { revokedAt: typeof revokedAt === "string" ? revokedAt : toIso(Number(revokedAt)) } : {}),
    status: credentialStatus(credential, now),
    exportedAt: now.toISOString(),
  };
}

/** Canonical JSON: explicit key order, claims sorted, 2-space indent. */
export function credentialToJson(model: ExportedCredential): string {
  const claims: Record<string, string> = {};
  for (const key of Object.keys(model.claims).sort()) {
    claims[key] = model.claims[key];
  }
  const ordered: Record<string, unknown> = {
    schemaVersion: model.schemaVersion,
    id: model.id,
    subject: model.subject,
    issuer: model.issuer,
    credentialType: model.credentialType,
    status: model.status,
    claims,
    claimsHash: model.claimsHash,
    signature: model.signature,
    issuedAt: model.issuedAt,
    expiresAt: model.expiresAt,
    activationTime: model.activationTime,
    version: model.version,
    revoked: model.revoked,
  };
  if (model.revokedAt !== undefined && model.revokedAt !== null) {
    ordered.revokedAt = model.revokedAt;
  }
  ordered.exportedAt = model.exportedAt;
  return JSON.stringify(ordered, null, 2) + "\n";
}

/** Escapes text for XML character data and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 forbids most control characters outright.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function credentialToXml(model: ExportedCredential): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<credential xmlns="https://soroban-identity.dev/schema/credential-export" schemaVersion="${model.schemaVersion}">`
  );
  lines.push(`  <id>${escapeXml(model.id)}</id>`);
  lines.push(`  <subject>${escapeXml(model.subject)}</subject>`);
  lines.push(`  <issuer>${escapeXml(model.issuer)}</issuer>`);
  lines.push(`  <credentialType>${escapeXml(model.credentialType)}</credentialType>`);
  lines.push(`  <status>${escapeXml(model.status)}</status>`);
  lines.push("  <claims>");
  for (const key of Object.keys(model.claims).sort()) {
    lines.push(`    <claim name="${escapeXml(key)}">${escapeXml(model.claims[key])}</claim>`);
  }
  lines.push("  </claims>");
  lines.push(`  <claimsHash>${escapeXml(model.claimsHash)}</claimsHash>`);
  lines.push(`  <signature>${escapeXml(model.signature)}</signature>`);
  lines.push(`  <version>${model.version}</version>`);
  lines.push(`  <revoked>${model.revoked ? "true" : "false"}</revoked>`);
  if (model.revokedAt) {
    lines.push(`  <revokedAt>${escapeXml(model.revokedAt)}</revokedAt>`);
  }
  lines.push(`  <issuedAt>${escapeXml(model.issuedAt)}</issuedAt>`);
  if (model.expiresAt) {
    lines.push(`  <expiresAt>${escapeXml(model.expiresAt)}</expiresAt>`);
  }
  if (model.activationTime) {
    lines.push(`  <activationTime>${escapeXml(model.activationTime)}</activationTime>`);
  }
  lines.push(`  <exportedAt>${escapeXml(model.exportedAt)}</exportedAt>`);
  lines.push("</credential>");
  return lines.join("\n") + "\n";
}

/** The human-readable lines that go into a PDF. */
export function exportLines(model: ExportedCredential): string[] {
  const lines = [
    "Soroban Identity credential",
    "",
    `Credential ID : ${model.id}`,
    `Subject       : ${model.subject}`,
    `Issuer        : ${model.issuer}`,
    `Type          : ${model.credentialType}`,
    `Status        : ${model.status}`,
    `Issued at     : ${model.issuedAt}`,
    `Expires at    : ${model.expiresAt ?? "never"}`,
    `Version       : ${model.version}`,
    `Claims hash   : ${model.claimsHash}`,
  ];
  if (model.revokedAt) {
    lines.push(`Revoked at    : ${model.revokedAt}`);
  }
  lines.push("", "Claims:");
  for (const key of Object.keys(model.claims).sort()) {
    lines.push(`  ${key}: ${model.claims[key]}`);
  }
  lines.push("", `Exported      : ${model.exportedAt}`);
  return lines;
}

/** PDF strings are Latin-1 and use backslash escapes for `(`, `)` and `\`. */
function toPdfString(value: string): string {
  return value
    .replace(/[\\]/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // Keep to printable ASCII: the built-in Helvetica has no glyphs beyond it.
    .replace(/[^\x20-\x7E]/g, "?");
}

/**
 * Minimal single-page PDF 1.4 with one text block.
 *
 * Objects: 1 catalog, 2 page tree, 3 page, 4 content stream, 5 font. The xref
 * table is built from the real byte offsets, so readers that trust it (most of
 * them) find every object.
 */
export function credentialToPdf(model: ExportedCredential, lines = exportLines(model)): Buffer {
  const textLines = lines.slice(0, 60); // one page of text
  const content =
    "BT\n/F1 10 Tf\n14 TL\n40 800 Td\n" +
    textLines.map((line) => `(${toPdfString(line)}) Tj T*`).join("\n") +
    "\nET\n";

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (text: string): void => {
    const buffer = Buffer.from(text, "latin1");
    chunks.push(buffer);
    offset += buffer.length;
  };

  push("%PDF-1.4\n");
  // A binary comment marks the file as binary for tools that sniff it.
  push("%\xE2\xE3\xCF\xD3\n");

  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = offset;
  push(`xref\n0 ${objects.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (const objectOffset of offsets) {
    push(`${objectOffset.toString().padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return Buffer.concat(chunks);
}

export interface ExportedFile {
  content: Buffer;
  mimeType: string;
  filename: string;
}

/** Serialises a credential in one of the supported formats. */
export function exportCredential(
  credential: Credential | RevokedCredential,
  format: ExportFormat,
  options: { now?: Date } = {}
): ExportedFile {
  const model = toExportModel(credential, options.now ?? new Date());
  const base = `credential-${model.id.slice(0, 12)}`;
  switch (format) {
    case "json":
      return {
        content: Buffer.from(credentialToJson(model), "utf8"),
        mimeType: EXPORT_MIME_TYPES.json,
        filename: `${base}.json`,
      };
    case "xml":
      return {
        content: Buffer.from(credentialToXml(model), "utf8"),
        mimeType: EXPORT_MIME_TYPES.xml,
        filename: `${base}.xml`,
      };
    case "pdf":
      return {
        content: credentialToPdf(model),
        mimeType: EXPORT_MIME_TYPES.pdf,
        filename: `${base}.pdf`,
      };
    default: {
      const unreachable: never = format;
      throw new Error(`unsupported export format: ${String(unreachable)}`);
    }
  }
}
