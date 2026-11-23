#!/usr/bin/env bash
set -euo pipefail

# Keep credentials out of the image and let developers provide a funded testnet
# secret through SOROBAN_SECRET_KEY when they need to deploy contracts.
mkdir -p .devcontainer/data
printf '\n# Soroban Identity helpers\nalias ci="npm run build && cargo test --workspace --manifest-path contracts/Cargo.toml"\nalias docs:dev="npm run docs:dev"\n' >> "$HOME/.bashrc"

rustup target add wasm32v1-none
cargo install --locked stellar-cli --version 23.0.0 || true
npm install
npm install --prefix docs
npm install --prefix frontend
npm install --prefix sdk

cat > .devcontainer/data/testnet.env.example <<'EOF'
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
# SOROBAN_SECRET_KEY=replace-with-a-local-testnet-secret
EOF
