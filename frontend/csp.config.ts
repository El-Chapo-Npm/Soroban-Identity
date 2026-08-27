/**
 * Content Security Policy for the frontend (#754).
 *
 * Kept in one module because the policy has to be applied in three different
 * places — the Vite dev server, `vite preview`, and whatever static host
 * serves `dist/` in production — and three hand-maintained copies drift.
 *
 * ## Why development and production differ
 *
 * Vite's dev server rewrites modules on the fly and injects an inline
 * bootstrap script, so development genuinely requires `'unsafe-inline'` and
 * `'unsafe-eval'`. Production does not: the build emits external bundles, so
 * `script-src 'self'` is enough. Shipping the dev policy to production is the
 * usual way a CSP ends up providing no protection at all, so the two are
 * derived separately here rather than sharing one permissive baseline.
 *
 * ## Nonces
 *
 * A static SPA has no server to mint a per-response nonce, which is why the
 * production policy relies on `'self'` and external bundles instead. The API
 * server issues real nonces for the one page it renders itself — see
 * `server/src/security-headers.js`.
 */

/** Soroban RPC endpoints the app is allowed to talk to. */
export const ALLOWED_RPC_ORIGINS = [
  "https://soroban-testnet.stellar.org",
  "https://soroban-mainnet.stellar.org",
  "https://soroban-testnet-backup.stellar.org",
  "https://soroban-mainnet-backup.stellar.org",
];

/** WalletConnect's relay, required for wallet pairing. */
export const WALLET_CONNECT_ORIGINS = ["wss://relay.walletconnect.com"];

export interface CspOptions {
  /** `development` relaxes script-src for Vite's dev server. */
  mode: "development" | "production";
  /** Where violations are posted, e.g. `https://api.example.org/csp-report`. */
  reportUri?: string;
  /** Extra origins the deployment needs, beyond the defaults above. */
  extraConnectSrc?: string[];
  extraScriptSrc?: string[];
  extraStyleSrc?: string[];
  extraImgSrc?: string[];
  extraFontSrc?: string[];
}

function unique(sources: string[]): string[] {
  return [...new Set(sources)];
}

/**
 * Build the policy string.
 *
 * @example
 * buildFrontendCsp({ mode: "production", reportUri: "https://api.example.org/csp-report" })
 */
export function buildFrontendCsp(options: CspOptions): string {
  const isDev = options.mode === "development";

  const scriptSrc = unique([
    "'self'",
    // Required by Vite's dev server only — never emitted for production.
    ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
    ...(options.extraScriptSrc ?? []),
  ]);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Styled-component and CSS-in-JS libraries inject <style> at runtime, so
    // style-src keeps 'unsafe-inline'. It is far less dangerous than the
    // script-src equivalent: injected CSS cannot execute.
    "style-src": unique(["'self'", "'unsafe-inline'", ...(options.extraStyleSrc ?? [])]),
    "connect-src": unique([
      "'self'",
      ...ALLOWED_RPC_ORIGINS,
      ...WALLET_CONNECT_ORIGINS,
      ...(options.extraConnectSrc ?? []),
    ]),
    // data: is needed for the inline SVG favicon.
    "img-src": unique(["'self'", "data:", ...(options.extraImgSrc ?? [])]),
    "font-src": unique(["'self'", ...(options.extraFontSrc ?? [])]),
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([name, sources]) => `${name} ${sources.join(" ")}`
  );

  if (!isDev) {
    parts.push("upgrade-insecure-requests");
  }

  if (options.reportUri) {
    parts.push(`report-uri ${options.reportUri}`);
  }

  return parts.join("; ");
}

/**
 * The full header set, keyed by header name.
 *
 * @param options.reportOnly - Report violations without blocking them. Use
 *   this until the reports come back clean; an enforced policy that is even
 *   slightly too tight breaks the app for every visitor at once.
 */
export function buildSecurityHeaders(
  options: CspOptions & { reportOnly?: boolean }
): Record<string, string> {
  const policy = buildFrontendCsp(options);

  const cspHeader = options.reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  const headers: Record<string, string> = {
    [cspHeader]: policy,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };

  if (options.mode === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

/**
 * Render the header set in the `_headers` format understood by Netlify and
 * Cloudflare Pages.
 *
 * A static host applies nothing by default, so a production CSP only exists
 * if the build emits it. Writing this file during the build means the policy
 * ships with the bundle instead of living in a dashboard someone has to
 * remember to update.
 */
export function renderHeadersFile(
  options: CspOptions & { reportOnly?: boolean }
): string {
  const headers = buildSecurityHeaders(options);
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);

  return `/*\n${lines.join("\n")}\n`;
}

/** Minimal shape of the Rollup plugin context this plugin relies on. */
interface EmitFileContext {
  emitFile(file: { type: "asset"; fileName: string; source: string }): void;
}

/**
 * Vite plugin that writes the production `_headers` file into the build
 * output.
 *
 * A static host applies no headers of its own, so the production CSP only
 * exists if the build emits it. Keeping it here rather than in a hosting
 * dashboard means the policy is versioned with the code that depends on it.
 */
export function emitSecurityHeaders(options: {
  reportUri?: string;
  reportOnly?: boolean;
}) {
  return {
    name: "emit-security-headers",
    apply: "build" as const,
    generateBundle(this: EmitFileContext) {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: renderHeadersFile({
          mode: "production",
          reportUri: options.reportUri,
          reportOnly: options.reportOnly,
        }),
      });
    },
  };
}
