import { describe, expect, it } from "vitest";
import {
  EXPORT_SCHEMA_VERSION,
  credentialToJson,
  credentialToPdf,
  credentialToXml,
  credentialStatus,
  escapeXml,
  exportCredential,
  exportLines,
  toExportModel,
} from "./export";
import type { Credential } from "./types";

const NOW = new Date("2026-09-27T12:00:00Z");

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "aa".repeat(32),
    subject: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    issuer: "GBP4PZKOITZ4JZ5K7Z2QZ4PZKOITZ4JZ5K7Z2QZ4PZKOITZ4JZ5K7Z2",
    credentialType: "Kyc" as Credential["credentialType"],
    claims: { name: "Alice & Bob", country: "UA", note: "<script>" },
    claimsHash: "bb".repeat(32),
    signature: "cc".repeat(64),
    issuedAt: 1_700_000_000,
    version: 2,
    lastModifiedAt: 1_700_000_500,
    activationTime: 0,
    expiresAt: 0,
    revoked: false,
    activationCancelled: false,
    ...overrides,
  };
}

describe("credential export model (#939)", () => {
  it("turns 0 timestamps into null and keeps ISO timestamps", () => {
    const model = toExportModel(credential(), NOW);

    expect(model.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(model.issuedAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(model.expiresAt).toBeNull();
    expect(model.activationTime).toBeNull();
    expect(model.status).toBe("valid");
    expect(model.exportedAt).toBe(NOW.toISOString());
  });

  it("derives the status from the credential state", () => {
    expect(credentialStatus(credential({ revoked: true }), NOW)).toBe("revoked");
    expect(credentialStatus(credential({ activationCancelled: true }), NOW)).toBe("cancelled");
    expect(credentialStatus(credential({ expiresAt: Math.floor(NOW.getTime() / 1000) - 1 }), NOW)).toBe(
      "expired"
    );
    expect(
      credentialStatus(credential({ activationTime: Math.floor(NOW.getTime() / 1000) + 60 }), NOW)
    ).toBe("not-yet-active");
  });

  it("exports a revoked credential with its revocation timestamp", () => {
    const model = toExportModel(credential({ revoked: true }), NOW);

    expect(model.status).toBe("revoked");
    expect(model.revoked).toBe(true);
  });
});

describe("credentialToJson", () => {
  it("is byte-identical for the same input and orders keys explicitly", () => {
    const model = toExportModel(credential(), NOW);
    const first = credentialToJson(model);
    const second = credentialToJson(toExportModel(credential(), NOW));

    expect(first).toBe(second);
    const keys = Object.keys(JSON.parse(first));
    expect(keys[0]).toBe("schemaVersion");
    expect(keys[1]).toBe("id");
    expect(keys).toContain("status");
    expect(keys[keys.length - 1]).toBe("exportedAt");
  });

  it("sorts claims so the hash-relevant order never depends on insertion", () => {
    const model = toExportModel(
      credential({ claims: { zeta: "1", alpha: "2" } as Record<string, string> }),
      NOW
    );

    const parsed = JSON.parse(credentialToJson(model));
    expect(Object.keys(parsed.claims)).toEqual(["alpha", "zeta"]);
  });
});

describe("credentialToXml", () => {
  it("escapes claims and never emits raw markup from user data", () => {
    const xml = credentialToXml(toExportModel(credential(), NOW));

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<claim name="note">&lt;script&gt;</claim>');
    expect(xml).toContain("Alice &amp; Bob");
    expect(xml).not.toContain("<script>");
    expect(xml.trim().endsWith("</credential>")).toBe(true);
  });

  it("escapes every XML metacharacter, including attribute values", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    // Control characters are not representable in XML 1.0 at all.
    expect(escapeXml("a\u0000b\u0007c")).toBe("abc");
  });

  it("omits optional elements instead of writing empty ones", () => {
    const xml = credentialToXml(toExportModel(credential(), NOW));

    expect(xml).not.toContain("<expiresAt>");
    expect(xml).not.toContain("<revokedAt>");
  });
});

describe("credentialToPdf", () => {
  it("writes a structurally valid single-page PDF", () => {
    const pdf = credentialToPdf(toExportModel(credential(), NOW));
    const text = pdf.toString("latin1");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages /Kids [3 0 R] /Count 1");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("(Credential ID : ");
    expect(text).toContain("/F1 10 Tf");
  });

  it("points the xref table at the real byte offsets", () => {
    const pdf = credentialToPdf(toExportModel(credential(), NOW));
    const text = pdf.toString("latin1");

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    expect(text).toContain(`0 ${6}\n`); // trailer size: 5 objects + the free entry

    // Entry n+1 in the xref table must land on "<n> 0 obj".
    const tableStart = startxref + `xref\n0 6\n`.length;
    for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
      const entry = text.slice(tableStart + objectNumber * 20, tableStart + objectNumber * 20 + 10);
      const offset = Number(entry);
      expect(text.slice(offset, offset + `${objectNumber} 0 obj`.length)).toBe(
        `${objectNumber} 0 obj`
      );
    }
  });

  it("escapes PDF string metacharacters and drops glyphs Helvetica has no glyph for", () => {
    const pdf = credentialToPdf(
      toExportModel(credential({ claims: { note: "a(b)c\\ Кирилиця" } }), NOW)
    );
    const text = pdf.toString("latin1");

    expect(text).toContain("a\\(b\\)c\\\\ ????????");
    expect(text).not.toContain("(a(b)c");
  });

  it("keeps a long claim list on one page instead of overflowing", () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < 200; index += 1) many[`claim${index}`] = `value ${index}`;

    const pdf = credentialToPdf(toExportModel(credential({ claims: many }), NOW));
    const text = pdf.toString("latin1");

    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(1);
    expect(exportLines(toExportModel(credential({ claims: many }), NOW)).length).toBeGreaterThan(60);
  });
});

describe("exportCredential", () => {
  it("returns the right mime type and filename per format", () => {
    const json = exportCredential(credential(), "json", { now: NOW });
    const xml = exportCredential(credential(), "xml", { now: NOW });
    const pdf = exportCredential(credential(), "pdf", { now: NOW });

    expect(json.mimeType).toBe("application/json");
    expect(xml.mimeType).toBe("application/xml");
    expect(pdf.mimeType).toBe("application/pdf");
    expect(json.filename).toBe(`credential-${"aa".repeat(6)}.json`);
    expect(xml.filename.endsWith(".xml")).toBe(true);
    expect(pdf.filename.endsWith(".pdf")).toBe(true);
    expect(pdf.content.subarray(0, 8).toString()).toBe("%PDF-1.4");
  });

  it("rejects a format the SDK does not implement", () => {
    expect(() => exportCredential(credential(), "docx" as never)).toThrow(/unsupported export format/);
  });
});
