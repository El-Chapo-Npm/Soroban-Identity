terraform {
  backend "s3" {}
}

locals {
  # Replication topology (see docs/replication-topology.md):
  #   Primary (writer): us-east-1
  #   Read replicas:    us-east-1 (same-region), eu-west-1, ap-southeast-1
  #   Failover:         replica failure -> route reads to primary; primary failure -> promote replica
  read_replicas = {
    us = {
      region             = "us-east-1"
      availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
      instance_class     = "db.r7g.2xlarge"
      replica_count      = 2
      priority           = 1
    }
    eu = {
      region             = "eu-west-1"
      availability_zones = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
      instance_class     = "db.r7g.xlarge"
      replica_count      = 2
      priority           = 2
    }
    asia = {
      region             = "ap-southeast-1"
      availability_zones = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
      instance_class     = "db.r7g.xlarge"
      replica_count      = 2
      priority           = 3
    }
  }
}

module "platform" {
  source     = "../../"
  environment = "production"
  aws_region  = "us-east-1"

  availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
  vpc_cidr           = "10.30.0.0/16"

  redis_node_type = "cache.r7g.large"
  redis_replicas  = 3

  app_image         = "REPLACE_WITH_IMAGE_DIGEST"
  app_desired_count = 3

  # --- Geo-distributed read replicas (#1051) ---
  enable_read_replicas = true
  read_replicas        = local.read_replicas

  # Read/write splitting: writers hit the primary endpoint, readers are routed
  # to the nearest healthy replica.
  enable_read_write_splitting = true
  read_routing_strategy       = "nearest"

  # Replica lag monitoring: alarm when a replica falls behind the primary.
  replica_lag_monitoring_enabled = true
  replica_lag_threshold_seconds  = 30
  replica_lag_alarm_actions      = []

  # Failover: on replica failure, reads fall back to the primary; on primary
  # failure, the highest-priority healthy replica is promoted.
  replica_failover_enabled       = true
  failover_to_primary_on_replica_failure = true
  primary_failover_priority_order        = ["us", "eu", "asia"]

  # Eventual consistency handling for cross-region reads.
  eventual_consistency_mode = "session"
  read_after_write_timeout  = 5
}