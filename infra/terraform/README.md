# Soroban Identity infrastructure

This directory is the single source of truth for the AWS application network, ECS service, and encrypted ElastiCache Redis query cache. The same root module is instantiated by `environments/dev`, `environments/staging`, and `environments/production`.

## Remote state and locking

Create the state bucket and lock table once per AWS account, with versioning, default encryption, and public access blocked. Supply the bucket and table through CI secrets or a local backend configuration file; credentials and backend values must never be committed.

```bash
aws s3api create-bucket --bucket "$TF_STATE_BUCKET" --region "$AWS_REGION" --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-bucket-versioning --bucket "$TF_STATE_BUCKET" --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name "$TF_LOCK_TABLE" --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST
```

Initialize an environment with `terraform -chdir=infra/terraform/environments/dev init -backend-config=bucket=... -backend-config=key=soroban-identity/dev.tfstate -backend-config=region=... -backend-config=dynamodb_table=... -backend-config=encrypt=true`. The S3 backend uses the DynamoDB `LockID` table to prevent concurrent plans and applies.

## Workflow

Every pull request touching `infra/terraform` runs formatting, validation, a security scan, and Infracost. The workflow posts the plan and estimated monthly cost as pull-request artifacts; only an explicitly approved protected-branch deployment may apply changes. Promote the same reviewed image digest from dev to staging and production.

Before production provisioning, replace the placeholder image digest and configure the application secrets through the deployment platform’s secret manager. Redis transit and at-rest encryption are enabled by default, and production uses multi-AZ replicas.

## Geo-distributed read replicas

The primary database lives in `us-east-1` and accepts all writes. Read replicas are deployed in three regions so that read-heavy query traffic is served close to the caller.

| Region | Role | Endpoint | Notes |
| --- | --- | --- | --- |
| `us-east-1` | Primary (read/write) | `primary.us-east-1.soroban-identity.internal` | All writes are routed here. |
| `us-east-1` | Read replica | `replica.us-east-1.soroban-identity.internal` | Same-region reads for US traffic. |
| `eu-west-1` | Read replica | `replica.eu-west-1.soroban-identity.internal` | Serves EU traffic. |
| `ap-southeast-1` | Read replica | `replica.ap-southeast-1.soroban-identity.internal` | Serves Asia-Pacific traffic. |

Replica endpoints are published to the application through the `READ_REPLICA_ENDPOINTS` environment variable as a region-to-endpoint map. The Terraform root module exposes the primary endpoint as `primary_endpoint` and the replica map as `read_replica_endpoints` outputs; environment stacks wire those outputs into the ECS task definition.

### Read/write splitting

- Writes, transactions, and any read-after-write path go to the primary endpoint.
- Read-only queries are routed to the nearest healthy replica, selected by the caller’s region from `READ_REPLICA_ENDPOINTS`.
- If no replica is healthy, or the caller’s region has no replica, reads fall back to the primary.
- The application marks a request as read-only explicitly; the router never infers read-only status from the query text.

### Replica lag monitoring

Each replica publishes `Replica.Lag` (seconds behind the primary) to CloudWatch. Alarms fire at 30 seconds (warning) and 120 seconds (critical). When a replica exceeds the critical threshold it is removed from the routing pool until lag recovers below the warning threshold for five consecutive minutes. Lag metrics and alarm state are exported to the shared observability stack.

### Failover

- **Replica failure:** the health check fails, the replica is drained from the routing pool, and reads are served by the next nearest healthy replica or by the primary. No manual action is required.
- **Primary failure:** writes fail fast and the on-call engineer promotes the designated replica following the runbook. Promotion is a manual, reviewed operation; the application must not promote automatically.
- After any failover, update the `primary_endpoint` output and re-apply the affected environment so the application picks up the new endpoint.

### Eventual consistency

Replica reads are eventually consistent. Paths that require read-after-write consistency must read from the primary. The application exposes a consistency hint per request; when it is set, the router bypasses replicas entirely. Replication lag is bounded by the alarms above, and callers that cannot tolerate staleness should not be routed to replicas.
