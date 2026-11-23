# syntax=docker/dockerfile:1
#
# API server image (#883). Build from the repository root so the image can
# include docs/api/swagger.html, which the server serves at /api/docs:
#
#   docker build -f server/Dockerfile -t soroban-identity .
#
# The container reports its health through HEALTHCHECK (see below); probe
# semantics are documented in docs/container-health-checks.md.

FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/server/data
WORKDIR /app/server

COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json server/openapi.json ./
COPY server/src ./src
COPY server/scripts/healthcheck.mjs ./scripts/healthcheck.mjs
COPY docs/api/swagger.html /app/docs/api/swagger.html

RUN mkdir -p "$DATA_DIR" && chown node:node "$DATA_DIR"
USER node

EXPOSE 3001

# Liveness: /live never probes a dependency, so an RPC or Redis outage marks
# the service not-ready (GET /ready) without getting the container restarted.
# --start-period covers startup (Vault, config validation, data dir) before
# failed probes count against --retries.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

# index.js drains in-flight requests on SIGTERM (graceful shutdown, #722).
STOPSIGNAL SIGTERM
CMD ["node", "src/index.js"]
