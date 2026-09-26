# ADR-0006: Store claim hashes on-chain, not raw claims

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Credential claims can contain personal data. Ledger data is public and permanent.

## Options considered

1. Store full claims on-chain
2. Store a 32-byte SHA-256 hash on-chain and keep claims off-chain

## Decision

Store only `claims_hash` on-chain. Holders present the full claims off-chain and verifiers compare the hash.

## Consequences

No personal data on the ledger and cheaper storage. Holders must keep their claims, and losing them makes the credential unprovable.

## Related code

`sdk/src/credentials.ts`, `contracts/credential-manager`
