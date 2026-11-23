# Recovery Objectives (RPO / RTO)

- **RPO (recovery point objective):** the maximum amount of data, measured in
  time, that we accept losing.
- **RTO (recovery time objective):** the maximum time from declaring a disaster
  to restoring service.

## Components

| Component | Where it lives | Authoritative? | Tier |
| --- | --- | --- | --- |
| Contract state (DIDs, credentials on-chain, reputation, governance) | Stellar network | Yes, and not operated by us | n/a |
| Data directory: `credentials.json`, webhooks, webhook logs, notification log, API keys, expiry watermark | `DATA_DIR` on the API host | Yes, for off-chain metadata | 1 |
| Audit logs | `AUDIT_LOG_PATH`, which defaults to `DATA_DIR/audit` | Yes, and compliance relevant | 1 |
| Secrets and config (env, API signing secrets, OAuth clients) | Deployment secret manager, env files | Yes | 1 |
| Redis: DID cache, query cache, rate-limit and job queues | ElastiCache | No. Rebuildable from chain and data directory | 2 |
| Frontend static assets | Cloudflare Worker assets | No. Rebuilt from git | 3 |
| Metrics, traces, access logs | CloudWatch, Prometheus | No | 3 |

## Objectives

| Tier | Scenario | RPO | RTO |
| --- | --- | --- | --- |
| 1 | Single task or AZ failure | 0 (after the EFS gap is closed); last backup until then | 5 min (ECS reschedules) |
| 1 | Data corruption / bad write | 1 h | 2 h |
| 1 | Full primary-region loss | 1 h | 1 h |
| 2 | Redis failure (primary node) | Cache contents only | 2 min (automatic ElastiCache failover) |
| 2 | Redis total loss | Cache contents only; queued jobs since last backup | 30 min |
| 3 | Frontend / observability loss | n/a | 4 h |

### Why these numbers

- **RPO 1 h** follows from the hourly backup schedule (`ship-backup.sh`) plus
  the S3 replication SLA of 15 minutes. Tightening it means backing up more
  often, or moving `DATA_DIR` onto replicated storage such as EFS with
  cross-region replication, which brings RPO down to about 15 min.
- **RTO 1 h for a region loss** is the time budget for the steps in
  [secondary-region.md](secondary-region.md): about 10 min to decide, 15 min to
  restore data, 10 min to scale up the service, 5 min to repoint Cloudflare, and
  about 20 min of slack. Quarterly drills measure the real figure (see
  [failover-testing.md](failover-testing.md)).
- **Redis carries no RPO** because every value in it is derived. The DID and
  query caches repopulate from Stellar RPC on a miss. Rate-limit buckets
  resetting is harmless. Bull queues can lose in-flight jobs, and the client
  retries issuance requests.

## Review

Review these objectives after every real DR event, after every drill that
misses a target, and at least once a year. Record any change in the
changelog at the bottom of this file.

| Date | Change | Approved by |
| --- | --- | --- |
| 2026-09-27 | Initial objectives (#959) | _pending_ |
