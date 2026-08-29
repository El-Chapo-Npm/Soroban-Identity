terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
  }
  backend "s3" {}
}
provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = "soroban-identity", Environment = var.environment, ManagedBy = "terraform" } }
}
provider "cloudflare" { api_token = var.cloudflare_api_token }
locals { name = "soroban-identity-${var.environment}" }
module "network" {
  source = "./modules/network"
  name = local.name
  vpc_cidr = var.vpc_cidr
  availability_zones = var.availability_zones
}
module "redis" {
  source = "./modules/redis"
  name = local.name
  subnet_ids = module.network.private_subnet_ids
  security_group_id = module.network.redis_security_group_id
  node_type = var.redis_node_type
  number_cache_clusters = var.redis_replicas
}
module "app" {
  source = "./modules/app"
  name = local.name
  subnet_ids = module.network.private_subnet_ids
  security_group_id = module.network.app_security_group_id
  image = var.app_image
  desired_count = var.app_desired_count
  redis_endpoint = module.redis.endpoint
}
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "availability_zones" { type = list(string) }
variable "vpc_cidr" { type = string }
variable "redis_node_type" { type = string }
variable "redis_replicas" { type = number }
variable "app_image" { type = string }
variable "app_desired_count" { type = number }
variable "cloudflare_api_token" { type = string, sensitive = true, default = "" }
output "redis_endpoint" { value = module.redis.endpoint }
output "app_security_group_id" { value = module.network.app_security_group_id }
