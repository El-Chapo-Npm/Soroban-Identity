# ADR-0008: TypeScript SDK with one client per contract

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

dApp developers need a typed interface and should not have to build XDR by hand.

## Options considered

1. One large client class
2. A shared `BaseClient` with `IdentityClient`, `CredentialClient` and `ReputationClient`

## Decision

Ship `@soroban-identity/sdk` with one client per contract. All clients share `BaseClient` for RPC failover, retries and transaction submission, and take one `SorobanIdentityConfig`.

## Consequences

Clear boundaries and tree-shakeable imports. Features that span contracts must use several clients.

## Related code

`sdk/src/base-client.ts`
