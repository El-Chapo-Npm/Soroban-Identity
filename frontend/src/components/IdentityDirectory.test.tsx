import { describe, expect, it } from "vitest";
import { filterIdentities, identityMatchesQuery } from "./IdentityDirectory";
import type { DidDocument } from "../../../sdk/src/types";

const identities: DidDocument[] = [
  {
    id: "did:stellar:GACTIVE",
    controller: "GACTIVE",
    metadata: { name: "Alice Example" },
    createdAt: 1,
    updatedAt: 1,
    active: true,
    services: [],
  },
  {
    id: "did:stellar:GINACTIVE",
    controller: "GINACTIVE",
    metadata: { displayName: "Bob Example" },
    createdAt: 1,
    updatedAt: 1,
    active: false,
    services: [],
  },
];

describe("IdentityDirectory filtering", () => {
  it("matches DID, controller address, and metadata name case-insensitively", () => {
    expect(identityMatchesQuery(identities[0], "alice example")).toBe(true);
    expect(identityMatchesQuery(identities[0], "GACTIVE")).toBe(true);
    expect(identityMatchesQuery(identities[0], "did:stellar:gactive")).toBe(true);
    expect(identityMatchesQuery(identities[0], "missing")).toBe(false);
  });

  it("matches either supported metadata name field", () => {
    const identity = {
      ...identities[0],
      metadata: { name: "Alice", displayName: "Administrator" },
    };
    expect(identityMatchesQuery(identity, "administrator")).toBe(true);
  });

  it("filters identities by query and active status", () => {
    expect(filterIdentities(identities, "", "active")).toEqual([identities[0]]);
    expect(filterIdentities(identities, "", "inactive")).toEqual([identities[1]]);
    expect(filterIdentities(identities, "bob", "all")).toEqual([identities[1]]);
    expect(filterIdentities(identities, "alice", "inactive")).toEqual([]);
  });
});
