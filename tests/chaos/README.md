# Chaos Engineering

Failure-injection experiments that verify the API degrades gracefully and recovers.
Built on [Toxiproxy](https://github.com/Shopify/toxiproxy): the API server, Redis
cache and Soroban RPC endpoint are all reached through Toxiproxy proxies, so faults
can be injected at the network layer without touching application code.

```
client ──► toxiproxy:3002 ──► api:3001 ──► toxiproxy:6380 ──► redis
                                     └──► toxiproxy:8001 ──► rpc-mock
```

## Scenarios
| # | Scenario | Target | Injection | Pass criteria |
|---|---|---|---|---|
| 01 | High latency | RPC endpoint | +2s ±500ms latency | ≥95% success, recovery <10s |
| 02 | Network partition | Redis cache | proxy disabled | ≥99% success (cache bypass), recovery <15s |
| 03 | Network partition | RPC endpoint | proxy disabled | no connection failures, recovery <15s |
| 04 | Service crash | API server | `SIGKILL` container | healthy again <30s |
| 05 | Disk full | API server | fill 16 MB tmpfs | ≥95% success, recovery <10s |

Each run records **baseline**, **during-fault** (success rate, p50/p95 latency,
status codes — i.e. blast radius) and **recovery time** into `chaos-report.json`.

## Running
```bash
cd tests/chaos
docker compose -f docker-compose.chaos.yml up -d --build
node run-chaos.mjs                 # all scenarios
node run-chaos.mjs redis latency   # subset
docker compose -f docker-compose.chaos.yml down -v
```
Against staging, point `TOXIPROXY_URL` and `CHAOS_API_URL` at the staging
Toxiproxy/API (scenarios 04–05 require docker access to the host). The
`chaos.yml` workflow runs the suite weekly and on manual dispatch.

## Failure response playbooks / runbooks
### Redis unavailable
- **Symptoms:** `DID cache` errors in logs, higher RPC load and latency.
- **Expected behaviour:** requests served from origin; no 5xx.
- **Response:** check `redis` health/memory, restart it; the client auto-reconnects
  (see `docs/redis-auto-reconnect.md`). No user action needed.

### RPC endpoint slow / unreachable
- **Symptoms:** p95 latency spikes, 503 on contract reads/writes.
- **Response:** confirm with `curl $STELLAR_RPC_URL`; fail over `STELLAR_RPC_URL`
  to a secondary provider and redeploy; post status update if >5 min.

### API server crash
- **Symptoms:** health check failures, connection refused at the load balancer.
- **Response:** orchestrator restarts the container; if crash-looping, roll back
  to the previous image and inspect logs for the triggering request.

### Disk full
- **Symptoms:** write errors in logs, failed uploads/temp files.
- **Response:** clear temp/log files, raise volume size, verify log rotation.

### Recording findings
After each run, add any failed criterion or unexpected blast radius as an issue
and extend the relevant runbook above with the observed behaviour and fix.
