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
