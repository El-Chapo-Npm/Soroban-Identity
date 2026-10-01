# Security Policy

## Reporting a vulnerability
Do not open a public issue. Use **GitHub Security Advisories** instead: go to the *Security* tab and choose *Report a vulnerability*. We will reply within 72 hours.

## Dependency update process
| Update type | Policy |
|---|---|
| Patch | Dependabot opens a PR. It auto-merges once CI passes (`dependabot-auto-merge.yml`) |
| Minor | Dependabot opens a grouped PR. One maintainer reviews it |
| Major | Dependabot opens its own PR. Two maintainers review it and it gets a changelog check |
| Security advisory | A maintainer triages it within 48 hours. If it is critical, a fix ships within 7 days |

- **Dependabot** (`.github/dependabot.yml`) scans npm (root, frontend, server, sdk, docs), Cargo (contracts) and GitHub Actions every week. Related packages are grouped into one PR.
- **Snyk** (`.github/workflows/snyk.yml`) runs on every PR and push to `main`. It fails on high or critical issues and uploads SARIF to code scanning. It also runs monthly to produce an audit report artifact.
- **Slack:** when Snyk finds a critical vulnerability, it posts to `SLACK_SECURITY_WEBHOOK_URL`.

The repository secrets needed are `SNYK_TOKEN` and `SLACK_SECURITY_WEBHOOK_URL`.
