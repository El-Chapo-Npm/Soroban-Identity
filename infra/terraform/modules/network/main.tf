variable "name" { type = string }
variable "vpc_cidr" { type = string }
variable "availability_zones" { type = list(string) }

variable "region" {
  type        = string
  description = "AWS region this network is deployed in (e.g. us-east-1, eu-west-1, ap-southeast-1)"
}

variable "replica_regions" {
  type        = map(string)
  description = "Map of peer region name to that region's VPC CIDR for cross-region replication traffic"
  default     = {}
}

variable "transit_gateway_id" {
  type        = string
  description = "Shared transit gateway ID used to connect regional VPCs for replication"
  default     = ""
}

variable "replication_ports" {
  type        = list(number)
  description = "Ports used for cross-region database/redis replication traffic"
  default     = [5432, 6379]
}

variable "replica_dns_name" {
  type        = string
  description = "DNS name used to resolve the nearest read replica endpoint"
  default     = ""
}

resource "aws_vpc" "this" {
  cidr_block = var.vpc_cidr
  enable_dns_support = true
  enable_dns_hostnames = true
}
resource "aws_internet_gateway" "this" { vpc_id = aws_vpc.this.id }
resource "aws_subnet" "private" {
  count = length(var.availability_zones)
  vpc_id = aws_vpc.this.id
  cidr_block = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone = var.availability_zones[count.index]
  tags = { Name = "${var.name}-private-${count.index + 1}" }
}
resource "aws_subnet" "public" {
  count = length(var.availability_zones)
  vpc_id = aws_vpc.this.id
  cidr_block = cidrsubnet(var.vpc_cidr, 4, count.index + length(var.availability_zones))
  availability_zone = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${var.name}-public-${count.index + 1}" }
}
resource "aws_security_group" "app" {
  name = "${var.name}-app"
  vpc_id = aws_vpc.this.id
  ingress {
    from_port = 3001
    to_port = 3001
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "redis" {
  name = "${var.name}-redis"
  vpc_id = aws_vpc.this.id
  ingress {
    from_port = 6379
    to_port = 6379
    protocol = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Security group for cross-region replication traffic between regional VPCs.
resource "aws_security_group" "replication" {
  name        = "${var.name}-replication"
  description = "Cross-region replication traffic for read replicas"
  vpc_id      = aws_vpc.this.id

  dynamic "ingress" {
    for_each = var.replication_ports
    content {
      description = "Replication traffic from peer regions"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = values(var.replica_regions)
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-replication" }
}

# Attach this VPC to the shared transit gateway for inter-region connectivity.
resource "aws_ec2_transit_gateway_vpc_attachment" "this" {
  count              = var.transit_gateway_id == "" ? 0 : 1
  transit_gateway_id = var.transit_gateway_id
  vpc_id             = aws_vpc.this.id
  subnet_ids         = aws_subnet.private[*].id

  tags = { Name = "${var.name}-tgw-attachment" }
}

# VPC peering fallback when no transit gateway is configured.
resource "aws_vpc_peering_connection" "peer" {
  for_each    = var.transit_gateway_id == "" ? var.replica_regions : {}
  vpc_id      = aws_vpc.this.id
  peer_vpc_id = each.value
  peer_region = each.key
  auto_accept = false

  tags = { Name = "${var.name}-peer-${each.key}" }
}

# Private DNS zone so replica endpoints resolve to the nearest regional replica.
resource "aws_route53_zone" "replica" {
  count = var.replica_dns_name == "" ? 0 : 1
  name  = var.replica_dns_name

  vpc {
    vpc_id = aws_vpc.this.id
  }

  tags = { Name = "${var.name}-replica-dns" }
}

resource "aws_route53_record" "replica_reader" {
  count   = var.replica_dns_name == "" ? 0 : 1
  zone_id = aws_route53_zone.replica[0].zone_id
  name    = "reader.${var.replica_dns_name}"
  type    = "CNAME"
  ttl     = 30
  records = ["replica.${var.region}.${var.replica_dns_name}"]
}

output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "app_security_group_id" { value = aws_security_group.app.id }
output "redis_security_group_id" { value = aws_security_group.redis.id }
output "replication_security_group_id" { value = aws_security_group.replication.id }
output "transit_gateway_attachment_id" {
  value = var.transit_gateway_id == "" ? null : aws_ec2_transit_gateway_vpc_attachment.this[0].id
}
output "vpc_peering_connection_ids" { value = { for k, v in aws_vpc_peering_connection.peer : k => v.id } }
output "replica_dns_zone_id" {
  value = var.replica_dns_name == "" ? null : aws_route53_zone.replica[0].zone_id
}
