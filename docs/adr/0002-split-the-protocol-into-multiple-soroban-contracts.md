# ADR-0002: Split the protocol into multiple Soroban contracts

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Identity, credentials, revocation, reputation and schemas change at different rates and have different access rules.

## Options considered

1. One monolithic contract
2. Separate contracts that call each other

## Decision

Deploy separate contracts: `identity-registry`, `credential-manager`, `revocation-registry`, `reputation`, `schema-registry` and `selective-disclosure`, with shared types in `soroban-identity-interface`.

## Consequences

Each contract stays under the WASM size budget and can be upgraded independently. Cross-contract calls cost more and deployments must be coordinated.

## Related code

`contracts/`
