// frontend/src/search/index.ts
// Advanced search engine with boolean operators, fuzzy matching, faceting,
// highlighting, history, saved searches, and pluggable remote providers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface Credential {
  id: string;
  issuer: string;
  subject: string;
  credentialType: string;
  claims?: Record<string, unknown> | string[];
  status: string;
  issuedAt?: string | number | Date;
  expiresAt?: string | number | Date;
  [key: string]: unknown;
}

export type FieldName =
  | 'id'
  | 'issuer'
  | 'subject'
  | 'credentialType'
  | 'claims'
  | 'status';

export const SEARCHABLE_FIELDS: FieldName[] = [
  'id',
  'issuer',
  'subject',
  'credentialType',
  'claims',
  'status',
];

export type BooleanOp = 'AND' | 'OR' | 'NOT';

export interface QueryTerm {
  value: string;
  fuzzy: boolean;
  negated: boolean;
}

export interface ParsedQuery {
  /** Groups of terms joined by OR; each group is AND-ed internally. */
  groups: QueryTerm[][];
  raw: string;
}

export interface MatchRange {
  start: number;
  end: number;
}

export interface FieldHighlight {
  field: FieldName;
  value: string;
  ranges: MatchRange[];
}

export interface SearchResult<T extends Credential = Credential> {
  item: T;
  score: number;
  highlights: FieldHighlight[];
  matchedFields: FieldName[];
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface DateRangeBucket {
  label: string;
  from?: number;
  to?: number;
  count: number;
}

export interface Facets {
  credentialType: FacetBucket[];
  status: FacetBucket[];
  issuer: FacetBucket[];
  issuedAt: DateRangeBucket[];
}

export interface FacetFilters {
  credentialType?: string[];
  status?: string[];
  issuer?: string[];
  issuedAt?: { from?: number; to?: number };
}

export interface SearchOptions {
  facets?: FacetFilters;
  limit?: number;
  offset?: number;
  fuzzy?: boolean;
}

export interface SearchResponse<T extends Credential = Credential> {
  results: SearchResult<T>[];
  total: number;
  facets: Facets;
  took: number;
  query: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: FacetFilters;
  createdAt: number;
}

export interface HistoryEntry {
  query: string;
  filters?: FacetFilters;
  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                              Query parsing                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tokenize a raw query string. Supports quoted phrases, boolean operators
 * (AND, OR, NOT), parentheses grouping, and fuzzy suffix `~`.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && (ch === '(' || ch === ')')) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push(ch);
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function isOperator(token: string): token is BooleanOp {
  const upper = token.toUpperCase();
  return upper === 'AND' || upper === 'OR' || upper === 'NOT';
}

/**
 * Parse a query string into OR-of-AND groups with negation support.
 * Grammar (simplified): expr := term (OR term)* ; term := factor (AND factor)*
 * factor := [NOT] (term | '(' expr ')')
 */
export function parseQuery(raw: string): ParsedQuery {
  const tokens = tokenize(raw || '');
  let pos = 0;

  function parseExpr(): QueryTerm[][] {
    const groups: QueryTerm[][] = [];
    let current = parseTerm();
    groups.push(current);
    while (pos < tokens.length && tokens[pos].toUpperCase() === 'OR') {
      pos++;
      current = parseTerm();
      groups.push(current);
    }
    return groups;
  }

  function parseTerm(): QueryTerm[] {
    const terms: QueryTerm[] = [];
    let negateNext = false;

    while (pos < tokens.length) {
      const tok = tokens[pos];
      const upper = tok.toUpperCase();
      if (upper === 'OR' || tok === ')') break;
      if (upper === 'AND') {
        pos++;
        continue;
      }
      if (upper === 'NOT') {
        negateNext = !negateNext;
        pos++;
        continue;
      }
      if (tok === '(') {
        pos++;
        const inner = parseExpr();
        if (pos < tokens.length && tokens[pos] === ')') pos++;
        // Flatten inner groups into this term (approximation).
        for (const group of inner) {
          for (const t of group) {
            terms.push({ ...t, negated: t.negated !== negateNext });
          }
        }
        negateNext = false;
        continue;
      }
      terms.push(makeTerm(tok, negateNext));
      negateNext = false;
      pos++;
    }
    return terms;
  }

  const groups = parseExpr();
  return { groups, raw };
}

function makeTerm(token: string, negated: boolean): QueryTerm {
  let value = token;
  let fuzzy = false;
  if (value.endsWith('~')) {
    fuzzy = true;
    value = value.slice(0, -1);
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  }
  return { value: value.toLowerCase(), fuzzy, negated };
}

/* -------------------------------------------------------------------------- */
/*                              Fuzzy matching                                */
/* -------------------------------------------------------------------------- */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Max allowed edit distance based on term length. */
function fuzzyThreshold(term: string): number {
  if (term.length <= 3) return 1;
  if (term.length <= 6) return 2;
  return 3;
}

/**
 * Returns a score in [0,1] for how well `term` matches `text`.
 * 1 = exact substring, lower = fuzzy.
 */
export function matchScore(term: string, text: string, fuzzy: boolean): number {
  if (!term) return 0;
  const lower = text.toLowerCase();
  if (lower === term) return 1;
  if (lower.includes(term)) {
    // Prefer prefix matches.
    return lower.startsWith(term) ? 0.95 : 0.85;
  }
  if (!fuzzy) return 0;

  const words = lower.split(/[\s\-_/.:]+/).filter(Boolean);
  let best = 0;
  for (const word of words) {
    const dist = levenshtein(term, word);
    const threshold = fuzzyThreshold(term);
    if (dist <= threshold) {
      const score = 1 - dist / Math.max(term.length, word.length);
      if (score > best) best = score * 0.7;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/*                              Field extraction                              */
/* -------------------------------------------------------------------------- */

function stringifyClaims(claims: Credential['claims']): string {
  if (!claims) return '';
  if (Array.isArray(claims)) return claims.join(' ');
  try {
    return Object.entries(claims)
      .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' ');
  } catch {
    return '';
  }
}

export function extractField(item: Credential, field: FieldName): string {
  switch (field) {
    case 'claims':
      return stringifyClaims(item.claims);
    case 'id':
    case 'issuer':
    case 'subject':
    case 'credentialType':
    case 'status':
      return item[field] != null ? String(item[field]) : '';
    default:
      return '';
  }
}

/* -------------------------------------------------------------------------- */
/*                              Full-text index                               */
/* -------------------------------------------------------------------------- */

interface IndexedDoc {
  item: Credential;
  fields: Record<FieldName, string>;
}

export class FullTextIndex {
  private docs: IndexedDoc[] = [];

  constructor(items: Credential[] = []) {
    this.build(items);
  }

  build(items: Credential[]): void {
    this.docs = items.map((item) => {
      const fields = {} as Record<FieldName, string>;
      for (const f of SEARCHABLE_FIELDS) fields[f] = extractField(item, f);
      return { item, fields };
    });
  }

  size(): number {
    return this.docs.length;
  }

  all(): Credential[] {
    return this.docs.map((d) => d.item);
  }

  search(query: ParsedQuery, options: SearchOptions = {}): SearchResult[] {
    const fuzzyDefault = options.fuzzy !== false;
    const results: SearchResult[] = [];

    for (const doc of this.docs) {
      if (!matchesFilters(doc.item, options.facets)) continue;

      const { score, highlights, matchedFields } = scoreDoc(doc, query, fuzzyDefault);
      if (score > 0 || query.groups.every((g) => g.length === 0)) {
        results.push({ item: doc.item, score, highlights, matchedFields });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

function scoreDoc(
  doc: IndexedDoc,
  query: ParsedQuery,
  fuzzyDefault: boolean,
): { score: number; highlights: FieldHighlight[]; matchedFields: FieldName[] } {
  const highlights: FieldHighlight[] = [];
  const matchedFields = new Set<FieldName>();

  // Empty query: return everything with neutral score.
  if (query.groups.every((g) => g.length === 0)) {
    return { score: 0.01, highlights, matchedFields: [] };
  }

  let totalScore = 0;
  let anyGroupMatched = false;

  for (const group of query.groups) {
    if (group.length === 0) continue;
    let groupScore = 0;
    let groupMatched = true;

    for (const term of group) {
      const fuzzy = term.fuzzy || fuzzyDefault;
      let bestTermScore = 0;

      for (const field of SEARCHABLE_FIELDS) {
        const text = doc.fields[field];
        if (!text) continue;
        const s = matchScore(term.value, text, fuzzy);
        if (s > bestTermScore) bestTermScore = s;

        if (s > 0 && !term.negated) {
          matchedFields.add(field);
          const ranges = findRanges(term.value, text, fuzzy);
          if (ranges.length) {
            highlights.push({ field, value: text, ranges });
          }
        }
      }

      if (term.negated) {
        if (bestTermScore > 0) {
          groupMatched = false;
          break;
        }
      } else {
        if (bestTermScore === 0) {
          groupMatched = false;
          break;
        }
        groupScore += bestTermScore;
      }
    }

    if (groupMatched) {
      anyGroupMatched = true;
      totalScore += groupScore;
    }
  }

  if (!anyGroupMatched) {
    return { score: 0, highlights: [], matchedFields: [] };
  }

  // Field weighting: id/issuer/subject/type more important than claims.
  const weight: Record<FieldName, number> = {
    id: 1.2,
    issuer: 1.1,
    subject: 1.1,
    credentialType: 1.0,
    status: 0.9,
    claims: 0.7,
  };
  let weighted = 0;
  for (const f of matchedFields) weighted += weight[f];
  const finalScore = totalScore * (1 + weighted / 10);

  return { score: finalScore, highlights, matchedFields: Array.from(matchedFields) };
}

/* -------------------------------------------------------------------------- */
/*                              Highlighting                                  */
/* -------------------------------------------------------------------------- */

export function findRanges(term: string, text: string, fuzzy: boolean): MatchRange[] {
  if (!term) return [];
  const lower = text.toLowerCase();
  const ranges: MatchRange[] = [];

  let idx = lower.indexOf(term);
  while (idx !== -1) {
    ranges.push({ start: idx, end: idx + term.length });
    idx = lower.indexOf(term, idx + term.length);
  }

  if (ranges.length === 0 && fuzzy) {
    // Fuzzy: highlight words within threshold.
    const wordRegex = /[\w\-]+/g;
    let m: RegExpExecArray | null;
    while ((m = wordRegex.exec(text)) !== null) {
      const word = m[0];
      const dist = levenshtein(term, word.toLowerCase());
      if (dist <= fuzzyThreshold(term)) {
        ranges.push({ start: m.index, end: m.index + word.length });
      }
    }
  }

  return mergeRanges(ranges);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/* -------------------------------------------------------------------------- */
/*                                  Facets                                    */
/* -------------------------------------------------------------------------- */

function toTimestamp(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? undefined : t;
}

export function computeFacets(items: Credential[]): Facets {
  const typeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const issuerCounts = new Map<string, number>();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const dateBuckets: DateRangeBucket[] = [
    { label: 'Last 7 days', from: now - 7 * day, to: now, count: 0 },
    { label: 'Last 30 days', from: now - 30 * day, to: now - 7 * day, count: 0 },
    { label: 'Last year', from: now - 365 * day, to: now - 30 * day, count: 0 },
    { label: 'Older', to: now - 365 * day, count: 0 },
  ];

  for (const item of items) {
    bump(typeCounts, item.credentialType);
    bump(statusCounts, item.status);
    bump(issuerCounts, item.issuer);

    const ts = toTimestamp(item.issuedAt);
    if (ts != null) {
      for (const bucket of dateBuckets) {
        const afterFrom = bucket.from == null || ts >= bucket.from;
        const beforeTo = bucket.to == null || ts < bucket.to;
        if (afterFrom && beforeTo) {
          bucket.count++;
          break;
        }
      }
    }
  }

  return {
    credentialType: toBuckets(typeCounts),
    status: toBuckets(statusCounts),
    issuer: toBuckets(issuerCounts),
    issuedAt: dateBuckets,
  };
}

function bump(map: Map<string, number>, key: string | undefined): void {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function toBuckets(map: Map<string, number>): FacetBucket[] {
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function matchesFilters(item: Credential, filters?: FacetFilters): boolean {
  if (!filters) return true;
  if (filters.credentialType?.length && !filters.credentialType.includes(item.credentialType)) {
    return false;
  }
  if (filters.status?.length && !filters.status.includes(item.status)) {
    return false;
  }
  if (filters.issuer?.length && !filters.issuer.includes(item.issuer)) {
    return false;
  }
  if (filters.issuedAt) {
    const ts = toTimestamp(item.issuedAt);
    if (ts == null) return false;
    const { from, to } = filters.issuedAt;
    if (from != null && ts < from) return false;
    if (to != null && ts > to) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*                                   Cache                                    */
/* -------------------------------------------------------------------------- */

export class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity = 50) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Local storage                                 */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = 'search:history';
const SAVED_KEY = 'search:saved';
const MAX_HISTORY = 50;

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / availability errors */
  }
}

export function getSearchHistory(): HistoryEntry[] {
  return safeGet<HistoryEntry[]>(HISTORY_KEY, []);
}

export function addSearchHistory(entry: HistoryEntry): HistoryEntry[] {
  const history = getSearchHistory().filter(
    (h) => !(h.query === entry.query && JSON.stringify(h.filters) === JSON.stringify(entry.filters)),
  );
  history.unshift(entry);
  const trimmed = history.slice(0, MAX_HISTORY);
  safeSet(HISTORY_KEY, trimmed);
  return trimmed;
}

export function clearSearchHistory(): void {
  safeSet(HISTORY_KEY, []);
}

export function getSavedSearches(): SavedSearch[] {
  return safeGet<SavedSearch[]>(SAVED_KEY, []);
}

export function saveSearch(search: Omit<SavedSearch, 'id' | 'createdAt'>): SavedSearch {
  const saved: SavedSearch = {
    ...search,
    id: `saved_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const all = getSavedSearches();
  all.unshift(saved);
  safeSet(SAVED_KEY, all);
  return saved;
}

export function deleteSavedSearch(id: string): SavedSearch[] {
  const all = getSavedSearches().filter((s) => s.id !== id);
  safeSet(SAVED_KEY, all);
  return all;
}

/* -------------------------------------------------------------------------- */
/*                              Autocomplete                                  */
/* -------------------------------------------------------------------------- */

export function getSuggestions(
  prefix: string,
  items: Credential[],
  limit = 8,
): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (v: string) => {
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    if (!key.includes(p)) return;
    seen.add(key);
    out.push(v);
  };

  for (const item of items) {
    push(item.credentialType);
    push(item.issuer);
    push(item.subject);
    push(item.status);
    if (out.length >= limit * 3) break;
  }

  return out
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(p) ? 0 : 1;
      const bStarts = b.toLowerCase().startsWith(p) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    })
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*                              Provider adapter                              */
/* -------------------------------------------------------------------------- */

export interface SearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  suggest?(prefix: string, limit?: number): Promise<string[]>;
}

export interface ProviderConfig {
  provider?: string;
  algolia?: { appId: string; apiKey: string; indexName: string };
  elasticsearch?: { endpoint: string; index: string; apiKey?: string };
}

export function getProviderConfig(): ProviderConfig {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  return {
    provider: env.VITE_SEARCH_PROVIDER,
    algolia: env.VITE_ALGOLIA_APP_ID
      ? {
          appId: env.VITE_ALGOLIA_APP_ID,
          apiKey: env.VITE_ALGOLIA_API_KEY || '',
          indexName: env.VITE_ALGOLIA_INDEX || 'credentials',
        }
      : undefined,
    elasticsearch: env.VITE_ELASTICSEARCH_ENDPOINT
      ? {
          endpoint: env.VITE_ELASTICSEARCH_ENDPOINT,
          index: env.VITE_ELASTICSEARCH_INDEX || 'credentials',
          apiKey: env.VITE_ELASTICSEARCH_API_KEY,
        }
      : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Search engine                                 */
/* -------------------------------------------------------------------------- */

export class SearchEngine {
  private index: FullTextIndex;
  private cache = new LRUCache<string, SearchResponse>(100);
  private provider?: SearchProvider;

  constructor(items: Credential[] = [], provider?: SearchProvider) {
    this.index = new FullTextIndex(items);
    this.provider = provider;
  }

  setItems(items: Credential[]): void {
    this.index.build(items);
    this.cache.clear();
  }

  setProvider(provider?: SearchProvider): void {
    this.provider = provider;
    this.cache.clear();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let response: SearchResponse;
    if (this.provider) {
      response = await this.provider.search(query, options);
    } else {
      response = this.searchLocal(query, options);
    }

    this.cache.set(cacheKey, response);
    return response;
  }

  searchLocal(query: string, options: SearchOptions = {}): SearchResponse {
    const start = performance.now();
    const parsed = parseQuery(query);
    const all = this.index.all();
    const facets = computeFacets(
      all.filter((item) => matchesFilters(item, options.facets)),
    );

    let results = this.index.search(parsed, options);
    const total = results.length;

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return {
      results,
      total,
      facets,
      took: performance.now() - start,
      query,
    };
  }

  suggest(prefix: string, limit = 8): string[] {
    return getSuggestions(prefix, this.index.all(), limit);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/* -------------------------------------------------------------------------- */
/*                              Debounce hook                                 */
/* -------------------------------------------------------------------------- */

export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export interface UseDebouncedSearchOptions extends SearchOptions {
  delay?: number;
  minLength?: number;
  recordHistory?: boolean;
}

export interface UseDebouncedSearchResult {
  query: string;
  setQuery: (q: string) => void;
  response: SearchResponse | null;
  loading: boolean;
  error: Error | null;
  suggestions: string[];
}

export function useDebouncedSearch(
  engine: SearchEngine,
  options: UseDebouncedSearchOptions = {},
): UseDebouncedSearchResult {
  const { delay = 250, minLength = 0, recordHistory = false, ...searchOptions } = options;
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const debouncedQuery = useDebounce(query, delay);
  const requestId = useRef(0);

  const optionsKey = useMemo(() => JSON.stringify(searchOptions), [searchOptions]);

  useEffect(() => {
    if (debouncedQuery.length > 0 && debouncedQuery.length < minLength) {
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    engine
      .search(debouncedQuery, searchOptions)
      .then((res) => {
        if (id !== requestId.current) return;
        setResponse(res);
        setLoading(false);
        if (recordHistory && debouncedQuery.trim()) {
          addSearchHistory({
            query: debouncedQuery,
            filters: searchOptions.facets,
            timestamp: Date.now(),
          });
        }
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, debouncedQuery, optionsKey, minLength, recordHistory]);

  const suggestions = useMemo(
    () => (query.length >= 2 ? engine.suggest(query) : []),
    [engine, query],
  );

  const updateQuery = useCallback((q: string) => setQuery(q), []);

  return { query, setQuery: updateQuery, response, loading, error, suggestions };
}

/* -------------------------------------------------------------------------- */
/*                              Default export                                */
/* -------------------------------------------------------------------------- */

export function createSearchEngine(
  items: Credential[] = [],
  config: ProviderConfig = getProviderConfig(),
): SearchEngine {
  // Remote providers are resolved lazily by the host app; the local engine
  // remains the fallback when no provider is configured.
  void config;
  return new SearchEngine(items);
}

export default SearchEngine;