import type { Credential, ExportFile, ExportFormat, ExportOptions, ExportTemplate } from "./types";
import { exportBasename, timestampSlug } from "./format";
import { credentialToJson, credentialsToJson } from "./json";
import { credentialToXml, credentialsToXml } from "./xml";

// jsPDF, qrcode and JSZip are large; load them only when an export runs so
// they stay out of the credentials panel's chunk.
const loadPdf = () => import("./pdf");

const MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  json: "application/json",
  xml: "application/xml",
};

/** Export a single credential in the given format. */
export async function exportCredential(
  cred: Credential,
  format: ExportFormat,
  template: ExportTemplate,
  options: ExportOptions = {}
): Promise<ExportFile> {
  const filename = `${exportBasename(cred)}.${format}`;
  const data =
    format === "pdf"
      ? await (await loadPdf()).credentialToPdf(cred, template, options)
      : new Blob(
          [format === "json" ? credentialToJson(cred, options) : credentialToXml(cred, options)],
          { type: MIME[format] }
        );
  return { filename, mimeType: MIME[format], data };
}

export type BatchMode =
  /** One combined document (multi-page PDF, JSON array, single XML root). */
  | "combined"
  /** A ZIP archive with one file per credential. */
  | "zip";

/** Export several credentials at once. */
export async function exportBatch(
  creds: Credential[],
  format: ExportFormat,
  template: ExportTemplate,
  mode: BatchMode,
  options: ExportOptions = {}
): Promise<ExportFile> {
  if (creds.length === 0) throw new Error("No credentials selected for export");
  if (creds.length === 1) return exportCredential(creds[0], format, template, options);

  const stamp = timestampSlug();

  if (mode === "combined") {
    const data =
      format === "pdf"
        ? await (await loadPdf()).credentialsToPdf(creds, template, options)
        : new Blob(
            [format === "json" ? credentialsToJson(creds, options) : credentialsToXml(creds, options)],
            { type: MIME[format] }
          );
    return { filename: `credentials-${stamp}.${format}`, mimeType: MIME[format], data };
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const cred of creds) {
    const file = await exportCredential(cred, format, template, options);
    zip.file(file.filename, file.data);
  }
  const data = await zip.generateAsync({ type: "blob" });
  return { filename: `credentials-${stamp}-${format}.zip`, mimeType: "application/zip", data };
}
