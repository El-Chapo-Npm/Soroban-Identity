/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildSecurityHeaders, emitSecurityHeaders } from "./csp.config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// The production policy ships with the bundle as a `_headers` file (Netlify /
// Cloudflare Pages format) — see `emitSecurityHeaders`. Hosts using a
// different mechanism (Vercel's `vercel.json`, an nginx `add_header` block)
// should carry the same policy; see `docs/content-security-policy.md`.

export default defineConfig(({ mode }) => {
  const isDev = mode !== "production";

  // Point violation reports at the API server's collector. Left unset, the
  // policy simply carries no report-uri.
  const reportUri = process.env.VITE_CSP_REPORT_URI;

  // Report-only unless explicitly switched to enforcing, so a policy is
  // validated against real traffic before it can break the app.
  const reportOnly = process.env.VITE_CSP_REPORT_ONLY !== "false";

  const devHeaders = buildSecurityHeaders({
    mode: "development",
    reportUri,
    reportOnly,
  });

  return {
    // Serve built assets from the CDN when CDN_BASE_URL is set (see infrastructure/cdn)
    base: process.env.CDN_BASE_URL || "/",
    resolve: {
      alias: {
        "node:crypto": path.resolve(rootDir, "src/shims/node-crypto.ts"),
        "node:fs/promises": path.resolve(rootDir, "src/shims/node-fs.ts"),
      },
    },
    plugins: [react(), emitSecurityHeaders({ reportUri, reportOnly })],
    define: {
      global: "globalThis",
    },
    build: {
      manifest: true,
      sourcemap: isDev,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            i18n: ["i18next", "react-i18next"],
            stellar: ["@stellar/stellar-sdk"],
            wallet: ["@creit.tech/stellar-wallets-kit", "@walletconnect/sign-client"],
            charts: ["recharts"],
          },
        },
      },
    },
    server: {
      headers: devHeaders,
    },
    preview: {
      // Preview serves the production bundle, so it gets the production
      // policy — this is the last chance to catch a policy that breaks the
      // built app before it reaches a real host.
      headers: buildSecurityHeaders({
        mode: isDev ? "development" : "production",
        reportUri,
        reportOnly,
      }),
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/setupTests.ts"],
    },
  };
});
