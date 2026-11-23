/**
 * Content Security Policy and companion security headers (#754)
 *
 * CSP is the browser's last line of defence against injected markup: even if
 * an attacker gets a `<script>` into a response, the browser refuses to run it
 * unless the policy allows it. That only holds if the policy is strict enough
 * to be worth enforcing — a policy containing `'unsafe-inline'` in
 * `script-src` permits exactly the injection it is meant to stop.
 *
 * ## Nonces rather than 'unsafe-inline'
 *
 * The server renders one HTML page (the GraphQL playground) with an inline
 * `<style>` and an inline `<script>`. Rather than open the policy to all
 * inline code, each response gets a fresh random nonce, and only the tags
 * carrying that nonce may run. An injected script cannot guess it, because it
 * is generated per response and never reused.
 *
 * ## Report-only first
 *
 * Enforcing a policy that is even slightly too tight breaks the page. The
 * default is therefore `Content-Security-Policy-Report-Only`, which reports
 * violations without blocking anything. Watch the reports, widen the policy
 * where they are legitimate, and only then set `CSP_REPORT_ONLY=false`.
 */

import crypto from 'node:crypto';

/** Where violation reports are posted unless configured otherwise. */
export const DEFAULT_REPORT_URI = '/csp-report';

/** Name used for the Reporting API endpoint group. */
export const REPORT_TO_GROUP = 'csp-endpoint';

/**
 * A CSP nonce must be unguessable and must not repeat across responses.
 * 128 bits of base64 is the value the spec recommends.
 *
 * @returns {string}
 */
export function generateCspNonce() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Merge configured extra sources into a directive's baseline.
 *
 * Duplicates are dropped so a source named in both the baseline and the
 * configuration does not appear twice in the header.
 *
 * @param {string[]} baseline
 * @param {string[]} [extra]
 * @returns {string[]}
 */
function withExtras(baseline, extra = []) {
  return [...new Set([...baseline, ...extra])];
}

/**
 * Build the policy string.
 *
 * @param {object} params
 * @param {object} params.config
 * @param {string} [params.nonce] - Omitted for responses with no inline content
 * @returns {string}
 */
export function buildCspPolicy({ config, nonce }) {
  const nonceSource = nonce ? [`'nonce-${nonce}'`] : [];

  const directives = {
    // Everything not named below falls back to same-origin only.
    'default-src': ["'self'"],
    // No 'unsafe-inline': the nonce is what permits our own inline script,
    // and an injected one has no way to carry it.
    'script-src': withExtras(["'self'", ...nonceSource], config.cspScriptSrc),
    'style-src': withExtras(["'self'", ...nonceSource], config.cspStyleSrc),
    'connect-src': withExtras(["'self'"], config.cspConnectSrc),
    'img-src': withExtras(["'self'", 'data:'], config.cspImgSrc),
    'font-src': withExtras(["'self'"], config.cspFontSrc),
    // No plugins, ever — these are a legacy XSS vector with no modern use.
    'object-src': ["'none'"],
    // Stops an injected <base> from silently repointing every relative URL.
    'base-uri': ["'self'"],
    // Stops an injected <form> from posting credentials to another origin.
    'form-action': withExtras(["'self'"], config.cspFormAction),
    // Clickjacking defence; the modern equivalent of X-Frame-Options.
    'frame-ancestors': withExtras(
      config.cspFrameAncestors?.length ? [] : ["'none'"],
      config.cspFrameAncestors,
    ),
  };

  const parts = Object.entries(directives).map(
    ([name, sources]) => `${name} ${sources.join(' ')}`,
  );

  // Only meaningful over HTTPS, and actively unhelpful in local development
  // where the dev server is plain HTTP.
  if (config.nodeEnv === 'production') {
    parts.push('upgrade-insecure-requests');
  }

  const reportUri = config.cspReportUri || DEFAULT_REPORT_URI;
  if (reportUri) {
    // report-uri is deprecated but is still the only mechanism some browsers
    // implement; report-to is its replacement. Sending both is the standard
    // transition strategy and costs one header.
    parts.push(`report-uri ${reportUri}`);
    parts.push(`report-to ${REPORT_TO_GROUP}`);
  }

  return parts.join('; ');
}

/**
 * Apply CSP and the companion security headers to a response.
 *
 * Returns the nonce so the caller can thread it into any inline markup it is
 * about to render.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} config
 * @returns {string|null} The nonce, or null when CSP is disabled
 */
export function setSecurityHeaders(req, res, config) {
  // These are cheap, unconditional, and independent of CSP.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Retained for browsers predating frame-ancestors.
  res.setHeader('X-Frame-Options', 'DENY');

  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (!config.cspEnabled) return null;

  const nonce = generateCspNonce();
  const policy = buildCspPolicy({ config, nonce });

  // Report-only reports violations without blocking them, so a policy can be
  // validated against real traffic before it can break anything.
  const headerName = config.cspReportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  res.setHeader(headerName, policy);

  const reportUri = config.cspReportUri || DEFAULT_REPORT_URI;
  if (reportUri) {
    res.setHeader(
      'Report-To',
      JSON.stringify({
        group: REPORT_TO_GROUP,
        max_age: 10886400,
        endpoints: [{ url: reportUri }],
      }),
    );
  }

  return nonce;
}

/**
 * Normalize a violation report into flat fields worth alerting on.
 *
 * Browsers disagree about the envelope: the legacy `report-uri` mechanism
 * posts `{"csp-report": {...}}` with hyphenated keys, while the Reporting API
 * posts an array of `{type, body}` with camelCase keys. Both are accepted so a
 * report is not silently dropped depending on which browser sent it.
 *
 * @param {unknown} payload - Parsed JSON body
 * @returns {Array<{directive: string, blockedUri: string, documentUri: string, sourceFile: string|null, lineNumber: number|null}>}
 */
export function normalizeCspReports(payload) {
  const rawReports = [];

  if (Array.isArray(payload)) {
    // Reporting API: [{ type: 'csp-violation', body: {...} }]
    for (const entry of payload) {
      if (entry?.type === 'csp-violation' && entry.body) rawReports.push(entry.body);
    }
  } else if (payload && typeof payload === 'object') {
    if (payload['csp-report']) rawReports.push(payload['csp-report']);
    else if (payload.body) rawReports.push(payload.body);
  }

  return rawReports.map((report) => ({
    directive:
      report['effective-directive'] ??
      report.effectiveDirective ??
      report['violated-directive'] ??
      report.violatedDirective ??
      'unknown',
    blockedUri: report['blocked-uri'] ?? report.blockedURL ?? 'unknown',
    documentUri: report['document-uri'] ?? report.documentURL ?? 'unknown',
    sourceFile: report['source-file'] ?? report.sourceFile ?? null,
    lineNumber: report['line-number'] ?? report.lineNumber ?? null,
  }));
}
