# Changelog and Releases

The changelog is generated automatically by `.github/workflows/changelog.yml`. See [ADR-0011](adr/0011-conventional-commits-and-automated-changelog.md).

## Commit format

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/). PRs are squash-merged, so the title becomes the commit message. CI checks the title.

```
<type>(<optional scope>): <description>

feat(sdk): add verifyMany helper
fix(identity-registry): reject empty metadata keys
feat(credential-manager)!: rename issue to issue_credential
```

| Type | Changelog section |
|------|-------------------|
| `feat` | Features |
| `fix` | Bug Fixes |
| `perf` | Performance |
| `docs` | Documentation |
| `revert` | Reverts |
| `!` or a `BREAKING CHANGE:` footer | ⚠ BREAKING CHANGES |

`refactor`, `chore`, `test`, `ci` and `build` are hidden from the changelog.

Referencing `#123` or `Closes #123` in the PR links the issue in the changelog entry. The PR number is always linked.

## Release flow

1. On each push to `main`, release-please updates an open **release PR** that bumps the version and adds the new `CHANGELOG.md` section.
2. Merging the release PR creates the `vX.Y.Z` tag and publishes the notes to GitHub Releases.
3. The `notify` job posts the release to Discord and Twitter/X when the `DISCORD_WEBHOOK_URL` and `TWITTER_*` secrets are set. It skips them otherwise.

## Breaking changes

Every breaking change needs a migration guide in [`docs/migrations/`](migrations/). Link it in the `BREAKING CHANGE:` footer so it appears in the changelog:

```
BREAKING CHANGE: `issue` is renamed to `issue_credential`. See docs/migrations/v0.2.md
```
