# DR backup buckets with cross-region replication (#959).
# See ../backup-restoration.md.

provider "aws" {
  alias  = "primary"
  region = var.primary_region
  default_tags { tags = { Project = "soroban-identity", Environment = var.environment, ManagedBy = "terraform", Purpose = "dr" } }
}

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region
  default_tags { tags = { Project = "soroban-identity", Environment = var.environment, ManagedBy = "terraform", Purpose = "dr" } }
}

locals {
  bucket_prefix = "soroban-identity-dr-backups"
}

resource "aws_kms_key" "primary" {
  provider            = aws.primary
  description         = "DR backup encryption (${var.primary_region})"
  enable_key_rotation = true
}

resource "aws_kms_key" "secondary" {
  provider            = aws.secondary
  description         = "DR backup encryption (${var.secondary_region})"
  enable_key_rotation = true
}

# ── Primary bucket: every archive is uploaded here ─────────────────────────
resource "aws_s3_bucket" "primary" {
  provider = aws.primary
  bucket   = "${local.bucket_prefix}-${var.primary_region}"
}

# ── Replica bucket: object-locked so a compromised primary cannot purge it ─
resource "aws_s3_bucket" "secondary" {
  provider            = aws.secondary
  bucket              = "${local.bucket_prefix}-${var.secondary_region}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_object_lock_configuration" "secondary" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 30
    }
  }
}

resource "aws_s3_bucket_versioning" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_versioning" "secondary" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.primary.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "secondary" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.secondary.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "primary" {
  provider                = aws.primary
  bucket                  = aws_s3_bucket.primary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "secondary" {
  provider                = aws.secondary
  bucket                  = aws_s3_bucket.secondary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  rule {
    id     = "expire-old-archives"
    status = "Enabled"
    filter { prefix = "archives/" }
    expiration { days = 90 }
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "secondary" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary.id
  rule {
    id     = "expire-old-archives"
    status = "Enabled"
    filter { prefix = "archives/" }
    expiration { days = 90 }
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

# ── Replication (S3 RTC: 99.99% of objects within 15 minutes) ──────────────
resource "aws_iam_role" "replication" {
  provider = aws.primary
  name     = "${local.bucket_prefix}-replication"
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
        Resource = [aws_s3_bucket.primary.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
        Resource = ["${aws_s3_bucket.primary.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Resource = ["${aws_s3_bucket.secondary.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.primary.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [aws_kms_key.secondary.arn]
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "primary_to_secondary" {
  provider   = aws.primary
  depends_on = [aws_s3_bucket_versioning.primary, aws_s3_bucket_versioning.secondary]
  role       = aws_iam_role.replication.arn
  bucket     = aws_s3_bucket.primary.id

  rule {
    id     = "dr-replica"
    status = "Enabled"
    filter { prefix = "archives/" }
    delete_marker_replication { status = "Disabled" }

    source_selection_criteria {
      sse_kms_encrypted_objects { status = "Enabled" }
    }

    destination {
      bucket        = aws_s3_bucket.secondary.arn
      storage_class = "STANDARD_IA"
      encryption_configuration { replica_kms_key_id = aws_kms_key.secondary.arn }
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

# Alert when replication falls behind the 15-minute RPO budget.
resource "aws_cloudwatch_metric_alarm" "replication_latency" {
  provider            = aws.primary
  alarm_name          = "${local.bucket_prefix}-replication-latency"
  namespace           = "AWS/S3"
  metric_name         = "ReplicationLatency"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 900
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    SourceBucket      = aws_s3_bucket.primary.id
    DestinationBucket = aws_s3_bucket.secondary.id
    RuleId            = "dr-replica"
  }
}

output "primary_backup_bucket" { value = aws_s3_bucket.primary.id }
output "secondary_backup_bucket" { value = aws_s3_bucket.secondary.id }
