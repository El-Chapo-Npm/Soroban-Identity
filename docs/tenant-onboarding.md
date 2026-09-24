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

### 4. Issuing Credentials within Tenant
When clients make requests, pass the header or call through their subdomain:
```bash
curl -X POST https://fintech.identity.example.com/credentials \
  -H "X-Tenant-Id: fintech-org" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```
The credential is automatically stored in `data/tenants/fintech-org/credentials.json` and tagged with `tenant_id: "fintech-org"`.
