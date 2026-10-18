# Multi-Tenant Architecture & Onboarding Guide

## Overview
Soroban Identity supports multi-tenancy with namespace isolation, enabling SaaS deployments where multiple organizations share a single backend cluster while maintaining complete cryptographic, data, quota, and rate-limiting separation.

## Key Capabilities
1. **Namespace Isolation**: Each tenant has dedicated storage paths (`/data/tenants/<tenant_id>/`), separating credentials, audit trails, and webhooks.
2. **Tenant Resolution**:
   - HTTP Header: `X-Tenant-Id: <tenant_id>`
   - Subdomain routing: `<tenant_id>.identity.example.com`
   - JWT Claim: `tenant_id` claim in Authorization Bearer tokens
   - Default: `default` system tenant
3. **Custom Contract Addresses**:
   - Each tenant can point to organization-specific Soroban contract addresses (`Identity Registry`, `Credential Manager`, `Reputation`).
4. **Tenant-Specific Rate Limits & Quotas**:
   - Configurable per-tenant tiers (`free`, `pro`, `enterprise`) or custom read/write limits per minute.
5. **Auditing & Context**:
   - Every audit log entry records `tenant_id` for compliance and forensic isolation.

---

## Onboarding a New Tenant

### 1. Provision Tenant via API
Send a `POST /api/v1/tenants` request (superadmin authorization):

```bash
curl -X POST https://api.identity.example.com/api/v1/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "id": "fintech-org",
    "name": "Fintech Global Inc",
    "subdomain": "fintech",
    "tier": "enterprise",
    "contracts": {
      "identityRegistry": "CBA...FINTECH_REGISTRY",
      "credentialManager": "CBA...FINTECH_CREDENTIAL",
      "reputation": "CBA...FINTECH_REPUTATION"
    },
    "rateLimits": {
      "readsPerMinute": 1200,
      "writesPerMinute": 500
    },
    "quotas": {
      "maxCredentials": 100000,
      "maxDids": 50000
    },
    "admins": ["admin@fintech.example.com"]
  }'
```

### 2. DNS & Subdomain Setup
Point `fintech.identity.example.com` CNAME to your gateway or ingress proxy. Requests arriving at `fintech.identity.example.com` will automatically be resolved to tenant `fintech-org`.

### 3. Manage Tenant Admins
Add an additional admin:
```bash
curl -X POST https://api.identity.example.com/api/v1/tenants/fintech-org/admins \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{ "email": "security-officer@fintech.example.com" }'
```

### 4. Configure Resource Limits & Quotas
Resource limits are enforced per tenant at the API gateway and storage layers. Update them at any time:

```bash
curl -X PATCH https://api.identity.example.com/api/v1/tenants/fintech-org/limits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "tier": "enterprise",
    "rateLimits": {
      "readsPerMinute": 1200,
      "writesPerMinute": 500
    },
    "quotas": {
      "maxCredentials": 100000,
      "maxDids": 50000,
      "maxStorageBytes": 10737418240
    }
  }'
```

| Tier | Reads/min | Writes/min | Max Credentials | Max DIDs |
|------|-----------|------------|-----------------|----------|
| `free` | 60 | 20 | 1,000 | 500 |
| `pro` | 600 | 200 | 25,000 | 10,000 |
| `enterprise` | custom | custom | custom | custom |

When a tenant exceeds a quota, write requests return `429 Too Many Requests` with a `Retry-After` header; quota exhaustion returns `403 Forbidden` with error code `TENANT_QUOTA_EXCEEDED`.

### 5. Tenant-Specific Customization
Each tenant can override branding, contract addresses, webhook endpoints, and feature flags without affecting other tenants:

```bash
curl -X PATCH https://api.identity.example.com/api/v1/tenants/fintech-org/customization \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "branding": {
      "displayName": "Fintech Global Identity",
      "logoUrl": "https://fintech.example.com/logo.png",
      "primaryColor": "#0A5CFF"
    },
    "contracts": {
      "identityRegistry": "CBA...FINTECH_REGISTRY",
      "credentialManager": "CBA...FINTECH_CREDENTIAL",
      "reputation": "CBA...FINTECH_REPUTATION"
    },
    "webhooks": {
      "credentialIssued": "https://fintech.example.com/hooks/credential-issued"
    },
    "features": {
      "reputationEnabled": true,
      "bulkIssuance": true
    }
  }'
```

Customization values are stored under `/data/tenants/<tenant_id>/config.json` and are resolved at request time after tenant resolution.

### 6. Cross-Tenant Isolation Guarantees
- **Storage isolation**: every read/write is scoped to `/data/tenants/<tenant_id>/`; paths are derived from the resolved tenant, never from client-supplied input.
- **Query isolation**: all database queries are filtered by `tenant_id`; a request can never read or mutate another tenant's records.
- **Cryptographic isolation**: signing keys and contract addresses are per-tenant; credentials issued by one tenant cannot be verified under another tenant's registry.
- **Audit isolation**: every audit entry records `tenant_id`, and audit queries are restricted to the caller's tenant.
- **Rate-limit isolation**: quotas and rate-limit counters are tracked per tenant, so one tenant cannot exhaust another's capacity.
- **Header/claim validation**: a mismatch between the `X-Tenant-Id` header, the subdomain, and the JWT `tenant_id` claim results in `403 Forbidden` with error code `TENANT_MISMATCH`.

### 7. Issuing Credentials within Tenant
When clients make requests, pass the header or call through their subdomain:
```bash
curl -X POST https://fintech.identity.example.com/credentials \
  -H "X-Tenant-Id: fintech-org" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```
The credential is automatically stored in `data/tenants/fintech-org/credentials.json` and tagged with `tenant_id: "fintech-org"`.

### 8. Tenant Credentials & API Keys
Issue tenant-scoped API keys for machine clients. Keys are bound to a single tenant and cannot be used against another tenant's endpoints:

```bash
curl -X POST https://api.identity.example.com/api/v1/tenants/fintech-org/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "name": "issuance-service",
    "scopes": ["credentials:write", "credentials:read"],
    "expiresInDays": 90
  }'
```

The response contains the plaintext key exactly once; store it securely. Revoke a key with:

```bash
curl -X DELETE https://api.identity.example.com/api/v1/tenants/fintech-org/api-keys/<KEY_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### 9. Offboarding
To deprovision a tenant, suspend it first (blocks all requests with `403 Forbidden`), then delete it after the retention window:

```bash
curl -X POST https://api.identity.example.com/api/v1/tenants/fintech-org/suspend \
  -H "Authorization: Bearer <ADMIN_TOKEN>"

curl -X DELETE https://api.identity.example.com/api/v1/tenants/fintech-org \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Deletion removes `/data/tenants/fintech-org/` and all associated records. Export tenant data before deletion if retention is required.
