#!/usr/bin/env bash
# Regenerates the TypeScript, Python and Go API clients using the official
# openapi-generator Docker image. No local Java installation is required.
#
# Usage: ./tools/codegen/scripts/generate-docker.sh [typescript|python|go|all]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="7.25.0"
IMAGE="openapitools/openapi-generator-cli:v${VERSION}"
SPEC="${ROOT}/spec/openapi.json"

GENERATORS=("$1" "all")
generator=${GENERATORS[0]}

run_generate() {
  local -r generator="$1"
  echo "=== Generating ${generator} client ==="
  docker run --rm \
    -v "${ROOT}:/local" \
    "${IMAGE}" generate \
    --input-spec "/local/spec/openapi.json" \
    --generator-name "${generator}" \
    --output "/local/generated/${generator}" \
    --config "/local/config/${generator}.yaml"
}

if [[ "$generator" == "all" || "$generator" == "" ]]; then
  run_generate "typescript"
  run_generate "python"
  run_generate "go"
else
  case "$generator" in
    typescript|python|go) run_generate "$generator" ;;
    *) echo "Unknown generator: ${generator}" >&2; exit 1 ;;
  esac
fi

echo
echo "Done. Regenerated clients are under ${ROOT}/generated/"