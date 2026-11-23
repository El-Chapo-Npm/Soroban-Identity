import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { requireAuth } from "../src/http-utils.js";
import { getClientAddress, isIpAllowed } from "../src/ip-whitelist.js";

function makeResponse() {
  let statusCode;
  let body;
  return {
    res: {
      writeHead: (status, _headers) => {
        statusCode = status;
      },
      end: (value) => {
        body = JSON.parse(value);
      },
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

test("IP allowlist matches exact IPv4 and CIDR ranges", () => {
  assert.equal(isIpAllowed("192.0.2.4", ["192.0.2.4"]), true);
  assert.equal(isIpAllowed("192.0.2.4", ["192.0.2.0/24"]), true);
  assert.equal(isIpAllowed("192.0.3.4", ["192.0.2.0/24"]), false);
  assert.equal(isIpAllowed("::ffff:192.0.2.4", ["192.0.2.4"]), true);
});

test("IP allowlist matches IPv6 addresses and CIDR ranges", () => {
  assert.equal(isIpAllowed("2001:db8::5", ["2001:db8::/32"]), true);
  assert.equal(isIpAllowed("2001:db9::5", ["2001:db8::/32"]), false);
  assert.equal(isIpAllowed("2001:db8::5", ["2001:db8::5"]), true);
});

test("invalid addresses and invalid ranges fail closed", () => {
  assert.equal(isIpAllowed("not-an-ip", ["0.0.0.0/0"]), false);
  assert.equal(isIpAllowed("192.0.2.1", ["192.0.2.0/99"]), false);
  assert.equal(isIpAllowed("192.0.2.1", []), false);
});

test("forwarded client IP is used only when TRUST_PROXY is enabled", () => {
  const req = {
    headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
    socket: { remoteAddress: "10.0.0.2" },
  };
  assert.equal(getClientAddress(req, false), "10.0.0.2");
  assert.equal(getClientAddress(req, true), "198.51.100.9");
});

test("admin routes reject an unlisted client before validating credentials", async () => {
  const response = makeResponse();
  const req = {
    url: "/admin/api-keys",
    headers: {},
    socket: { remoteAddress: "198.51.100.7" },
  };
  const config = {
    adminApiKey: "secret",
    adminIpAllowlist: ["192.0.2.0/24"],
    adminIpAllowlistRequired: true,
  };

  assert.equal(await requireAuth(req, response.res, config, ["admin:read"]), false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "ADMIN_IP_NOT_ALLOWED");
});

test("allowlisted clients can authenticate and empty production lists fail closed", async () => {
  const allowedResponse = makeResponse();
  const allowedReq = {
    url: "/admin/api-keys",
    headers: { "x-api-key": "secret" },
    socket: { remoteAddress: "192.0.2.12" },
  };
  const config = {
    adminApiKey: "secret",
    adminIpAllowlist: ["192.0.2.0/24"],
    adminIpAllowlistRequired: true,
  };
  assert.equal(await requireAuth(allowedReq, allowedResponse.res, config, ["admin:read"]), true);

  const deniedResponse = makeResponse();
  assert.equal(
    await requireAuth(
      { url: "/admin", headers: {}, socket: { remoteAddress: "192.0.2.12" } },
      deniedResponse.res,
      { adminApiKey: "secret", adminIpAllowlist: [], adminIpAllowlistRequired: true },
      [],
    ),
    false,
  );
  assert.equal(deniedResponse.statusCode, 503);
  assert.equal(deniedResponse.body.code, "ADMIN_IP_ALLOWLIST_NOT_CONFIGURED");
});

test("public routes are not subject to admin IP allowlist policy", async () => {
  const response = makeResponse();
  const req = {
    url: "/credentials",
    headers: { "x-api-key": "secret" },
    socket: { remoteAddress: "198.51.100.7" },
  };
  const config = {
    adminApiKey: "secret",
    adminIpAllowlist: ["192.0.2.0/24"],
    adminIpAllowlistRequired: true,
  };
  assert.equal(await requireAuth(req, response.res, config, ["credentials:read"]), true);
});

test("production configuration requires an explicit admin allowlist by default", () => {
  assert.equal(loadConfig({ NODE_ENV: "production" }).adminIpAllowlistRequired, true);
  assert.deepEqual(
    loadConfig({ NODE_ENV: "production", ADMIN_IP_ALLOWLIST: "192.0.2.1,2001:db8::/32" }).adminIpAllowlist,
    ["192.0.2.1", "2001:db8::/32"],
  );
  assert.equal(
    loadConfig({ NODE_ENV: "production", ADMIN_IP_ALLOWLIST_REQUIRED: "false" }).adminIpAllowlistRequired,
    false,
  );
});
