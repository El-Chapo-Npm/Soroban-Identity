# Emergency Contacts

**Keep this list current.** The DR plan owner reviews it every quarter as part of the drill (see [failover-testing.md](failover-testing.md)). Anyone whose on-call status or contact details change must update it in the same week.

Store personal phone numbers in the pager tool, not in this repository. This file lists roles, pager handles, and where to find each person.

## Escalation path

1. **Primary on-call.** Paged automatically by alerts. Acknowledge within 5 min.
2. **Secondary on-call.** Auto-paged if the primary does not acknowledge within 15 min.
3. **Incident commander (IC).** The only role that can declare a SEV-1 or approve a regional failover.
4. **Engineering lead, then leadership.** For SEV-1 incidents lasting more than 1 h or involving data loss.

## Roles

| Role | Name | Pager / handle | Backup |
| --- | --- | --- | --- |
| DR plan owner | _TBD_ | _@handle_ | _TBD_ |
| Incident commander rotation | _pager schedule: `soroban-identity-ic`_ | | |
| Primary on-call (platform) | _pager schedule: `soroban-identity-primary`_ | | |
| Secondary on-call (platform) | _pager schedule: `soroban-identity-secondary`_ | | |
| Smart contract owner | _TBD_ | _@handle_ | _TBD_ |
| Security contact | See [SECURITY.md](../../SECURITY.md) | | |
| Communications / status page | _TBD_ | _@handle_ | _TBD_ |

## Vendors

| Vendor | What for | Support channel | Account / plan ID |
| --- | --- | --- | --- |
| AWS | ECS, ElastiCache, S3, EFS | AWS Support Console, Business plan | _account ID in password manager_ |
| Cloudflare | DNS, CDN, WAF | Cloudflare dashboard → Support | _zone ID in password manager_ |
| Soroban RPC provider (primary) | `STELLAR_RPC_URL` | _TBD_ | |
| Soroban RPC provider (secondary) | Failover RPC endpoint | _TBD_ | |
| Pager tool | Paging and schedules | _TBD_ | |

## Where things are

| Item | Location |
| --- | --- |
| Backup buckets (primary / secondary) | `DR_BACKUP_BUCKET_PRIMARY` / `DR_BACKUP_BUCKET_SECONDARY` in the ops secret store |
| Cloudflare API token for DNS failover | Ops secret store: `cloudflare/dns-failover` |
| Terraform state | S3 state bucket (see `infra/terraform/README.md`) |
| Incident channel | _#incident-soroban-identity_ |
| Status page | _TBD_ |

## Review log

| Date | Reviewer | Changes |
| --- | --- | --- |
| 2026-09-27 | — | Initial template (#945) |
