import { URL } from 'node:url';
import { readJson, sendJson } from './http-utils.js';

const PREFIX = '/mock/v1';
const MOCK_CREDENTIALS = [
  {
    id: 'mock-credential-001',
    subject: 'GMOCKSUBJECT000000000000000000000000000000000000000000000000000',
    issuer: 'GMOCKISSUER000000000000000000000000000000000000000000000000000',
    credentialType: 'Kyc',
    claims: { name: 'Ada Example', country: 'US' },
    issuedAt: 1_700_000_000,
    expiresAt: 1_893_456_000,
    revoked: false,
    mock: true,
  },
];

const SIMULATED_ERRORS = {
  400: { error: 'invalid_request', message: 'Simulated bad request.' },
  401: { error: 'unauthorized', message: 'Simulated missing or invalid credentials.' },
  403: { error: 'forbidden', message: 'Simulated insufficient permissions.' },
  404: { error: 'not_found', message: 'Simulated missing resource.' },
  409: { error: 'conflict', message: 'Simulated conflicting state.' },
  429: { error: 'rate_limit_exceeded', message: 'Simulated rate limit.' },
  500: { error: 'internal_server_error', message: 'Simulated server error.' },
  503: { error: 'service_unavailable', message: 'Simulated upstream outage.' },
};
const MAX_SIMULATED_DELAY_MS = 5_000;

function respond(res, status, body, headers = {}) {
  sendJson(res, status, body, { 'cache-control': 'no-store', ...headers });
  return true;
}

/**
 * Read the client's requested failure scenario from `?mockStatus=` /
 * `X-Mock-Status` and `?mockDelayMs=` / `X-Mock-Delay-Ms`. The query
 * parameter wins so a browser, which cannot easily set headers, can use it.
 *
 * @returns {{ status: number|null, delayMs: number, error: string|null }}
 */
function readScenario(req, url) {
  const rawStatus = url.searchParams.get('mockStatus') ?? req.headers?.['x-mock-status'];
  const rawDelay = url.searchParams.get('mockDelayMs') ?? req.headers?.['x-mock-delay-ms'];

  let status = null;
  if (rawStatus !== undefined && rawStatus !== null && rawStatus !== '') {
    status = Number(rawStatus);
    if (!Object.hasOwn(SIMULATED_ERRORS, status)) {
      return { status: null, delayMs: 0, error: `mockStatus must be one of ${Object.keys(SIMULATED_ERRORS).join(', ')}.` };
    }
  }

  let delayMs = 0;
  if (rawDelay !== undefined && rawDelay !== null && rawDelay !== '') {
    delayMs = Number(rawDelay);
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_SIMULATED_DELAY_MS) {
      return { status: null, delayMs: 0, error: `mockDelayMs must be an integer from 0 to ${MAX_SIMULATED_DELAY_MS}.` };
    }
  }

  return { status, delayMs, error: null };
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Serve deterministic fixtures for client development without contacting the
 * chain or writing credential data. Mock routes are opt-in and production is
 * always denied, even if the environment variable is accidentally set.
 *
 * @returns {Promise<boolean>} true when a /mock/v1 request was handled.
 */
export async function handleMockApiRequest(req, res, config = {}) {
  const url = new URL(req.url ?? '/', `http://${req.headers?.host ?? 'localhost'}`);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;

  if (!config.mockApiEnabled || config.nodeEnv === 'production') {
    return respond(res, 404, { error: 'not_found', message: 'Mock API is disabled.' });
  }

  if (req.method === 'GET' && url.pathname === `${PREFIX}/health`) {
    return respond(res, 200, { status: 'ok', mock: true });
  }

  // Health stays unconditional so a test harness can always tell the mock
  // server is up; every other route honours the requested scenario.
  const scenario = readScenario(req, url);
  if (scenario.error) {
    return respond(res, 400, { error: 'invalid_mock_scenario', message: scenario.error, mock: true });
  }
  if (scenario.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
  }
  if (scenario.status !== null) {
    const headers = scenario.status === 429 || scenario.status === 503 ? { 'retry-after': '1' } : {};
    return respond(res, scenario.status, { ...SIMULATED_ERRORS[scenario.status], simulated: true, mock: true }, headers);
  }
  if (req.method === 'GET' && url.pathname === `${PREFIX}/info`) {
    return respond(res, 200, {
      name: 'Soroban Identity Mock API',
      apiVersion: 'v1',
      mock: true,
      endpoints: [
        'GET /mock/v1/health',
        'GET /mock/v1/credentials',
        'GET /mock/v1/credentials/:id',
        'POST /mock/v1/credentials',
        'GET /mock/v1/dids/:address',
        'GET /mock/v1/reputation/:address',
      ],
      scenarios: {
        mockStatus: Object.keys(SIMULATED_ERRORS).map(Number),
        mockDelayMs: { min: 0, max: MAX_SIMULATED_DELAY_MS },
      },
    });
  }
  if (req.method === 'GET' && url.pathname === `${PREFIX}/credentials`) {
    return respond(res, 200, { items: MOCK_CREDENTIALS, count: MOCK_CREDENTIALS.length, mock: true });
  }
  if (req.method === 'POST' && url.pathname === `${PREFIX}/credentials`) {
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return respond(res, 415, { error: 'unsupported_media_type', message: 'Content-Type must be application/json.' });
    }
    let body;
    try {
      body = await readJson(req, { maxBodyBytes: config.maxBodyBytes ?? 64 * 1024 });
    } catch {
      return respond(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON.' });
    }
    if (body.__payloadTooLarge) {
      return respond(res, 413, { error: 'payload_too_large', message: 'Request body exceeds the configured size limit.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respond(res, 400, { error: 'invalid_request', message: 'Request body must be a JSON object.' });
    }
    return respond(res, 201, {
      credential: {
        ...body,
        id: typeof body.id === 'string' && body.id ? body.id : 'mock-created-credential',
        issuedAt: 1_700_000_000,
        mock: true,
      },
      mock: true,
    });
  }

  const credentialMatch = url.pathname.match(/^\/mock\/v1\/credentials\/([^/]+)$/);
  if (req.method === 'GET' && credentialMatch) {
    const id = decodePathSegment(credentialMatch[1]);
    if (id === null) return respond(res, 400, { error: 'invalid_path', message: 'Credential ID is malformed.' });
    const credential = MOCK_CREDENTIALS.find((item) => item.id === id);
    return credential
      ? respond(res, 200, { credential, mock: true })
      : respond(res, 404, { error: 'credential_not_found', id, mock: true });
  }

  const didMatch = url.pathname.match(/^\/mock\/v1\/dids\/([^/]+)$/);
  if (req.method === 'GET' && didMatch) {
    const address = decodePathSegment(didMatch[1]);
    if (address === null) return respond(res, 400, { error: 'invalid_path', message: 'DID is malformed.' });
    return respond(res, 200, {
      did: `did:stellar:${address}`,
      controller: address,
      document: { id: `did:stellar:${address}`, controller: address },
      mock: true,
    });
  }

  const reputationMatch = url.pathname.match(/^\/mock\/v1\/reputation\/([^/]+)$/);
  if (req.method === 'GET' && reputationMatch) {
    const address = decodePathSegment(reputationMatch[1]);
    if (address === null) return respond(res, 400, { error: 'invalid_path', message: 'Address is malformed.' });
    return respond(res, 200, {
      subject: address,
      score: 72,
      tier: 'trusted',
      reporters: 4,
      mock: true,
    });
  }

  return respond(res, 404, { error: 'mock_endpoint_not_found', path: url.pathname, mock: true });
}
