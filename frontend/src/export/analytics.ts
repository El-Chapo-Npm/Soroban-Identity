// frontend/src/export/analytics.ts

import { jsPDF } from 'jspdf';
import { downloadFile } from './download';

/**
 * Aggregated analytics data used by the dashboard.
 * All fields are optional so partial reports can be exported.
 */
export interface AnalyticsTrendPoint {
  date: string;
  issued: number;
  verified: number;
  failed?: number;
}

export interface VerificationRate {
  label: string;
  success: number;
  failure: number;
}

export interface CredentialTypeStat {
  type: string;
  count: number;
  percentage?: number;
}

export interface IssuerPerformance {
  issuer: string;
  issued: number;
  verified: number;
  successRate?: number;
}

export interface GeoStat {
  region: string;
  count: number;
  percentage?: number;
}

export interface AnalyticsReport {
  title?: string;
  generatedAt?: string;
  dateRange?: { start: string; end: string };
  trends?: AnalyticsTrendPoint[];
  verificationRates?: VerificationRate[];
  credentialTypes?: CredentialTypeStat[];
  issuerPerformance?: IssuerPerformance[];
  geography?: GeoStat[];
}

const DEFAULT_TITLE = 'Credential Analytics Report';

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvValue).join(',');
}

function formatTimestamp(value?: string): string {
  if (value) {
    return value;
  }
  return new Date().toISOString();
}

function buildCsv(report: AnalyticsReport): string {
  const lines: string[] = [];
  const title = report.title || DEFAULT_TITLE;

  lines.push(toCsvRow([title]));
  lines.push(toCsvRow(['Generated At', formatTimestamp(report.generatedAt)]));
  if (report.dateRange) {
    lines.push(toCsvRow(['Date Range', `${report.dateRange.start} to ${report.dateRange.end}`]));
  }
  lines.push('');

  if (report.trends && report.trends.length > 0) {
    lines.push(toCsvRow(['Issuance Trends']));
    lines.push(toCsvRow(['Date', 'Issued', 'Verified', 'Failed']));
    for (const point of report.trends) {
      lines.push(toCsvRow([point.date, point.issued, point.verified, point.failed ?? '']));
    }
    lines.push('');
  }

  if (report.verificationRates && report.verificationRates.length > 0) {
    lines.push(toCsvRow(['Verification Rates']));
    lines.push(toCsvRow(['Category', 'Success', 'Failure', 'Success Rate (%)']));
    for (const rate of report.verificationRates) {
      const total = rate.success + rate.failure;
      const successRate = total > 0 ? ((rate.success / total) * 100).toFixed(2) : '0.00';
      lines.push(toCsvRow([rate.label, rate.success, rate.failure, successRate]));
    }
    lines.push('');
  }

  if (report.credentialTypes && report.credentialTypes.length > 0) {
    lines.push(toCsvRow(['Credential Types']));
    lines.push(toCsvRow(['Type', 'Count', 'Percentage (%)']));
    for (const stat of report.credentialTypes) {
      lines.push(
        toCsvRow([stat.type, stat.count, stat.percentage !== undefined ? stat.percentage.toFixed(2) : '']),
      );
    }
    lines.push('');
  }

  if (report.issuerPerformance && report.issuerPerformance.length > 0) {
    lines.push(toCsvRow(['Issuer Performance']));
    lines.push(toCsvRow(['Issuer', 'Issued', 'Verified', 'Success Rate (%)']));
    for (const perf of report.issuerPerformance) {
      let successRate = perf.successRate;
      if (successRate === undefined) {
        successRate = perf.issued > 0 ? (perf.verified / perf.issued) * 100 : 0;
      }
      lines.push(toCsvRow([perf.issuer, perf.issued, perf.verified, successRate.toFixed(2)]));
    }
    lines.push('');
  }

  if (report.geography && report.geography.length > 0) {
    lines.push(toCsvRow(['Geographic Usage']));
    lines.push(toCsvRow(['Region', 'Count', 'Percentage (%)']));
    for (const geo of report.geography) {
      lines.push(
        toCsvRow([geo.region, geo.count, geo.percentage !== undefined ? geo.percentage.toFixed(2) : '']),
      );
    }
    lines.push('');
  }

  return lines.join('\r\n');
}

/**
 * Export analytics report data as a CSV file and trigger a download.
 */
export function exportAnalyticsCsv(report: AnalyticsReport, filename?: string): void {
  const csv = buildCsv(report);
  const name = filename || `analytics-report-${Date.now()}.csv`;
  downloadFile(csv, name, 'text/csv;charset=utf-8;');
}

/**
 * Export analytics report data as a PDF file and trigger a download.
 */
export function exportAnalyticsPdf(report: AnalyticsReport, filename?: string): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = margin;

  const title = report.title || DEFAULT_TITLE;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
  };

  const addHeading = (text: string) => {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(text, margin, cursorY);
    cursorY += 20;
  };

  const addTable = (headers: string[], rows: string[][]) => {
    const colWidth = contentWidth / headers.length;
    const rowHeight = 18;

    ensureSpace(rowHeight * 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    headers.forEach((header, i) => {
      doc.text(header, margin + i * colWidth, cursorY);
    });
    cursorY += rowHeight;

    doc.setFont('helvetica', 'normal');
    for (const row of rows) {
      ensureSpace(rowHeight);
      row.forEach((cell, i) => {
        const text = doc.splitTextToSize(cell, colWidth - 4)[0] ?? '';
        doc.text(text, margin + i * colWidth, cursorY);
      });
      cursorY += rowHeight;
    }
    cursorY += 10;
  };

  // Title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(title, margin, cursorY);
  cursorY += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Generated: ${formatTimestamp(report.generatedAt)}`, margin, cursorY);
  cursorY += 14;
  if (report.dateRange) {
    doc.text(`Date Range: ${report.dateRange.start} to ${report.dateRange.end}`, margin, cursorY);
    cursorY += 14;
  }
  cursorY += 10;

  if (report.trends && report.trends.length > 0) {
    addHeading('Issuance Trends');
    addTable(
      ['Date', 'Issued', 'Verified', 'Failed'],
      report.trends.map((p) => [p.date, String(p.issued), String(p.verified), String(p.failed ?? '')]),
    );
  }

  if (report.verificationRates && report.verificationRates.length > 0) {
    addHeading('Verification Rates');
    addTable(
      ['Category', 'Success', 'Failure', 'Success Rate (%)'],
      report.verificationRates.map((r) => {
        const total = r.success + r.failure;
        const rate = total > 0 ? ((r.success / total) * 100).toFixed(2) : '0.00';
        return [r.label, String(r.success), String(r.failure), rate];
      }),
    );
  }

  if (report.credentialTypes && report.credentialTypes.length > 0) {
    addHeading('Credential Types');
    addTable(
      ['Type', 'Count', 'Percentage (%)'],
      report.credentialTypes.map((c) => [
        c.type,
        String(c.count),
        c.percentage !== undefined ? c.percentage.toFixed(2) : '',
      ]),
    );
  }

  if (report.issuerPerformance && report.issuerPerformance.length > 0) {
    addHeading('Issuer Performance');
    addTable(
      ['Issuer', 'Issued', 'Verified', 'Success Rate (%)'],
      report.issuerPerformance.map((p) => {
        let rate = p.successRate;
        if (rate === undefined) {
          rate = p.issued > 0 ? (p.verified / p.issued) * 100 : 0;
        }
        return [p.issuer, String(p.issued), String(p.verified), rate.toFixed(2)];
      }),
    );
  }

  if (report.geography && report.geography.length > 0) {
    addHeading('Geographic Usage');
    addTable(
      ['Region', 'Count', 'Percentage (%)'],
      report.geography.map((g) => [
        g.region,
        String(g.count),
        g.percentage !== undefined ? g.percentage.toFixed(2) : '',
      ]),
    );
  }

  const name = filename || `analytics-report-${Date.now()}.pdf`;
  const blob = doc.output('blob');
  downloadFile(blob, name, 'application/pdf');
}
```

Note: This file imports `downloadFile` from `./download`. If your existing `downloadFile` utility lives at a different path (e.g. `./index` or `../utils/download`), adjust the import accordingly. The `exportAnalyticsCsv` and `exportAnalyticsPdf` functions should be re-exported from `frontend/src/export/index.ts`:

```typescript
export { exportAnalyticsCsv, exportAnalyticsPdf } from './analytics';
export type {
  AnalyticsReport,
  AnalyticsTrendPoint,
  VerificationRate,
  CredentialTypeStat,
  IssuerPerformance,
  GeoStat,
} from './analytics';