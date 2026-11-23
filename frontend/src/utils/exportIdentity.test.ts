/** Export identity data as JSON (issue #1255). */
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ downloadExport: vi.fn() }));

vi.mock("./exportCredentials", () => ({ downloadExport: m.downloadExport }));

import { buildIdentityExport, downloadIdentityExport, IDENTITY_EXPORT_SCHEMA_VERSION } from "./exportIdentity";

const did = {
  id: "did:stellar:GABCDEF",
  controller: "GABCDEF",
  createdAt: 1700000000,
  updatedAt: 1700000000,
  metadata: { name: "Ada" },
  active: true,
};

describe("buildIdentityExport (#1255)", () => {
  it("includes the DID document, address, network and optional record data", () => {
    const out = buildIdentityExport({
      did: did as never,
      address: "GABCDEF",
      network: "testnet",
      reputation: { score: 42 } as never,
      scoreHistory: [{ score: 40 }] as never,
      credentials: [{ id: "cred-1" }],
    });

    expect(out.schemaVersion).toBe(IDENTITY_EXPORT_SCHEMA_VERSION);
    expect(out.did).toBe("did:stellar:GABCDEF");
    expect(out.address).toBe("GABCDEF");
    expect(out.network).toBe("testnet");
    expect(out.document).toEqual(did);
    expect(out.reputation).toEqual({ score: 42 });
    expect(out.scoreHistory).toHaveLength(1);
    expect(out.credentials).toEqual([{ id: "cred-1" }]);
  });

  it("defaults optional sections and rejects exports without an address", () => {
    const out = buildIdentityExport({ did: did as never, address: "GABCDEF", network: "mainnet" });
    expect(out.reputation).toBeNull();
    expect(out.scoreHistory).toEqual([]);
    expect(out.credentials).toEqual([]);
    expect(() => buildIdentityExport({ did: did as never, address: "", network: "mainnet" })).toThrow(
      /address is required/,
    );
  });

  it("downloads the full record as JSON", () => {
    downloadIdentityExport({ did: did as never, address: "GABCDEF", network: "testnet" });
    expect(m.downloadExport).toHaveBeenCalledTimes(1);
    const [content, filename, mimeType] = m.downloadExport.mock.calls[0];
    expect(JSON.parse(content)).toMatchObject({ did: "did:stellar:GABCDEF", network: "testnet" });
    expect(filename).toBe("soroban-identity-GABCDEF.json");
    expect(mimeType).toBe("application/json");
  });
});
