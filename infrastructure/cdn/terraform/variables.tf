variable "cloudflare_api_token" {
  description = "API token with Zone Settings:Edit and Cache Rules:Edit on the zone"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID of the domain serving the frontend"
  type        = string
}

variable "app_hostname" {
  description = "Custom hostname of the frontend, e.g. app.example.com"
  type        = string
}

variable "hashed_asset_ttl" {
  description = "Edge TTL in seconds for content-hashed files under /assets/"
  type        = number
  default     = 31536000 # 1 year
}
