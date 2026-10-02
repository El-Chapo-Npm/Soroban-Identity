# Emergency Contacts

> **Keep personal details out of git.** This file defines the roles and the
> escalation order. Names, phone numbers and personal emails live in the
> on-call tool (PagerDuty, Opsgenie or similar) and in the team password
> manager entry **"Soroban Identity — DR contacts"**. Fill in the
> _where to find_ column below. Do not paste the numbers themselves.

## Escalation order

| Step | Who | When | Response target |
| --- | --- | --- | --- |
| 1 | Primary on-call engineer | Automatically, from alerts | 15 min |
| 2 | Secondary on-call engineer | Primary has not acknowledged within 15 min | 15 min |
| 3 | Incident Commander (IC) | A DR event is declared, or a customer-visible outage lasts more than 30 min | 30 min |
| 4 | Engineering lead | Region failover, data loss beyond RPO, or a security compromise | 1 h |
| 5 | Security lead | Any credential or key compromise (runbook scenario 8) | 1 h |
| 6 | Project maintainers | Contract-level issue, or a public statement is needed | Best effort |

## Roles

| Role | Responsibility | Where to find the current holder |
| --- | --- | --- |
| On-call (primary / secondary) | First response, runs the runbook | On-call schedule: `soroban-identity-prod` |
| Incident Commander | Owns the incident: decisions, comms, and the declare/stand-down call | On-call schedule: `soroban-identity-ic` |
| Communications | Status page, user-facing updates every 30 min | Named by the IC at incident start |
| Scribe | Timestamped log in the incident channel | Named by the IC at incident start |
| Security lead | Rotation, forensics, disclosure (see `SECURITY.md`) | Password manager entry |

## Channels

| Purpose | Where |
| --- | --- |
| Incident coordination | New channel per incident: `#inc-YYYYMMDD-<slug>` |
| Engineering broadcast | `#eng` |
| Public status | Status page (URL in the password manager entry) |
| Security reports from outside | Per `SECURITY.md` |

## External vendors

| Vendor | Used for | Support route | Account / plan info |
| --- | --- | --- | --- |
| AWS | ECS, ElastiCache, S3, KMS | AWS Support Center → create case (severity "Production system down") | Password manager: "AWS root / support" |
| Cloudflare | Edge Worker, DNS, WAF | Cloudflare dashboard → Support → "Emergency" | Password manager: "Cloudflare" |
| Stellar RPC provider (primary) | `STELLAR_RPC_URL` | Provider status page and support email | Password manager: "RPC providers" |
| Stellar RPC provider (fallback) | Swap in during runbook scenario 7 | As above | As above |
| Stellar network status | Network-level halts | https://status.stellar.org, Stellar Developers Discord | n/a |
| Domain registrar | DNS override when Cloudflare is down (runbook scenario 9) | Registrar support | Password manager: "Registrar" |

## Keeping this current

- The engineering lead reviews this file and the password manager entry every
  quarter, as part of the failover drill (see [failover-testing.md](failover-testing.md)).
- During the drill, the drill lead places one test page through the
  escalation chain, up to step 3, and records whether each step acknowledged
  within its target.
