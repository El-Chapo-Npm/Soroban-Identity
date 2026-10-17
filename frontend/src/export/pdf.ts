import { jsPDF } from "jspdf";
import type { Credential, ExportOptions, ExportTemplate } from "./types";
import { DEFAULT_FIELD_LABELS, credentialStatus, fieldValue } from "./format";
import { credentialQrDataUrl, verificationUrl } from "./qr";
import { downloadFile } from "./download";

const PAGE_MARGIN = 48;
const HEADER_HEIGHT = 72;
const LABEL_WIDTH = 130;
const QR_SIZE = 110;
const LINE_HEIGHT = 14;

const STATUS_COLORS: Record<string, string> = {
  active: "#047857",
  pending: "#1d4ed8",
  cancelled: "#b91c1c",
  revoked: "#b91c1c",
  expired: "#b45309",
};

/** Render one credential onto the current page of `doc`. */
async function drawCredential(
  doc: jsPDF,
  cred: Credential,
  template: ExportTemplate,
  options: ExportOptions
): Promise<void> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;

  // Header bar
  doc.setFillColor(template.accentColor);
  doc.rect(0, 0, pageWidth, HEADER_HEIGHT, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(template.title, PAGE_MARGIN, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Soroban Identity", pageWidth - PAGE_MARGIN, 44, { align: "right" });

  let y = HEADER_HEIGHT + 36;

  // QR code, top right, links to the live verification page
  let valueWidth = contentWidth - LABEL_WIDTH;
  if (template.includeQr) {
    const qr = await credentialQrDataUrl(cred, options);
    const qrX = pageWidth - PAGE_MARGIN - QR_SIZE;
    doc.addImage(qr, "PNG", qrX, y - 12, QR_SIZE, QR_SIZE);
    doc.setFontSize(7);
    doc.setTextColor("#64748b");
    doc.text("Scan to verify", qrX + QR_SIZE / 2, y + QR_SIZE, { align: "center" });
    valueWidth -= QR_SIZE + 16;
  }
  const qrBottom = y + QR_SIZE + 12;

  for (const field of template.fields) {
    const label = template.fieldLabels?.[field] ?? DEFAULT_FIELD_LABELS[field];
    const value = fieldValue(cred, field) || "—";
    // Fields below the QR code can use the full width.
    const width = template.includeQr && y < qrBottom ? valueWidth : contentWidth - LABEL_WIDTH;
    const lines: string[] = doc.splitTextToSize(value, width);

    if (y + lines.length * LINE_HEIGHT > pageHeight - PAGE_MARGIN - 40) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(template.accentColor);
    doc.text(label.toUpperCase(), PAGE_MARGIN, y);

    const mono = field === "id" || field === "signature" || field === "claimsHash";
    doc.setFont(mono ? "courier" : "helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(
      field === "status" ? STATUS_COLORS[credentialStatus(cred)] : "#0f172a"
    );
    doc.text(lines, PAGE_MARGIN + LABEL_WIDTH, y);

    y += Math.max(1, lines.length) * LINE_HEIGHT + 10;
  }

  // Footer
  doc.setDrawColor("#e2e8f0");
  doc.line(PAGE_MARGIN, pageHeight - PAGE_MARGIN - 18, pageWidth - PAGE_MARGIN, pageHeight - PAGE_MARGIN - 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#64748b");
  if (template.footerText) {
    doc.text(template.footerText, PAGE_MARGIN, pageHeight - PAGE_MARGIN);
  }
  doc.text(
    `Exported ${new Date().toISOString()}`,
    pageWidth - PAGE_MARGIN,
    pageHeight - PAGE_MARGIN,
    { align: "right" }
  );
  if (template.includeQr) {
    doc.link(pageWidth - PAGE_MARGIN - QR_SIZE, HEADER_HEIGHT + 24, QR_SIZE, QR_SIZE, {
      url: verificationUrl(cred, options),
    });
  }
}

/**
 * Build a PDF with one credential per page (a credential with many claims
 * may spill onto extra pages).
 */
export async function credentialsToPdf(
  creds: Credential[],
  template: ExportTemplate,
  options: ExportOptions = {}
): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setProperties({
    title: template.title,
    subject: `${creds.length} verifiable credential(s)`,
    creator: "Soroban Identity",
  });

  for (let i = 0; i < creds.length; i++) {
    if (i > 0) doc.addPage();
    await drawCredential(doc, creds[i], template, options);
  }
  return doc.output("blob");
}

export function credentialToPdf(
  cred: Credential,
  template: ExportTemplate,
  options: ExportOptions = {}
): Promise<Blob> {
  return credentialsToPdf([cred], template, options);
}

/** A single row of the side-by-side comparison table. */
export interface ComparisonRow {
  /** Stable key for the attribute (e.g. "issuer", "expiresAt"). */
  key: string;
  /** Human readable label shown in the first column. */
  label: string;
  /** One value per credential, in the same order as the compared list. */
  values: string[];
  /** Whether the values differ across the compared credentials. */
  differs: boolean;
}

export interface ComparisonInput {
  credentials: Credential[];
  /** Optional issuer reputation score (0-100) per credential, same order. */
  issuerReputations?: (number | null | undefined)[];
  /** Optional verification status label per credential, same order. */
  verificationStatuses?: (string | null | undefined)[];
}

const COMPARISON_ACCENT = "#4f46e5";
const COMPARISON_DIFF_BG = "#fef3c7";
const COMPARISON_ALT_BG = "#f8fafc";

const DEFAULT_COMPARISON_TEMPLATE: ExportTemplate = {
  id: "comparison",
  name: "Comparison Template",
  title: "Credential comparison",
  accentColor: COMPARISON_ACCENT,
  fields: [],
  includeQr: false,
};

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function formatReputation(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "Unknown";
  return `${Math.round(score)}/100`;
}

function formatExpiry(cred: Credential): string {
  const raw = fieldValue(cred, "expiresAt");
  if (!raw) return "No expiry";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

/**
 * Build the attribute rows used by both the PDF and image comparison exports.
 * Rows are aligned by attribute key so differences can be highlighted.
 */
export function buildComparisonRows(input: ComparisonInput): ComparisonRow[] {
  const { credentials, issuerReputations = [], verificationStatuses = [] } = input;
  const rows: ComparisonRow[] = [];

  const push = (key: string, label: string, values: string[]) => {
    const differs = values.some((v) => normalizeValue(v) !== normalizeValue(values[0] ?? ""));
    rows.push({ key, label, values, differs });
  };

  push(
    "issuer",
    "Issuer",
    credentials.map((c) => fieldValue(c, "issuer") || "—")
  );
  push(
    "issuerReputation",
    "Issuer reputation",
    credentials.map((_, i) => formatReputation(issuerReputations[i]))
  );
  push(
    "status",
    "Status",
    credentials.map((c) => credentialStatus(c))
  );
  push(
    "verification",
    "Verification",
    credentials.map((_, i) => verificationStatuses[i] ?? "Unverified")
  );
  push(
    "expiresAt",
    "Expiry date",
    credentials.map((c) => formatExpiry(c))
  );
  push(
    "issuedAt",
    "Issued",
    credentials.map((c) => fieldValue(c, "issuedAt") || "—")
  );

  // Union of all claim keys across the compared credentials.
  const claimKeys = new Set<string>();
  for (const cred of credentials) {
    for (const key of Object.keys(cred.claims ?? {})) claimKeys.add(key);
  }
  for (const key of Array.from(claimKeys).sort()) {
    push(
      key,
      (DEFAULT_FIELD_LABELS as Record<string, string>)[key] ?? key,
      credentials.map((c) => c.claims?.[key] || "—")
    );
  }

  return rows;
}

/** Render the side-by-side comparison table onto the current jsPDF page. */
function drawComparison(
  doc: jsPDF,
  input: ComparisonInput,
  template: ExportTemplate
): void {
  const { credentials } = input;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const labelWidth = 120;
  const columnWidth = (contentWidth - labelWidth) / Math.max(1, credentials.length);
  const rows = buildComparisonRows(input);

  doc.setFillColor(template.accentColor || COMPARISON_ACCENT);
  doc.rect(0, 0, pageWidth, HEADER_HEIGHT, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(template.title || "Credential comparison", PAGE_MARGIN, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Soroban Identity", pageWidth - PAGE_MARGIN, 44, { align: "right" });

  let y = HEADER_HEIGHT + 32;

  const drawHeader = () => {
    doc.setFillColor("#e2e8f0");
    doc.rect(PAGE_MARGIN, y - 12, contentWidth, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor("#0f172a");
    doc.text("ATTRIBUTE", PAGE_MARGIN + 6, y + 3);
    credentials.forEach((cred, i) => {
      const x = PAGE_MARGIN + labelWidth + columnWidth * i + 6;
      const title = cred.claims?.["name"] || fieldValue(cred, "id") || `Credential ${i + 1}`;
      doc.text(doc.splitTextToSize(title, columnWidth - 12)[0], x, y + 3);
    });
    y += 22;
  };

  drawHeader();

  for (const row of rows) {
    const cellLines = row.values.map((value) =>
      doc.splitTextToSize(value, columnWidth - 12)
    );
    const rowHeight = Math.max(20, ...cellLines.map((l) => l.length * LINE_HEIGHT + 8));

    if (y + rowHeight > pageHeight - PAGE_MARGIN - 30) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawHeader();
    }

    if (row.differs) {
      doc.setFillColor(COMPARISON_DIFF_BG);
      doc.rect(PAGE_MARGIN, y - 12, contentWidth, rowHeight, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor("#334155");
    doc.text(doc.splitTextToSize(row.label, labelWidth - 12), PAGE_MARGIN + 6, y);

    cellLines.forEach((lines, i) => {
      const x = PAGE_MARGIN + labelWidth + columnWidth * i + 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(row.differs ? "#92400e" : "#0f172a");
      doc.text(lines, x, y);
    });

    y += rowHeight;
    doc.setDrawColor("#e2e8f0");
    doc.line(PAGE_MARGIN, y - 12, pageWidth - PAGE_MARGIN, y - 12);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#64748b");
  doc.text(
    `Compared ${credentials.length} credentials · Exported ${new Date().toISOString()}`,
    PAGE_MARGIN,
    pageHeight - PAGE_MARGIN
  );
}

/** Build a side-by-side comparison PDF for 2-4 credentials. */
export function comparisonToPdf(
  input: ComparisonInput,
  template: ExportTemplate = DEFAULT_COMPARISON_TEMPLATE
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setProperties({
    title: template.title || "Credential comparison",
    subject: `${input.credentials.length} credentials compared`,
    creator: "Soroban Identity",
  });
  drawComparison(doc, input, template);
  return doc.output("blob");
}

/** Build a PNG image of the side-by-side comparison table. */
export function comparisonToImage(
  input: ComparisonInput,
  template: ExportTemplate = DEFAULT_COMPARISON_TEMPLATE
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  drawComparison(doc, input, template);
  const dataUrl = doc.output("datauristring");
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/** Export the comparison as a PDF and trigger a download. */
export function downloadComparisonPdf(
  input: ComparisonInput,
  filename = "credential-comparison.pdf",
  template?: ExportTemplate
): void {
  downloadFile({
    data: comparisonToPdf(input, template),
    filename,
    mimeType: "application/pdf",
  });
}

/** Export the comparison as a PNG image and trigger a download. */
export function downloadComparisonImage(
  input: ComparisonInput,
  filename = "credential-comparison.png",
  template?: ExportTemplate
): void {
  downloadFile({
    data: comparisonToImage(input, template),
    filename,
    mimeType: "image/png",
  });
}

export const exportToPdf = downloadComparisonPdf;
export const exportToPng = downloadComparisonImage;

