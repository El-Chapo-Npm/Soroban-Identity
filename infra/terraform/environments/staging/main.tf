terraform { backend "s3" {} }
module "platform" { source = "../../"; environment = "staging"; aws_region = "us-east-1"; availability_zones = ["us-east-1a", "us-east-1b"]; vpc_cidr = "10.20.0.0/16"; redis_node_type = "cache.t4g.small"; redis_replicas = 2; app_image = "REPLACE_WITH_IMAGE_DIGEST"; app_desired_count = 2 }
