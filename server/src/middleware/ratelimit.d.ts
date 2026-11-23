import type { IncomingMessage } from 'node:http';
import type { TieredRateLimiter } from '../rate-limiter.js';

export interface BucketStrategy {
  /** Sustained requests per minute (token refill rate). */
  ratePerMinute: number;
  /** Extra requests allowed in a spike on top of the sustained rate. */
  burst: number;
}

export type RateLimitScope = 'ip' | 'user' | 'endpoint' | 'tier';

export interface RateLimitResult {
  allowed: boolean;
  scope?: RateLimitScope;
  rule?: string;
  tier?: string;
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAfter?: number;
  ip?: string;
  whitelisted?: boolean;
  bypass?: 'premium';
  binding?: { limit: number; remaining: number; resetAt: number; rule?: string };
}

export interface RateLimitViolation {
  at: string;
  scope: RateLimitScope;
  rule: string;
  ip: string;
  userKey: string | null;
  method: string;
  path: string;
  limit: number;
  retryAfter: number;
}

export interface AdvancedRateLimiterOptions {
  tiered?: TieredRateLimiter;
  whitelist?: string[];
  trustProxy?: boolean;
  maxBuckets?: number;
  strategies?: { ip?: Partial<BucketStrategy>; user?: Partial<BucketStrategy> };
  premiumTiers?: string[];
  premiumKeys?: string[];
  metrics?: { observeRateLimitDecision?(d: { outcome: string; scope: string }): void } | null;
  now?: () => number;
}

export declare const DEFAULT_STRATEGIES: { ip: BucketStrategy; user: BucketStrategy };
export declare const DEFAULT_PREMIUM_TIERS: string[];

export declare class TokenBucket {
  constructor(opts: BucketStrategy & { now: number });
  readonly capacity: number;
  tokens: number;
  take(now: number): { allowed: boolean; retryAfter: number };
  resetAt(now: number): number;
  isFull(now: number): boolean;
}

export declare class AdvancedRateLimiter {
  constructor(options?: AdvancedRateLimiterOptions);
  check(req: IncomingMessage, pathname: string): RateLimitResult;
  isPremium(req: IncomingMessage): boolean;
  getStats(): {
    strategies: { ip: BucketStrategy; user: BucketStrategy };
    premiumTiers: string[];
    premiumKeys: number;
    buckets: { ip: number; user: number; tiered: number };
    decisions: { allowed: number; bypassed: number; denied: number };
    violations: Record<RateLimitScope, number>;
    recentViolations: RateLimitViolation[];
  };
  reset(): void;
}

export declare function createRateLimiter(
  config: Record<string, unknown>,
  deps?: { metrics?: AdvancedRateLimiterOptions['metrics'] },
): AdvancedRateLimiter;
