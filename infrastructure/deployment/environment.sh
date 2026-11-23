#!/usr/bin/env bash
set -Eeuo pipefail
cmd="${1:?up|stop}"
color="${2:?blue|green}"
image="${3:-}"
case "$color" in blue|green) ;; *) exit 2 ;; esac
project="${COMPOSE_PROJECT:-soroban-identity}"
compose_file="$(dirname "$0")/docker-compose.yml"
case "$cmd" in
  up)
    [[ -n "$image" ]] || { echo 'image required' >&2; exit 2; }
    IMAGE="$image" docker compose -f "$compose_file" -p "$project" up -d --no-build --force-recreate "$color"
    docker compose -f "$compose_file" -p "$project" up -d --no-build router
    ;;
  stop)
    # Both application colors use the same compose project and thus the same
    # durable database services; stopping a color must not stop its database.
    docker compose -f "$compose_file" -p "$project" stop "$color"
    ;;
  *) exit 2 ;;
esac
