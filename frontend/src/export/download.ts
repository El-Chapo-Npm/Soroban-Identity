import type { ExportFile } from "./types";

/** Trigger a browser download for an export result. */
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
