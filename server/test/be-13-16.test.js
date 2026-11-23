import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyJwt } from "../src/jwt-auth.js";
import { pinJson } from "../src/ipfs-storage.js";

const issuer = "G" + "A".repeat(55);
function token(payload, secret = "test-secret") {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const input = `${header}.${body}`;
  const signature = crypto.createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${signature}`;
}

test("JWT verification derives the authenticated issuer from the Stellar subject", () => {
  const result = verifyJwt(token({ sub: issuer, scope: "credentials:read", exp: 2_000 }), {
    secret: "test-secret",
    now: 1_000_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.auth.subject, issuer);
  assert.deepEqual(result.auth.scopes, ["credentials:read"]);
});

test("JWT verification rejects a non-Stellar subject", () => {
  const result = verifyJwt(token({ sub: "did:example:issuer", exp: 2_000 }), {
    secret: "test-secret",
    now: 1_000_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_SUBJECT");
});

test("JWT verification supports ES256 JOSE signatures", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "ES256", typ: "JWT" });
  const body = encode({ sub: issuer, exp: 2_000 });
  const input = `${header}.${body}`;
  const der = crypto.sign("sha256", Buffer.from(input), privateKey);
  let offset = 2;
  const readInteger = () => {
    assert.equal(der[offset++], 0x02);
    const length = der[offset++];
    const integer = der.subarray(offset, offset + length);
    offset += length;
    return integer[0] === 0 ? integer.subarray(1) : integer;
  };
  const r = readInteger();
  const s = readInteger();
  const signature = Buffer.concat([Buffer.alloc(32 - r.length), r, Buffer.alloc(32 - s.length), s]);
  const result = verifyJwt(`${input}.${signature.toString("base64url")}`, {
    publicKey,
    algorithms: ["ES256"],
    now: 1_000_000,
  });
  assert.equal(result.ok, true);
});

test("web3.storage pinning returns the API CID", async () => {
  const result = await pinJson({ id: "did:stellar:test" }, {
    token: "secret",
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer secret");
      return { ok: true, status: 200, json: async () => ({ cid: "bafytestcid" }) };
    },
  });
  assert.equal(result, "bafytestcid");
});
