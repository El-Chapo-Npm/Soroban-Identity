output "cache_ruleset_id" {
  value = cloudflare_ruleset.cache.id
}

output "tiered_cache" {
  value = cloudflare_tiered_cache.smart.cache_type
}
