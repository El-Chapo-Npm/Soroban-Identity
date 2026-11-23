resource "aws_cloudwatch_log_metric_filter" "ddos_events" {
  name = "${var.name}-ddos-events"
  log_group_name = aws_cloudwatch_log_group.this.name
  pattern = "DDoS protection event"
  metric_transformation {
    name = "DdosProtectionEvents"
    namespace = "SorobanIdentity/Security"
    value = "1"
  }
}
resource "aws_cloudwatch_metric_alarm" "ddos_events" {
  alarm_name = "${var.name}-ddos-events"
  namespace = "SorobanIdentity/Security"
  metric_name = "DdosProtectionEvents"
  statistic = "Sum"
  period = 60
  evaluation_periods = 5
  threshold = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data = "notBreaching"
  alarm_description = "DDoS protection events exceeded the configured threshold; inspect Cloudflare and origin controls."
}
resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  alarm_name = "${var.name}-ecs-cpu"
  namespace = "AWS/ECS"
  metric_name = "CPUUtilization"
  dimensions = { ClusterName = aws_ecs_cluster.this.name, ServiceName = aws_ecs_service.this.name }
  statistic = "Average"
  period = 60
  evaluation_periods = 5
  threshold = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data = "notBreaching"
}

# Read replica lag monitoring. Alerts when replication lag on any regional
# read replica exceeds the configured threshold, which indicates the replica
# is falling behind the primary and may serve stale data.
resource "aws_cloudwatch_metric_alarm" "replica_lag" {
  for_each = toset(var.read_replica_regions)

  alarm_name = "${var.name}-replica-lag-${each.key}"
  namespace = "AWS/RDS"
  metric_name = "ReplicaLag"
  dimensions = {
    DBInstanceIdentifier = "${var.name}-replica-${each.key}"
  }
  statistic = "Average"
  period = 60
  evaluation_periods = 5
  threshold = var.replica_lag_threshold_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data = "notBreaching"
  alarm_description = "Read replica in ${each.key} has replication lag above ${var.replica_lag_threshold_seconds}s; queries routed to this replica may return stale data."
}

# Replica health monitoring. Alerts when a regional read replica becomes
# unhealthy so traffic can be failed over to the primary.
resource "aws_cloudwatch_metric_alarm" "replica_unhealthy" {
  for_each = toset(var.read_replica_regions)

  alarm_name = "${var.name}-replica-unhealthy-${each.key}"
  namespace = "AWS/RDS"
  metric_name = "DatabaseConnections"
  dimensions = {
    DBInstanceIdentifier = "${var.name}-replica-${each.key}"
  }
  statistic = "Average"
  period = 60
  evaluation_periods = 3
  threshold = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data = "breaching"
  alarm_description = "Read replica in ${each.key} appears unhealthy (no active connections); failover to primary may be required."
}

# Failover event monitoring. Alerts whenever a replica failover to the
# primary is triggered so operators can investigate the root cause.
resource "aws_cloudwatch_log_metric_filter" "replica_failover" {
  name = "${var.name}-replica-failover"
  log_group_name = aws_cloudwatch_log_group.this.name
  pattern = "Replica failover to primary"
  metric_transformation {
    name = "ReplicaFailoverEvents"
    namespace = "SorobanIdentity/Replication"
    value = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "replica_failover" {
  alarm_name = "${var.name}-replica-failover"
  namespace = "SorobanIdentity/Replication"
  metric_name = "ReplicaFailoverEvents"
  statistic = "Sum"
  period = 60
  evaluation_periods = 1
  threshold = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data = "notBreaching"
  alarm_description = "A read replica failover to the primary occurred; verify replication topology and replica health."
}