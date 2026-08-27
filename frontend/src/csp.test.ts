import { describe, it, expect } from "vitest";
import {
  ALLOWED_RPC_ORIGINS,
  buildFrontendCsp,
  buildSecurityHeaders,
  emitSecurityHeaders,
  renderHeadersFile,
} from "../csp.config";

/** Parse a policy string into directive -> sources. */
function parsePolicy(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of policy.split("; ")) {
    const [name, ...sources] = part.split(" ");
    directives[name] = sources;
  }
  return directives;
}

describe("buildFrontendCsp", () => {
  it("keeps unsafe-inline and unsafe-eval out of the production script-src", () => {
    // Shipping the dev policy to production is the usual way a CSP ends up
    // providing no protection at all.
    const directives = parsePolicy(buildFrontendCsp({ mode: "production" }));

    expect(directives["script-src"]).toEqual(["'self'"]);
    expect(directives["script-src"]).not.toContain("'unsafe-inline'");
    expect(directives["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("relaxes script-src in development for Vite's dev server", () => {
    const directives = parsePolicy(buildFrontendCsp({ mode: "development" }));

    expect(directives["script-src"]).toContain("'unsafe-inline'");
    expect(directives["script-src"]).toContain("'unsafe-eval'");
  });

  it("locks down the dangerous directives in both modes", () => {
    for (const mode of ["development", "production"] as const) {
      const directives = parsePolicy(buildFrontendCsp({ mode }));

      expect(directives["default-src"]).toEqual(["'self'"]);
      expect(directives["object-src"]).toEqual(["'none'"]);
      expect(directives["base-uri"]).toEqual(["'self'"]);
      expect(directives["frame-ancestors"]).toEqual(["'none'"]);
      expect(directives["form-action"]).toEqual(["'self'"]);
    }
  });

  it("allows the Soroban RPC endpoints and the WalletConnect relay", () => {
    const directives = parsePolicy(buildFrontendCsp({ mode: "production" }));

    for (const origin of ALLOWED_RPC_ORIGINS) {
      expect(directives["connect-src"]).toContain(origin);
    }
    expect(directives["connect-src"]).toContain("wss://relay.walletconnect.com");
  });

  it("allows data: images for the inline SVG favicon", () => {
    const directives = parsePolicy(buildFrontendCsp({ mode: "production" }));
    expect(directives["img-src"]).toContain("data:");
  });

  it("merges deployment-specific origins into their directives", () => {
    const directives = parsePolicy(
      buildFrontendCsp({
        mode: "production",
        extraConnectSrc: ["https://api.example.org"],
        extraScriptSrc: ["https://cdn.example.org"],
        extraStyleSrc: ["https://fonts.googleapis.com"],
        extraFontSrc: ["https://fonts.gstatic.com"],
        extraImgSrc: ["https://images.example.org"],
      })
    );

    expect(directives["connect-src"]).toContain("https://api.example.org");
    expect(directives["script-src"]).toContain("https://cdn.example.org");
    expect(directives["style-src"]).toContain("https://fonts.googleapis.com");
    expect(directives["font-src"]).toContain("https://fonts.gstatic.com");
    expect(directives["img-src"]).toContain("https://images.example.org");
  });

  it("does not repeat a source supplied twice", () => {
    const directives = parsePolicy(
      buildFrontendCsp({
        mode: "production",
        extraConnectSrc: [ALLOWED_RPC_ORIGINS[0], "'self'"],
      })
    );

    const occurrences = directives["connect-src"].filter(
      (source) => source === ALLOWED_RPC_ORIGINS[0]
    );
    expect(occurrences).toHaveLength(1);
  });

  it("adds upgrade-insecure-requests in production only", () => {
    expect(buildFrontendCsp({ mode: "production" })).toContain("upgrade-insecure-requests");
    expect(buildFrontendCsp({ mode: "development" })).not.toContain("upgrade-insecure-requests");
  });

  it("includes report-uri only when one is configured", () => {
    expect(
      buildFrontendCsp({
        mode: "production",
        reportUri: "https://api.example.org/csp-report",
      })
    ).toContain("report-uri https://api.example.org/csp-report");

    expect(buildFrontendCsp({ mode: "production" })).not.toContain("report-uri");
  });
});

describe("buildSecurityHeaders", () => {
  it("uses the report-only header until enforcement is switched on", () => {
    const reportOnly = buildSecurityHeaders({
      mode: "production",
      reportOnly: true,
    });
    expect(reportOnly["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(reportOnly["Content-Security-Policy"]).toBeUndefined();

    const enforcing = buildSecurityHeaders({
      mode: "production",
      reportOnly: false,
    });
    expect(enforcing["Content-Security-Policy"]).toBeDefined();
    expect(enforcing["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("always sets the companion security headers", () => {
    const headers = buildSecurityHeaders({ mode: "production" });

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBeDefined();
  });

  it("sets HSTS in production only", () => {
    expect(buildSecurityHeaders({ mode: "production" })["Strict-Transport-Security"]).toBeDefined();
    expect(
      buildSecurityHeaders({ mode: "development" })["Strict-Transport-Security"]
    ).toBeUndefined();
  });
});

describe("renderHeadersFile", () => {
  it("emits every header under a catch-all route", () => {
    const file = renderHeadersFile({ mode: "production", reportOnly: false });
    const lines = file.split("\n");

    expect(lines[0]).toBe("/*");
    expect(file).toContain("  Content-Security-Policy: default-src 'self'");
    expect(file).toContain("  X-Content-Type-Options: nosniff");
    expect(file).toContain("/assets/*");
    expect(file).toContain("Cache-Control: public, max-age=31536000, immutable");
    expect(file).toContain("max-age=0, must-revalidate");
  });
});

describe("emitSecurityHeaders", () => {
  it("writes the production policy into the build output", () => {
    // Without this the production bundle ships with no policy at all, since a
    // static host applies none by default.
    const emitted: Array<{ fileName: string; source: string }> = [];
    const plugin = emitSecurityHeaders({
      reportUri: "https://api.example.org/csp-report",
      reportOnly: false,
    });

    plugin.generateBundle.call({
      emitFile: (file) => emitted.push(file),
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe("_headers");
    expect(emitted[0].source).toContain("Content-Security-Policy: default-src 'self'");
    expect(emitted[0].source).toContain("report-uri https://api.example.org/csp-report");
  });

  it("emits the production policy even when the dev server is relaxed", () => {
    const emitted: Array<{ fileName: string; source: string }> = [];

    emitSecurityHeaders({}).generateBundle.call({
      emitFile: (file) => emitted.push(file),
    });

    expect(emitted[0].source).not.toContain("'unsafe-eval'");
    expect(emitted[0].source).toContain("upgrade-insecure-requests");
  });

  it("only runs during a build", () => {
    expect(emitSecurityHeaders({}).apply).toBe("build");
  });
});
