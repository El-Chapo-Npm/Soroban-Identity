# ADR-0010: Event-driven off-chain indexing

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Querying lists such as credentials by issuer is expensive on-chain.

## Options considered

1. Iterate storage from RPC
2. Emit contract events and index them off-chain

## Decision

Contracts emit structured events. The server indexes them for list and search queries.

## Consequences

List queries are fast. The index is eventually consistent and must be rebuildable from events.

## Related code

`docs/contract-events.md`, `docs/claim-indexing.md`, `server/`
