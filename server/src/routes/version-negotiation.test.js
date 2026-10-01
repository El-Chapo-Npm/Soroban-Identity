/**
 * Version negotiation tests (#878).
 *
 * Covers all three version selection mechanisms (URL path, Accept-Version
 * header, vendor MIME type) plus the default fallback, deprecation headers,
 * and the v2 response envelope transform.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApiVersion, setVersionHeaders, SUPPORTED_VERSIONS, DEFAULT_VERSION } from "../versioning.js";
import { applyVersioning, isSupportedVersion, isDeprecatedVersion } from "./version-middleware.js";
import { withV1Prefix, stripV1Prefix, wrapResponse as v1Wrap } from "./v1.js";
import { withV2Prefix, wrapResponse as v2Wrap, toV2 } from "./v2.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(urlStr, headers = {}) {
  return { url: urlStr, headers: { host: "localhost", ...headers } };
}

function makeRes() {
  const headers = {};
  return {
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
  };
}

function resolve(urlStr, headers = {}) {
  const req = makeReq(urlStr, headers);
  const url = new URL(urlStr, "http://localhost");
  return resolveApiVersion(req, url);
}

// ── resolveApiVersion ─────────────────────────────────────────────────────────

describe("resolveApiVersion – URL path prefix", () => {
  it("picks v1 from /v1/credentials", () => {
    const { version, normalizedPath } = resolve("/v1/credentials");
    assert.equal(version, "v1");
    assert.equal(normalizedPath, "/credentials");
  });

  it("picks v2 from /v2/credentials", () => {
    const { version, normalizedPath } = resolve("/v2/credentials");
    assert.equal(version, "v2");
    assert.equal(normalizedPath, "/credentials");
  });

  it("sets isExplicitUrlVersion=true for a versioned path", () => {
    const { isExplicitUrlVersion } = resolve("/v1/health");
    assert.equal(isExplicitUrlVersion, true);
  });

  it("normalises trailing slash: /v1/ → /", () => {
    const { normalizedPath } = resolve("/v1/");
    assert.equal(normalizedPath, "/");
  });

  it("ignores unknown version in URL, falls back to default", () => {
    const { version } = resolve("/v99/credentials");
    assert.equal(version, DEFAULT_VERSION);
  });
});

describe("resolveApiVersion – Accept-Version header", () => {
  it("picks v2 from Accept-Version: v2", () => {
    const { version } = resolve("/credentials", { "accept-version": "v2" });
    assert.equal(version, "v2");
  });

  it("accepts bare number: Accept-Version: 2", () => {
    const { version } = resolve("/credentials", { "accept-version": "2" });
    assert.equal(version, "v2");
  });

  it("ignores unrecognised version, falls back to default", () => {
    const { version } = resolve("/credentials", { "accept-version": "v99" });
    assert.equal(version, DEFAULT_VERSION);
  });

  it("URL prefix takes precedence over Accept-Version header", () => {
    const { version } = resolve("/v1/credentials", { "accept-version": "v2" });
    assert.equal(version, "v1");
  });
});

describe("resolveApiVersion – vendor MIME type", () => {
  it("picks v2 from Accept: application/vnd.soroban-identity.v2+json", () => {
    const { version } = resolve("/credentials", {
      accept: "application/vnd.soroban-identity.v2+json",
    });
    assert.equal(version, "v2");
  });

  it("picks v1 from Accept: application/vnd.soroban-identity.v1+json", () => {
    const { version } = resolve("/credentials", {
      accept: "application/vnd.soroban-identity.v1+json",
    });
    assert.equal(version, "v1");
  });
});

describe("resolveApiVersion – default fallback", () => {
  it("falls back to DEFAULT_VERSION for unversioned path", () => {
    const { version, isExplicitUrlVersion } = resolve("/credentials");
    assert.equal(version, DEFAULT_VERSION);
    assert.equal(isExplicitUrlVersion, false);
  });

  it("DEFAULT_VERSION is v1", () => {
    assert.equal(DEFAULT_VERSION, "v1");
  });

  it("SUPPORTED_VERSIONS includes v1 and v2", () => {
    assert.ok(SUPPORTED_VERSIONS.includes("v1"));
    assert.ok(SUPPORTED_VERSIONS.includes("v2"));
  });
});

// ── setVersionHeaders ─────────────────────────────────────────────────────────

describe("setVersionHeaders", () => {
  it("sets X-API-Version and X-Supported-Versions", () => {
    const res = makeRes();
    setVersionHeaders(res, { version: "v1", isDeprecated: false, isExplicitUrlVersion: false });
    assert.equal(res.headers["x-api-version"], "v1");
    assert.ok(res.headers["x-supported-versions"].includes("v1"));
  });

  it("sets deprecation headers when version is deprecated", () => {
    const res = makeRes();
    setVersionHeaders(res, { version: "v1", isDeprecated: true, isExplicitUrlVersion: true });
    assert.equal(res.headers["deprecation"], "true");
    assert.ok(res.headers["sunset"]);
    assert.ok(res.headers["link"]);
  });

  it("does not set deprecation headers for non-deprecated version", () => {
    const res = makeRes();
    setVersionHeaders(res, { version: "v2", isDeprecated: false, isExplicitUrlVersion: true });
    assert.equal(res.headers["deprecation"], undefined);
  });
});

// ── version-middleware ────────────────────────────────────────────────────────

describe("applyVersioning middleware", () => {
  it("attaches apiVersion and versionedPath to req", () => {
    const req = makeReq("/v2/credentials");
    const res = makeRes();
    const url = new URL("/v2/credentials", "http://localhost");
    applyVersioning(req, res, url);
    assert.equal(req.apiVersion, "v2");
    assert.equal(req.versionedPath, "/credentials");
  });
});

describe("isSupportedVersion / isDeprecatedVersion", () => {
  it("recognises supported versions", () => {
    assert.ok(isSupportedVersion("v1"));
    assert.ok(isSupportedVersion("v2"));
    assert.ok(!isSupportedVersion("v99"));
  });

  it("v1 and v2 are not deprecated", () => {
    assert.ok(!isDeprecatedVersion("v1"));
    assert.ok(!isDeprecatedVersion("v2"));
  });
});

// ── v1 route helpers ──────────────────────────────────────────────────────────

describe("v1 route helpers", () => {
  it("withV1Prefix prepends /v1", () => {
    assert.equal(withV1Prefix("/credentials"), "/v1/credentials");
  });

  it("withV1Prefix is idempotent", () => {
    assert.equal(withV1Prefix("/v1/credentials"), "/v1/credentials");
  });

  it("stripV1Prefix removes /v1", () => {
    assert.equal(stripV1Prefix("/v1/credentials"), "/credentials");
  });

  it("stripV1Prefix is a no-op on unversioned paths", () => {
    assert.equal(stripV1Prefix("/credentials"), "/credentials");
  });

  it("v1 wrapResponse is pass-through", () => {
    const payload = { items: [] };
    assert.deepEqual(v1Wrap(payload), payload);
  });
});

// ── v2 route helpers / response envelope ─────────────────────────────────────

describe("v2 wrapResponse", () => {
  it("wraps a scalar in apiVersion + data + meta", () => {
    const result = v2Wrap({ id: "abc" });
    assert.equal(result.apiVersion, "v2");
    assert.deepEqual(result.data, { id: "abc" });
    assert.ok(result.meta.timestamp);
  });

  it("promotes pageInfo for list responses", () => {
    const result = v2Wrap({
      items: [{ id: "1" }],
      nextCursor: "tok123",
      previousCursor: null,
      pagination: { total_count: 10, page_size: 1, has_more: true },
    });
    assert.equal(result.apiVersion, "v2");
    assert.ok(Array.isArray(result.data.items));
    assert.equal(result.data.pageInfo.nextCursor, "tok123");
    assert.equal(result.data.pageInfo.hasNextPage, true);
    assert.equal(result.data.pageInfo.hasPreviousPage, false);
    assert.equal(result.data.pageInfo.count, 1);
  });

  it("toV2 is an alias of wrapResponse", () => {
    const payload = { items: [], pagination: null };
    assert.deepEqual(toV2(payload), v2Wrap(payload));
  });
});

describe("withV2Prefix", () => {
  it("prepends /v2 to bare path", () => {
    assert.equal(withV2Prefix("/credentials"), "/v2/credentials");
  });

  it("is idempotent", () => {
    assert.equal(withV2Prefix("/v2/credentials"), "/v2/credentials");
  });
});
