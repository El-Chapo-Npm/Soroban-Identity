# Secondary-region (pilot light) infrastructure for disaster recovery (#945).
#
# Reuses the platform root module in infra/terraform so the standby region
# is identical to production except for scale: the ECS service runs at 0
# tasks until failover.sh scales it up. Also provisions the backup buckets
# and cross-region replication that the hourly backup-and-ship job writes to.
#
# terraform -chdir=infrastructure/dr/terraform init -backend-config=... \
#   -backend-config=key=soroban-identity/dr.tfstate
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {}
}

variable "environment" {
  type    = string
  default = "production"
}
variable "primary_region" {
  type    = string
  default = "us-east-1"
}
variable "dr_region" {
  type    = string
  default = "us-west-2"
}
variable "dr_availability_zones" {
  type    = list(string)
  default = ["us-west-2a", "us-west-2b", "us-west-2c"]
}
variable "dr_vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "app_image" { type = string }
variable "backup_retention_days" {
  type    = number
  default = 35
}

provider "aws" {
  alias  = "primary"
  region = var.primary_region
  default_tags { tags = { Project = "soroban-identity", Environment = var.environment, ManagedBy = "terraform", DR = "primary" } }
}
provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags { tags = { Project = "soroban-identity", Environment = var.environment, ManagedBy = "terraform", DR = "secondary" } }
}

locals {
  name = "soroban-identity-${var.environment}"
}

# ── Standby platform in the DR region (pilot light) ─────────────────────────

# infra/terraform configures its own aws provider from `aws_region`, so the
# DR region is selected through that variable rather than a providers map.
module "dr_platform" {
  source = "../../../infra/terraform"

  environment        = "${var.environment}-dr"
  aws_region         = var.dr_region
  availability_zones = var.dr_availability_zones
  vpc_cidr           = var.dr_vpc_cidr
  # Smallest footprint that still restores into ElastiCache; scale on failover.
  redis_node_type   = "cache.r7g.large"
  redis_replicas    = 1
  app_image         = var.app_image
  app_desired_count = 0
}

# ── Backup buckets with cross-region replication ─────────────────────────────

resource "aws_s3_bucket" "backups_primary" {
  provider = aws.primary
  bucket   = "${local.name}-backups-${var.primary_region}"
}
resource "aws_s3_bucket" "backups_dr" {
  provider = aws.dr
  bucket   = "${local.name}-backups-${var.dr_region}"
}

resource "aws_s3_bucket_versioning" "backups_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.backups_primary.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_versioning" "backups_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.backups_dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.backups_primary.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" }
  }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "backups_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.backups_dr.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" }
  }
}

resource "aws_s3_bucket_public_access_block" "backups_primary" {
  provider                = aws.primary
  bucket                  = aws_s3_bucket.backups_primary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_public_access_block" "backups_dr" {
  provider                = aws.dr
  bucket                  = aws_s3_bucket.backups_dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.backups_primary.id
  rule {
    id     = "expire-archives"
    status = "Enabled"
    filter { prefix = "archives/" }
    expiration { days = var.backup_retention_days }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "backups_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.backups_dr.id
  rule {
    id     = "expire-archives"
    status = "Enabled"
    filter { prefix = "archives/" }
    expiration { days = var.backup_retention_days }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }
}

resource "aws_iam_role" "replication" {
  provider = aws.primary
  name     = "${local.name}-backup-replication"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "replication" {
  provider = aws.primary
  role     = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Resource = aws_s3_bucket.backups_primary.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
        Resource = "${aws_s3_bucket.backups_primary.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Resource = "${aws_s3_bucket.backups_dr.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "backups" {
  provider   = aws.primary
  depends_on = [aws_s3_bucket_versioning.backups_primary, aws_s3_bucket_versioning.backups_dr]
  role       = aws_iam_role.replication.arn
  bucket     = aws_s3_bucket.backups_primary.id

  rule {
    id     = "replicate-backups-to-dr"
    status = "Enabled"
    filter {}
    delete_marker_replication { status = "Disabled" }
    source_selection_criteria {
      sse_kms_encrypted_objects { status = "Enabled" }
    }
    destination {
      bucket        = aws_s3_bucket.backups_dr.arn
      storage_class = "STANDARD_IA"
      encryption_configuration { replica_kms_key_id = "alias/aws/s3" }
      # Replication Time Control: 99.99% of objects within 15 minutes, which
      # keeps the replicated copy well inside the 1h RPO.
      replication_time {
        status = "Enabled"
        time { minutes = 15 }
      }
      metrics {
        status = "Enabled"
        event_threshold { minutes = 15 }
      }
    }
  }
}

output "backup_bucket_primary" { value = aws_s3_bucket.backups_primary.bucket }
output "backup_bucket_dr" { value = aws_s3_bucket.backups_dr.bucket }
output "dr_redis_endpoint" { value = module.dr_platform.redis_endpoint }
