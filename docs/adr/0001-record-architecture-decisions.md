# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Decisions were scattered across PRs and issues, so new contributors could not tell why the system looks the way it does.

## Options considered

1. Keep decisions in PR descriptions only
2. Keep lightweight Markdown ADRs in `docs/adr/`

## Decision

Use numbered Markdown ADRs in `docs/adr/`, following `template.md`.

## Consequences

Decisions become searchable and reviewable. Authors spend a little extra time per significant change.

## Related code

`docs/adr/`
