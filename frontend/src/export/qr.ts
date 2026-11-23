import QRCode from "qrcode";
import type { Credential, ExportOptions } from "./types";

export function verificationUrl(cred: Credential, options: ExportOptions = {}): string {
  const template =
    options.verifyUrl ?? `${window.location.origin}/?verify={id}`;
  return template.replace("{id}", encodeURIComponent(cred.id));
}

/** PNG data URL of a QR code pointing at the credential's verification page. */
export function credentialQrDataUrl(
  cred: Credential,
  options: ExportOptions = {}
): Promise<string> {
  return QRCode.toDataURL(verificationUrl(cred, options), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
}
