# Failover Testing

A DR plan that has never been exercised is a guess. We run a drill every quarter and record the measured RPO and RTO against the targets in [README.md](README.md).

## Schedule

| Quarter | Window | Drill type |
| --- | --- | --- |
| Q1 | First Tuesday of January, 14:00 UTC | **Full regional failover** in staging, then failback |
| Q2 | First Tuesday of April | Restore drill (automated) plus scenario C (Redis loss) tabletop |
| Q3 | First Tuesday of July | **Full regional failover** in staging, then failback |
| Q4 | First Tuesday of October | Restore drill (automated) plus scenario D (data corruption) live in staging |

The automated restore drill (`scripts/dr-drill.sh`) also runs from [crontab](crontab) at 06:00 UTC on the first day of each quarter. It posts results to `ALERT_WEBHOOK`.

## Automated restore drill

```bash
infrastructure/dr/scripts/dr-drill.sh                     # restore-only drill (safe, no traffic change)
infrastructure/dr/scripts/dr-drill.sh --full --env staging  # full failover of staging + verification
```

The drill:

1. Measures **achieved RPO**: the age of the newest archive in the secondary bucket.
2. Downloads it, verifies the checksum, and restores it with `scripts/restore.sh` into a scratch directory.
3. Validates the restored data: every JSON file parses and the credentials file is present.
4. With `--full`, runs `failover.sh --execute` against staging, then `verify-recovery.sh`, and measures **achieved RTO**.
5. Appends a row to `drill-log.md`, next to this file, and exits non-zero if either target was missed.

## Full failover drill checklist (staging)

Before:

- [ ] Announce the drill window in the engineering channel 48 h ahead
- [ ] Confirm the staging secondary is provisioned (`terraform plan` in `infrastructure/dr/terraform` shows no drift)
- [ ] Confirm the newest backup is less than 1 h old
- [ ] Assign roles: IC, operator, scribe (timestamps everything)

During:

- [ ] T0: IC declares a simulated region loss. The scribe starts the clock
- [ ] Operator follows [runbook.md § E](runbook.md#e-region-failover) as written, with no improvising. Every deviation is a finding
- [ ] Record the timestamp of each numbered step
- [ ] Run `verify-recovery.sh` against the public staging URL
- [ ] T1: service verified. **RTO = T1 − T0**

After:

- [ ] Fail back using [runbook.md § Failback](runbook.md#failback)
- [ ] Add a row to the drill log below
- [ ] File issues for every gap found. RTO or RPO misses are sev-2
- [ ] Update the runbook in the same week

## Drill log

Automated drills append to `drill-log.md`. Manual drills add a row here.

| Date | Type | Env | Achieved RPO | Achieved RTO | Targets met | Findings / issues |
| --- | --- | --- | --- | --- | --- | --- |
| _next: Q1 drill_ | Full failover | staging | | | | |
