import { describe, it, expect, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  KEY_ID_HEADER,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  buildCanonicalString,
  createSignedFetch,
  generateNonce,
  signRequest,
} from "./request-signing";

const SECRET = "ss_test_secret_value";

/**
 * Recompute a signature the way the server does, independently of the code
 * under test. If the client's canonical form ever drifts from the documented
 * one, this disagrees and the test fails — which is the whole point, since a
 * mismatch is otherwise only discoverable against a live server.
 */
function serverSideSignature(params: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body?: string;
}): string {
  const bodyHash = createHash("sha256")
    .update(params.body ?? "")
    .digest("hex");

  const canonical = [
    params.method.toUpperCase(),
    params.path,
    String(params.timestamp),
    params.nonce,
    bodyHash,
  ].join("\n");

  return `v1=${createHmac("sha256", SECRET).update(canonical).digest("hex")}`;
}

describe("buildCanonicalString", () => {
  it("joins method, path, timestamp, nonce and body hash with newlines", async () => {
    const canonical = await buildCanonicalString({
      method: "post",
      path: "/credentials?limit=10",
      timestamp: 1700000000,
      nonce: "abc",
      body: '{"a":1}',
    });

    expect(canonical.split("\n")).toEqual([
      "POST",
      "/credentials?limit=10",
      "1700000000",
      "abc",
      createHash("sha256").update('{"a":1}').digest("hex"),
    ]);
  });

  it("hashes an absent body as the empty string", async () => {
    const canonical = await buildCanonicalString({
      method: "GET",
      path: "/health",
      timestamp: 1700000000,
      nonce: "abc",
    });

    expect(canonical.split("\n")[4]).toBe(
      createHash("sha256").update("").digest("hex")
    );
  });
});

describe("signRequest", () => {
  it("produces the signature the server computes", async () => {
    const params = {
      method: "POST",
      path: "/credentials",
      timestamp: 1700000000,
      nonce: "fixed-nonce",
      body: '{"subject":"did:stellar:GABC"}',
    };

    const headers = await signRequest({ signingSecret: SECRET, ...params });

    expect(headers[SIGNATURE_HEADER]).toBe(serverSideSignature(params));
    expect(headers[TIMESTAMP_HEADER]).toBe("1700000000");
    expect(headers[NONCE_HEADER]).toBe("fixed-nonce");
  });

  it("omits the key id header unless one is supplied", async () => {
    const headers = await signRequest({
      signingSecret: SECRET,
      method: "GET",
      path: "/credentials",
    });

    expect(headers[KEY_ID_HEADER]).toBeUndefined();
  });

  it("includes the key id when signing with a non-authenticating key", async () => {
    const headers = await signRequest({
      signingSecret: SECRET,
      method: "GET",
      path: "/credentials",
      keyId: "key_abc123",
    });

    expect(headers[KEY_ID_HEADER]).toBe("key_abc123");
  });

  it("defaults the timestamp to now", async () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = await signRequest({
      signingSecret: SECRET,
      method: "GET",
      path: "/credentials",
    });
    const after = Math.floor(Date.now() / 1000);

    const sent = Number(headers[TIMESTAMP_HEADER]);
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(after);
  });

  it("changes the signature when any signed component changes", async () => {
    const base = {
      signingSecret: SECRET,
      method: "POST",
      path: "/credentials",
      timestamp: 1700000000,
      nonce: "fixed-nonce",
      body: '{"a":1}',
    };

    const original = (await signRequest(base))[SIGNATURE_HEADER];

    const variants = [
      { ...base, method: "PUT" },
      { ...base, path: "/admin/api-keys" },
      { ...base, timestamp: 1700000001 },
      { ...base, nonce: "other-nonce" },
      { ...base, body: '{"a":2}' },
    ];

    for (const variant of variants) {
      expect((await signRequest(variant))[SIGNATURE_HEADER]).not.toBe(original);
    }
  });
});

describe("generateNonce", () => {
  it("returns a fresh 128-bit hex value each call", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => generateNonce()));

    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("createSignedFetch", () => {
  it("signs every request and forwards it to the base URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    const signedFetch = createSignedFetch({
      signingSecret: SECRET,
      baseUrl: "https://api.example.org",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const body = '{"subject":"did:stellar:GABC"}';
    await signedFetch("/credentials", { method: "POST", body });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect(url).toBe("https://api.example.org/credentials");

    const headers = init.headers as Record<string, string>;
    expect(headers[SIGNATURE_HEADER]).toBe(
      serverSideSignature({
        method: "POST",
        path: "/credentials",
        timestamp: Number(headers[TIMESTAMP_HEADER]),
        nonce: headers[NONCE_HEADER],
        body,
      })
    );
  });

  it("preserves caller-supplied headers alongside the signature", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    const signedFetch = createSignedFetch({
      signingSecret: SECRET,
      baseUrl: "https://api.example.org",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await signedFetch("/credentials", {
      method: "POST",
      body: "{}",
      headers: { "X-API-Key": "sk_live", "Content-Type": "application/json" },
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers["X-API-Key"]).toBe("sk_live");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers[SIGNATURE_HEADER]).toBeDefined();
  });

  it("gives each request its own nonce so retries are not replays", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    const signedFetch = createSignedFetch({
      signingSecret: SECRET,
      baseUrl: "https://api.example.org",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await signedFetch("/credentials", { method: "POST", body: "{}" });
    await signedFetch("/credentials", { method: "POST", body: "{}" });

    const [, first] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [, second] = fetchImpl.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];

    expect((first.headers as Record<string, string>)[NONCE_HEADER]).not.toBe(
      (second.headers as Record<string, string>)[NONCE_HEADER]
    );
  });
});
