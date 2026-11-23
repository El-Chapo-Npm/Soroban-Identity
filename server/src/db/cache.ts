import { createHash } from 'crypto';
import { logger } from '../utils/logger';

/**
 * Database query result cache (issue #886 [PERF-04]).
 *
 * Caches the results of frequent, read-only queries with a per-query TTL,
 * a deterministic cache key strategy and explicit invalidation on data
 * mutations.
 *
 * Cacheable queries are identified by a table tag (e.g. "dids",
 * "credentials"). A mutation on a table invalidates every cached entry
 * tagged with that table, so stale reads are bounded by the TTL at worst.
 */

export interface QueryCacheOptions {
  /** Default TTL in milliseconds for entries without an explicit TTL. */
  defaultTtlMs?: number;
  /** Maximum number of entries kept in memory. Oldest entries are evicted. */
  maxEntries?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export interface QueryCacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  invalidations: number;
  size: number;
  /** hits / (hits + misses), 0 when no lookups happened yet. */
  hitRate: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tables: string[];
}

const DEFAULT_TTL_MS = 30 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Normalise SQL so that whitespace and casing differences do not produce
 * distinct cache keys for the same query.
 */
export function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Build a deterministic cache key from the query text, its parameters and
 * the tenant scope. Parameters are serialised with sorted object keys so
 * that `{a:1,b:2}` and `{b:2,a:1}` map to the same key.
 */
export function buildCacheKey(
  text: string,
  params: unknown[] = [],
  tenantId?: string,
): string {
  const payload = JSON.stringify({
    q: normalizeQuery(text),
    p: params.map(stableValue),
    t: tenantId ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = stableValue(obj[key]);
    }
    return out;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/** True when the statement only reads data and is therefore cacheable. */
export function isCacheableQuery(text: string): boolean {
  const normalized = normalizeQuery(text);
  if (!/^(select|with)\b/.test(normalized)) {
    return false;
  }
  // Volatile functions and locking reads must never be cached.
  if (/\b(now\(\)|current_timestamp|random\(\)|nextval\()/.test(normalized)) {
    return false;
  }
  if (/\bfor (update|share)\b/.test(normalized)) {
    return false;
  }
  return true;
}

export class QueryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private evictions = 0;
  private invalidations = 0;

  constructor(options: QueryCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /** Read a cached value, or undefined on miss/expiry. */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh recency for LRU-style eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value as T;
  }

  /** Store a value, tagged with the tables it was derived from. */
  set<T>(key: string, value: T, tables: string[] = [], ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (ttl <= 0) {
      return;
    }
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
        this.evictions += 1;
      }
    }
    this.entries.set(key, {
      value,
      expiresAt: this.now() + ttl,
      tables: tables.map((t) => t.toLowerCase()),
    });
    this.sets += 1;
  }

  /**
   * Cache-aside helper: return the cached result or run the loader and
   * cache its result. Loader errors are never cached.
   */
  async wrap<T>(
    key: string,
    tables: string[],
    loader: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await loader();
    this.set(key, value, tables, ttlMs);
    return value;
  }

  /** Invalidate every entry derived from the given table. */
  invalidateTable(table: string): number {
    const target = table.toLowerCase();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.tables.includes(target)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    this.invalidations += removed;
    if (removed > 0) {
      logger.debug('db.cache: invalidated table', { table: target, removed });
    }
    return removed;
  }

  /** Invalidate every entry derived from any of the given tables. */
  invalidateTables(tables: string[]): number {
    let removed = 0;
    for (const table of tables) {
      removed += this.invalidateTable(table);
    }
    return removed;
  }

  /** Drop a single key. */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Drop everything (e.g. after a schema migration). */
  clear(): void {
    this.entries.clear();
  }

  /** Hit/miss counters for observability. */
  stats(): QueryCacheStats {
    const lookups = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      invalidations: this.invalidations,
      size: this.entries.size,
      hitRate: lookups === 0 ? 0 : this.hits / lookups,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
    this.invalidations = 0;
  }
}

export const queryCache = new QueryCache();
