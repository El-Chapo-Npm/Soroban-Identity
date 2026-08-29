# Distributed Tracing

Soroban Identity implements distributed tracing using [Jaeger](https://www.jaegertracing.io/) to track requests across microservices and identify performance bottlenecks.

## Overview

Distributed tracing helps you:

- **Track request flow** across multiple services and components
- **Identify performance bottlenecks** in API endpoints and RPC calls
- **Debug complex distributed systems** with visual trace timelines
- **Monitor system health** and track error rates
- **Optimize resource usage** by analyzing span durations

## Architecture

### Components

1. **Tracer** (`server/src/tracer.js`) - Jaeger client initialization and span management
2. **Tracing Middleware** (`server/src/tracing-middleware.js`) - HTTP request instrumentation
3. **Soroban Tracing** (`server/src/soroban-tracing.js`) - Contract call instrumentation
4. **Jaeger Agent** - Collects traces and forwards to collector
5. **Jaeger UI** - Visualizes traces and provides search/analysis

### Trace Flow

```
HTTP Request → Express Middleware → Business Logic → Contract Call → Response
     ↓               ↓                    ↓                ↓            ↓
  Root Span    Middleware Span    Operation Spans   RPC Spans   Complete Span
     ↓               ↓                    ↓                ↓            ↓
 Jaeger Agent ← Jaeger Agent ← Jaeger Agent ← Jaeger Agent ← Jaeger Agent
     ↓
 Jaeger Collector
     ↓
 Jaeger Storage (Cassandra/Elasticsearch)
     ↓
 Jaeger UI (Query Service)
```

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Enable distributed tracing
JAEGER_ENABLED=true

# Service name (appears in Jaeger UI)
JAEGER_SERVICE_NAME=soroban-identity-server

# Jaeger agent connection
JAEGER_AGENT_HOST=localhost
JAEGER_AGENT_PORT=6832

# Sampling strategy
JAEGER_SAMPLER_TYPE=const
JAEGER_SAMPLER_PARAM=1

# Reporter options
JAEGER_REPORTER_LOG_SPANS=false
JAEGER_REPORTER_FLUSH_INTERVAL=1000
```

### Sampler Types

| Type | Description | Parameter | Use Case |
|------|-------------|-----------|----------|
| `const` | Constant sampling | `1` = all traces, `0` = none | Development, debugging |
| `probabilistic` | Random sampling | `0.0` - `1.0` (e.g., `0.1` = 10%) | High-traffic production |
| `ratelimiting` | Rate-limited sampling | Max traces per second | Cost control |
| `remote` | Server-controlled sampling | N/A | Centralized configuration |

### Sampling Recommendations

**Development:**
```bash
JAEGER_SAMPLER_TYPE=const
JAEGER_SAMPLER_PARAM=1  # Sample all traces
```

**Production (low traffic):**
```bash
JAEGER_SAMPLER_TYPE=const
JAEGER_SAMPLER_PARAM=1  # Sample all traces
```

**Production (high traffic):**
```bash
JAEGER_SAMPLER_TYPE=probabilistic
JAEGER_SAMPLER_PARAM=0.1  # Sample 10% of traces
```

**Production (cost-sensitive):**
```bash
JAEGER_SAMPLER_TYPE=ratelimiting
JAEGER_SAMPLER_PARAM=10  # Max 10 traces per second
```

## Setup

### 1. Install Jaeger (Development)

Using Docker:

```bash
docker run -d --name jaeger \
  -e COLLECTOR_ZIPKIN_HOST_PORT=:9411 \
  -p 5775:5775/udp \
  -p 6831:6831/udp \
  -p 6832:6832/udp \
  -p 5778:5778 \
  -p 16686:16686 \
  -p 14268:14268 \
  -p 14250:14250 \
  -p 9411:9411 \
  jaegertracing/all-in-one:latest
```

This starts Jaeger with:
- Agent (UDP): ports 5775, 6831, 6832
- Collector: ports 14268, 14250
- Query/UI: port 16686
- Zipkin compatible: port 9411

### 2. Configure Application

Update your `.env`:

```bash
JAEGER_ENABLED=true
JAEGER_AGENT_HOST=localhost
JAEGER_AGENT_PORT=6832
```

### 3. Start Application

```bash
npm start
```

### 4. Access Jaeger UI

Open your browser to [http://localhost:16686](http://localhost:16686)

## Usage

### Viewing Traces

1. Open Jaeger UI at [http://localhost:16686](http://localhost:16686)
2. Select service: `soroban-identity-server`
3. Choose operation (or leave empty for all)
4. Click **Find Traces**

### Search Options

- **Lookback**: Time range (e.g., last hour, last 15 minutes)
- **Max Duration**: Filter by trace duration
- **Min Duration**: Filter slow traces only
- **Tags**: Search by custom tags (e.g., `http.status_code=500`)

### Analyzing Traces

Each trace shows:

- **Duration**: Total time for the request
- **Spans**: Individual operations within the trace
- **Tags**: Metadata about the operation
- **Logs**: Events and errors during execution

Example trace hierarchy:

```
http_request (350ms)
├─ did.resolve (180ms)
│  ├─ cache.get (5ms)
│  └─ contract.invoke (170ms)
│     └─ rpc.call (165ms)
├─ storage.read (20ms)
└─ http.response (2ms)
```

## Instrumented Operations

### HTTP Requests

Every incoming HTTP request creates a root span with:

**Tags:**
- `http.method` - HTTP method (GET, POST, etc.)
- `http.url` - Full URL
- `http.path` - URL path
- `http.status_code` - Response status
- `span.kind` - `server`

**Example:**
```
Operation: http_request
Duration: 245ms
Tags:
  http.method: POST
  http.url: /credentials
  http.path: /credentials
  http.status_code: 201
  component: http-server
```

### Contract Invocations

All Soroban contract calls are traced:

**Tags:**
- `contract.id` - Contract address
- `rpc.system` - `soroban`
- `rpc.service` - `contract`
- `rpc.method` - Contract method name
- `span.kind` - `client`

**Example:**
```
Operation: contract.invoke
Duration: 165ms
Tags:
  contract.id: CAAAA...BSC4
  rpc.method: get_did
  contract.args_count: 1
  component: soroban-client
```

### DID Resolution

DID lookups are instrumented:

**Tags:**
- `did` - Full DID identifier
- `did.address` - Stellar address
- `did.found` - Whether document was found

**Example:**
```
Operation: did.resolve
Duration: 180ms
Tags:
  did: did:stellar:GAAAA...AWHF
  did.address: GAAAA...AWHF
  did.found: true
  component: did-resolver
```

### Cache Operations

Redis cache operations are traced:

**Tags:**
- `cache.operation` - `get`, `set`, `invalidate`
- `cache.key` - Cache key
- `cache.hit` - For `get`: true if cached
- `db.type` - `redis`

**Example:**
```
Operation: cache.get
Duration: 5ms
Tags:
  cache.operation: get
  cache.key: did:GAAAA...AWHF
  cache.hit: true
  component: cache
```

### RPC Retries

Retry attempts are logged as events:

**Fields:**
- `retry.attempt` - Attempt number
- `retry.max_retries` - Maximum retries
- `retry.delay_ms` - Delay before retry
- `retry.reason` - Error reason

### Circuit Breaker

Circuit breaker state changes are tracked:

**Fields:**
- `circuit_breaker.state` - `open`, `closed`, `half_open`
- `circuit_breaker.reason` - Reason for state change

## Custom Instrumentation

### Adding Spans to Business Logic

Use the `traceOperation` helper:

```javascript
import { traceOperation } from './tracing-middleware.js';
import { Tags } from './tracer.js';

async function processCredential(credentialId) {
  return traceOperation('credential.process', async (span) => {
    span.addTags({
      [Tags.CREDENTIAL_ID]: credentialId,
      [Tags.COMPONENT]: 'credential-processor',
    });

    // Your business logic here
    const result = await doWork(credentialId);

    span.log({
      event: 'credential_processed',
      credential_id: credentialId,
    });

    return result;
  }, {
    'operation.type': 'process',
  });
}
```

### Manual Span Creation

For more control:

```javascript
import { startSpan } from './tracing-middleware.js';
import { Tags } from './tracer.js';

async function customOperation() {
  const span = startSpan('custom.operation', {
    [Tags.COMPONENT]: 'custom-component',
    'custom.tag': 'value',
  });

  try {
    // Your logic
    const result = await doSomething();
    
    span.setTag('success', true);
    span.log({
      event: 'operation_complete',
      result_size: result.length,
    });
    
    return result;
  } catch (error) {
    span.setTag(Tags.ERROR, true);
    span.setTag(Tags.ERROR_MESSAGE, error.message);
    span.log({
      event: 'error',
      'error.kind': error.name,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    span.finish();
  }
}
```

### Adding Tags to Current Span

```javascript
import { addTagsToCurrentSpan } from './tracing-middleware.js';

function someFunction(userId) {
  addTagsToCurrentSpan({
    'user.id': userId,
    'operation.phase': 'validation',
  });
}
```

### Logging Events

```javascript
import { logToCurrentSpan } from './tracing-middleware.js';

function logCheckpoint(checkpointName) {
  logToCurrentSpan('checkpoint', {
    name: checkpointName,
    timestamp: Date.now(),
  });
}
```

## Production Deployment

### Kubernetes

Use the [Jaeger Operator](https://www.jaegertracing.io/docs/latest/operator/):

```yaml
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: soroban-identity
spec:
  strategy: production
  storage:
    type: elasticsearch
    options:
      es:
        server-urls: http://elasticsearch:9200
```

### Docker Compose

```yaml
version: '3.8'
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "5775:5775/udp"
      - "6831:6831/udp"
      - "6832:6832/udp"
      - "5778:5778"
      - "16686:16686"
      - "14268:14268"
    environment:
      COLLECTOR_ZIPKIN_HOST_PORT: :9411

  app:
    build: .
    environment:
      JAEGER_ENABLED: "true"
      JAEGER_AGENT_HOST: jaeger
      JAEGER_AGENT_PORT: "6832"
      JAEGER_SAMPLER_TYPE: probabilistic
      JAEGER_SAMPLER_PARAM: "0.1"
    depends_on:
      - jaeger
```

### Environment-Specific Configuration

**Development:**
```bash
JAEGER_ENABLED=true
JAEGER_SAMPLER_TYPE=const
JAEGER_SAMPLER_PARAM=1
JAEGER_REPORTER_LOG_SPANS=true  # Debug output
```

**Staging:**
```bash
JAEGER_ENABLED=true
JAEGER_SAMPLER_TYPE=probabilistic
JAEGER_SAMPLER_PARAM=0.5  # Sample 50%
```

**Production:**
```bash
JAEGER_ENABLED=true
JAEGER_SAMPLER_TYPE=probabilistic
JAEGER_SAMPLER_PARAM=0.1  # Sample 10%
JAEGER_REPORTER_LOG_SPANS=false
```

## Performance Considerations

### Overhead

Distributed tracing adds minimal overhead:

- **Sampling overhead**: < 0.1ms per request
- **Span creation**: ~0.01ms per span
- **Network**: Async, non-blocking UDP

### Optimizations

1. **Use appropriate sampling** - Don't sample 100% in high-traffic production
2. **Limit span depth** - Avoid creating too many nested spans
3. **Batch reporting** - Default flush interval (1000ms) is optimized
4. **UDP transport** - Non-blocking, fire-and-forget

### Resource Usage

For 1000 req/s with 10% sampling:

- **CPU**: < 2% overhead
- **Memory**: ~10MB for span buffers
- **Network**: ~100 KB/s to Jaeger agent

## Troubleshooting

### No Traces Appearing

1. **Check Jaeger is running:**
   ```bash
   curl http://localhost:16686/api/services
   ```

2. **Verify configuration:**
   ```bash
   echo $JAEGER_ENABLED
   echo $JAEGER_AGENT_HOST
   echo $JAEGER_AGENT_PORT
   ```

3. **Check logs:**
   ```bash
   grep "Distributed tracing" logs/server.log
   ```

4. **Test UDP connectivity:**
   ```bash
   nc -u localhost 6832
   ```

### Traces Incomplete

- **Check sampling rate**: Increase `JAEGER_SAMPLER_PARAM`
- **Verify all services configured**: Ensure consistent service names
- **Check span finishing**: Every `startSpan()` needs `finish()`

### High Overhead

- **Reduce sampling**: Lower `JAEGER_SAMPLER_PARAM`
- **Use rate limiting**: Switch to `ratelimiting` sampler
- **Decrease span granularity**: Remove unnecessary spans

### Agent Connection Errors

```
Error: Failed to send spans
```

**Solutions:**
- Verify Jaeger agent is running
- Check firewall rules for UDP port 6832
- Ensure `JAEGER_AGENT_HOST` is correct

## Best Practices

### Naming Conventions

- **Operations**: Use `noun.verb` format (e.g., `credential.create`, `did.resolve`)
- **Tags**: Use lowercase with dots (e.g., `http.method`, `db.type`)
- **Components**: Use descriptive names (e.g., `soroban-client`, `cache-manager`)

### Span Hierarchy

Keep span hierarchies shallow (3-5 levels max):

```
✅ Good:
http_request
├─ did.resolve
└─ contract.invoke

❌ Too deep:
http_request
├─ handler
│  └─ validator
│     └─ parser
│        └─ transformer
│           └─ executor
```

### Error Handling

Always set error tags and log exceptions:

```javascript
try {
  // operation
} catch (error) {
  span.setTag(Tags.ERROR, true);
  span.setTag(Tags.ERROR_MESSAGE, error.message);
  span.log({
    event: 'error',
    'error.kind': error.name,
    message: error.message,
    stack: error.stack,
  });
  throw error;
}
```

### Sensitive Data

Never log sensitive information in spans:

```javascript
// ❌ Bad
span.setTag('user.password', password);
span.setTag('api.key', apiKey);

// ✅ Good
span.setTag('user.id', userId);
span.setTag('api.key_present', !!apiKey);
```

## Integration with Monitoring

### Correlation with Logs

Request IDs from logs match trace IDs for correlation:

```json
{
  "level": "info",
  "msg": "Request completed",
  "requestId": "abc123",
  "trace_id": "1234567890abcdef",
  "span_id": "fedcba0987654321"
}
```

### Metrics Integration

Combine with Prometheus metrics for full observability:

- **Traces**: Detailed request flow and timing
- **Metrics**: Aggregate statistics and trends
- **Logs**: Detailed event information

### Alerting

Set up alerts based on trace data:

- **Slow traces**: Duration > threshold
- **Error rate**: Traces with error tags
- **Throughput**: Trace count per service

## References

- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OpenTracing Specification](https://opentracing.io/specification/)
- [Jaeger Client Node.js](https://github.com/jaegertracing/jaeger-client-node)
- [Distributed Tracing Best Practices](https://www.jaegertracing.io/docs/latest/best-practices/)

## Contributing

To add tracing to a new component:

1. Import tracing utilities
2. Wrap operations with `traceOperation()`
3. Add relevant tags and logs
4. Test with Jaeger UI
5. Update this documentation

For questions or improvements, open an issue on GitHub.
