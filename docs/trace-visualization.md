# OpenTelemetry Distributed Tracing & Visualization Setup

## Overview
Soroban Identity utilizes OpenTelemetry for end-to-end distributed tracing across the full request lifecycle:
- Inbound HTTP requests
- Soroban RPC and smart contract invocations
- Cross-service dependencies (Redis, Webhook delivery, external notification endpoints)
- Worker threads with context propagation

## Configuration Options
The following environment variables configure the OpenTelemetry Node SDK tracer:

| Environment Variable | Default | Description |
|---|---|---|
| `OTEL_SERVICE_NAME` | `soroban-identity` | Logical service name for traces |
| `OTEL_SAMPLING_RATE` | `0.10` | Trace sampling rate (default: 10% of requests) |
| `OTEL_EXPORTER_TYPE` | `jaeger` | Target exporter: `jaeger`, `zipkin`, or `console` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP/Jaeger HTTP ingestion endpoint |

## Custom Trace Attributes
Every span is automatically enriched with contextual attributes:
- `tenant_id`: Current organization / tenant context (`X-Tenant-Id`)
- `contract_name`: Target smart contract (e.g. `identityRegistry`, `credentialManager`, `reputation`)
- `contract_id`: On-chain address of the invoked contract
- `rpc.method`: Smart contract or RPC method called
- `http.method`, `http.route`, `http.status_code`

---

## Trace Visualization Setup

### 1. Running Jaeger All-in-One (Docker)
Start the Jaeger all-in-one container locally:
```bash
docker run -d --name jaeger \
  -e COLLECTOR_ZIPKIN_HOST_PORT=:9411 \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 6831:6831/udp \
  -p 6832:6832/udp \
  -p 5778:5778 \
  -p 16686:16686 \
  -p 4317:4317 \
  -p 4318:4318 \
  -p 14250:14250 \
  -p 14268:14268 \
  -p 14269:14269 \
  -p 9411:9411 \
  jaegertracing/all-in-one:latest
```

### 2. Accessing the Jaeger UI
Open your browser at:
`http://localhost:16686`

1. Select **Service**: `soroban-identity`
2. Filter by Tag: `tenant_id=acme` or `contract_name=credentialManager`
3. Click **Find Traces** to view the timeline, RPC child spans, latency waterfalls, and error statuses.

### 3. Alternative: Running Zipkin
Start Zipkin:
```bash
docker run -d -p 9411:9411 openzipkin/zipkin
```
Set in `.env`:
```env
OTEL_EXPORTER_TYPE=zipkin
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:9411/api/v2/spans
```
Access the Zipkin UI at `http://localhost:9411`.
