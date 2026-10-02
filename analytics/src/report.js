// CSV and PDF exports of an aggregator snapshot.
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function toCsv(snap) {
  const rows = [['section', 'key', 'value']];
  for (const [k, v] of Object.entries(snap.totals)) rows.push(['totals', k, v]);
  for (const p of snap.didsOverTime) rows.push(['dids_cumulative', p.date, p.count]);
  for (const p of snap.issuanceRate) rows.push(['issuance_daily', p.date, p.count]);
  for (const p of snap.verificationFrequency) rows.push(['verifications_daily', p.date, p.count]);
  for (const i of snap.topIssuers) rows.push(['top_issuer', i.issuer, i.count]);
  for (const g of snap.geography) rows.push(['geography', g.country, g.count]);
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

function reportLines(snap) {
  const lines = ['Soroban Identity Analytics Report', `Generated: ${snap.generatedAt}`, '', 'Totals'];
  for (const [k, v] of Object.entries(snap.totals)) lines.push(`  ${k}: ${v}`);
  lines.push('', 'Top issuers');
  for (const i of snap.topIssuers) lines.push(`  ${i.issuer}: ${i.count}`);
  lines.push('', 'Geographic distribution');
  for (const g of snap.geography) lines.push(`  ${g.country}: ${g.count}`);
  lines.push('', 'Daily issuance (last 14 days)');
  for (const p of snap.issuanceRate.slice(-14)) lines.push(`  ${p.date}: ${p.count}`);
  return lines;
}

// Minimal dependency-free single-page text PDF.
export function toPdf(snap) {
  const text = reportLines(snap).slice(0, 60)
    .map((l) => `(${l.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?')}) Tj T*`).join('\n');
  const stream = `BT /F1 11 Tf 14 TL 50 790 Td\n${text}\nET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const off = Buffer.byteLength(pdf); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
