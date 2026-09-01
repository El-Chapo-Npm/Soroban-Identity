import type { Credential } from "../../../sdk/src/types";

interface ExportOptions {
  includeMetadata?: boolean;
  digitalSignature?: string;
}

/**
 * Export credentials as JSON with metadata and optional digital signature
 */
export function exportCredentialsAsJSON(
  credentials: Credential[],
  options: ExportOptions = {}
): string {
  const exportData = {
    exportDate: new Date().toISOString(),
    credentialCount: credentials.length,
    credentials: credentials.map((cred) => ({
      ...cred,
      exportedAt: new Date().toISOString(),
    })),
    metadata: options.includeMetadata
      ? {
          version: "1.0",
          format: "json",
          signature: options.digitalSignature || null,
        }
      : undefined,
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Export credentials as CSV format
 */
export function exportCredentialsAsCSV(credentials: Credential[]): string {
  if (credentials.length === 0) {
    return "No credentials to export";
  }

  // CSV headers
  const headers = [
    "Type",
    "Status",
    "Issuer",
    "Subject",
    "Issued At",
    "Expires At",
    "Revoked",
    "Claims",
  ];

  // CSV rows
  const rows = credentials.map((cred) => [
    cred.credentialType,
    cred.revoked ? "Revoked" : cred.expiresAt > 0 && Date.now() / 1000 > cred.expiresAt ? "Expired" : "Active",
    cred.issuer || "N/A",
    cred.subject || "N/A",
    new Date(cred.issuedAt * 1000).toISOString(),
    cred.expiresAt === 0
      ? "No Expiry"
      : new Date(cred.expiresAt * 1000).toISOString(),
    cred.revoked ? "Yes" : "No",
    JSON.stringify(cred.claims || {}),
  ]);

  // Combine headers and rows
  const csvContent = [
    headers.map((h) => `"${h}"`).join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  return csvContent;
}

/**
 * Export credentials as PDF with QR codes
 * Note: This requires a PDF library like pdfkit or similar
 * For now, returning a placeholder implementation
 */
export function exportCredentialsAsPDF(credentials: Credential[]): Blob {
  // This would require a PDF library in production
  // For MVP, we'll create a simple text-based PDF
  const pdfContent = credentials
    .map(
      (cred, idx) => `
Credential ${idx + 1}
Type: ${cred.credentialType}
Status: ${cred.revoked ? "Revoked" : cred.expiresAt > 0 && Date.now() / 1000 > cred.expiresAt ? "Expired" : "Active"}
Issuer: ${cred.issuer || "N/A"}
Subject: ${cred.subject || "N/A"}
Issued: ${new Date(cred.issuedAt * 1000).toISOString()}
Expires: ${cred.expiresAt === 0 ? "No Expiry" : new Date(cred.expiresAt * 1000).toISOString()}
---`
    )
    .join("\n");

  return new Blob([pdfContent], { type: "application/pdf" });
}

/**
 * Download exported data as a file
 */
export function downloadExport(
  content: string | Blob,
  filename: string,
  mimeType: string = "text/plain"
): void {
  let blob: Blob;

  if (content instanceof Blob) {
    blob = content;
  } else {
    blob = new Blob([content], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export credentials with progress tracking
 */
export async function exportCredentialsWithProgress(
  credentials: Credential[],
  format: "json" | "csv" | "pdf",
  onProgress?: (progress: number) => void
): Promise<{ content: string | Blob; filename: string; mimeType: string }> {
  // Simulate progress updates
  onProgress?.(10);

  let content: string | Blob;
  let filename: string;
  let mimeType: string;

  try {
    onProgress?.(30);

    switch (format) {
      case "json":
        content = exportCredentialsAsJSON(credentials, { includeMetadata: true });
        filename = `credentials_export_${Date.now()}.json`;
        mimeType = "application/json";
        break;

      case "csv":
        content = exportCredentialsAsCSV(credentials);
        filename = `credentials_export_${Date.now()}.csv`;
        mimeType = "text/csv";
        break;

      case "pdf":
        content = exportCredentialsAsPDF(credentials);
        filename = `credentials_export_${Date.now()}.pdf`;
        mimeType = "application/pdf";
        break;

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    onProgress?.(90);
    onProgress?.(100);

    return { content, filename, mimeType };
  } catch (error) {
    console.error("Export error:", error);
    throw error;
  }
}
