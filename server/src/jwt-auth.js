import crypto from "node:crypto";

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const SUPPORTED_ALGORITHMS = new Set(["HS256", "RS256", "ES256", "EdDSA"]);

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function signingInput(header, payload) {
  return `${header}.${payload}`;
}

function joseEcdsaToDer(signature) {
  if (signature.length !== 64) return null;
  const encodeInteger = (value) => {
    let firstNonZero = 0;
    while (firstNonZero < value.length - 1 && value[firstNonZero] === 0) firstNonZero += 1;
    let integer = value.subarray(firstNonZero);
    if (integer[0] & 0x80) integer = Buffer.concat([Buffer.from([0]), integer]);
    return Buffer.concat([Buffer.from([0x02, integer.length]), integer]);
  };
  const sequence = Buffer.concat([
    encodeInteger(signature.subarray(0, 32)),
    encodeInteger(signature.subarray(32)),
  ]);
  return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
}

function verifySignature(algorithm, signingBytes, signature, key) {
  if (algorithm === "HS256") {
    const expected = crypto.createHmac("sha256", key).update(signingBytes).digest();
    return signature.length === expected.length && crypto.timingSafeEqual(signature, expected);
  }
  if (algorithm === "EdDSA") return crypto.verify(null, Buffer.from(signingBytes), key, signature);
  const verifier = crypto.createVerify(algorithm === "RS256" ? "RSA-SHA256" : "SHA256");
  verifier.update(signingBytes);
  verifier.end();
  return verifier.verify(key, algorithm === "ES256" ? joseEcdsaToDer(signature) ?? Buffer.alloc(0) : signature);
}

function parseScopes(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? "").split(/[\s,]+/).filter(Boolean);
}

function isStellarPublicKey(value) {
  return typeof value === "string" && STELLAR_PUBLIC_KEY.test(value);
}

/**
 * Verify a compact JWT and normalize its issuer identity.
 *
 * HS256 uses JWT_SECRET. RS256, ES256 and EdDSA use JWT_PUBLIC_KEY. A subject
 * is deliberately restricted to a Stellar account public key so it can be
 * used as the issuer identity for rate limits and contract operations.
 */
export function verifyJwt(token, {
  secret = process.env.JWT_SECRET,
  publicKey = process.env.JWT_PUBLIC_KEY,
  algorithms = String(process.env.JWT_ALGORITHMS ?? "HS256").split(",").map((value) => value.trim()).filter(Boolean),
  issuer = process.env.JWT_ISSUER,
  audience = process.env.JWT_AUDIENCE,
  clockSkewSeconds = 30,
  now = Date.now(),
} = {}) {
  if (typeof token !== "string") return { ok: false, code: "INVALID_TOKEN", message: "Bearer token is missing." };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, code: "INVALID_TOKEN", message: "Malformed JWT bearer token." };
  let header;
  let payload;
  let signature;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    return { ok: false, code: "INVALID_TOKEN", message: "JWT could not be decoded." };
  }
  if (!header || !payload || typeof payload !== "object" || !SUPPORTED_ALGORITHMS.has(header.alg) || !algorithms.includes(header.alg)) {
    return { ok: false, code: "INVALID_TOKEN", message: "JWT algorithm is not allowed." };
  }
  const key = header.alg === "HS256" ? secret : publicKey;
  if (!key) return { ok: false, code: "JWT_NOT_CONFIGURED", message: "JWT verification is not configured." };
  try {
    if (!verifySignature(header.alg, signingInput(parts[0], parts[1]), signature, key)) {
      return { ok: false, code: "INVALID_SIGNATURE", message: "JWT signature verification failed." };
    }
  } catch {
    return { ok: false, code: "INVALID_SIGNATURE", message: "JWT signature verification failed." };
  }
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) + clockSkewSeconds < nowSeconds) {
    return { ok: false, code: "TOKEN_EXPIRED", message: "JWT bearer token has expired or has no valid exp claim." };
  }
  if (payload.nbf !== undefined && Number(payload.nbf) - clockSkewSeconds > nowSeconds) {
    return { ok: false, code: "TOKEN_NOT_ACTIVE", message: "JWT bearer token is not active yet." };
  }
  if (issuer && payload.iss !== issuer) return { ok: false, code: "INVALID_ISSUER", message: "JWT issuer is not trusted." };
  if (audience) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return { ok: false, code: "INVALID_AUDIENCE", message: "JWT audience is not trusted." };
  }
  if (!isStellarPublicKey(payload.sub)) {
    return { ok: false, code: "INVALID_SUBJECT", message: "JWT subject must be a Stellar public key." };
  }
  return {
    ok: true,
    claims: payload,
    auth: {
      subject: payload.sub,
      issuer: payload.iss ?? null,
      scopes: parseScopes(payload.scope ?? payload.scopes),
      expiresAt: Number(payload.exp),
      tokenType: "jwt",
    },
  };
}

export function isJwtToken(token) {
  return typeof token === "string" && token.split(".").length === 3;
}
