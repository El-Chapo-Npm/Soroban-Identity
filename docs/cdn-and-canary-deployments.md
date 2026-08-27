# CDN and canary deployments

## CDN architecture

The frontend is published to Cloudflare Pages and served through `infra/cloudflare/worker.js`. The worker routes visitors to the stable origin by default and, when enabled, assigns a visitor to the canary origin using a signed-by-transport, `Secure` and `HttpOnly` release cookie. `CANARY_PERCENTAGE` defaults to **10**, so the normal split is 10% canary and 90% stable. A pinned visitor stays on one release for the cookie lifetime instead of moving between versions during a session.

Cloudflare provides global edge delivery and edge Brotli/gzip negotiation. The build additionally creates `.br` and `.gz` siblings for CDNs that need origin-side precompressed artifacts and writes `asset-compression-manifest.json` with their sizes. Hashed Vite assets are sent with:

```text
Cache-Control: public, max-age=31536000, immutable
```

The generated `dist/_headers` applies this rule to JavaScript, CSS, fonts, WebAssembly, images, and the `/assets/` directory. The HTML entrypoint is sent with `max-age=0, must-revalidate`, allowing a deployment to point visitors at the newest asset manifest without waiting for a long-lived HTML cache.

Vite’s content-hashed filenames make every release self-invalidating. Cloudflare Pages publishes the new deployment atomically and purges the project’s edge cache as part of deployment; the release workflow then probes the configured public health URL. If another CDN is used, purge its distribution after upload using the provider’s deployment API and preserve the same cache policy.

The worker retries a failed canary request against the stable origin and adds `x-release-channel` to the response for log correlation. Configure `STABLE_ORIGIN`, `CANARY_ORIGIN`, and `CANARY_ENABLED` as worker variables or secrets. Do not put provider API tokens in the frontend bundle.

## Image delivery

Place source PNG or JPEG files in `frontend/public`. Run `npm run images:webp` to create quality-82 WebP siblings without deleting the originals. New UI code should prefer the WebP asset with a fallback for browsers that do not support it. The command is part of the production build and is intentionally a no-op when no raster source files exist.

## Bundle analysis and budgets

`npm run analyze` produces an interactive Rollup/Vite treemap at `dist/bundle-report.html`, with gzip and Brotli sizes. Vite uses Rollup rather than webpack, so the Vite-native visualizer is used instead of applying `webpack-bundle-analyzer` to an incompatible stats format. `npm run build` also writes `dist/bundle-metrics.json` and fails when the initial JavaScript, total JavaScript, or total asset budgets are exceeded. The CI workflow publishes both the metrics and report as artifacts and includes a compact table in the job summary.

The application’s two tab panels are route-like surfaces. `IdentityPanel` and `CredentialsPanel` are loaded with `React.lazy`, a loading fallback is displayed during the fetch, and the credentials panel is preloaded on pointer hover or keyboard focus. Vendor chunks are grouped for React, i18n, Stellar SDK, wallet integrations, and charts so changes in one area do not invalidate every bundle.

## Canary process

The server canary resources use Argo Rollouts with stable and canary Services behind the NGINX ingress. The first step sends 10% of traffic to the canary and pauses for the configured `CANARY_DURATION_HOURS` value, constrained by the dispatch workflow to 1–4 hours. During the pause, the analysis template validates `/health`, limits canary 5xx error rate to 2%, and checks p95 latency. Prometheus and Grafana provide the operational view in `infra/monitoring/grafana/soroban-identity-canary.json`.

The GitHub Actions canary workflow performs a public health probe, polls the configured metrics endpoint once per minute, and promotes only after the observation window passes. A health failure, error-rate breach, or rollout command failure runs `kubectl argo rollouts abort` and `undo`, returning traffic to the previous stable revision. The workflow reads kubeconfig from Vault and should be protected by a production environment with required reviewers.

Before enabling production traffic splitting, install the Argo Rollouts controller, NGINX ingress canary support, Prometheus scraping for `http_requests_total` and `http_request_duration_seconds`, and Grafana dashboard provisioning. Replace the example host and image registry in `rollout.yaml`; the checked-in values are safe templates, not production credentials or endpoints.
