import type { Summary } from "./metrics";
import type { StoreData } from "./store";

export type ReportName = "summary" | "dids" | "issuance" | "types" | "issuers" | "verifications" | "geography" | "events";
export type ReportFormat = "csv" | "json";

export const REPORTS: ReportName[] = ["summary", "dids", "issuance", "types", "issuers", "verifications", "geography", "events"];

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n";
}

const date = (t: number) => new Date(t).toISOString().slice(0, 10);
const iso = (t: number) => new Date(t).toISOString();

/** Tabular rows for a report; JSON exports of `summary` return the full object instead. */
function rows(name: ReportName, summary: Summary, data: StoreData): Array<Record<string, unknown>> {
  switch (name) {
    case "summary":
      return [
        ...Object.entries(summary.totals).map(([metric, value]) => ({ metric, value })),
        ...Object.entries(summary.rates).map(([metric, value]) => ({ metric, value })),
      ];
    case "dids":
      return summary.didsDaily.map((d) => ({ date: date(d.t), created: d.created, total: d.total }));
    case "issuance":
      return summary.issuanceDaily.map((d) => ({ date: date(d.t), issued: d.issued, revoked: d.revoked }));
    case "types":
      return summary.issuedByType.map((t) => ({ credential_type: t.type, issued: t.issued }));
    case "issuers":
      return summary.topIssuers.map((i, rank) => ({
        rank: rank + 1,
        issuer: i.issuer,
        issued: i.issued,
        revoked: i.revoked,
        unique_subjects: i.uniqueSubjects,
        last_issued_at: iso(i.lastIssuedAt),
      }));
    case "verifications":
      return summary.verificationsDaily.map((d) => ({
        date: date(d.t),
        onchain: d.onchain,
        reported: d.reported,
        total: d.onchain + d.reported,
      }));
    case "geography":
      return summary.geography.countries.map((c) => ({ country: c.country, dids: c.dids }));
    case "events":
      return [
        ...data.dids.map((e) => ({ time: iso(e.ts), ledger: e.ledger, type: `did.${e.kind}`, actor: e.controller, subject: "", credential_id: "" })),
        ...data.credentials.map((e) => ({ time: iso(e.ts), ledger: e.ledger, type: `credential.${e.kind}`, actor: e.issuer ?? "", subject: e.subject ?? "", credential_id: e.credentialId ?? "" })),
        ...data.issuers.map((e) => ({ time: iso(e.ts), ledger: e.ledger, type: `issuer.${e.kind}`, actor: e.issuer, subject: "", credential_id: "" })),
        ...data.verifications.map((e) => ({ time: iso(e.ts), ledger: "", type: `verification.${e.source}`, actor: "", subject: e.valid === undefined ? "" : e.valid ? "valid" : `invalid:${e.reason ?? "unknown"}`, credential_id: e.credentialId ?? "" })),
      ].sort((a, b) => a.time.localeCompare(b.time));
  }
}

export function buildReport(
  name: ReportName,
  format: ReportFormat,
  summary: Summary,
  data: StoreData
): { body: string; contentType: string; filename: string } {
  const stamp = new Date(summary.generatedAt).toISOString().slice(0, 10);
  const filename = `soroban-identity-${name}-${stamp}.${format}`;

  if (format === "json") {
    const payload = name === "summary" ? summary : { generatedAt: iso(summary.generatedAt), report: name, rows: rows(name, summary, data) };
    return { body: JSON.stringify(payload, null, 2), contentType: "application/json", filename };
  }
  return { body: toCsv(rows(name, summary, data)), contentType: "text/csv; charset=utf-8", filename };
}
