import type { ExportFile } from "./types";

export function downloadFile(
  fileOrData: ExportFile | Blob | string,
  filename?: string,
  mimeType = "application/octet-stream"
): void {
  let blob: Blob;
  let name = filename || "download";

  if (typeof fileOrData === "object" && "data" in fileOrData && "filename" in fileOrData) {
    name = fileOrData.filename;
    blob = fileOrData.data instanceof Blob
      ? fileOrData.data
      : new Blob([String(fileOrData.data)], { type: fileOrData.mimeType });
  } else if (fileOrData instanceof Blob) {
    blob = fileOrData;
  } else {
    blob = new Blob([String(fileOrData)], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
