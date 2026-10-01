# ADR-0004: Authentication with Soroban `require_auth`

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Contracts must prove the caller controls a DID or is an authorized issuer.

## Options considered

1. Custom signature checks inside the contract
2. Native `Address::require_auth`

## Decision

Use `require_auth` on the controller, issuer or admin address for every state-changing call. Credential signatures that must be checked off-chain use ed25519 in addition.

## Consequences

Wallets and multisig accounts work out of the box. Authorization rules sit in the host, so they are harder to customize.

## Related code

`contracts/*/src/lib.rs`
