variable "name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "image" { type = string }
variable "desired_count" { type = number }
variable "redis_endpoint" { type = string }

data "aws_region" "current" {}
resource "aws_ecs_cluster" "this" { name = var.name }
resource "aws_iam_role" "task" {
  name = "${var.name}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}
resource "aws_cloudwatch_log_group" "this" {
  name = "/ecs/${var.name}"
  retention_in_days = 30
}
resource "aws_ecs_task_definition" "this" {
  family = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = 512
  memory = 1024
  execution_role_arn = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name = "server"
    image = var.image
    essential = true
    portMappings = [{ containerPort = 3001 }]
    environment = [
      { name = "NODE_ENV", value = var.name },
      { name = "REDIS_URL", value = "rediss://${var.redis_endpoint}:6379" }
    ]
    healthCheck = { command = ["CMD-SHELL", "curl -fsS http://localhost:3001/health || exit 1"], interval = 30, timeout = 5, retries = 3 }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group" = aws_cloudwatch_log_group.this.name
        "awslogs-region" = data.aws_region.current.name
        "awslogs-stream-prefix" = "server"
      }
    }
  }])
}
resource "aws_ecs_service" "this" {
  name = var.name
  cluster = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count = var.desired_count
  launch_type = "FARGATE"
  network_configuration {
    subnets = var.subnet_ids
    security_groups = [var.security_group_id]
    assign_public_ip = false
  }
}
output "cluster_name" { value = aws_ecs_cluster.this.name }
