# Blue-green API deployment

The deployment runner in `blue-green.sh` keeps the current color serving requests while it starts the other API container, verifies the candidate, runs a smoke check, and gracefully reloads the shared Nginx router. The Nginx entry point is `http://127.0.0.1:8080`; blue and green are also exposed on loopback ports `3001` and `3002` for health checks. Both application colors use the same Compose project and durable database services.

## Prerequisites

Run from a Linux deployment host with Docker Compose v2, `flock`, `curl`, and an immutable container image already available to the host. The deployment must have a valid, initialized database and the Nginx router configuration directory must remain writable by the deploy user. Before the first rollout, provision both colors with healthy images; the router waits for both API health checks. Keep the origin API ports private; expose the router port through the site's TLS-terminating edge instead.

## Deploy

```bash
IMAGE=ghcr.io/example/soroban-identity@sha256:<image-digest> \
HEALTH_URL=http://127.0.0.1:3002/health \
SMOKE_URL=http://127.0.0.1:3002/info \
HEALTH_ATTEMPTS=30 HEALTH_INTERVAL=5 \
./infrastructure/deployment/blue-green.sh
```

Set `HEALTH_URL` and `SMOKE_URL` to the inactive color's host port before running; the first rollout targets green when the router is on blue. The runner serializes deployments with an OS lock, checks health and a smoke endpoint before switching, writes the active-color state atomically, and updates Nginx with a graceful reload. On failure, it attempts to restore the previous color, roll back a successful migration, and stop the failed candidate. If router recovery cannot be confirmed, it leaves the candidate and migrated schema running and emits a manual-recovery warning rather than risk routing live traffic to an incompatible database. The previously active container remains available after a successful promotion for manual rollback:

```bash
./infrastructure/deployment/traffic-switch.sh blue ./infrastructure/deployment/router.conf
```

For a non-Nginx load balancer, set `TRAFFIC_RELOAD_COMMAND` to the provider's graceful reload/switch operation and set `ACTIVE_UPSTREAM_CONFIG` to an appropriate generated upstream file. The default uses `docker compose exec router nginx -s reload`.

## Database migration safety

Migrations run only when `MIGRATION_COMMAND` is set. In that case, a compatibility gate and a reversible rollback command are mandatory:

```bash
MIGRATION_CHECK_COMMAND='npm run db:migration:check -- --backward-compatible' \
MIGRATION_COMMAND='npm run db:migrate' \
MIGRATION_ROLLBACK_COMMAND='npm run db:migrate:rollback -- --steps 1' \
IMAGE=ghcr.io/example/soroban-identity@sha256:<image-digest> \
HEALTH_URL=http://127.0.0.1:3002/health \
./infrastructure/deployment/blue-green.sh
```

The compatibility check must verify the expand/contract rule: the schema remains readable and writable by both the old and new application versions during overlap. If migration execution fails, the runner immediately invokes the rollback command. If a later health check or cutover fails after migrations succeeded and traffic is confirmed on the prior color, the deployment trap invokes it before exiting. The rollback operation must be safe for the migration tool and must not discard unrelated writes; use transactional/reversible down migrations rather than restoring an entire database snapshot over live data. If router recovery or automatic migration rollback fails, the script emits a manual-recovery warning and exits non-zero.

No migration command means there is no schema change and skips the compatibility check. A configured migration with no compatibility checker or rollback command fails before changing the database.

## Operational state and checks

`COLOR_FILE` defaults to `active-color` beside the scripts. If it does not exist, the runner reads `active=` from `router.conf` (which defaults to blue). `DEPLOYMENT_LOCK_FILE` and `COMPOSE_PROJECT` may be overridden for custom hosts. Router and deployment configuration changes should be reviewed and tested before production use. The helper tests can be run with:

```bash
./infrastructure/deployment/test-deployment.sh
```
