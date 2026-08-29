terraform { backend "s3" {} }
module "platform" { source = "../../"; environment = "production"; aws_region = "us-east-1"; availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]; vpc_cidr = "10.30.0.0/16"; redis_node_type = "cache.r7g.large"; redis_replicas = 3; app_image = "REPLACE_WITH_IMAGE_DIGEST"; app_desired_count = 3 }
