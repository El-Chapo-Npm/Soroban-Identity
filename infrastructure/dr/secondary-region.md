# Secondary Region

| | Primary | Secondary |
| --- | --- | --- |
| Region | `us-east-1` | `us-west-2` |
| Terraform | `infra/terraform/environments/production` | `infrastructure/dr/terraform` |
| VPC CIDR | `10.30.0.0/16` | `10.40.0.0/16` (no overlap, so the two can be peered later) |
| ECS service | 3 tasks | **0 tasks** (scaled up on failover) |
| Redis | `cache.r7g.large` × 3 | `cache.r7g.large` × 2, empty |
| Backups bucket | `soroban-identity-dr-backups-us-east-1` | `soroban-identity-dr-backups-us-west-2` (replica) |
| Read replicas | `us-east-1` (writer) | `us-west-2`, `eu-west-1`, `ap-southeast-1` |

## Strategy: warm standby (pilot light)

The secondary region runs the same root module as production. Networking,
the ECS cluster, the task definition and Redis are all provisioned and kept in
sync by Terraform, and only the task count stays at zero. This keeps the
standby cost to Redis plus NAT, while failover only has to scale ECS instead of
creating infrastructure mid-incident.

We chose this over active-active because the data directory is file-based and
single-writer. Running two writers in two regions would diverge. Revisit the
decision once `DATA_DIR` moves to a store that supports multi-region writes.

## Read replicas

Reads are served from regional replicas so that queries do not have to cross
an ocean to reach `us-east-1`. The writer stays single, in the primary region.

| Region | Role | Endpoint | Notes |
| --- | --- | --- | --- |
| `us-east-1` | writer + replica | `soroban-identity-primary` | Authoritative. All writes land here. |
| `us-west-2` | replica | `soroban-identity-replica-us-west-2` | Also the DR target region. |
| `eu-west-1` | replica | `soroban-identity-replica-eu-west-1` | |
| `ap-southeast-1` | replica | `soroban-identity-replica-ap-southeast-1` | |

### Read/write splitting

The application decides where a query goes from the request, not from a
hard-coded host:

- Anything that mutates state (writes, deletes, transactions) is pinned to the
  writer. The writer connection is never load-balanced.
- Reads go to the replica nearest the caller, resolved from the request's
  region hint, falling back to the writer when no replica is healthy.
- A read that must observe its own write (read-after-write) is pinned to the
  writer for a short window after the write. This is the escape hatch for the
  eventual consistency described below.

### Replica lag and eventual consistency

Replication is asynchronous, so a replica can be behind the writer. The
application tolerates this:

- Every read response carries the replica's lag. Callers that need a
  consistent read must opt in to the writer.
- If a replica's lag exceeds the configured threshold it is taken out of the
  read pool until it catches up. Reads then fall through to the next nearest
  replica, and finally to the writer.
- Lag is exported as a metric per replica and alerted on. A replica that is
  lagging is a performance problem, not a correctness one, because the writer
  remains the source of truth.

### Failover interaction

Read replicas are independent of the DR failover path, and this is deliberate:

- **Replica failure:** a replica going down only removes it from the read
  pool. No failover is triggered; the writer is unaffected and reads fall
  through to the next nearest replica. This is the "failover to primary"
  behaviour for reads.
- **Writer failure:** the existing warm-standby failover below still applies.
  `us-west-2` is both a read replica and the DR target, so on failover it is
  promoted to writer and the remaining replicas (`eu-west-1`,
  `ap-southeast-1`) re-point at it. The `us-east-1` replica is not used while
  the primary is down.
- **Failback:** when the primary returns, it is re-established as the writer
  and the replicas re-point back. Replicas are rebuilt from the restored
  archive rather than caught up, so no replica can serve stale data from
  before the incident.

Because replicas are read-only, they never hold data that is not also on the
writer, so a replica can be discarded and rebuilt at any time without a
recovery procedure.

## Keeping it in sync

- **Infrastructure:** every production `terraform apply` must be followed by an
  apply of `infrastructure/dr/terraform`. Both are driven by the same root
  module, so drift shows up in `terraform plan`.
- **Image:** set `app_image` to the same digest as production. The
  secondary task definition must never lag behind, or failover ships old code.
- **Secrets:** replicate the secret-manager entries to `us-west-2`. Secrets
  Manager supports multi-region replicas natively. Enable them.
- **Data:** hourly archives replicate through S3 CRR ([terraform/backups.tf](terraform/backups.tf)).
- **Replicas:** the replica set is declared in the same root module, so a
  production apply that changes the topology must be followed by the DR apply
  as usual. Replica endpoints are published to the application through the
  same configuration mechanism as the writer endpoint.

## Setup

```bash
cd infrastructure/dr/terraform
terraform init \
  -backend-config=bucket="$TF_STATE_BUCKET" \
  -backend-config=key=soroban-identity/dr-us-west-2.tfstate \
  -backend-config=region=us-east-1 \
  -backend-config=dynamodb_table="$TF_LOCK_TABLE" \
  -backend-config=encrypt=true
terraform apply -var app_image="$PRODUCTION_IMAGE_DIGEST"
```

State for the secondary region lives in the primary region's state bucket. If
`us-east-1` is down, you cannot `terraform apply` there, which is why nothing
in the failover path depends on Terraform. The scripts only use the AWS CLI
and Wrangler.

## Failover

`scripts/failover.sh --to us-west-2` runs these steps. To do it by hand:

1. **Freeze the primary** (if it is reachable) so it stops taking writes:
   `aws ecs update-service --region us-east-1 ... --desired-count 0`.
2. **Restore data** into the secondary:
   `scripts/recover.sh --region us-west-2 --no-scale`.
3. **Scale up:**
   `aws ecs update-service --region us-west-2 --cluster soroban-identity-dr --service soroban-identity-dr --desired-count 3`
   and wait for `services-stable`.
4. **Check the secondary origin:** `curl -fsS $SECONDARY_ORIGIN/ready`.
5. **Move traffic** by repointing the Worker's stable origin:

   ```bash
   cd infra/cloudflare
   printf '%s' "$SECONDARY_ORIGIN" | npx wrangler secret put STABLE_ORIGIN
   npx wrangler deploy --var CANARY_ENABLED:false
   ```

6. **Re-point replicas:** update the replica configuration so `eu-west-1` and
   `ap-southeast-1` follow the promoted `us-west-2` writer. Until this is
   done, those replicas serve reads from the old topology and should be
   treated as lagging.
7. **Announce:** post to the status page and the incident channel with the
   achieved RPO, which is the age of the restored archive.

## Failback

Wait until the primary region has been healthy for 24 h. Then:

1. Take a fresh backup **from the secondary**:
   `scripts/ship-backup.sh --bucket soroban-identity-dr-backups-us-west-2`.
   The secondary has been the writer, so its data is now authoritative.
2. Scale the secondary to 0 (a brief write freeze, announced in advance).
3. `scripts/recover.sh --region us-east-1 --bucket soroban-identity-dr-backups-us-west-2`.
4. Repoint `STABLE_ORIGIN` back to the primary origin.
5. Re-point the replicas back at the `us-east-1` writer and let them rebuild
   from the restored archive.
6. Confirm the primary is healthy, and leave the secondary at 0.

The write freeze in step 2 is the only user-visible downtime during failback.
Schedule it for low traffic.
