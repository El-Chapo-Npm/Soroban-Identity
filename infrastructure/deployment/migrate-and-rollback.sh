#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo 'Usage: migrate-and-rollback.sh apply|rollback' >&2; exit 2; }
[[ $# -eq 1 ]] || usage
ACTION="$1"
case "$ACTION" in
  apply)
    if [[ -z "${MIGRATION_COMMAND:-}" ]]; then
      echo 'No MIGRATION_COMMAND configured; skipping database migrations.'
      exit 0
    fi
    if [[ -z "${MIGRATION_ROLLBACK_COMMAND:-}" ]]; then
      echo 'MIGRATION_ROLLBACK_COMMAND is required whenever MIGRATION_COMMAND is set.' >&2
      exit 2
    fi
    echo 'Applying database migrations.'
    if bash -Eeuo pipefail -c "$MIGRATION_COMMAND"; then
      echo 'Database migrations completed successfully.'
      exit 0
    else
      migration_status=$?
      echo "Migration command failed with status $migration_status; executing rollback." >&2
      if ! bash -Eeuo pipefail -c "$MIGRATION_ROLLBACK_COMMAND"; then
        echo 'Automatic migration rollback failed; manual database recovery is required.' >&2
        exit 81
      fi
      echo 'Automatic migration rollback completed.' >&2
      # Reserved status lets the deployment wrapper know the down migration
      # already ran, so its failure trap does not execute it a second time.
      exit 80
    fi
    ;;
  rollback)
    if [[ -z "${MIGRATION_COMMAND:-}" ]]; then
      echo 'No migration was configured; nothing to roll back.'
      exit 0
    fi
    if [[ -z "${MIGRATION_ROLLBACK_COMMAND:-}" ]]; then
      echo 'MIGRATION_ROLLBACK_COMMAND is required to roll back this deployment.' >&2
      exit 2
    fi
    echo 'Executing database migration rollback.' >&2
    bash -Eeuo pipefail -c "$MIGRATION_ROLLBACK_COMMAND"
    ;;
  *) usage ;;
esac
