# ADR-0011: Conventional commits and automated changelog

- **Status:** Accepted
- **Date:** 2026-09-25 (recorded retroactively)
- **Deciders:** Soroban Identity maintainers

## Context

Release notes were written by hand and often incomplete.

## Options considered

1. Hand-written changelog
2. Conventional commits plus release-please

## Decision

Require conventional commit PR titles and generate `CHANGELOG.md` and GitHub Releases with release-please.

## Consequences

Consistent release notes. Contributors must follow the commit format, which CI enforces on PR titles.

## Related code

`.github/workflows/changelog.yml`
