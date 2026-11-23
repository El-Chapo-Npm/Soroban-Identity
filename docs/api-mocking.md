# API Mocking for Client Development

The server provides deterministic API fixtures for frontend work and integration testing when the chain or supporting services are unavailable. The mock routes do not access Soroban and never persist credential writes.

## Enable locally

Set `MOCK_API_ENABLED=true` when starting the server:

```bash
cd server
MOCK_API_ENABLED=true npm start
```

The feature is **disabled by default** and is forcibly disabled when `NODE_ENV=production`, even if `MOCK_API_ENABLED=true` is present. Responses include `mock: true` where applicable and `Cache-Control: no-store` so test data is not cached.

## Endpoints

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/mock/v1/health` | Mock service health |
| `GET` | `/mock/v1/info` | Endpoint index |
| `GET` | `/mock/v1/credentials` | Deterministic example credential list |
| `GET` | `/mock/v1/credentials/:id` | Fetch the example credential or return a mock 404 |
| `POST` | `/mock/v1/credentials` | Return a mock issued credential without storing it |
| `GET` | `/mock/v1/dids/:address` | Return a minimal DID document fixture |
| `GET` | `/mock/v1/reputation/:address` | Return a fixed reputation fixture |

The mock routes have a dedicated `/mock/v1` prefix and are not aliases for real API routes. Invalid methods and unknown paths return JSON errors. `POST /mock/v1/credentials` requires `Content-Type: application/json` and obeys the server request-body size limit.

## Simulating failures and latency

Clients can force an error or a slow response on any mock route except `/mock/v1/health`, which stays unconditional so a test harness can always confirm the mock server is up. That way error handling and loading states can be tested without a broken backend.

| Query parameter | Header | Effect |
|---|---|---|
| `mockStatus` | `X-Mock-Status` | Respond with this status and a JSON error body marked `"simulated": true`. Allowed: `400`, `401`, `403`, `404`, `409`, `429`, `500`, `503`. `429` and `503` also send `Retry-After: 1`. |
| `mockDelayMs` | `X-Mock-Delay-Ms` | Wait this many milliseconds (integer, `0`–`5000`) before responding. Combines with `mockStatus`. |

When both are supplied, the query parameter wins, since a browser can't easily set request headers. Out-of-range values return `400 invalid_mock_scenario`. `GET /mock/v1/info` lists the supported scenarios under `scenarios`.

```bash
curl -i 'http://localhost:3001/mock/v1/credentials?mockStatus=503'
curl 'http://localhost:3001/mock/v1/dids/GMOCK?mockDelayMs=1500'
```

## Example

```bash
curl http://localhost:3001/mock/v1/credentials
curl -X POST http://localhost:3001/mock/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"subject":"GMOCKSUBJECT","credentialType":"Kyc"}'
```
