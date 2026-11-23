# Backup Restoration Procedures

This covers each data store: what is backed up, where the backups live, and how to restore them. For the mechanics of the backup scripts themselves, see [docs/backup-restore.md](../../docs/backup-restore.md).

## Backup inventory

| Store | Backup | Frequency | Location | Retention |
| --- | --- | --- | --- | --- |
| Data directory (`DATA_DIR`) plus Redis dump plus env config | `scripts/backup.sh` archive (`soroban-identity-backup-<ts>.tar.gz`) | Hourly (`backup-and-ship.sh`) | `s3://$DR_BACKUP_BUCKET_PRIMARY/archives/`, replicated to `s3://$DR_BACKUP_BUCKET_SECONDARY/archives/` | 30 days local. S3 lifecycle: 35 days |
| Redis (standalone or self-hosted) | `infrastructure/backup/backup.sh` (`redis-<host>-<ts>.rdb.gz`) | Daily at 02:00 UTC | `s3://$S3_BUCKET/db-backups/` | 30 days |
| ElastiCache | Automatic snapshots | Daily | AWS-managed, per region | 7 days (`snapshot_retention_limit`) |
| Terraform state | S3 versioned bucket | Every apply | State bucket | Versioned |

## Before any restore

1. **Pick the recovery point.** Use the newest archive unless the incident is data corruption. For corruption, pick the last archive taken before it started (check `manifest.json` → `created_at`).
2. **Stop writers.** Scale the target ECS service to 0, or put the API into maintenance, so nothing writes to the data directory mid-restore.
3. **Record the time** you started. The RTO measurement starts at the disaster declaration, but log each step's timing as you go.

## 1. Fetch the archive

```bash
export AWS_REGION=us-west-2                      # region you are restoring INTO
BUCKET="$DR_BACKUP_BUCKET_SECONDARY"             # or _PRIMARY if the primary region is healthy
LATEST=$(aws s3 ls "s3://$BUCKET/archives/" | awk '{print $4}' | grep '\.tar\.gz$' | sort | tail -n1)
aws s3 cp "s3://$BUCKET/archives/$LATEST" /tmp/restore/
aws s3 cp "s3://$BUCKET/archives/$LATEST.sha256" - | (cd /tmp/restore && sha256sum -c -)
mkdir -p /tmp/restore/staging && tar -xzf "/tmp/restore/$LATEST" -C /tmp/restore/staging   # inspect manifest.json
```

## 2. Restore the data directory

Run this from an ops host (or a one-off ECS task) that has the target region's data volume mounted at `$DR_DATA_DIR`:

```bash
scripts/restore.sh "/tmp/restore/$LATEST" --data-dir "$DR_DATA_DIR" --dry-run   # inspect first
scripts/restore.sh "/tmp/restore/$LATEST" --data-dir "$DR_DATA_DIR" --force --config-dir /tmp/restore/config
```

`--force` moves the existing contents aside to `<data-dir>.pre-restore-<ts>` instead of deleting them. Keep that directory until the recovery is verified.

**Verify:** each JSON file under `$DR_DATA_DIR` parses (`find "$DR_DATA_DIR" -name '*.json' -exec jq empty {} +`). Record the credential count (`jq length "$DR_DATA_DIR/credentials.json"`); step 5 checks it again through the API.

## 3. Restore Redis

Redis holds caches, counters, and queues. It can be rebuilt, so **skip this step when meeting the RTO is at risk.** The service starts with a cold cache and empty queues. Replay any jobs that were lost from the webhook and notification logs.

**ElastiCache in the same region** (for example, after data corruption): recreate the replication group from the latest automatic snapshot.

```bash
SNAP=$(aws elasticache describe-snapshots --region "$AWS_REGION" \
  --replication-group-id soroban-identity-production --query 'Snapshots[-1].SnapshotName' --output text)
aws elasticache create-replication-group --region "$AWS_REGION" \
  --replication-group-id soroban-identity-production-restored \
  --replication-group-description "restored from $SNAP" --snapshot-name "$SNAP" \
  --cache-node-type cache.r7g.large --engine redis --transit-encryption-enabled --at-rest-encryption-enabled
```

**ElastiCache in the secondary region:** ElastiCache does not accept `CONFIG`/`DEBUG RELOAD`, so `scripts/restore.sh --redis-url` cannot load a dump into it. Seed a new replication group from the archive's `redis-dump.rdb` instead:

```bash
aws s3 cp /tmp/restore/staging/redis-dump.rdb "s3://$DR_BACKUP_BUCKET_SECONDARY/redis-seed/redis-dump.rdb"
aws elasticache create-replication-group --region us-west-2 \
  --replication-group-id soroban-identity-dr-seeded --replication-group-description "DR seed" \
  --snapshot-arns "arn:aws:s3:::$DR_BACKUP_BUCKET_SECONDARY/redis-seed/redis-dump.rdb" \
  --cache-node-type cache.r7g.large --engine redis --transit-encryption-enabled --at-rest-encryption-enabled
```

The bucket policy must grant `elasticache.amazonaws.com` read access to that object. After seeding, point `REDIS_URL` at the new group.

**Self-hosted Redis:** `scripts/restore.sh --redis-url "$REDIS_URL"` loads the archive's `redis-dump.rdb`. To restore a daily `infrastructure/backup` dump by hand instead:

```bash
redis-cli -u "$REDIS_URL" SHUTDOWN NOSAVE    # or systemctl stop redis
gunzip -c redis-<host>-<ts>.rdb.gz > /var/lib/redis/dump.rdb
chown redis:redis /var/lib/redis/dump.rdb
systemctl start redis
redis-cli -u "$REDIS_URL" DBSIZE
```

## 4. Restore config and secrets

Canonical secrets live in the secret manager for the target region. Treat the `config/` directory in the archive as a **reference only**:

- Diff it against the target task definition's environment.
- Copy across any values that are missing.
- Never commit it.
- Shred it when done: `shred -u /tmp/restore/config/*`.

Values that differ between regions and must be set for the secondary:

- `REDIS_URL`
- `DATA_DIR`
- `CORS_ALLOWED_ORIGINS` if origins are region-specific
- webhook signing secrets (the same values; confirm they are replicated)

## 5. Verify

```bash
infrastructure/dr/scripts/verify-recovery.sh --url "https://$DR_ORIGIN" \
  --expect-credentials "$(jq length "$DR_DATA_DIR/credentials.json")"
```

It checks `/health`, `/ready`, `/live`, and `/info`, that the credential total (`pagination.total_count`) is at least the expected count, and that responses carry `X-Correlation-ID`.

## Point-in-time recovery for corruption

For data that is corrupted rather than lost:

1. Find the first bad write in the audit logs (`/admin/audit-logs`) or by correlation ID (see [docs/request-tracing.md](../../docs/request-tracing.md)).
2. Restore the newest archive older than that write.
3. Replay legitimate writes made after it from the audit log. Credential issuance and revocation are also on-chain, so the credential index can be rebuilt from contract events: set `EXPIRY_EVENTS_START_LEDGER` to the ledger at the recovery point.
