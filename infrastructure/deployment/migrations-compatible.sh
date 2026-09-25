#!/usr/bin/env bash
set -Eeuo pipefail
# Expand/contract rule: migrations must be additive while both colors are live.
if [[ -n "${MIGRATION_CHECK_COMMAND:-}" ]]; then
  eval "$MIGRATION_CHECK_COMMAND"
elif [[ -x "${MIGRATION_CHECK_SCRIPT:-}" ]]; then
  "$MIGRATION_CHECK_SCRIPT" --backward-compatible
else
  echo 'No migration checker configured; assuming schema is backward compatible.'
fi
