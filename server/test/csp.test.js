import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';

import { createApp } from '../src/app.js';
import {
  DEFAULT_REPORT_URI,
  REPORT_TO_GROUP,
  buildCspPolicy,
  generateCspNonce,
  normalizeCspReports,
  setSecurityHeaders,
} from '../src/security-headers.js';

function makeConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    adminApiKey: 'test-admin-key',
    adminActor: 'admin',
    corsAllowedOrigins: ['*'],
    maxBodyBytes: 64 * 1024,
    credentialStorePath: ':memory:',
    auditLogPath: ':memory:',
    cspEnabled: true,
    cspReportOnly: true,
    cspReportUri: DEFAULT_REPORT_URI,
    cspScriptSrc: [],
    cspStyleSrc: [],
    cspConnectSrc: [],
    cspImgSrc: [],
    cspFontSrc: [],
    cspFormAction: [],
    cspFrameAncestors: [],
    ...overrides,
  };
}

/** Minimal response double that records the headers set on it. */
function makeRes() {
  const headers = {};
  return {
    headers,
    setHeader: (name, value) => { headers[name] = value; },
  };
}

/** Parse a policy string into directive -> sources. */
function parsePolicy(policy) {
  const directives = {};
  for (const part of policy.split('; ')) {
    const [name, ...sources] = part.split(' ');
    directives[name] = sources;
  }
  return directives;
}

// ── Policy construction ──────────────────────────────────────────────────────

test('the baseline policy locks down the dangerous directives', () => {
  const directives = parsePolicy(buildCspPolicy({ config: makeConfig(), nonce: 'abc' }));

  assert.deepEqual(directives['default-src'], ["'self'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives['form-action'], ["'self'"]);
});

test("script-src carries the nonce and never 'unsafe-inline'", () => {
  // 'unsafe-inline' in script-src would permit exactly the injection the
  // policy exists to stop, so its absence is the point of the whole feature.
  const policy = buildCspPolicy({ config: makeConfig(), nonce: 'r4nd0m' });
  const directives = parsePolicy(policy);

  assert.ok(directives['script-src'].includes("'nonce-r4nd0m'"));
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.ok(!directives['script-src'].includes("'unsafe-eval'"));
});

test('style-src carries the nonce', () => {
  const directives = parsePolicy(buildCspPolicy({ config: makeConfig(), nonce: 'r4nd0m' }));
  assert.ok(directives['style-src'].includes("'nonce-r4nd0m'"));
});

test('a policy built without a nonce omits the nonce source', () => {
  const policy = buildCspPolicy({ config: makeConfig() });
  assert.ok(!policy.includes('nonce-'));
});

test('configured trusted domains are merged into their directives', () => {
  const config = makeConfig({
    cspScriptSrc: ['https://cdn.example.org'],
    cspStyleSrc: ['https://fonts.googleapis.com'],
    cspConnectSrc: ['https://soroban-testnet.stellar.org', 'wss://relay.walletconnect.com'],
    cspImgSrc: ['https://images.example.org'],
    cspFontSrc: ['https://fonts.gstatic.com'],
  });
  const directives = parsePolicy(buildCspPolicy({ config, nonce: 'abc' }));

  assert.ok(directives['script-src'].includes('https://cdn.example.org'));
  assert.ok(directives['style-src'].includes('https://fonts.googleapis.com'));
  assert.ok(directives['connect-src'].includes('https://soroban-testnet.stellar.org'));
  assert.ok(directives['connect-src'].includes('wss://relay.walletconnect.com'));
  assert.ok(directives['img-src'].includes('https://images.example.org'));
  assert.ok(directives['font-src'].includes('https://fonts.gstatic.com'));
});

test('a source named in both the baseline and the config is not duplicated', () => {
  const config = makeConfig({ cspConnectSrc: ["'self'"] });
  const directives = parsePolicy(buildCspPolicy({ config, nonce: 'abc' }));

  assert.deepEqual(directives['connect-src'], ["'self'"]);
});

test('configured frame-ancestors replace the none default', () => {
  const config = makeConfig({ cspFrameAncestors: ['https://console.example.org'] });
  const directives = parsePolicy(buildCspPolicy({ config, nonce: 'abc' }));

  assert.deepEqual(directives['frame-ancestors'], ['https://console.example.org']);
  assert.ok(!directives['frame-ancestors'].includes("'none'"));
});

test('the policy points at the report endpoint through both mechanisms', () => {
  const policy = buildCspPolicy({ config: makeConfig(), nonce: 'abc' });

  assert.ok(policy.includes(`report-uri ${DEFAULT_REPORT_URI}`));
  assert.ok(policy.includes(`report-to ${REPORT_TO_GROUP}`));
});

test('upgrade-insecure-requests is production-only', () => {
  assert.ok(
    buildCspPolicy({ config: makeConfig({ nodeEnv: 'production' }) })
      .includes('upgrade-insecure-requests'),
  );
  assert.ok(
    !buildCspPolicy({ config: makeConfig({ nodeEnv: 'development' }) })
      .includes('upgrade-insecure-requests'),
  );
});

// ── Nonces ───────────────────────────────────────────────────────────────────

test('every nonce is unique and long enough to be unguessable', () => {
  const nonces = new Set(Array.from({ length: 500 }, () => generateCspNonce()));

  assert.equal(nonces.size, 500);
  for (const nonce of nonces) {
    // 16 random bytes, base64 encoded.
    assert.ok(Buffer.from(nonce, 'base64').length >= 16);
  }
});

// ── Header application ───────────────────────────────────────────────────────

test('report-only mode uses the report-only header and blocks nothing', () => {
  const res = makeRes();
  setSecurityHeaders({}, res, makeConfig({ cspReportOnly: true }));

  assert.ok(res.headers['Content-Security-Policy-Report-Only']);
  assert.equal(res.headers['Content-Security-Policy'], undefined);
});

test('enforcing mode uses the enforcing header', () => {
  const res = makeRes();
  setSecurityHeaders({}, res, makeConfig({ cspReportOnly: false }));

  assert.ok(res.headers['Content-Security-Policy']);
  assert.equal(res.headers['Content-Security-Policy-Report-Only'], undefined);
});

test('the companion security headers are always set', () => {
  const res = makeRes();
  setSecurityHeaders({}, res, makeConfig());

  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.ok(res.headers['Permissions-Policy']);
});

test('HSTS is set in production only', () => {
  const prod = makeRes();
  setSecurityHeaders({}, prod, makeConfig({ nodeEnv: 'production' }));
  assert.ok(prod.headers['Strict-Transport-Security']);

  const dev = makeRes();
  setSecurityHeaders({}, dev, makeConfig({ nodeEnv: 'development' }));
  assert.equal(dev.headers['Strict-Transport-Security'], undefined);
});

test('disabling CSP still leaves the companion headers in place', () => {
  const res = makeRes();
  const nonce = setSecurityHeaders({}, res, makeConfig({ cspEnabled: false }));

  assert.equal(nonce, null);
  assert.equal(res.headers['Content-Security-Policy'], undefined);
  assert.equal(res.headers['Content-Security-Policy-Report-Only'], undefined);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
});

test('the Report-To header names the endpoint the policy refers to', () => {
  const res = makeRes();
  setSecurityHeaders({}, res, makeConfig());

  const reportTo = JSON.parse(res.headers['Report-To']);
  assert.equal(reportTo.group, REPORT_TO_GROUP);
  assert.deepEqual(reportTo.endpoints, [{ url: DEFAULT_REPORT_URI }]);
});

// ── Report parsing ───────────────────────────────────────────────────────────

test('a legacy report-uri payload is normalized', () => {
  const [report] = normalizeCspReports({
    'csp-report': {
      'document-uri': 'https://app.example.org/',
      'violated-directive': 'script-src',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example.org/x.js',
      'source-file': 'https://app.example.org/',
      'line-number': 42,
    },
  });

  assert.equal(report.directive, 'script-src-elem');
  assert.equal(report.blockedUri, 'https://evil.example.org/x.js');
  assert.equal(report.documentUri, 'https://app.example.org/');
  assert.equal(report.lineNumber, 42);
});

test('a Reporting API payload is normalized', () => {
  // Different browsers post different envelopes; dropping one silently would
  // make violations invisible depending on the visitor's browser.
  const [report] = normalizeCspReports([
    {
      type: 'csp-violation',
      body: {
        documentURL: 'https://app.example.org/',
        effectiveDirective: 'img-src',
        blockedURL: 'https://tracker.example.org/pixel.gif',
      },
    },
  ]);

  assert.equal(report.directive, 'img-src');
  assert.equal(report.blockedUri, 'https://tracker.example.org/pixel.gif');
});

test('entries that are not CSP violations are ignored', () => {
  const reports = normalizeCspReports([
    { type: 'deprecation', body: { id: 'x' } },
    { type: 'csp-violation', body: { effectiveDirective: 'style-src' } },
  ]);

  assert.equal(reports.length, 1);
  assert.equal(reports[0].directive, 'style-src');
});

test('an unrecognised payload yields no reports rather than throwing', () => {
  assert.deepEqual(normalizeCspReports(null), []);
  assert.deepEqual(normalizeCspReports('nonsense'), []);
  assert.deepEqual(normalizeCspReports({}), []);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

const mockSoroban = {
  getIssuers: async () => [],
  pingAllContracts: async () => ({}),
};

async function withServer(config, run, { metrics = { renderPrometheus: () => '' } } = {}) {
  const app = createApp({ config, soroban: mockSoroban, metrics });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    return await run(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('responses carry the CSP header', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/info`);
    const policy = response.headers.get('content-security-policy-report-only');

    assert.ok(policy, 'expected a report-only policy header');
    assert.ok(policy.includes("default-src 'self'"));
  });
});

test('each response gets its own nonce', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const first = await fetch(`${baseUrl}/info`);
    const second = await fetch(`${baseUrl}/info`);

    const nonceOf = (response) =>
      response.headers.get('content-security-policy-report-only').match(/'nonce-([^']+)'/)[1];

    assert.notEqual(nonceOf(first), nonceOf(second));
  });
});

test('a violation report is accepted and counted', async () => {
  const observed = [];
  const metrics = {
    renderPrometheus: () => '',
    observeCspViolation: (directive) => observed.push(directive),
  };

  await withServer(makeConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'effective-directive': 'script-src',
          'blocked-uri': 'https://evil.example.org/x.js',
        },
      }),
    });

    assert.equal(response.status, 204);
    assert.deepEqual(observed, ['script-src']);
  }, { metrics });
});

test('a malformed violation report is discarded without a server error', async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: 'this is not json',
    });

    assert.equal(response.status, 204);
  });
});

test('the report endpoint needs no credentials', async () => {
  // The browser posts these on its own behalf; requiring auth would mean
  // never receiving a report at all.
  await withServer(makeConfig({ adminApiKey: 'secret' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src' } }),
    });

    assert.equal(response.status, 204);
  });
});

test('the report endpoint stays reachable when request signing is enabled', async () => {
  // A browser has no signing secret, so requiring a signature here would
  // silence the reports exactly when the policy is being rolled out.
  const config = makeConfig({
    requestSigningEnabled: true,
    requestSigningEnforce: 'all',
    requestSigningMaxAgeSeconds: 300,
  });

  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src' } }),
    });

    assert.equal(response.status, 204);
  });
});
