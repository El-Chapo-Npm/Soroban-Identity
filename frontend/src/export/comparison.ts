/**
 * Export and sharing utilities for credential comparison views.
 */

import type { Credential } from "@soroban-identity/sdk";
import { downloadFile } from "./download";
import { downloadComparisonPdf, downloadComparisonImage } from "./pdf";

export type ComparisonExportFormat = "json" | "csv" | "html" | "pdf" | "png";

export interface ComparisonExportOptions {
  format?: ComparisonExportFormat;
  filename?: string;
  includeMetadata?: boolean;
}

export interface ComparisonExportResult {
  data: string | Blob;
  filename: string;
  mimeType: string;
}

export interface ComparisonLinkOptions {
  baseUrl?: string;
  ids: string[];
}

export function buildComparisonExport(credentials: Credential[]): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    count: credentials.length,
    credentials: credentials.map((c) => ({
      id: c.id,
      issuer: c.issuer,
      subject: c.subject,
      credentialType: c.credentialType,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      claims: c.claims,
    })),
  };
}

export function comparisonToJson(credentials: Credential[]): string {
  return JSON.stringify(buildComparisonExport(credentials), null, 2);
}

export function comparisonToCsv(credentials: Credential[]): string {
  if (credentials.length === 0) return "";
  const allClaimKeys = Array.from(
    new Set(credentials.flatMap((c) => Object.keys(c.claims || {})))
  ).sort();

  const headers = ["id", "type", "issuer", "subject", "issuedAt", "expiresAt", ...allClaimKeys];
  const rows = credentials.map((c) => {
    const values = [
      c.id,
      c.credentialType,
      c.issuer,
      c.subject,
      c.issuedAt ? new Date(c.issuedAt * 1000).toISOString() : "",
      c.expiresAt ? new Date(c.expiresAt * 1000).toISOString() : "",
      ...allClaimKeys.map((k) => (c.claims?.[k] !== undefined ? `"${String(c.claims[k]).replace(/"/g, '""')}"` : "")),
    ];
    return values.join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function comparisonToHtml(credentials: Credential[]): string {
  return `<!DOCTYPE html><html><head><title>Credential Comparison</title><style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}</style></head><body><h1>Credential Comparison</h1><pre>${comparisonToJson(credentials)}</pre></body></html>`;
}

export async function exportComparison(
  credentials: Credential[],
  options: ComparisonExportOptions = {}
): Promise<void> {
  const format = options.format || "json";
  const filename = options.filename || `credential-comparison-${Date.now()}`;

  switch (format) {
    case "json": {
      const content = comparisonToJson(credentials);
      downloadFile(content, `${filename}.json`, "application/json");
      break;
    }
    case "csv": {
      const content = comparisonToCsv(credentials);
      downloadFile(content, `${filename}.csv`, "text/csv");
      break;
    }
    case "html": {
      const content = comparisonToHtml(credentials);
      downloadFile(content, `${filename}.html`, "text/html");
      break;
    }
    case "pdf": {
      await exportComparisonAsPdf(credentials, filename);
      break;
    }
    case "png": {
      await exportComparisonAsImage(credentials, filename);
      break;
    }
  }
}

export async function exportComparisonAsPdf(
  credentials: Credential[],
  filename = `credential-comparison-${Date.now()}`
): Promise<void> {
  try {
    downloadComparisonPdf({ credentials: credentials as any }, `${filename}.pdf`);
  } catch {
    downloadFile(comparisonToJson(credentials), `${filename}.json`, "application/json");
  }
}

export async function exportComparisonAsImage(
  credentials: Credential[],
  filename = `credential-comparison-${Date.now()}`
): Promise<void> {
  try {
    downloadComparisonImage({ credentials: credentials as any }, `${filename}.png`);
  } catch {
    downloadFile(comparisonToJson(credentials), `${filename}.json`, "application/json");
  }
}

export const MAX_COMPARISON_CREDENTIALS = 4;

export function buildComparisonLink(options: ComparisonLinkOptions): string {
  const base =
    options.baseUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "");
  const params = new URLSearchParams();
  params.set("compare", options.ids.slice(0, MAX_COMPARISON_CREDENTIALS).join(","));
  return `${base}?${params.toString()}`;
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function copyComparisonLink(ids: string[]): Promise<boolean> {
  const url = buildComparisonLink({ ids });
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard
      .writeText(url)
      .then(() => true)
      .catch(() => copyWithExecCommand(url));
  }
  return Promise.resolve(copyWithExecCommand(url));
}

export function readComparisonFromLink(search = typeof window !== "undefined" ? window.location.search : ""): string[] {
  const params = new URLSearchParams(search);
  const compare = params.get("compare");
  if (!compare) return [];
  return compare
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .slice(0, MAX_COMPARISON_CREDENTIALS);
}
