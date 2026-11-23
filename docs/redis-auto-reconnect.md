# Redis Automatic Reconnection

## Problem

Temporary network issues cause Redis connections to drop permanently. When the network recovers, Redis remains disconnected until the server is manually restarted.

**Previous behavior:**
1. Network interruption occurs
2. Redis connection drops
3. All commands fail
4. Network recovers
5. **Redis stays disconnected** ❌
6. Manual server restart required

## Solution

Automatic reconnection with exponential backoff ensures Redis recovers from temporary network issues without manual intervention.

**New behavior:**
1. Network interruption occurs
2. Redis connection drops
3. Commands fail temporarily
4. **Automatic reconnection starts** ✅
5. Network recovers
6. **Redis reconnects successfully** ✅
7. Service resumes normal operation

## Configuration

### Environment Variables

```bash
# Enable/disable automatic reconnection (default: true)
REDIS_ENABLE_AUTO_RECONNECT=true

# Initial delay before first reconnect attempt (default: 1000ms)
REDIS_RECONNECT_DELAY_MS=1000

# Maximum retries for initial connection (default: 5)
REDIS_MAX_RETRIES=5

# Base delay for exponential backoff (default: 200ms)
REDIS_RETRY_BASE_MS=200

# Command timeout for Redis operations (default: 1000ms)
REDIS_COMMAND_TIMEOUT_MS=1000
```

### Reconnection Behavior

**Exponential Backoff:**
- Attempt 1: 1000ms delay
- Attempt 2: 2000ms delay
- Attempt 3: 4000ms delay
- Attempt 4: 5000ms delay (capped at retryMaxMs)
- Attempt 5+: 5000ms delay (continues indefinitely)

**Formula:**
```javascript
delay = Math.min(retryMaxMs, reconnectDelayMs * 2^(attempt - 1))
```

## How It Works

### Connection Lifecycle

```
┌─────────────┐
│   CLOSED    │
└──────┬──────┘
       │ connect()
       ▼
┌─────────────┐
│ CONNECTING  │◄───────┐
└──────┬──────┘        │
       │               │ retry
       ▼               │
┌─────────────┐        │
│  CONNECTED  │        │
└──────┬──────┘        │
       │               │
       │ socket error  │
       ▼               │
┌─────────────┐        │
│DISCONNECTED │────────┘
└─────────────┘  auto-reconnect
```

### During Disconnection

1. **Pending Commands Fail Immediately**  
   All in-flight commands are rejected with the connection error

2. **Cache Degrades Gracefully**  
   Cache misses are returned instead of errors

3. **Reconnection Scheduled**  
   Exponential backoff timer starts automatically

4. **Background Reconnection**  
   Attempts continue until success or manual close

5. **Service Continues**  
   HTTP requests succeed (without cache) during reconnection

### After Reconnection

- ✅ Cache operations resume
- ✅ Reconnection counter resets
- ✅ Normal service restored
- ✅ No manual intervention needed

## Logging

### Connection Events

**Successful Connection:**
```json
{
  "level": "info",
  "msg": "Redis connected",
  "host": "localhost",
  "port": 6379,
  "attempt": 1
}
```

**Connection Failed:**
```json
{
  "level": "warn",
  "msg": "Redis connection attempt failed",
  "host": "localhost",
  "port": 6379,
  "attempt": 2,
  "maxRetries": 5,
  "error": "connect ECONNREFUSED 127.0.0.1:6379"
}
```

**Reconnection Scheduled:**
```json
{
  "level": "info",
  "msg": "Scheduling Redis reconnection",
  "host": "localhost",
  "port": 6379,
  "attempt": 1,
  "delayMs": 1000
}
```

**Reconnection Successful:**
```json
{
  "level": "info",
  "msg": "Redis reconnection successful",
  "host": "localhost",
  "port": 6379
}
```

## Disabling Auto-Reconnect

For environments where manual control is preferred:

```bash
REDIS_ENABLE_AUTO_RECONNECT=false
```

**Use cases:**
- Testing failure scenarios
- Controlled maintenance windows
- Custom orchestration (e.g., Kubernetes liveness probes)

When disabled:
- Initial connection still retries (up to `REDIS_MAX_RETRIES`)
- Disconnections are NOT automatically recovered
- Manual restart required after network issues

## Testing

### Simulating Network Interruption

**Using Docker:**
```bash
# Pause Redis container
docker pause redis

# Wait for disconnection
sleep 2

# Observe reconnection attempts in logs
docker logs -f soroban-identity-server

# Resume Redis
docker unpause redis

# Verify reconnection success
```

**Using iptables (Linux):**
```bash
# Block Redis port
sudo iptables -A INPUT -p tcp --dport 6379 -j DROP

# Observe reconnection logs
tail -f logs/server.log

# Restore connectivity
sudo iptables -D INPUT -p tcp --dport 6379 -j DROP
```

### Expected Log Sequence

```
INFO  Redis connected
WARN  Redis connection attempt failed (attempt 1)
INFO  Scheduling Redis reconnection (delayMs: 1000)
INFO  Attempting Redis reconnection (attempt 1)
WARN  Redis reconnection failed (attempt 1)
INFO  Scheduling Redis reconnection (delayMs: 2000)
INFO  Attempting Redis reconnection (attempt 2)
INFO  Redis reconnection successful
```

## Performance Impact

### During Normal Operation

- **Zero overhead** - Reconnection logic only runs after disconnection
- **No polling** - Event-driven detection via socket errors

### During Reconnection

- **Graceful degradation** - Cache operations fail fast (no blocking)
- **Exponential backoff** - Reduces load on Redis during outages
- **Background recovery** - HTTP requests unaffected

### Metrics

Monitor reconnection health:

```javascript
// Track reconnection events
cache.metrics.connectionFailures.inc();
cache.metrics.reconnectionAttempts.inc();
cache.metrics.reconnectionSuccess.inc();
```

## Comparison with Redis Libraries

### ioredis (popular Node.js client)

**Similarities:**
- Automatic reconnection with exponential backoff
- Configurable retry strategy
- Connection event logging

**Differences:**
- Our implementation: Minimal dependencies (node:net/node:tls only)
- ioredis: Full-featured client with clustering, pub/sub, Lua scripts
- Trade-off: Simplicity vs features for our cache-only use case

### node-redis

**Similarities:**
- Automatic reconnection support
- RESP protocol handling

**Differences:**
- Our implementation: Direct socket control for testing
- node-redis: More abstractions, harder to mock in tests
- Trade-off: Control vs convenience

## Troubleshooting

### Redis stays disconnected despite auto-reconnect

**Possible causes:**
1. `REDIS_ENABLE_AUTO_RECONNECT=false` - Check configuration
2. Firewall blocking outbound connections - Check network policies
3. Redis authentication changed - Update `REDIS_URL` credentials
4. Redis server down permanently - Verify Redis is running

**Diagnosis:**
```bash
# Check Redis connectivity
redis-cli -h <host> -p <port> PING

# Review reconnection logs
grep "reconnection" logs/server.log

# Verify configuration
curl http://localhost:3000/health
```

### Reconnection attempts too frequent

**Solution:** Increase initial delay
```bash
REDIS_RECONNECT_DELAY_MS=5000  # Start with 5s delay
```

### Reconnection takes too long

**Solution:** Decrease initial delay
```bash
REDIS_RECONNECT_DELAY_MS=500  # Start with 500ms delay
```

### Memory leak during reconnections

**Not an issue** - Timers are properly cleaned up:
- `timer.unref()` prevents process from hanging
- `clearTimeout()` cancels pending attempts on quit
- Reconnection stops when `quit()` called

## Best Practices

1. **Enable auto-reconnect in production**  
   Default behavior handles transient network issues

2. **Monitor reconnection metrics**  
   Frequent reconnections indicate infrastructure problems

3. **Set reasonable timeouts**  
   Balance between fast failure and allowing recovery time

4. **Use health checks**  
   Kubernetes/Docker health probes should tolerate temporary Redis outages

5. **Test failure scenarios**  
   Regularly simulate Redis outages in staging

## Migration Guide

### Before (Manual Restart Required)

```bash
# Network issue occurs
# Redis disconnects
# Commands fail: Error: Redis is not connected

# Manual intervention needed:
pm2 restart server
# or
docker restart soroban-identity-server
```

### After (Automatic Recovery)

```bash
# Network issue occurs
# Redis disconnects
# Commands fail temporarily
# Automatic reconnection starts
# Network recovers
# Redis reconnects automatically
# Service resumes - no action needed ✅
```

**No code changes required** - Feature enabled by default.

## References

- [Redis Persistence](https://redis.io/docs/management/persistence/)
- [Node.js net module](https://nodejs.org/api/net.html)
- [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)
- [Issue #739](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/739)

## Related Configuration

- `REDIS_URL` - Redis connection string
- `REDIS_MAX_RETRIES` - Initial connection retry limit
- `REDIS_RETRY_BASE_MS` - Base delay for initial connection retries
- `REDIS_COMMAND_TIMEOUT_MS` - Timeout for individual commands
- `DID_CACHE_TTL_MS` - Cache entry time-to-live
- `CACHE_FAILURE_THRESHOLD` - Consecutive failures before circuit breaker opens
