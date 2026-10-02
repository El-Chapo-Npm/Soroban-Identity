import type { CredentialField, ExportTemplate } from "./types";

const ALL_FIELDS: CredentialField[] = [
  "id",
  "credentialType",
  "status",
  "subject",
  "issuer",
  "issuedAt",
  "activationTime",
  "expiresAt",
  "claims",
  "claimsHash",
  "signature",
];

export const BUILT_IN_TEMPLATES: ExportTemplate[] = [
  {
    id: "standard",
    name: "Standard",
    title: "Verifiable Credential",
    accentColor: "#7c3aed",
    fields: ALL_FIELDS,
    includeQr: true,
    footerText: "Issued on the Stellar network via Soroban Identity.",
    builtIn: true,
  },
  {
    id: "compact",
    name: "Compact",
    title: "Credential Summary",
    accentColor: "#0f766e",
    fields: ["credentialType", "status", "subject", "issuer", "expiresAt"],
    includeQr: true,
    builtIn: true,
  },
  {
    id: "kyc-certificate",
    name: "KYC Certificate",
    title: "Certificate of Identity Verification",
    accentColor: "#1d4ed8",
    fields: ["subject", "issuer", "issuedAt", "expiresAt", "status", "id"],
    fieldLabels: {
      subject: "Verified holder",
      issuer: "Verifying authority",
      issuedAt: "Verified on",
      expiresAt: "Valid until",
      id: "Reference",
    },
    includeQr: true,
    footerText:
      "Scan the QR code to check this certificate's current on-chain status.",
    builtIn: true,
  },
];

export const TEMPLATE_FIELDS = ALL_FIELDS;

const STORAGE_KEY = "soroban-identity:export-templates";

export function loadCustomTemplates(): ExportTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: ExportTemplate[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(templates.filter((t) => !t.builtIn))
    );
  } catch {
    // Storage unavailable (private mode) — templates last for this session only.
  }
}

export function allTemplates(): ExportTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...loadCustomTemplates()];
}

export function newTemplateId(): string {
  return `custom-${Date.now().toString(36)}`;
}

function isTemplate(value: unknown): value is ExportTemplate {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<ExportTemplate>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.title === "string" &&
    typeof t.accentColor === "string" &&
    Array.isArray(t.fields) &&
    typeof t.includeQr === "boolean"
  );
}
