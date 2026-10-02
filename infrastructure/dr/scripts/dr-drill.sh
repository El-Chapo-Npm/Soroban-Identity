#!/usr/bin/env bash
# Quarterly DR drill (#945). Measures achieved RPO/RTO against targets and
# appends a row to infrastructure/dr/drill-log.md.
#
# Usage:
#   dr-drill.sh                     restore-only drill (no traffic change)
#   dr-drill.sh --full --env staging  full failover of the given environment
#
# Env: DR_BACKUP_BUCKET_SECONDARY, DR_REGION (restore-only);
#      everything failover.sh needs (--full). ALERT_WEBHOOK optional.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DR_DIR/../.." && pwd)"
LOG_FILE="${DRILL_LOG:-$DR_DIR/drill-log.md}"

FULL=0
ENV_NAME="staging"
while [[ $# -gt 0 ]]; do
  case $1 in
    --full) FULL=1; shift ;;
    --env) ENV_NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ "$FULL" -eq 1 && "$ENV_NAME" == "production" && "${DR_DRILL_ALLOW_PRODUCTION:-}" != "yes" ]]; then
  echo "refusing a full failover drill against production (set DR_DRILL_ALLOW_PRODUCTION=yes)" >&2
  exit 2
fi

RPO_TARGET="${DR_RPO_MINUTES:-60}"
RTO_TARGET="${DR_RTO_MINUTES:-60}"
BUCKET="${DR_BACKUP_BUCKET_SECONDARY:?DR_BACKUP_BUCKET_SECONDARY is required}"
REGION="${DR_REGION:-us-west-2}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '%s [dr-drill] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
findings=()

# 1. Achieved RPO.
rpo="$("$SCRIPT_DIR/verify-recovery.sh" --check-backup-age --bucket "$BUCKET" --max-age-minutes 525600 \
  | sed -n 's/.*archive is \([0-9]*\)m old.*/\1/p')" || true
[[ -n "$rpo" ]] || { findings+=("no archives found"); rpo="n/a"; }
log "achieved RPO: ${rpo}m (target ${RPO_TARGET}m)"
[[ "$rpo" != "n/a" && "$rpo" -gt "$RPO_TARGET" ]] && findings+=("RPO ${rpo}m > ${RPO_TARGET}m")

# 2–3. Restore into scratch and validate.
t0="$(date -u +%s)"
if [[ "$rpo" != "n/a" ]]; then
  latest="$(aws s3 ls "s3://$BUCKET/archives/" --region "$REGION" | awk '{print $4}' | grep '\.tar\.gz$' | sort | tail -n1)"
  aws s3 cp "s3://$BUCKET/archives/$latest" "$WORK/" --region "$REGION" --only-show-errors
  if aws s3 cp "s3://$BUCKET/archives/$latest.sha256" "$WORK/" --region "$REGION" --only-show-errors \
     && (cd "$WORK" && sha256sum -c --quiet "$latest.sha256"); then
    log "checksum ok"
  else
    findings+=("checksum verification failed for $latest")
  fi
  mkdir -p "$WORK/data"
  if "$REPO_ROOT/scripts/restore.sh" "$WORK/$latest" --data-dir "$WORK/data" --config-dir "$WORK/config" --force --quiet; then
    bad=0
    while IFS= read -r f; do
      jq empty "$f" 2>/dev/null || { bad=$((bad + 1)); findings+=("unparseable: ${f#"$WORK/data/"}"); }
    done < <(find "$WORK/data" -name '*.json' -type f)
    [[ -f "$WORK/data/credentials.json" ]] || findings+=("credentials.json missing from archive")
    log "restore validated ($bad bad files)"
  else
    findings+=("restore.sh failed")
  fi
fi
restore_min=$(( ( $(date -u +%s) - t0 + 59 ) / 60 ))

# 4. Optional full failover.
rto="${restore_min} (restore only)"
if [[ "$FULL" -eq 1 ]]; then
  t1="$(date -u +%s)"
  if FAILOVER_TIMINGS="$WORK/timings.jsonl" "$SCRIPT_DIR/failover.sh" --execute; then
    rto_min=$(( ( $(date -u +%s) - t1 + 59 ) / 60 ))
    rto="$rto_min"
    (( rto_min <= RTO_TARGET )) || findings+=("RTO ${rto_min}m > ${RTO_TARGET}m")
  else
    rto="failed"
    findings+=("failover.sh failed; see timings")
  fi
fi
log "achieved RTO: ${rto}m (target ${RTO_TARGET}m)"

# 5. Record.
met="yes"
[[ ${#findings[@]} -eq 0 ]] || met="no"
summary="$(IFS='; '; echo "${findings[*]:-none}")"
if [[ ! -f "$LOG_FILE" ]]; then
  printf '# DR Drill Log\n\nAppended by `scripts/dr-drill.sh`. See failover-testing.md.\n\n| Date | Type | Env | Achieved RPO | Achieved RTO | Targets met | Findings |\n| --- | --- | --- | --- | --- | --- | --- |\n' > "$LOG_FILE"
fi
printf '| %s | %s | %s | %sm | %sm | %s | %s |\n' "$(date -u +%Y-%m-%d)" \
  "$([[ $FULL -eq 1 ]] && echo 'Full failover' || echo 'Restore')" "$ENV_NAME" "$rpo" "$rto" "$met" "$summary" >> "$LOG_FILE"
log "recorded in $LOG_FILE"

if [[ -n "${ALERT_WEBHOOK:-}" ]]; then
  curl -fsS -m 10 -X POST "$ALERT_WEBHOOK" -H 'Content-Type: application/json' \
    -d "{\"text\":\"[dr-drill] $ENV_NAME: RPO ${rpo}m, RTO ${rto}m, targets met: $met. Findings: $summary\"}" >/dev/null 2>&1 || true
fi

[[ "$met" == "yes" ]]
