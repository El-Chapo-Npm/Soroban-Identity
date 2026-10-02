/**
 * Security Middleware - Content Security Policy (CSP) for XSS Protection
 * 
 * This middleware implements Content Security Policy headers to prevent XSS attacks
 * by controlling which resources can be loaded and executed in the browser.
 * 
 * Issue: #855
 * 
 * ## Overview
 * 
 * Content Security Policy (CSP) is a security standard that helps prevent Cross-Site
 * Scripting (XSS), clickjacking, and other code injection attacks by specifying which
 * dynamic resources are allowed to load. The browser refuses to execute or render
 * resources that violate the policy.
 * 
 * ## Key Security Features
 * 
 * 1. **Nonce-Based Inline Script Allowlist**
 *    - Uses cryptographically random nonces instead of 'unsafe-inline'
 *    - Each response gets a fresh nonce that cannot be guessed by attackers
 *    - Only scripts/styles with the correct nonce attribute will execute
 * 
 * 2. **Strict Directive Configuration**
 *    - default-src: 'self' - Everything defaults to same-origin only
 *    - script-src: 'self' + nonce - No unsafe-inline, prevents injected scripts
 *    - style-src: 'self' + nonce - Controlled style execution
 *    - object-src: 'none' - Blocks legacy plugins (Flash, Java, etc.)
 *    - base-uri: 'self' - Prevents <base> tag hijacking
 *    - form-action: 'self' - Prevents form submission to malicious origins
 * 
 * 3. **Violation Reporting**
 *    - Monitors CSP violations in real-time
 *    - Supports both legacy report-uri and modern Reporting API
 *    - Helps identify legitimate resources that need to be whitelisted
 * 
 * 4. **Report-Only Mode**
 *    - Default mode: reports violations without blocking
 *    - Allows safe deployment and policy tuning before enforcement
 *    - Switch to enforcement mode after validating reports
 * 
 * ## Configuration
 * 
 * Environment variables (see config.js):
 * - CSP_ENABLED: Enable/disable CSP headers (default: true)
 * - CSP_REPORT_ONLY: Report violations without blocking (default: true)
 * - CSP_REPORT_URI: Endpoint for violation reports (default: /csp-report)
 * - CSP_SCRIPT_SRC: Additional trusted script sources (comma-separated)
 * - CSP_STYLE_SRC: Additional trusted style sources
 * - CSP_CONNECT_SRC: Additional trusted connection sources
 * - CSP_IMG_SRC: Additional trusted image sources
 * - CSP_FONT_SRC: Additional trusted font sources
 * - CSP_FORM_ACTION: Additional trusted form submission targets
 * - CSP_FRAME_ANCESTORS: Origins allowed to embed this site
 * 
 * ## Usage
 * 
 * ```typescript
 * import { securityMiddleware } from './middleware/security';
 * 
 * // Apply to all routes
 * app.use(securityMiddleware(config));
 * 
 * // Access the nonce in response rendering
 * res.render('template', { cspNonce: req.cspNonce });
 * 
 * // In HTML templates
 * <script nonce="${cspNonce}">
 *   // Inline script code
 * </script>
 * ```
 * 
 * ## Testing
 * 
 * 1. **Browser Console**: Check for CSP violation warnings
 * 2. **Report Endpoint**: Monitor POST requests to CSP_REPORT_URI
 * 3. **Network Tab**: Verify CSP header is present in responses
 * 4. **Injection Test**: Try injecting <script>alert('XSS')</script>
 * 
 * ## Deployment Checklist
 * 
 * 1. Deploy with CSP_REPORT_ONLY=true
 * 2. Monitor violation reports for 1-2 weeks
 * 3. Add legitimate sources to CSP_*_SRC environment variables
 * 4. Verify no false positives remain
 * 5. Switch to enforcement: CSP_REPORT_ONLY=false
 * 6. Continue monitoring for any breaking changes
 * 
 * ## References
 * 
 * - [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
 * - [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
 * - [W3C CSP Level 3](https://www.w3.org/TR/CSP3/)
 */

import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Configuration interface for CSP middleware
 */
export interface SecurityConfig {
  nodeEnv: string;
  cspEnabled: boolean;
  cspReportOnly: boolean;
  cspReportUri?: string;
  cspScriptSrc?: string[];
  cspStyleSrc?: string[];
  cspConnectSrc?: string[];
  cspImgSrc?: string[];
  cspFontSrc?: string[];
  cspFormAction?: string[];
  cspFrameAncestors?: string[];
}

/**
 * Extend Express Request to include CSP nonce
 */
declare global {
  namespace Express {
    interface Request {
      cspNonce?: string;
    }
  }
}

/** Default violation report endpoint */
export const DEFAULT_REPORT_URI = '/csp-report';

/** Reporting API endpoint group name */
export const REPORT_TO_GROUP = 'csp-endpoint';

/**
 * Generate a cryptographically secure random nonce for CSP
 * 
 * A nonce must be:
 * - Unguessable (cryptographically random)
 * - Unique per response (never reused)
 * - Sufficient entropy (128 bits minimum)
 * 
 * The nonce is what makes inline scripts safe: an attacker cannot inject
 * a script with the correct nonce because it's generated server-side and
 * never exposed until the response is rendered.
 * 
 * @returns {string} Base64-encoded random nonce (128 bits)
 */
export function generateCspNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Merge additional sources into a directive's baseline
 * 
 * Removes duplicates so a source listed in both baseline and config
 * appears only once in the final policy.
 * 
 * @param {string[]} baseline - Default sources for the directive
 * @param {string[]} extra - Additional sources from configuration
 * @returns {string[]} Merged and deduplicated sources
 */
function mergeDirectiveSources(baseline: string[], extra: string[] = []): string[] {
  return [...new Set([...baseline, ...extra])];
}

/**
 * Build the Content Security Policy string
 * 
 * Constructs a strict CSP that:
 * - Defaults to same-origin for all resource types
 * - Uses nonces instead of 'unsafe-inline' for scripts and styles
 * - Blocks plugins, base-uri hijacking, and cross-origin forms
 * - Protects against clickjacking via frame-ancestors
 * - Upgrades insecure requests in production
 * 
 * @param {SecurityConfig} config - Application configuration
 * @param {string} [nonce] - Optional nonce for inline content
 * @returns {string} Complete CSP policy string
 */
export function buildCspPolicy(config: SecurityConfig, nonce?: string): string {
  const nonceSource = nonce ? [`'nonce-${nonce}'`] : [];

  // CSP Directives with security rationale:
  const directives: Record<string, string[]> = {
    // Fallback for any resource type not explicitly specified
    'default-src': ["'self'"],
    
    // Scripts: Same-origin + nonce only. NO 'unsafe-inline' or 'unsafe-eval'
    // This is the primary XSS defense - injected scripts cannot execute
    'script-src': mergeDirectiveSources(
      ["'self'", ...nonceSource],
      config.cspScriptSrc
    ),
    
    // Styles: Same-origin + nonce only. Prevents CSS-based data exfiltration
    'style-src': mergeDirectiveSources(
      ["'self'", ...nonceSource],
      config.cspStyleSrc
    ),
    
    // AJAX, WebSocket, EventSource connections
    'connect-src': mergeDirectiveSources(
      ["'self'"],
      config.cspConnectSrc
    ),
    
    // Images: Same-origin + data URIs (common for inline images)
    'img-src': mergeDirectiveSources(
      ["'self'", 'data:'],
      config.cspImgSrc
    ),
    
    // Web fonts from same-origin or CDNs
    'font-src': mergeDirectiveSources(
      ["'self'"],
      config.cspFontSrc
    ),
    
    // Block ALL plugins (Flash, Java, Silverlight) - legacy XSS vectors
    'object-src': ["'none'"],
    
    // Prevents <base> tag injection from repointing all relative URLs
    'base-uri': ["'self'"],
    
    // Prevents forms from posting credentials to attacker-controlled origins
    'form-action': mergeDirectiveSources(
      ["'self'"],
      config.cspFormAction
    ),
    
    // Clickjacking protection (modern replacement for X-Frame-Options)
    // Default 'none' unless explicitly configured otherwise
    'frame-ancestors': mergeDirectiveSources(
      config.cspFrameAncestors?.length ? [] : ["'none'"],
      config.cspFrameAncestors
    ),
  };

  // Convert directives to policy string
  const policyParts = Object.entries(directives).map(
    ([name, sources]) => `${name} ${sources.join(' ')}`
  );

  // Upgrade HTTP to HTTPS in production (requires HTTPS deployment)
  if (config.nodeEnv === 'production') {
    policyParts.push('upgrade-insecure-requests');
  }

  // Add violation reporting endpoints
  const reportUri = config.cspReportUri || DEFAULT_REPORT_URI;
  if (reportUri) {
    // Legacy report-uri (deprecated but widely supported)
    policyParts.push(`report-uri ${reportUri}`);
    // Modern Reporting API (requires Report-To header)
    policyParts.push(`report-to ${REPORT_TO_GROUP}`);
  }

  return policyParts.join('; ');
}

/**
 * Apply CSP and companion security headers to the response
 * 
 * Sets multiple security headers:
 * - Content-Security-Policy (or -Report-Only)
 * - X-Content-Type-Options: Prevents MIME-sniffing attacks
 * - Referrer-Policy: Controls referrer information leakage
 * - Permissions-Policy: Disables dangerous browser features
 * - X-Frame-Options: Clickjacking protection for old browsers
 * - Strict-Transport-Security: Enforces HTTPS (production only)
 * - Report-To: Configures Reporting API endpoint
 * 
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {SecurityConfig} config - Security configuration
 * @returns {string | null} The generated nonce, or null if CSP is disabled
 */
export function setSecurityHeaders(
  req: Request,
  res: Response,
  config: SecurityConfig
): string | null {
  // Companion security headers (independent of CSP)
  
  // Prevents browsers from MIME-sniffing a response away from declared content-type
  // Blocks attacks where attacker uploads "image" that's actually executable script
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Only send full URL as referrer to same-origin, origin only to cross-origin HTTPS
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Disable dangerous browser features that could be exploited
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Legacy clickjacking protection for browsers that don't support frame-ancestors
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Force HTTPS for one year, including subdomains (production only)
  if (config.nodeEnv === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  // Skip CSP if disabled in configuration
  if (!config.cspEnabled) {
    return null;
  }

  // Generate fresh nonce for this response
  const nonce = generateCspNonce();
  const policy = buildCspPolicy(config, nonce);

  // Choose header based on report-only mode
  // Report-only: logs violations without blocking (safe for testing)
  // Enforcing: actually blocks policy violations
  const headerName = config.cspReportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  res.setHeader(headerName, policy);

  // Configure Reporting API endpoint for violation reports
  const reportUri = config.cspReportUri || DEFAULT_REPORT_URI;
  if (reportUri) {
    res.setHeader(
      'Report-To',
      JSON.stringify({
        group: REPORT_TO_GROUP,
        max_age: 10886400, // 126 days
        endpoints: [{ url: reportUri }],
      })
    );
  }

  return nonce;
}

/**
 * Normalize CSP violation reports from different formats
 * 
 * Browsers send violation reports in two different formats:
 * 1. Legacy report-uri: {"csp-report": {...}} with hyphenated keys
 * 2. Reporting API: [{type: "csp-violation", body: {...}}] with camelCase keys
 * 
 * This normalizer accepts both and returns a consistent format for logging.
 * 
 * @param {unknown} payload - Raw JSON body from violation report
 * @returns {Array} Normalized violation reports
 */
export function normalizeCspReports(payload: unknown): Array<{
  directive: string;
  blockedUri: string;
  documentUri: string;
  sourceFile: string | null;
  lineNumber: number | null;
}> {
  const rawReports: any[] = [];

  // Handle Reporting API format (array of reports)
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry?.type === 'csp-violation' && entry.body) {
        rawReports.push(entry.body);
      }
    }
  }
  // Handle legacy report-uri format (single report)
  else if (payload && typeof payload === 'object') {
    const payloadObj = payload as Record<string, any>;
    if (payloadObj['csp-report']) {
      rawReports.push(payloadObj['csp-report']);
    } else if (payloadObj.body) {
      rawReports.push(payloadObj.body);
    }
  }

  // Normalize each report to consistent format
  return rawReports.map((report) => ({
    directive:
      report['effective-directive'] ??
      report.effectiveDirective ??
      report['violated-directive'] ??
      report.violatedDirective ??
      'unknown',
    blockedUri: 
      report['blocked-uri'] ?? 
      report.blockedURL ?? 
      'unknown',
    documentUri: 
      report['document-uri'] ?? 
      report.documentURL ?? 
      'unknown',
    sourceFile: 
      report['source-file'] ?? 
      report.sourceFile ?? 
      null,
    lineNumber: 
      report['line-number'] ?? 
      report.lineNumber ?? 
      null,
  }));
}

/**
 * Express middleware for security headers
 * 
 * Applies CSP and companion security headers to all responses.
 * Attaches the nonce to req.cspNonce for use in template rendering.
 * 
 * @param {SecurityConfig} config - Security configuration
 * @returns {Function} Express middleware function
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { securityMiddleware } from './middleware/security';
 * 
 * const app = express();
 * const config = loadConfig();
 * 
 * // Apply to all routes
 * app.use(securityMiddleware(config));
 * 
 * // In route handlers, use req.cspNonce
 * app.get('/page', (req, res) => {
 *   res.render('template', { nonce: req.cspNonce });
 * });
 * ```
 */
export function securityMiddleware(config: SecurityConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Set all security headers and attach nonce to request
    req.cspNonce = setSecurityHeaders(req, res, config);
    next();
  };
}

/**
 * Express middleware for CSP violation reporting
 * 
 * Handles POST requests to the CSP report endpoint.
 * Parses and logs violation reports for monitoring and policy tuning.
 * 
 * @param {Function} logger - Logger function (e.g., winston, pino)
 * @returns {Function} Express middleware function
 * 
 * @example
 * ```typescript
 * import { cspReportHandler } from './middleware/security';
 * import { logger } from './logger';
 * 
 * app.post('/csp-report', 
 *   express.json({ type: 'application/csp-report' }),
 *   cspReportHandler(logger)
 * );
 * ```
 */
export function cspReportHandler(logger: any) {
  return (req: Request, res: Response): void => {
    const reports = normalizeCspReports(req.body);
    
    for (const report of reports) {
      logger.warn({
        type: 'csp-violation',
        directive: report.directive,
        blockedUri: report.blockedUri,
        documentUri: report.documentUri,
        sourceFile: report.sourceFile,
        lineNumber: report.lineNumber,
      }, 'Content Security Policy violation detected');
    }
    
    // Always respond with 204 No Content (standard for reporting endpoints)
    res.status(204).end();
  };
}

/**
 * CSP Policy Testing Utilities
 */

/**
 * Validate that a CSP policy string is well-formed
 * 
 * Checks for common policy mistakes:
 * - 'unsafe-inline' in script-src (defeats XSS protection)
 * - 'unsafe-eval' without good reason
 * - Missing critical directives
 * - Wildcard (*) in sensitive directives
 * 
 * @param {string} policy - CSP policy string to validate
 * @returns {object} Validation result with warnings
 */
export function validateCspPolicy(policy: string): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const lowerPolicy = policy.toLowerCase();

  // Check for unsafe-inline in script-src (major XSS risk)
  if (lowerPolicy.includes("script-src") && lowerPolicy.includes("'unsafe-inline'")) {
    warnings.push(
      "script-src contains 'unsafe-inline' - this allows XSS attacks. Use nonces instead."
    );
  }

  // Check for unsafe-eval in script-src (allows eval(), setTimeout with strings)
  if (lowerPolicy.includes("script-src") && lowerPolicy.includes("'unsafe-eval'")) {
    warnings.push(
      "script-src contains 'unsafe-eval' - avoid if possible or document why it's needed."
    );
  }

  // Check for wildcards in sensitive directives
  if (lowerPolicy.includes("script-src *") || lowerPolicy.includes("script-src  *")) {
    warnings.push(
      "script-src contains wildcard (*) - this allows scripts from any origin."
    );
  }

  // Check for object-src not set to 'none'
  if (!lowerPolicy.includes("object-src 'none'")) {
    warnings.push(
      "object-src should be 'none' to block plugins (Flash, Java, etc.)."
    );
  }

  // Check for base-uri (prevents base tag hijacking)
  if (!lowerPolicy.includes("base-uri")) {
    warnings.push(
      "base-uri directive missing - add base-uri 'self' to prevent base tag attacks."
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
