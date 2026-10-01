import { useState, useRef, useCallback } from "react";
import type { Credential } from "../../../sdk/src/types";
import "./CredentialImport.module.css";

interface ImportResult {
  success: Credential[];
  errors: { file: string; error: string }[];
  duplicates: { credential: Credential; action: "skip" | "replace" }[];
}

interface CredentialImportProps {
  onImport: (credentials: Credential[], results: ImportResult) => void;
  onClose?: () => void;
}

const CREDENTIAL_FIELDS = [
  "credentialType",
  "issuer",
  "subject",
  "issuedAt",
] as const;

type CredentialField = (typeof CREDENTIAL_FIELDS)[number];

type FieldMapping = Record<CredentialField, string>;

const DEFAULT_FIELD_MAPPING: FieldMapping = {
  credentialType: "credentialType",
  issuer: "issuer",
  subject: "subject",
  issuedAt: "issuedAt",
};

/**
 * Validate if the credential structure is correct
 */
function validateCredentialStructure(credential: unknown): credential is Credential {
  if (!credential || typeof credential !== "object") return false;

  const cred = credential as Record<string, unknown>;
  return CREDENTIAL_FIELDS.every((field) => field in cred);
}

/**
 * Parse a CSV line respecting quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Parse JSON file content
 */
async function parseJSONFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Handle both single credential and array of credentials
        const credentials = Array.isArray(data) ? data : data.credentials || [data];

        if (!Array.isArray(credentials) || credentials.length === 0) {
          reject(new Error("No credentials found in file"));
          return;
        }
        resolve(credentials as Record<string, unknown>[]);
      } catch (error) {
        reject(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : "Unknown error"}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/**
 * Parse CSV file content into raw rows
 */
async function parseCSVFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length < 2) {
          reject(new Error("CSV file must contain a header and at least one row"));
          return;
        }

        const headers = parseCSVLine(lines[0]);
        const rows: Record<string, unknown>[] = [];

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const row: Record<string, unknown> = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] ?? "";
          });
          rows.push(row);
        }

        if (rows.length === 0) {
          reject(new Error("No rows found in CSV"));
          return;
        }
        resolve(rows);
      } catch (error) {
        reject(new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : "Unknown error"}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/**
 * Apply field mapping to raw rows and validate the resulting credentials
 */
function applyFieldMapping(
  rows: Record<string, unknown>[],
  mapping: FieldMapping
): { credentials: Credential[]; invalidCount: number } {
  const credentials: Credential[] = [];
  let invalidCount = 0;

  for (const row of rows) {
    const mapped: Record<string, unknown> = { ...row };
    for (const field of CREDENTIAL_FIELDS) {
      const sourceKey = mapping[field];
      if (sourceKey && sourceKey in row) {
        mapped[field] = row[sourceKey];
      }
    }

    if (validateCredentialStructure(mapped)) {
      credentials.push(mapped as Credential);
    } else {
      invalidCount++;
    }
  }

  return { credentials, invalidCount };
}

/**
 * Detect duplicate credentials
 */
function detectDuplicates(
  newCredentials: Credential[],
  existingCredentials: Credential[]
): { unique: Credential[]; duplicates: Credential[] } {
  const duplicates: Credential[] = [];
  const unique: Credential[] = [];

  for (const newCred of newCredentials) {
    const isDuplicate = existingCredentials.some(
      (existing) =>
        existing.issuer === newCred.issuer &&
        existing.subject === newCred.subject &&
        existing.credentialType === newCred.credentialType
    );

    if (isDuplicate) {
      duplicates.push(newCred);
    } else {
      unique.push(newCred);
    }
  }

  return { unique, duplicates };
}

/**
 * Trigger a client-side download of a template file
 */
function downloadTemplate(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const JSON_TEMPLATE = JSON.stringify(
  [
    {
      credentialType: "example-type",
      issuer: "did:example:issuer",
      subject: "did:example:subject",
      issuedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  null,
  2
);

const CSV_TEMPLATE =
  "credentialType,issuer,subject,issuedAt\nexample-type,did:example:issuer,did:example:subject,2024-01-01T00:00:00.000Z\n";

export default function CredentialImport({
  onImport,
  onClose,
}: CredentialImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [sourceKeys, setSourceKeys] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>(DEFAULT_FIELD_MAPPING);
  const [previewCredentials, setPreviewCredentials] = useState<Credential[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const processFiles = useCallback(
    async (files: FileList) => {
      setIsProcessing(true);
      setUploadProgress(0);

      const results: ImportResult = {
        success: [],
        errors: [],
        duplicates: [],
      };

      const totalFiles = files.length;
      const collectedRows: Record<string, unknown>[] = [];

      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const progress = Math.round(((i + 1) / totalFiles) * 100);

        try {
          let rows: Record<string, unknown>[] = [];

          if (file.name.endsWith(".json")) {
            rows = await parseJSONFile(file);
          } else if (file.name.endsWith(".csv")) {
            rows = await parseCSVFile(file);
          } else {
            results.errors.push({
              file: file.name,
              error: "Unsupported file format. Use JSON or CSV.",
            });
            setUploadProgress(progress);
            continue;
          }

          collectedRows.push(...rows);
          setUploadProgress(progress);
        } catch (error) {
          results.errors.push({
            file: file.name,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          setUploadProgress(progress);
        }
      }

      // Derive available source keys for field mapping
      const keys = Array.from(
        collectedRows.reduce<Set<string>>((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set<string>())
      );

      const { credentials, invalidCount: invalid } = applyFieldMapping(
        collectedRows,
        DEFAULT_FIELD_MAPPING
      );

      setRawRows(collectedRows);
      setSourceKeys(keys);
      setFieldMapping(DEFAULT_FIELD_MAPPING);
      setPreviewCredentials(credentials);
      setInvalidCount(invalid);
      setImportResults(results);
      setIsProcessing(false);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (e.dataTransfer.files) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(e.target.files);
      }
    },
    [processFiles]
  );

  const handleMappingChange = useCallback(
    (field: CredentialField, sourceKey: string) => {
      setFieldMapping((prev) => {
        const next = { ...prev, [field]: sourceKey };
        const { credentials, invalidCount: invalid } = applyFieldMapping(rawRows, next);
        setPreviewCredentials(credentials);
        setInvalidCount(invalid);
        return next;
      });
    },
    [rawRows]
  );

  const handleConfirmImport = useCallback(() => {
    if (importResults && onImport) {
      const finalResults: ImportResult = {
        ...importResults,
        success: previewCredentials,
      };
      onImport(previewCredentials, finalResults);
      onClose?.();
    }
  }, [importResults, previewCredentials, onImport, onClose]);

  const handleReset = useCallback(() => {
    setRawRows([]);
    setSourceKeys([]);
    setFieldMapping(DEFAULT_FIELD_MAPPING);
    setPreviewCredentials([]);
    setInvalidCount(0);
    setImportResults(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const hasErrors = importResults ? importResults.errors.length > 0 : false;

  return (
    <div className="credential-import-modal">
      <div className="credential-import-container">
        <div className="credential-import-header">
          <h2>Import Credentials</h2>
          {onClose && (
            <button
              className="credential-import-close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        {!importResults ? (
          <div className="credential-import-content">
            <div
              className={`credential-import-dropzone ${isDragging ? "dragging" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <h3>Drop credential files here</h3>
              <p>or</p>
              <button
                className="btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv"
                multiple
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
              <p className="credential-import-hint">
                Supported formats: JSON, CSV
              </p>
            </div>

            <div className="credential-import-templates">
              <span>Download a template:</span>
              <button
                className="btn-secondary"
                onClick={() =>
                  downloadTemplate("credentials-template.json", JSON_TEMPLATE, "application/json")
                }
              >
                JSON Template
              </button>
              <button
                className="btn-secondary"
                onClick={() =>
                  downloadTemplate("credentials-template.csv", CSV_TEMPLATE, "text/csv")
                }
              >
                CSV Template
              </button>
            </div>

            {isProcessing && (
              <div className="credential-import-progress">
                <div className="credential-import-progress-bar">
                  <div
                    className="credential-import-progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span>{uploadProgress}%</span>
              </div>
            )}
          </div>
        ) : (
          <div className="credential-import-content">
            {hasErrors && (
              <div className="credential-import-errors">
                <h4>Some files could not be imported</h4>
                <ul>
                  {importResults.errors.map((err, idx) => (
                    <li key={idx}>
                      <strong>{err.file}:</strong> {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sourceKeys.length > 0 && (
              <div className="credential-import-mapping">
                <h4>Field Mapping</h4>
                {CREDENTIAL_FIELDS.map((field) => (
                  <div key={field} className="credential-import-mapping-row">
                    <label htmlFor={`mapping-${field}`}>{field}</label>
                    <select
                      id={`mapping-${field}`}
                      value={fieldMapping[field]}
                      onChange={(e) => handleMappingChange(field, e.target.value)}
                    >
                      <option value="">— none —</option>
                      {sourceKeys.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="credential-import-preview">
              <h4>
                Preview ({previewCredentials.length} valid
                {invalidCount > 0 ? `, ${invalidCount} invalid` : ""})
              </h4>
              {previewCredentials.length > 0 ? (
                <table className="credential-import-preview-table">
                  <thead>
                    <tr>
                      {CREDENTIAL_FIELDS.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewCredentials.slice(0, 10).map((cred, idx) => (
                      <tr key={idx}>
                        {CREDENTIAL_FIELDS.map((field) => (
                          <td key={field}>{String(cred[field] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="credential-import-empty">
                  No valid credentials to import. Adjust the field mapping above.
                </p>
              )}
            </div>

            <div className="credential-import-actions">
              <button className="btn-secondary" onClick={handleReset}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmImport}
                disabled={previewCredentials.length === 0}
              >
                Import {previewCredentials.length} Credential
                {previewCredentials.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
