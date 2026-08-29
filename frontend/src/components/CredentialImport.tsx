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

/**
 * Validate if the credential structure is correct
 */
function validateCredentialStructure(credential: unknown): credential is Credential {
  if (!credential || typeof credential !== "object") return false;

  const cred = credential as Record<string, unknown>;
  const requiredFields = ["credentialType", "issuer", "subject", "issuedAt"];
  return requiredFields.every((field) => field in cred);
}

/**
 * Parse JSON file content
 */
async function parseJSONFile(file: File): Promise<Credential[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Handle both single credential and array of credentials
        const credentials = Array.isArray(data) ? data : data.credentials || [data];

        const validCredentials = credentials.filter(validateCredentialStructure);
        if (validCredentials.length === 0) {
          reject(new Error("No valid credentials found in file"));
        }
        resolve(validCredentials);
      } catch (error) {
        reject(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : "Unknown error"}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/**
 * Parse CSV file content
 */
async function parseCSVFile(file: File): Promise<Credential[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.split("\n");
        const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

        const credentials: Credential[] = [];
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;

          const values = lines[i].split(",").map((v) => v.trim().replace(/"/g, ""));
          const row: Record<string, unknown> = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx];
          });

          if (validateCredentialStructure(row)) {
            credentials.push(row as Credential);
          }
        }

        if (credentials.length === 0) {
          reject(new Error("No valid credentials found in CSV"));
        }
        resolve(credentials);
      } catch (error) {
        reject(new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : "Unknown error"}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
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

export default function CredentialImport({
  onImport,
  onClose,
}: CredentialImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewCredentials, setPreviewCredentials] = useState<Credential[]>([]);
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

      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const progress = Math.round(((i + 1) / totalFiles) * 100);

        try {
          let credentials: Credential[] = [];

          if (file.name.endsWith(".json")) {
            credentials = await parseJSONFile(file);
          } else if (file.name.endsWith(".csv")) {
            credentials = await parseCSVFile(file);
          } else {
            results.errors.push({
              file: file.name,
              error: "Unsupported file format. Use JSON or CSV.",
            });
            setUploadProgress(progress);
            continue;
          }

          results.success.push(...credentials);
          setUploadProgress(progress);
        } catch (error) {
          results.errors.push({
            file: file.name,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          setUploadProgress(progress);
        }
      }

      setPreviewCredentials(results.success);
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

  const handleConfirmImport = useCallback(() => {
    if (importResults && onImport) {
      onImport(previewCredentials, importResults);
      onClose?.();
    }
  }, [importResults, previewCredentials, onImport, onClose]);

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
                Select Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.csv"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
              <p className="credential-import-hint">
                Supports JSON and CSV formats
              </p>
            </div>

            {isProcessing && (
              <div className="credential-import-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p>{uploadProgress}% uploaded</p>
              </div>
            )}
          </div>
        ) : (
          <div className="credential-import-preview">
            <div className="credential-import-summary">
              <p>
                ✓ <strong>{importResults.success.length}</strong> credentials imported
              </p>
              {importResults.errors.length > 0 && (
                <p>
                  ✗ <strong>{importResults.errors.length}</strong> errors
                </p>
              )}
              {importResults.duplicates.length > 0 && (
                <p>
                  ⚠ <strong>{importResults.duplicates.length}</strong> duplicates
                </p>
              )}
            </div>

            {importResults.errors.length > 0 && (
              <div className="credential-import-errors">
                <h4>Errors:</h4>
                {importResults.errors.map((err, idx) => (
                  <div key={idx} className="error-item">
                    <strong>{err.file}:</strong> {err.error}
                  </div>
                ))}
              </div>
            )}

            {previewCredentials.length > 0 && (
              <div className="credential-import-list">
                <h4>Preview ({previewCredentials.length} credentials):</h4>
                {previewCredentials.slice(0, 5).map((cred, idx) => (
                  <div key={idx} className="credential-preview-item">
                    <div className="credential-preview-type">
                      {cred.credentialType}
                    </div>
                    <div className="credential-preview-info">
                      <p>
                        <strong>Issuer:</strong> {cred.issuer}
                      </p>
                      <p>
                        <strong>Subject:</strong> {cred.subject}
                      </p>
                    </div>
                  </div>
                ))}
                {previewCredentials.length > 5 && (
                  <p className="credential-preview-more">
                    +{previewCredentials.length - 5} more...
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="credential-import-footer">
          {importResults && (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setImportResults(null);
                  setPreviewCredentials([]);
                }}
              >
                Back
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmImport}
                disabled={previewCredentials.length === 0}
              >
                Import {previewCredentials.length} Credentials
              </button>
            </>
          )}
          {onClose && !importResults && (
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
