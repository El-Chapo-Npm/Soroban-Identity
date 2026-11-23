# Migration guides

Migration guides describe breaking changes by major version. Each guide includes the rationale, before/after examples, compatibility notes, and an explicit checklist.

| Transition | Status | Estimated effort |
| --- | --- | --- |
| v0 → v1 | Supported | 1–2 hours |
| v1 → v2 | Supported | 2–4 hours |
| v2 → v3 | Planned | — |

## Fresh installations

Databases that have never been migrated — for example a brand-new PostgreSQL instance — start with an empty schema and no Flyway schema history table. Without a baseline, the first versioned migration (V1) is treated as a migration against an empty schema and fails.

For fresh installations, configure Flyway to baseline on migrate:

```properties
flyway.baselineOnMigrate=true
flyway.baselineVersion=1
```

With `baselineOnMigrate=true`, Flyway creates a baseline at the configured version instead of failing on the empty schema, so versioned migrations such as V1 apply cleanly.

## Upgrade checklist

1. Read the guide for every major version between your current and target version.
2. Upgrade contracts and SDK packages together; mixed major versions are not supported.
3. Run `npm test` and `cargo test --workspace` before deployment.
4. Deploy to testnet and verify read/write flows with a canary identity.
5. Keep the previous contract IDs available during the rollback window.
6. Record the migration in your release notes and notify integrators through the support channel in the repository issue tracker.

See [v1 → v2](./v1-to-v2) for the detailed guide.
