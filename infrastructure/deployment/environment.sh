#!/usr/bin/env bash
set -Eeuo pipefail
cmd="${1:?up|stop}"; color="${2:?blue|green}"; image="${3:-}"
case "$color" in blue|green) ;; *) exit 2 ;; esac
name="soroban-identity-$color"
case "$cmd" in
  up) [[ -n "$image" ]] || { echo 'image required' >&2; exit 2; }; IMAGE="$image" docker compose -f "$(dirname "$0")/docker-compose.yml" -p "$name" up -d --no-build --force-recreate "$color" ;;
  stop) docker compose -f "$(dirname "$0")/docker-compose.yml" -p "$name" stop "$color" ;;
  *) exit 2 ;;
esac
