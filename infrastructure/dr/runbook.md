# Service Recovery Runbook

Follow these steps in order. Every step lists a command and how to confirm it worked. Keep a timestamped log in the incident channel as you go, because the drill and post-mortem use it to measure the achieved RTO.

**Before you start:** the incident commander (IC) declares the disaster and the scenario. If you are unsure whether the incident is SEV-1, page the IC (see [contacts.md](contacts.md)). Do not fail over regions on your own.

## Environment

```bash
export PRIMARY_REGION=us-east-1
export DR_REGION=us-west-2
export DR_CLUSTER=soroban-identity-dr
export DR_SERVICE=soroban-identity-dr
export DR_DESIRED_COUNT=3
export DR_BACKUP_BUCKET_SECONDARY=...      # from contacts.md → "Where things are"
export DR_DATA_DIR=/mnt/efs/soroban-identity-dr/data
export DR_REDIS_URL=rediss://...           # secondary ElastiCache endpoint
export DR_ORIGIN=dr-origin.example.com     # secondary load balancer hostname
export CF_API_TOKEN=... CF_ZONE_ID=... CF_RECORD_ID=...   # api DNS record
export PUBLIC_URL=https://api.example.com
```

## Scenario index

| # | Scenario | Go to |
| --- | --- | --- |
| A | Single task or container failure | [A](#a-task-failure) |
| B | Availability zone outage | [B](#b-availability-zone-outage) |
| C | Redis primary failure or Redis data loss | [C](#c-redis-failure) |
| D | Data directory corruption or deletion | [D](#d-data-corruption-or-loss) |
| E | Full primary region outage | [E](#e-region-failover) |
| F | Soroban RPC provider outage | [F](#f-soroban-rpc-outage) |
| G | Compromised credentials or infrastructure | [G](#g-security-incident) |
| — | Returning to the primary region | [Failback](#failback) |

---

## A. Task failure

ECS replaces unhealthy tasks on its own (health check `curl /health`, 3 retries).

1. Check that replacement is happening: `aws ecs describe-services --cluster soroban-identity-production --services soroban-identity-production --query 'services[0].events[:5]'`.
2. If tasks crash-loop, find a correlation ID from the logs or the dashboard (`/admin/traces/dashboard`) and check the last deploy.
3. Roll back: `scripts/deploy.sh` with the previous image digest, or `infrastructure/deployment/traffic-switch.sh` for blue-green.

**Done when** `desiredCount == runningCount` and `/health` returns 200.

## B. Availability zone outage

The ECS service and ElastiCache are both multi-AZ, so there is nothing to do beyond confirming that capacity moved.

1. Confirm that tasks are running in the remaining AZs and that Redis `automatic_failover` promoted a replica (`aws elasticache describe-replication-groups`).
2. If capacity is short, temporarily raise `desired_count` (Terraform variable `app_desired_count`).

**Escalate to E** if a second AZ fails or the outage is expected to last longer than the RTO.

## C. Redis failure

1. On a Multi-AZ primary failure, ElastiCache promotes a replica automatically. Watch for `Failover Complete` in the ElastiCache events.
2. If the whole group is lost, recreate it from Terraform (`terraform apply` in `infra/terraform/environments/production`). The server starts with a cold cache.
3. To restore queue or counter state, follow [backup-restoration.md § 3](backup-restoration.md#3-restore-redis).
4. Replay webhook deliveries that were lost, using `/webhooks/logs` for failures after the recovery point.

**Done when** `/ready` returns 200 and `/health/detailed` shows Redis `up`.

## D. Data corruption or loss

1. **Stop writers:** `aws ecs update-service --cluster soroban-identity-production --service soroban-identity-production --desired-count 0`.
2. Identify the recovery point (see [backup-restoration.md § Point-in-time recovery](backup-restoration.md#point-in-time-recovery-for-corruption)).
3. Restore: [backup-restoration.md §§ 1–2](backup-restoration.md#1-fetch-the-archive) into the primary data directory.
4. Scale back up to the previous desired count.
5. Verify: `scripts/verify-recovery.sh --url "$PUBLIC_URL" --expect-credentials <n>`.
6. Reconcile against on-chain state for the gap window. Issuance and revocation events after the recovery point are replayed by the expiry and event poller when `EXPIRY_EVENTS_START_LEDGER` is set to the recovery-point ledger.

## E. Region failover

Target: **1 h RTO** and **1 h RPO**. The automated path is `scripts/failover.sh`. Run it as a dry run first to print the plan:

```bash
infrastructure/dr/scripts/failover.sh            # dry run: prints each step
infrastructure/dr/scripts/failover.sh --execute  # performs it
```

The script performs these steps. Do them by hand if it fails part-way:

1. **Freeze the primary** if it is reachable at all: scale it to 0 so there is no split brain.
2. **Fetch the newest archive** from the secondary bucket and check its age against the RPO. Check its checksum.
3. **Restore the data directory** into `$DR_DATA_DIR`. Seed Redis only if the time budget allows (see C).
4. **Scale up** the pilot-light service: `aws ecs update-service --region $DR_REGION --cluster $DR_CLUSTER --service $DR_SERVICE --desired-count $DR_DESIRED_COUNT`, then `aws ecs wait services-stable ...`.
5. **Verify the origin directly**: `verify-recovery.sh --url https://$DR_ORIGIN`.
6. **Switch DNS**: point the Cloudflare `api` record at `$DR_ORIGIN`. It is proxied, so the change takes effect in seconds.
7. **Verify the public URL**: `verify-recovery.sh --url $PUBLIC_URL`.
8. **Communicate**: post a status-page update and notify integrators that webhooks may have been delayed during the window.

After failover:

- Webhook and notification jobs queued in the primary's Redis are lost. Re-send deliveries that failed after the recovery point.
- Rate-limit and quota counters reset, which is acceptable.
- Run the backup shipping cron **from the secondary region** (flip `DR_BACKUP_BUCKET_PRIMARY` and `DR_BACKUP_BUCKET_SECONDARY`) so the RPO is protected while you run there.

## F. Soroban RPC outage

This is not an infrastructure failover. The circuit breaker (`server/src/circuit-breaker.js`) fails fast, and reads serve from the query cache.

1. Switch `STELLAR_RPC_URL` to the secondary provider listed in [contacts.md](contacts.md) and redeploy the task definition.
2. Confirm with `/health` (`contracts` all `true`).

## G. Security incident

1. Follow [SECURITY.md](../../SECURITY.md) and page the security contact.
2. Rotate secrets before restoring: API keys, webhook secrets, the admin key, and cloud credentials.
3. Rebuild from Terraform and a **known-good** image digest. Do not restore config files from archives taken after the suspected compromise time.
4. Restore data from the newest archive taken **before** the compromise (scenario D procedure).

---

## Failback

Return to the primary region only after it has been stable for at least 24 h, and during a low-traffic window.

1. Restore the newest secondary-region archive into the primary data directory (backup-restoration §§ 1–2).
2. Scale up the primary service, then verify its origin directly.
3. Switch DNS back and verify the public URL.
4. Scale the secondary back to 0 (pilot light) and restore the normal direction of backup shipping.
5. Write the post-mortem, including the measured RTO and RPO, and add it to the drill log in [failover-testing.md](failover-testing.md).
