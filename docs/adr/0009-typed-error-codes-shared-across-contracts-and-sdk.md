# ADR-0009: Typed error codes shared across contracts and SDK

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Opaque contract panics made failures hard to debug from the SDK.

## Options considered

1. String panics
2. A numeric `contracterror` enum mapped to SDK error classes

## Decision

Define error enums in `shared-errors` and map codes to `ContractError` and `SorobanIdentityError` in `sdk/src/error-codes.ts`.

## Consequences

Callers can handle specific failures. Codes must stay stable across releases.

## Related code

`contracts/shared-errors`, `sdk/src/error-codes.ts`
