#!/usr/bin/env bash
# Deploy contracts to an isolated staging (testnet) environment and seed test data.
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE="infrastructure/staging/.env.staging"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
: "${STELLAR_SECRET_KEY:?Set STELLAR_SECRET_KEY (staging key only)}"
export STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"

if [ "$STELLAR_NETWORK" != "testnet" ]; then
  echo "Refusing to deploy staging to non-testnet network: $STELLAR_NETWORK" >&2
  exit 1
fi

OUT="infrastructure/staging/deployment.log"
./scripts/deploy.sh | tee "$OUT"

REGISTRY_ID=$(awk '/^identity-registry:/ {print $2}' "$OUT")
CREDENTIAL_ID=$(awk '/^credential-manager:/ {print $2}' "$OUT")
REPUTATION_ID=$(awk '/^reputation:/ {print $2}' "$OUT")

cat > infrastructure/staging/contracts.staging.json <<JSON
{
  "network": "testnet",
  "identityRegistry": "$REGISTRY_ID",
  "credentialManager": "$CREDENTIAL_ID",
  "reputation": "$REPUTATION_ID"
}
JSON

echo "==> Seeding test data..."
ADMIN=$(stellar keys address "$STELLAR_SECRET_KEY" --network testnet)
stellar contract invoke --id "$CREDENTIAL_ID" --source "$STELLAR_SECRET_KEY" --network testnet \
  -- add_issuer --issuer "$ADMIN"

echo "Staging deployment complete. Contract IDs in infrastructure/staging/contracts.staging.json"
