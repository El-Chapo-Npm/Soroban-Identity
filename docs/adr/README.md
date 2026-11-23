# Architecture Decision Records

ADRs record significant technical decisions: the context, the options, and why we chose one.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](./0002-split-the-protocol-into-multiple-soroban-contracts.md) | Split the protocol into multiple Soroban contracts | Accepted |
| [0003](./0003-storage-architecture-persistent-storage-keyed-by-typed-datakey-enums.md) | Storage architecture: persistent storage keyed by typed DataKey enums | Accepted |
| [0004](./0004-authentication-with-soroban-require-auth.md) | Authentication with Soroban `require_auth` | Accepted |
| [0005](./0005-contract-upgrade-strategy-admin-gated-wasm-upgrade.md) | Contract upgrade strategy: admin-gated WASM upgrade | Accepted |
| [0006](./0006-store-claim-hashes-on-chain-not-raw-claims.md) | Store claim hashes on-chain, not raw claims | Accepted |
| [0007](./0007-separate-revocation-registry.md) | Separate revocation registry | Accepted |
| [0008](./0008-typescript-sdk-with-one-client-per-contract.md) | TypeScript SDK with one client per contract | Accepted |
| [0009](./0009-typed-error-codes-shared-across-contracts-and-sdk.md) | Typed error codes shared across contracts and SDK | Accepted |
| [0010](./0010-event-driven-off-chain-indexing.md) | Event-driven off-chain indexing | Accepted |
| [0011](./0011-conventional-commits-and-automated-changelog.md) | Conventional commits and automated changelog | Accepted |

## Proposing a new ADR

1. Copy `template.md` to `NNNN-short-title.md`, using the next free number.
2. Fill it in with status **Proposed** and open a PR with the `adr` label.
3. At least two maintainers review it. Discussion happens on the PR.
4. When approved, set the status to **Accepted**, add it to the index above, and merge.
5. Never delete an ADR. To reverse a decision, write a new ADR and mark the old one **Superseded by ADR-XXXX** or **Deprecated**.

## Linking from code

Reference an ADR in code comments where the decision applies, for example `// See docs/adr/0003-...md`.

## Documentation site

This directory is published with the rest of `docs/` by the docs workflow and linked from the [docs index](../index.md).
