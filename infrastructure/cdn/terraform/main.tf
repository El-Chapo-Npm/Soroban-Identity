# Zone-level CDN configuration for the frontend.
#
# The frontend itself is published to Cloudflare Pages and fronted by the
# edge worker in infra/cloudflare (see docs/cdn-and-canary-deployments.md).
# Pages already serves from Cloudflare's edge; this module tunes the zone
# that the custom app hostname lives in: protocol and compression settings,
# tiered caching, and edge TTLs for Vite's content-hashed assets.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  app_host = "(http.host eq \"${var.app_hostname}\")"

  # Vite emits content-hashed filenames under /assets/, so they never change.
  hashed_assets = "${local.app_host} and starts_with(http.request.uri.path, \"/assets/\")"

  # The HTML entry point and SPA routes must always revalidate.
  html = "${local.app_host} and not starts_with(http.request.uri.path, \"/assets/\") and not http.request.uri.path.extension in {\"js\" \"css\" \"woff2\" \"wasm\" \"png\" \"jpg\" \"jpeg\" \"gif\" \"svg\" \"webp\" \"ico\" \"br\" \"gz\"}"
}

# ── Zone performance settings ─────────────────────────────────────────────────
# These apply to the whole zone, not only the app hostname.

resource "cloudflare_zone_settings_override" "performance" {
  zone_id = var.cloudflare_zone_id

  settings {
    brotli           = "on"
    http3            = "on"
    zero_rtt         = "on"
    early_hints      = "on"
    always_use_https = "on"
    min_tls_version  = "1.2"
    tls_1_3          = "on"
  }
}

# Smart tiered cache: edge PoPs fill from a regional upper tier instead of
# all going to the origin, which raises hit ratios in low-traffic regions.
resource "cloudflare_tiered_cache" "smart" {
  zone_id    = var.cloudflare_zone_id
  cache_type = "smart"
}

# ── Cache rules (edge TTLs) ───────────────────────────────────────────────────
# Browser TTLs come from the `_headers` file the build emits
# (frontend/csp.config.ts); these rules only set how long the edge keeps
# objects and keep the entry HTML from being cached stale.

resource "cloudflare_ruleset" "cache" {
  zone_id     = var.cloudflare_zone_id
  name        = "soroban-identity-frontend-cache"
  description = "Edge caching for the Soroban Identity frontend"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    description = "Hashed build assets: cache for a year at the edge"
    expression  = local.hashed_assets
    action      = "set_cache_settings"
    enabled     = true

    action_parameters {
      cache = true

      edge_ttl {
        mode    = "override_origin"
        default = var.hashed_asset_ttl
      }

      browser_ttl {
        mode = "respect_origin"
      }

      # Query strings never change a hashed file's content; ignoring them
      # stops cache-busting parameters from fragmenting the cache.
      cache_key {
        custom_key {
          query_string {
            exclude = ["*"]
          }
        }
      }
    }
  }

  rules {
    description = "HTML entry point and SPA routes: revalidate on every request"
    expression  = local.html
    action      = "set_cache_settings"
    enabled     = true

    action_parameters {
      cache = false
    }
  }
}
