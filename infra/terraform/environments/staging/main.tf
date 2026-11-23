terraform { backend "s3" {} }

module "platform" {
  source             = "../../"
  environment        = "staging"
  aws_region         = "us-east-1"
  availability_zones = ["us-east-1a", "us-east-1b"]
  vpc_cidr           = "10.20.0.0/16"
  redis_node_type    = "cache.t4g.small"
  redis_replicas     = 2
  app_image          = "REPLACE_WITH_IMAGE_DIGEST"
  app_desired_count  = 2

  # Geo-distributed read replicas (staging subset for testing).
  # Primary stays in us-east-1; read replicas are deployed in eu-west-1 and
  # ap-southeast-1 so read/write splitting, nearest-replica routing, replica
  # lag monitoring, and failover-to-primary can be exercised before prod.
  enable_read_replicas = true
  read_replicas = [
    {
      name              = "staging-eu"
      region            = "eu-west-1"
      availability_zones = ["eu-west-1a", "eu-west-1b"]
      vpc_cidr          = "10.21.0.0/16"
      instance_class    = "db.t4g.small"
      replica_count     = 1
      # Route reads from EU clients to this replica.
      route_reads       = true
      # Fall back to the primary (us-east-1) if this replica fails or lags.
      failover_to_primary = true
      max_replica_lag_seconds = 30
    },
    {
      name              = "staging-ap"
      region            = "ap-southeast-1"
      availability_zones = ["ap-southeast-1a", "ap-southeast-1b"]
      vpc_cidr          = "10.22.0.0/16"
      instance_class    = "db.t4g.small"
      replica_count     = 1
      route_reads       = true
      failover_to_primary = true
      max_replica_lag_seconds = 30
    },
  ]

  # Read/write splitting: writes always go to the primary; reads are routed to
  # the nearest healthy replica. Eventual consistency is handled by falling back
  # to the primary for reads that require read-after-write guarantees.
  read_write_splitting = {
    enabled                 = true
    route_reads_to_nearest  = true
    consistency_mode        = "eventual"
    read_after_write_primary = true
  }

  # Replica lag monitoring and alerting.
  replica_lag_monitoring = {
    enabled                 = true
    evaluation_periods      = 3
    period_seconds          = 60
    warning_threshold_seconds  = 15
    critical_threshold_seconds = 30
    alarm_actions           = []
  }
}