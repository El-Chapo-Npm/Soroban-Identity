import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPORT_FORMATS, exportCredential, type ExportFormat } from '../../../sdk/src/export';
import type { Credential } from '../../../sdk/src/types';

export interface ExportFile {
  content: Buffer;
  mimeType: string;
  filename: string;
}

export interface CredentialExportMenuProps {
  credential: Credential;
  /**
   * Writes the file out. The default downloads it through a blob URL; tests
   * inject their own so they can assert on the bytes without touching the DOM
   * download machinery.
   */
  download?: (file: ExportFile) => void;
}

const LABEL_KEY: Record<ExportFormat, string> = {
  json: 'credentials.exportJson',
  xml: 'credentials.exportXml',
  pdf: 'credentials.exportPdf',
};

/** Triggers a browser download for an exported credential. */
export function downloadExport(file: ExportFile): void {
  const blob = new Blob([new Uint8Array(file.content)], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export menu for a credential (#939): the three formats the SDK can write,
 * with the result announced for screen readers instead of being a silent
 * download.
 */
export default function CredentialExportMenu({
  credential,
  download = downloadExport,
}: CredentialExportMenuProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleExport = (format: ExportFormat) => {
    try {
      const file = exportCredential(credential, format);
      download(file);
      setError('');
      setStatus(t('credentials.exportedAs', { filename: file.filename }));
    } catch {
      setStatus('');
      setError(t('credentials.exportFailed'));
    }
  };

  return (
    <div className="credential-export" role="group" aria-label={t('credentials.exportCredential')}>
      <span className="credential-export__label">{t('credentials.exportCredential')}</span>
      {EXPORT_FORMATS.map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => handleExport(format)}
          data-testid={`export-${format}`}
        >
          {t(LABEL_KEY[format])}
        </button>
      ))}
      <p className="credential-export__status" role="status" aria-live="polite">
        {status}
      </p>
      {error ? (
        <p className="credential-export__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
