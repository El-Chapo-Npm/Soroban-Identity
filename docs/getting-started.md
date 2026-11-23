# Getting started

## Prerequisites

Use the [Dev Container](../.devcontainer/devcontainer.json) for a consistent Node.js, Rust, Docker, and Stellar CLI environment, or install Node.js 20+, Rust stable, and the Stellar CLI locally.

## Install and build

```bash
npm install
npm run build
cargo test --workspace --manifest-path contracts/Cargo.toml
```

## Run the documentation site

```bash
npm install --prefix docs
npm run dev --prefix docs
```

The site is available at `http://localhost:8787`. Set `VITEPRESS_ALGOLIA_APP_ID`, `VITEPRESS_ALGOLIA_SEARCH_KEY`, and optionally `VITEPRESS_ALGOLIA_INDEX_NAME` to use hosted search; without them, VitePress local search is used.

## Testnet configuration

Copy `.devcontainer/data/testnet.env.example` to a local environment file and provide a funded testnet secret only for local development. Never commit private keys or crawler credentials.
