# Service Recovery Runbook

One section per failure scenario. Each has **detect → contain → recover →
verify** steps. Before you start, open an incident channel, name an Incident
Commander (IC), and keep a timestamped log in the channel. The post-incident
review is built from that log.

Common variables used below:

```bash
export PRIMARY=us-east-1 SECONDARY=us-west-2
export CLUSTER=soroban-identity-production SERVICE=soroban-identity-production
```

---

## 1. Single task crash / unhealthy task

**Detect:** the ECS container health check (`curl /health`) fails, ECS
service events show tasks being replaced, and 5xx rates spike. The
`<name>-ecs-cpu` alarm in `infra/terraform/modules/app/alarms.tf` often fires
first when the cause is resource exhaustion.

**Recover:** ECS replaces the task automatically. Watch it happen:

```bash
aws ecs describe-services --region $PRIMARY --cluster $CLUSTER --services $SERVICE \
  --query 'services[0].{running:runningCount,desired:desiredCount,events:events[0:5].message}'
```

If tasks keep crash-looping, pull the most recent logs:

```bash
aws logs tail /ecs/$CLUSTER --region $PRIMARY --since 15m
```

A crash loop that starts right after a deploy is **scenario 2**.

**Verify:** `runningCount == desiredCount` and `/ready` returns 200.

## 2. Bad deploy

**Detect:** errors begin at the deploy time, or the canary error-rate panel
(`infra/monitoring/grafana/soroban-identity-canary.json`) climbs.

**Contain:** if the canary was on, set `CANARY_ENABLED=false` in the Worker.
That stops canary traffic within seconds.

**Recover:** roll back to the previous task definition revision:

```bash
PREV=$(aws ecs list-task-definitions --region $PRIMARY --family-prefix $CLUSTER \
  --sort DESC --query 'taskDefinitionArns[1]' --output text)
aws ecs update-service --region $PRIMARY --cluster $CLUSTER --service $SERVICE --task-definition "$PREV"
```

For blue-green hosts, use `infrastructure/deployment/traffic-switch.sh` to move
traffic back to the previous colour.

**Verify:** the error rate returns to baseline within 10 minutes.

## 3. Availability Zone loss

**Detect:** tasks and a Redis node become unhealthy in one AZ.

**Recover:** no action is needed. The ECS service spreads across three private
subnets, and ElastiCache is multi-AZ with automatic failover. Confirm that
`desiredCount` is met and that Redis `primary_endpoint_address` resolves to a
healthy node. If capacity is tight, temporarily raise `desiredCount` by one.

## 4. Redis failure

**Detect:** `/ready` reports Redis down, cache-miss metrics jump, or Bull
queues stall.

**Contain:** the server degrades gracefully. The DID and query caches fall back
to direct RPC, and the Redis client reconnects on its own
(`docs/redis-auto-reconnect.md`). Expect higher latency and more RPC calls.

**Recover:**

- If the primary node failed, wait up to 2 min for automatic failover.
- If the replication group is gone, run `terraform apply` for the environment
  to recreate it empty, or restore from the most recent automatic snapshot (see
  [backup-restoration.md](backup-restoration.md#restoring-redis)). Then roll
  the ECS service (`aws ecs update-service --force-new-deployment`) so tasks
  pick up the endpoint.

**Verify:** `/ready` returns 200 and the cache hit rate recovers over about 30 min.

## 5. Data corruption or accidental deletion

**Detect:** users report missing or wrong credentials or webhooks, the audit
log shows unexpected bulk actions, or startup fails to parse JSON in `DATA_DIR`.

**Contain:**

1. Scale the service to 0 to stop further writes:
   `aws ecs update-service ... --desired-count 0`.
2. Snapshot the current (corrupt) data directory so it can be analysed later.

**Recover:** follow [backup-restoration.md](backup-restoration.md#choosing-a-backup)
to pick the last good archive, then:

```bash
infrastructure/dr/scripts/recover.sh --region $PRIMARY --backup-key archives/<last-good>.tar.gz
```

Replay any legitimate changes between the backup and the incident from the
audit log, by hand.

**Verify:** run the checks in [backup-restoration.md](backup-restoration.md#verification).

## 6. Full primary-region outage

**Detect:** the AWS Health Dashboard reports an outage in `us-east-1`, the
origin is unreachable from Cloudflare, and the AWS API is failing.

**Decide (T+0 to 10 min):** the IC confirms that the outage is regional and
not caused by a deploy. When in doubt, fail over. Failing back is rehearsed and
low-risk.

**Recover (T+10 to 45 min):**

```bash
infrastructure/dr/scripts/failover.sh --to $SECONDARY
```

The script performs, and logs, the following steps (details in
[secondary-region.md](secondary-region.md#failover)):

1. Select the newest archive in the replica bucket and report its age as the
   expected RPO.
2. Restore it into the secondary data volume.
3. Scale the secondary ECS service to production capacity.
4. Wait for `/ready` on the secondary origin.
5. Repoint Cloudflare `STABLE_ORIGIN` to the secondary origin and disable
   canary.

**Verify:** traffic flows through the Worker to the secondary origin and every
check in [backup-restoration.md](backup-restoration.md#verification) passes.
Post a status-page update.

**Fail back:** see [secondary-region.md](secondary-region.md#failback). Do not
start until the primary region has been stable for 24 h.

## 7. Stellar RPC / Horizon outage

**Detect:** `soroban_rpc_call_latency_seconds` spikes, circuit-breaker-open
metrics rise, and write endpoints return 503.

**Contain:** this is not a DR event for our infrastructure. The circuit breaker
(`server/src/circuit-breaker.js`) sheds load, and reads keep working from the
cache.

**Recover:** if the configured RPC provider is down but the network is up,
switch `STELLAR_RPC_URL` to the fallback provider listed in
[emergency-contacts.md](emergency-contacts.md#external-vendors) and roll the
service. If the Stellar network itself is halted, wait, and communicate through
the status page.

## 8. Credential or key compromise

**Detect:** unexpected admin actions in the audit log, a leaked key reported,
or anomalous traffic from an API key.

**Contain:**

1. Revoke the key: `DELETE /admin/api-keys/{id}`.
2. For a leaked admin key or signing secret, rotate it in the secret manager
   and roll the service.
3. If Cloudflare or AWS credentials leaked, rotate them from the provider
   console and review CloudTrail.

**Recover:** if data was changed, go to **scenario 5** and restore from before
the first malicious action. The Object Lock on the replica bucket means that
backups survive a compromised primary account.

## 9. Cloudflare outage

**Detect:** the edge is unreachable while the origin is healthy when hit
directly.

**Recover:** Cloudflare is the only public ingress. If the outage lasts longer
than the RTO, the IC may decide to expose the origin directly through a
temporary DNS change to the load-balancer address, at registrar level. Doing so
bypasses the edge rate limit and WAF, so the server's own rate limiting and
DDoS protection (`DDOS_PROTECTION_ENABLED=true`) must be on before the switch.

---

## After every incident

- [ ] Record the achieved RTO and RPO against [rpo-rto.md](rpo-rto.md).
- [ ] Hold a blameless post-incident review within 5 business days.
- [ ] Fix any runbook step that was wrong or missing, in the same PR as the
      review notes.
