# ADR-0005: Contract upgrade strategy: admin-gated WASM upgrade

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Bugs and new features require changing deployed contracts without losing state or contract IDs.

## Options considered

1. Redeploy and migrate data
2. In-place `update_current_contract_wasm` gated by admin auth

## Decision

Each contract exposes an admin-only `upgrade` entry point that swaps the WASM hash in place. Storage layout changes need a migration step, documented in `docs/migrations/`.

## Consequences

Contract IDs and data survive upgrades. The admin key is a single point of trust and should be a multisig in production.

## Related code

`contracts/`, `docs/migrations/`
