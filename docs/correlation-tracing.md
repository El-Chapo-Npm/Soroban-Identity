# Correlation IDs and request tracing

Every non-metrics HTTP request receives a correlation ID. The server accepts an
incoming `X-Correlation-ID` (or legacy `X-Request-ID`) and otherwise generates a
UUID. It returns both headers:

- `X-Correlation-ID` — stable request correlation value for support and logs
- `X-Request-ID` — backwards-compatible alias
- `X-Trace-ID` — distributed trace ID for sampled spans

The W3C `traceparent` header and `X-Trace-ID`/`X-Span-ID` are propagated to
Soroban, worker, and external-service instrumentation. Structured Pino logs
include `requestId`, `traceId`, and `spanId` when they run inside a request
context. Values must be treated as opaque identifiers; do not put credentials or
claims in them.

## Trace storage and visualization

Set `TRACE_STORE_PATH` to retain sampled spans as newline-delimited JSON for
replay or ingestion by an observability pipeline:

```bash
TRACE_STORE_PATH=./data/traces.ndjson \
OTEL_EXPORTER_TYPE=jaeger \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces \
npm start
```

The existing Jaeger/Zipkin exporter remains best effort: trace failures never
fail an API request. Run Jaeger all-in-one using the Docker instructions in
[`trace-visualization.md`](./trace-visualization.md), then select the
`soroban-identity` service and filter by `http.route`, `tenant_id`, or
`http.status_code`. The NDJSON store is intended for low-volume audit/debug
retention; use a managed trace backend for production volume and retention.
