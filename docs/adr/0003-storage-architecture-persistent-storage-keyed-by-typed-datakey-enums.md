# ADR-0003: Storage architecture: persistent storage keyed by typed DataKey enums

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Soroban has instance, persistent and temporary storage with different costs and TTLs. DIDs and credentials must outlive any single transaction.

## Options considered

1. Instance storage for everything
2. Persistent storage with typed keys, instance storage only for config

## Decision

Put admin and config values in instance storage. Put DIDs, credentials, issuers and reputation in persistent storage under `DataKey` enum variants. Extend TTLs on write and read.

## Consequences

Instance storage stays small and cheap to load. Records can expire if nobody extends their TTL, so the SDK and indexer extend TTLs on access.

## Related code

`contracts/identity-registry/src`, `contracts/credential-manager/src`
