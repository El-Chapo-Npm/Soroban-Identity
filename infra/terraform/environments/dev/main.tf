terraform { backend "s3" {} }
module "platform" { source = "../../"; environment = "dev"; aws_region = "us-east-1"; availability_zones = ["us-east-1a", "us-east-1b"]; vpc_cidr = "10.10.0.0/16"; redis_node_type = "cache.t4g.micro"; redis_replicas = 1; app_image = "REPLACE_WITH_IMAGE_DIGEST"; app_desired_count = 1 }
