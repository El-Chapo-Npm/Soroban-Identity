# CDN for static assets

The frontend is published to **Cloudflare Pages** and served through the edge worker in [`infra/cloudflare`](../../infra/cloudflare). The architecture, `_headers` cache policy and canary routing are described in [docs/cdn-and-canary-deployments.md](../../docs/cdn-and-canary-deployments.md).

This directory adds the pieces around that setup: zone-level CDN configuration, cache invalidation for the custom hostname, post-deploy verification, multi-region testing and performance metrics.

```
Browser ─▶ app.example.com ─▶ Cloudflare edge (zone settings, tiered cache, cache rules)
                                   │
                                   └─▶ edge worker ─▶ Cloudflare Pages (stable / canary)
```

## Layout

| Path | Purpose |
|---|---|
| `terraform/` | Zone performance settings, smart tiered cache, edge cache rules for the app hostname |
| `scripts/purge-cache.sh` | Purge the HTML entry point and non-hashed public files after a deploy |
| `scripts/check-cache-headers.sh` | Verify the live cache policy and that every referenced asset returns 200 |
| `scripts/multi-region-test.sh` | Fetch an asset from probes on six continents; report cache status, PoP and TTFB |
| `scripts/metrics.sh` | Hit ratio, bandwidth offload, edge TTFB percentiles, top PoPs and countries |
| `cdn.env.example` | Settings for running the scripts locally |

## Cloudflare configuration

```bash
cd infrastructure/cdn/terraform
cp terraform.tfvars.example terraform.tfvars   # zone ID + app hostname
export TF_VAR_cloudflare_api_token=...          # Zone Settings:Edit, Cache Rules:Edit
terraform init && terraform apply
```

| Resource | Effect |
|---|---|
| `cloudflare_zone_settings_override` | Brotli, HTTP/3, 0-RTT, Early Hints, TLS 1.3, HTTPS-only. **Zone-wide.** |
| `cloudflare_tiered_cache` (smart) | PoPs fill from a regional upper tier, so fewer requests reach the origin |
| Cache rule: `/assets/*` | Edge TTL 1 year; query strings are excluded from the cache key |
| Cache rule: HTML and SPA routes | Never cached at the edge, so a deploy takes effect immediately |

## Cache headers and TTLs

| Files | Browser (`_headers`, emitted by the build) | Edge | Invalidation |
|---|---|---|---|
| `/assets/*` (content-hashed by Vite) | `public, max-age=31536000, immutable` | 1 year (cache rule) | Never needed: new content gets a new URL |
| `/` and SPA routes | `public, max-age=0, must-revalidate` | Not cached (cache rule) | Purged on deploy anyway, for caches that ignore the rule |
| Other public files (favicon, manifest, …) | Pages default | Pages default | Purged by URL on deploy |

Browser TTLs live in `frontend/csp.config.ts` (`_headers`); edge TTLs live in `terraform/`. `check-cache-headers.sh` asserts both after each deploy.

## Asset upload pipeline and invalidation on deploy

Uploads are handled by the existing `Deploy frontend to Cloudflare Pages` workflow (`.github/workflows/deploy-frontend.yml`), which publishes `frontend/dist` atomically with `wrangler pages deploy`. After the health probe it now runs:

1. **`purge-cache.sh`** — Pages purges its own cache when a deployment goes live, but responses cached under the custom hostname are separate. The script purges `/`, `/index.html` and every non-hashed file in `dist/`, in batches of 30. `--all` purges the whole zone for emergencies.
2. **`check-cache-headers.sh`** — fails the deploy if the HTML is cacheable, a hashed asset isn't `immutable` with a one-year max-age, or any referenced asset doesn't return 200.
3. **`multi-region-test.sh`** — see below. Its result goes to the job summary but never blocks a deploy.

Each step is skipped until the repository variables are set:

| Setting | Kind | Used by |
|---|---|---|
| `FRONTEND_URL` | variable | all three steps |
| `CLOUDFLARE_ZONE_ID` | variable | purge |
| `GLOBALPING_TOKEN` | secret (optional) | multi-region test |

The purge reuses the Cloudflare API token from Vault, which therefore needs the **Cache Purge** permission on the zone.

## Multi-region testing

```bash
cp infrastructure/cdn/cdn.env.example infrastructure/cdn/cdn.env   # set FRONTEND_URL
infrastructure/cdn/scripts/multi-region-test.sh                     # first JS bundle in the live index.html
infrastructure/cdn/scripts/multi-region-test.sh /favicon.svg 3      # any path, 3 probes per region
```

The script uses the [Globalping](https://globalping.io) API to request the asset from probes in North America, South America, Europe, Asia, Oceania and Africa. A warm-up round fills each PoP's cache and the second round is reported. Example output:

```
REGION  LOCATION        STATUS  CACHE  POP  TTFB_MS  TOTAL_MS
EU      Frankfurt, DE   200     HIT    FRA  14       19
AS      Singapore, SG   200     HIT    SIN  11       16
...
probes: 12  ok: 12  cache hits: 12
TTFB ms  p50: 13  p90: 31  max: 44
```

It exits non-zero if any probe doesn't get HTTP 200. In GitHub Actions it also writes the table to the job summary.

## Performance metrics

```bash
infrastructure/cdn/scripts/metrics.sh             # last 24 h
infrastructure/cdn/scripts/metrics.sh 72 --json cdn-metrics.json
```

For the app hostname only, it reports:

- requests and **cache hit ratio** (`hit` + `revalidated`)
- **bandwidth offload**: the share of bytes served from cache
- **edge TTFB** average and p50/p95/p99, plus average origin response time
- the cache-status breakdown, top PoPs with their TTFB, and top client countries

The data comes from `httpRequestsAdaptiveGroups` in Cloudflare's GraphQL Analytics API. How far back it reaches depends on the plan (about 24 h on Free). Bundle-size metrics are covered separately by the frontend performance workflow.
