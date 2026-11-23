import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../i18n';
import CredentialExportMenu, { type ExportFile } from './CredentialExportMenu';
import type { Credential } from '../../../sdk/src/types';

function credential(): Credential {
  return {
    id: 'aa'.repeat(32),
    subject: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    issuer: 'GBP4PZKOITZ4JZ5K7Z2QZ4PZKOITZ4JZ5K7Z2QZ4PZKOITZ4JZ5K7Z2',
    credentialType: 'Kyc' as Credential['credentialType'],
    claims: { name: 'Alice' },
    claimsHash: 'bb'.repeat(32),
    signature: 'cc'.repeat(64),
    issuedAt: 1_700_000_000,
    version: 1,
    lastModifiedAt: 1_700_000_000,
    activationTime: 0,
    expiresAt: 0,
    revoked: false,
    activationCancelled: false,
  };
}

describe('CredentialExportMenu (#939)', () => {
  it('offers the three formats the SDK can write', () => {
    render(<CredentialExportMenu credential={credential()} download={vi.fn()} />);

    expect(screen.getByTestId('export-json')).toBeTruthy();
    expect(screen.getByTestId('export-xml')).toBeTruthy();
    expect(screen.getByTestId('export-pdf')).toBeTruthy();
  });

  it('hands the caller the exported bytes with a sensible filename', async () => {
    const files: ExportFile[] = [];
    render(<CredentialExportMenu credential={credential()} download={(file) => files.push(file)} />);

    await userEvent.click(screen.getByTestId('export-json'));

    expect(files).toHaveLength(1);
    expect(files[0].mimeType).toBe('application/json');
    expect(files[0].filename).toBe(`credential-${'aa'.repeat(6)}.json`);
    expect(JSON.parse(files[0].content.toString('utf8')).id).toBe('aa'.repeat(32));
  });

  it('exports a PDF that starts with the PDF header', async () => {
    const files: ExportFile[] = [];
    render(<CredentialExportMenu credential={credential()} download={(file) => files.push(file)} />);

    await userEvent.click(screen.getByTestId('export-pdf'));

    expect(files[0].mimeType).toBe('application/pdf');
    expect(files[0].content.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  });

  it('announces the exported file to screen readers', async () => {
    render(<CredentialExportMenu credential={credential()} download={vi.fn()} />);

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    await userEvent.click(screen.getByTestId('export-xml'));

    expect(screen.getByRole('status').textContent).toContain('.xml');
  });

  it('reports a failed export instead of silently doing nothing', async () => {
    render(
      <CredentialExportMenu
        credential={credential()}
        download={() => {
          throw new Error('disk full');
        }}
      />
    );

    await userEvent.click(screen.getByTestId('export-json'));

    expect(screen.getByRole('alert').textContent ?? '').toMatch(/failed/i);
  });
});
