# Identity API load scenarios

Use [k6 0.57 or newer](https://grafana.com/docs/k6/latest/using-k6/javascript-typescript-compatibility-mode/) (native TypeScript support). Run only against a dedicated disposable deployment with the documented identity and credential APIs, provisioned signing accounts, issuer authorization, and enough funded controllers for every iteration.

Supply `fixtures.json` as an array of objects containing `controller` and `credential`. The credential object must contain issuer, credentialType, claims, claimsHash (64 hex characters), signature (128 hex characters), and expiresAt. Use valid signing material for the deployment; do not commit secrets. Every controller must be unique and have no DID yet. Fixture exhaustion aborts rather than silently reusing state or counting conflicts as successes.

```sh
cd tests/load
BASE_URL=https://dedicated.example API_TOKEN=... FIXTURES=./fixtures.json SCENARIO=normal k6 run scenarios.ts
```

Run `normal`, `peak`, `stress`, and `spike` with fresh fixtures and reset deployment state between runs. These cover 100, 500, and 1000 concurrent users. Override `P95_MS` and `P99_MS` to the deployment's agreed latency limits. k6 exits nonzero on error-rate, latency, or functional-check regression. Archive `summary.json`, `report.html`, and k6 time-series output with deployment revision, hardware, RPC configuration, and fixture count. Endpoint tags distinguish DID creation, issuance, and verification without high-cardinality IDs.

## Baseline status

No dedicated deployment or fixture/signing pool was supplied. No measured capacity, breaking point, or performance baseline is claimed. The server in this checkout also has a pre-existing syntax error in `server/src/app.js` and needs repair before an end-to-end load run. The suite follows `docs/openapi.yaml`; validate that the deployed response shapes match it before measuring.

A deployment owner must run the scenarios, locate the first sustained latency/error threshold breach in time-series output, record its concurrency and throughput, and connect k6's nonzero exit to their regression alert channel. HTML output currently provides metric tables; time-series visualizations and dedicated-environment CI/alerts remain incomplete.
