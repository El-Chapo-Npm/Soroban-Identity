import { jsPDF } from "jspdf";
import type { Credential, ExportOptions, ExportTemplate } from "./types";
import { DEFAULT_FIELD_LABELS, credentialStatus, fieldValue } from "./format";
import { credentialQrDataUrl, verificationUrl } from "./qr";

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
