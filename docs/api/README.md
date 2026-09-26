# Interactive API documentation

The Swagger UI page (`docs/api/swagger.html`) renders the OpenAPI 3.0 spec.

- **Hosted:** the API server serves it at `GET /api/docs`. The spec comes from `GET /openapi.json`.
- **Static:** open `docs/api/swagger.html` directly. It loads `docs/openapi.yaml`.

## Features
- **Try it out** is on by default, so you can send requests from the browser.
- **Authentication:** click **Authorize** and enter your API key (`X-API-Key`). The key is kept across page reloads.
- **Code generation:** each operation shows request snippets (cURL for bash, PowerShell and CMD). To generate full clients in other languages, run
  `npx @openapitools/openapi-generator-cli generate -i docs/openapi.yaml -g <typescript-fetch|python|go|rust> -o out/`.
- The layout works on mobile screens.

## Error codes
| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_error` | The request body or params failed schema validation |
| 401 | `unauthorized` | The API key is missing or invalid |
| 403 | `forbidden` | The API key does not have the required scope |
| 404 | `not_found` | The resource does not exist |
| 413 | `payload_too_large` | The body is larger than the size limit |
| 415 | `unsupported_media_type` | The request did not use `Content-Type: application/json` |
| 429 | `rate_limited` | Too many requests. Wait for the time in `Retry-After` |
| 500 | `internal_error` | Unexpected server error |

## Rate limits
Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.
When you go over the limit, the server returns `429` with a `Retry-After` header. The limits for each key and scope are in [api-key-scopes.md](../api-key-scopes.md).

## Keeping docs in sync
The `docs-openapi` job in `.github/workflows/api-docs.yml` lints `docs/openapi.yaml` and `server/openapi.json` on every PR. It fails when a spec is invalid.
