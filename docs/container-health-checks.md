# Container health checks

How the API server reports its health to Docker, docker-compose, Kubernetes and ECS, and how to check that a failing container is replaced (#883).

## Endpoints

The server exposes three probe endpoints. None of them needs authentication, a request signature, or rate-limit budget.

| Endpoint | Question it answers | Checks | Fails with |
|---|---|---|---|
| `GET /live` | Is the process running and able to answer? | Nothing outside the process | No response (hung or crashed process) |
| `GET /ready` | Can this instance serve requests right now? | Data directory writable, Soroban RPC reachable | `503` with `failing: [...]` |
| `GET /health` | Full status report | Storage, RPC, contracts, Redis (when configured), with latency and version | `503` when any configured dependency is down, `200` with `status: "degraded"` for a partial outage |

Which endpoint to use depends on what happens on failure:

- **Restart the container:** use `/live`. An RPC or Redis outage affects every replica alike, so restarting them doesn't help and only adds a cold start. Liveness must stay green through dependency outages.
- **Stop routing traffic to the instance:** use `/ready`.
- **Judge a deployment or page someone:** use `/health`, which has the detail.

## Where each probe is configured

| Consumer | File | Endpoint | Settings |
|---|---|---|---|
| Docker `HEALTHCHECK` | `server/Dockerfile` | `/live` | every 30 s, 5 s timeout, 3 retries, 30 s start period |
| docker-compose blue/green | `infrastructure/deployment/docker-compose.yml` | `/live` | every 10 s, 5 s timeout, 3 retries, 30 s start period, `restart: unless-stopped` |
| Kubernetes startup probe | `infra/kubernetes/canary/rollout.yaml` | `/live` | every 2 s, up to 30 failures (60 s to boot) |
| Kubernetes readiness probe | same | `/ready` | every 10 s, 3 s timeout, 3 failures |
| Kubernetes liveness probe | same | `/live` | every 20 s, 3 s timeout, 3 failures |
| ECS task health check | `infra/terraform/modules/app/main.tf` | `/live` | every 30 s, 5 s timeout, 3 retries, 30 s start period |
| Argo canary analysis | `infra/kubernetes/canary/rollout.yaml` | `/health` | `$.status == "healthy"`, 5 samples |
| Blue/green cutover gate | `infrastructure/deployment/blue-green.sh` | `HEALTH_URL` | the URL you pass in; point it at `/health` or `/ready` |

Docker, compose and ECS run the probe inside the container with `node scripts/healthcheck.mjs`, because `node:20-alpine` has no `curl` or `wget`. The script exits `0` on a 2xx response and `1` on anything else, including timeouts and refused connections. It takes these settings:

| Setting | Default | Purpose |
|---|---|---|
| Path argument | `/live` | Endpoint to probe, e.g. `node scripts/healthcheck.mjs /ready` |
| `PORT` | `3001` | Port the server listens on |
| `HEALTHCHECK_PATH` | `/live` | Endpoint to probe when no path argument is given |
| `HEALTHCHECK_URL` | unset | Full URL; overrides the port and path |
| `HEALTHCHECK_TIMEOUT_MS` | `3000` | Request timeout |

Kubernetes probes over HTTP directly and doesn't need the script.

The Kubernetes pod and compose services allow 35 s for shutdown, 5 s more than the server's graceful shutdown timeout (`SHUTDOWN_TIMEOUT_MS`, 30 s). This lets in-flight requests drain before the container is killed.

## Building and running the image

Build from the repository root, because the image includes `docs/api/swagger.html`:

```bash
docker build -f server/Dockerfile -t soroban-identity .
docker run -d --name api -p 3001:3001 --env-file server/.env soroban-identity
docker inspect --format '{{json .State.Health}}' api   # status, streak, last probe output
```

The container runs as the unprivileged `node` user and writes data to `/app/server/data` (`DATA_DIR`). Mount a volume there to keep data across restarts. `server/Dockerfile.dockerignore` limits the build context to the files the image needs.

## Restart on failure

A failing health check has different effects depending on the platform:

- **Docker / docker-compose:** marks the container `unhealthy`. **Docker does not restart unhealthy containers.** The `restart: unless-stopped` policy only restarts a container whose process exited. To restart unhealthy containers, run under an orchestrator (Swarm, Kubernetes, ECS) or add an autoheal sidecar.
- **Kubernetes:**
  - A liveness failure restarts the container and increments `restartCount`.
  - A readiness failure removes the pod from the Service endpoints until it recovers.
  - Until the startup probe passes, the other two probes are not run.
- **ECS:** an unhealthy essential container stops the task, and the service starts a replacement.

### Verifying

The server runs as PID 1 in its container. The kernel ignores `SIGSTOP` and `SIGKILL` sent to PID 1 from inside its own PID namespace, so `docker exec ... kill -STOP 1` does nothing. Send those signals from outside the namespace instead.

To simulate a **hung process**, pause the Node process. The TCP socket stays open but nothing answers, which is exactly what `/live` exists to catch:

```bash
docker kill --signal=SIGSTOP api                    # sent by the daemon, outside the container
docker inspect --format '{{.State.Health.Status}}' api   # "unhealthy" after about 3 x 30 s
docker kill --signal=SIGCONT api
```

On Kubernetes, send the same signal to the container's host PID from the node:
1. Find the PID with `crictl inspect --output go-template --template '{{.info.pid}}' <container-id>`.
2. Run `kill -STOP <pid>`.
3. Watch `kubectl get pods -l app=soroban-identity -w`: after 3 x 20 s the liveness probe fails, the container restarts, `RESTARTS` goes up by 1, and `kubectl describe pod` shows `Liveness probe failed` events.

To simulate a **crashed process**, stop it with `SIGTERM`. The server handles it, shuts down and exits. `restart: unless-stopped` and Kubernetes both bring it back:

```bash
docker exec api kill -TERM 1
docker inspect --format '{{.RestartCount}}' api   # goes up by 1
kubectl exec deploy/soroban-identity -- kill -TERM 1
```

To simulate a **dependency outage**, point `SOROBAN_RPC_URL` at an unreachable host:
- `/ready` and `/health` return `503`.
- `/live` stays `200`.
- Kubernetes takes the pod out of rotation without restarting it.

### Tests

`.github/workflows/container-health.yml` runs whenever the image or probe files change. It builds the image and runs it with a stub `/live` server in place of the API process, keeping the image's own `HEALTHCHECK`. It then checks that the container becomes healthy, turns unhealthy when the process is frozen with `SIGSTOP`, recovers after `SIGCONT`, and is restarted by `restart: unless-stopped` after the process exits.


`server/test/healthcheck.test.js` runs `scripts/healthcheck.mjs` against a stub server. It covers 2xx, 503, a request that never answers, a refused connection and a malformed URL, both through `checkHealth` and through the CLI's exit code. Run it with:

```bash
cd server && node --test test/healthcheck.test.js
```
