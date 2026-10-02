import type { Credential } from "../../../sdk/src/types";

export type { Credential };

export type ExportFormat = "pdf" | "json" | "xml";

/** Credential fields that a template can show or hide. */
export type CredentialField =
  | "id"
  | "credentialType"
  | "subject"
  | "issuer"
  | "issuedAt"
  | "activationTime"
  | "expiresAt"
  | "status"
  | "claims"
  | "claimsHash"
  | "signature";

/**
 * Controls how a credential is rendered in a PDF export.
 * Built-in templates live in `templates.ts`; users can save their own.
 */
export interface ExportTemplate {
  id: string;
  name: string;
  /** Heading printed at the top of each page. */
  title: string;
  /** Hex colour used for the header bar and section headings. */
  accentColor: string;
  /** Fields to print, in order. */
  fields: CredentialField[];
  /** Optional overrides for field labels. */
  fieldLabels?: Partial<Record<CredentialField, string>>;
  /** Embed a QR code that links to the verification page. */
  includeQr: boolean;
  /** Free text printed at the bottom of each page. */
  footerText?: string;
  /** Built-in templates cannot be deleted or edited. */
  builtIn?: boolean;
}

export interface ExportOptions {
  /** Network the credential lives on, recorded in the export metadata. */
  network?: string;
  /** Contract ID of the credential-manager, recorded in the export metadata. */
  contractId?: string;
  /** Base URL encoded into PDF QR codes. `{id}` is replaced with the credential ID. */
  verifyUrl?: string;
}

export interface ExportFile {
  filename: string;
  mimeType: string;
  data: Blob;
}
