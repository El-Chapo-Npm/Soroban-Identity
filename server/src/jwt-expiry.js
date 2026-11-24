/** Validate the exp claim on an already signature-verified JWT bearer token. */
export function checkJwtExpiry(token, { clockSkewSeconds = 30, now = Date.now() } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, code: 'INVALID_TOKEN', message: 'Malformed JWT bearer token.' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, code: 'INVALID_TOKEN', message: 'JWT payload could not be decoded.' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_TOKEN', message: 'JWT payload could not be decoded.' };
  }
  if (payload.exp === undefined || payload.exp === null) {
    return { ok: false, code: 'TOKEN_EXPIRY_MISSING', message: 'JWT bearer token is missing the required exp claim.' };
  }
  const expSeconds = Number(payload.exp);
  if (!Number.isFinite(expSeconds)) {
    return { ok: false, code: 'TOKEN_EXPIRY_INVALID', message: 'JWT bearer token has an invalid exp claim.' };
  }
  if (expSeconds + clockSkewSeconds < Math.floor(now / 1000)) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: 'JWT bearer token has expired.' };
  }
  return { ok: true, expiresAt: expSeconds };
}
