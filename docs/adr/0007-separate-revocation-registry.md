# ADR-0007: Separate revocation registry

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Revocation must be checkable cheaply and in bulk by verifiers who do not need full credentials.

## Options considered

1. A revoked flag on each credential
2. A dedicated revocation registry contract

## Decision

Track revocations in `revocation-registry`, exposed as revocation lists.

## Consequences

Verifiers can fetch revocation lists cheaply. Revoking takes a cross-contract call.

## Related code

`contracts/revocation-registry`
