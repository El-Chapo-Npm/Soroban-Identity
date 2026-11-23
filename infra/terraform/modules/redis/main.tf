variable "name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "node_type" { type = string }
variable "number_cache_clusters" { type = number }

resource "aws_elasticache_subnet_group" "this" {
  name = var.name
  subnet_ids = var.subnet_ids
}
resource "aws_elasticache_replication_group" "this" {
  replication_group_id = replace(var.name, "_", "-")
  description = "Soroban Identity query cache"
  engine = "redis"
  engine_version = "7.2"
  node_type = var.node_type
  num_cache_clusters = var.number_cache_clusters
  port = 6379
  subnet_group_name = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.security_group_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.number_cache_clusters > 1
  snapshot_retention_limit = 7
  multi_az_enabled = var.number_cache_clusters > 1
}
output "endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
