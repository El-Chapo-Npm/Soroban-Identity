import { describe, it, expect } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import {
  buildIssueCredentialArgs,
  buildPassesSybilCheckArgs,
  buildRevokeBatchArgs,
  buildRevokeCredentialArgs,
  buildSubmitScoreArgs,
  encodeRevocationReason,
} from "./contract-args";
import {
  REVOCATION_REASONS,
  RevocationReason,
  isRevocationReason,
  normalizeRevocationReason,
} from "./types";

describe("revocation reason enum (#937)", () => {
  // A real Stellar account address: the shared ADDRESS constant above is not a
  // decodable StrKey, and `nativeToScVal(..., { type: 'address' })` rejects it.
  const VALID_ADDRESS = "GA25UWIGZGMDN2JQSDTBJ45AZKIUOFWMXUYY3T7XGDKWAMSUR7CWYISN";

  it("encodes a reason as the contracttype vector the contract decodes", () => {
    const encoded = encodeRevocationReason(RevocationReason.Superseded);

    // #[contracttype] unit variants travel as Vector[Symbol("Variant")].
    expect(encoded.switch().name).toBe("scvVec");
    expect(encoded.vec()).toHaveLength(1);
    expect(encoded.vec()![0].sym().toString()).toBe("Superseded");
    expect(scValToNative(encoded)).toEqual(["Superseded"]);
  });

  it("builds revoke_credential args with issuer, credential id and reason", () => {
    const args = buildRevokeCredentialArgs({
      issuer: VALID_ADDRESS,
      credentialId: Buffer.alloc(32),
      reason: RevocationReason.Lost,
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[2])).toEqual(["Lost"]);
  });

  it("builds batch args with the same enum encoding for the reason", () => {
    const args = buildRevokeBatchArgs({
      issuer: VALID_ADDRESS,
      credentialIds: [Buffer.alloc(32)],
      reason: RevocationReason.AdminRevoked,
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[2])).toEqual(["AdminRevoked"]);
  });

  it("rejects a reason the contract does not know", () => {
    expect(() => encodeRevocationReason("because-i-said-so" as never)).toThrow(
      /Unknown revocation reason/
    );
  });

  it("normalizes reason labels coming from CSV input", () => {
    expect(REVOCATION_REASONS).toHaveLength(5);
    expect(normalizeRevocationReason("superseded")).toBe(RevocationReason.Superseded);
    expect(normalizeRevocationReason("admin-revoked")).toBe(RevocationReason.AdminRevoked);
    expect(normalizeRevocationReason(" Admin Revoked ")).toBe(RevocationReason.AdminRevoked);
    expect(normalizeRevocationReason("Compromised")).toBe(RevocationReason.Compromised);
    expect(normalizeRevocationReason("because-i-said-so")).toBeUndefined();
    expect(normalizeRevocationReason(undefined)).toBeUndefined();
    expect(isRevocationReason("Superseded")).toBe(true);
    expect(isRevocationReason("superseded")).toBe(false);
  });
});


const ADDRESS = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJ";

describe("contract-args numeric field validation", () => {
  it("buildIssueCredentialArgs rejects a negative expiresAt with a clear client-side error", () => {
    expect(() =>
      buildIssueCredentialArgs({
        issuer: ADDRESS,
        subject: ADDRESS,
        credentialType: "kyc" as any,
        claims: {},
        claimsHash: Buffer.alloc(32),
        signature: Buffer.alloc(64),
        expiresAt: -1n,
      })
    ).toThrow("encodeU64: expected a non-negative integer");
  });

  it("buildPassesSybilCheckArgs rejects an out-of-range minScore with a clear client-side error", () => {
    expect(() =>
      buildPassesSybilCheckArgs({
        subject: ADDRESS,
        minScore: 2n ** 100n,
        minReporters: 1,
      })
    ).toThrow();
  });

  it("buildSubmitScoreArgs rejects an out-of-range delta with a clear client-side error", () => {
    expect(() =>
      buildSubmitScoreArgs({
        reporter: ADDRESS,
        subject: ADDRESS,
        delta: -(2n ** 100n),
        reason: "test",
      })
    ).toThrow();
  });
});
