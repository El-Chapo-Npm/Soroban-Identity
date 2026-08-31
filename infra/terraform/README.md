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
