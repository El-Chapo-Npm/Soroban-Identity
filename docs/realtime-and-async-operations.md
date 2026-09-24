# Realtime subscriptions and asynchronous operations

## GraphQL subscriptions

The server exposes `credentialUpdated`, `didUpdated`, and `reputationChanged` subscription fields over a `graphql-ws` compatible WebSocket transport. Subscription connections must authenticate with an API key in `connectionParams.token` (or the existing HTTP authorization header). Each subscription can filter by `subject`; credential subscriptions also accept `credentialType`. Connections use heartbeat pings and are closed when their per-subscription event budget is exceeded.

Example:

```js
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
const client = createClient({
  url: 'wss://identity.example/graphql',
  webSocketImpl: WebSocket,
  connectionParams: { token: process.env.IDENTITY_API_KEY },
});
const dispose = client.subscribe({
  query: `subscription ($subject: String!) {
    credentialUpdated(subject: $subject) { id action subject timestamp }
  }`,
  variables: { subject: 'G...' },
}, { next: console.log, error: console.error, complete: () => {} });
```

Contract event listeners publish normalized events into the subscription hub. The hub is deliberately transport-agnostic so the same events can also feed the existing WebSocket and webhook services.

## Response compression

Responses larger than `COMPRESSION_THRESHOLD` (default 1024 bytes) and matching a text, JSON, XML, JavaScript, GraphQL, or SVG content type are negotiated against `Accept-Encoding`. Brotli is preferred when available; gzip is the fallback. Images, audio, video, archives, PDFs, and already encoded responses are skipped. Compressed responses include `Content-Encoding` and `Vary: Accept-Encoding`; `compressionGzipLevel` defaults to 6. Prometheus integrations can implement `observeCompression({ encoding, originalSize, compressedSize, ratio })`.

## Bull queues

Set `REDIS_URL` and initialize `createBullQueues` with processors for `webhook-delivery`, `notification`, and `batch-credential-processing`. Jobs use exponential retry backoff, high/normal/low priorities, progress events, and completed-job cleanup after 24 hours. Permanently failed jobs are copied to the dead-letter queue. The optional Bull Board adapter exposes the queues under `/admin/queues`; protect that route with the existing admin authentication middleware.

## Blue-green deployment runbook

1. Build and publish an immutable image tag, then set `IMAGE` and the candidate `HEALTH_URL`.
2. Run `blue-green.sh`; it starts the inactive color, runs `migrations-compatible.sh`, polls health, executes the smoke URL, and runs the monitoring preflight hook.
3. `traffic-switch.sh` atomically changes the active color in `router.conf`; configure `TRAFFIC_RELOAD_COMMAND` to reload NGINX, Envoy, or the provider load balancer.
4. Monitor error rate and alerts through `monitor-cutover.sh`. A failed validation leaves traffic on the prior color and stops the candidate automatically.
5. To roll back manually, run `traffic-switch.sh blue router.conf` or `traffic-switch.sh green router.conf`, then reload the router.

Staging should run the same scripts with staging image tags, Redis, database, health, smoke, and monitoring endpoints before production promotion. Database changes must follow the expand/contract pattern so both colors can serve traffic during the cutover.
