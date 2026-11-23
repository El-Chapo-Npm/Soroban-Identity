#!/usr/bin/env bash
set -Eeuo pipefail

# Expand/contract rule: the new schema must remain usable by both blue and
# green while they overlap. A configured migration is never run without an
# explicit compatibility check.
if [[ -z "${MIGRATION_COMMAND:-}" ]]; then
  echo 'No database migration configured; compatibility check is not needed.'
  exit 0
fi

if [[ -n "${MIGRATION_CHECK_COMMAND:-}" ]]; then
  bash -Eeuo pipefail -c "$MIGRATION_CHECK_COMMAND"
elif [[ -n "${MIGRATION_CHECK_SCRIPT:-}" && -x "${MIGRATION_CHECK_SCRIPT}" ]]; then
  "${MIGRATION_CHECK_SCRIPT}" --backward-compatible
else
  echo 'MIGRATION_COMMAND is set, but no compatibility checker is configured.' >&2
  echo 'Set MIGRATION_CHECK_COMMAND or MIGRATION_CHECK_SCRIPT before deploying.' >&2
  exit 2
fi
