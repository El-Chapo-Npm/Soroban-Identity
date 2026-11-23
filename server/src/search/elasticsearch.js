/**
 * Elasticsearch-backed full-text search for credentials, DIDs, audit logs and
 * analytics events (#1114).
 *
 * The client speaks the Elasticsearch REST API through `fetch`, so no extra
 * dependency is required. `SearchIndexer` buffers documents and flushes them
 * with the `_bulk` API to provide near real-time indexing.
 */

export const INDEX_MAPPINGS = {
  credentials: {
    settings: {
      analysis: {
        analyzer: {
          autocomplete: { tokenizer: 'autocomplete_tokenizer', filter: ['lowercase'] },
          autocomplete_search: { tokenizer: 'lowercase' },
        },
        tokenizer: {
          autocomplete_tokenizer: { type: 'edge_ngram', min_gram: 2, max_gram: 20, token_chars: ['letter', 'digit'] },
        },
      },
    },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        issuer: { type: 'keyword' },
        subject: { type: 'keyword' },
        type: { type: 'keyword' },
        status: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'autocomplete',
          search_analyzer: 'autocomplete_search',
          fields: { raw: { type: 'keyword' } },
        },
        claims: {
          type: 'nested',
          properties: { name: { type: 'keyword' }, value: { type: 'text' } },
        },
        issuedAt: { type: 'date' },
        expiresAt: { type: 'date' },
      },
    },
  },
  dids: {
    mappings: {
      properties: {
        did: { type: 'keyword' },
        controller: { type: 'keyword' },
        method: { type: 'keyword' },
        metadata: { type: 'text' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
      },
    },
  },
  audit_logs: {
    mappings: {
      properties: {
        actor: { type: 'keyword' },
        action: { type: 'keyword' },
        resource: { type: 'keyword' },
        message: { type: 'text' },
        timestamp: { type: 'date' },
      },
    },
  },
  analytics_events: {
    mappings: {
      properties: {
        event: { type: 'keyword' },
        query: { type: 'text', fields: { raw: { type: 'keyword' } } },
        results: { type: 'integer' },
        timestamp: { type: 'date' },
      },
    },
  },
};

/** Field boosts used for relevance scoring. */
export const RELEVANCE_FIELDS = {
  credentials: ['title^3', 'type^2', 'issuer^2', 'subject', 'claims.value'],
  dids: ['did^3', 'controller^2', 'metadata'],
  audit_logs: ['message', 'action^2', 'resource'],
  analytics_events: ['query', 'event'],
};

/** Facets returned as aggregations per index. */
export const FACETS = {
  credentials: ['type', 'issuer', 'status'],
  dids: ['method', 'controller'],
  audit_logs: ['action', 'actor'],
  analytics_events: ['event'],
};

const NESTED_FIELD = /^claims\./;

/**
 * Build an Elasticsearch query body.
 *
 * @param {object} options
 * @param {string} options.index - logical index name (key of INDEX_MAPPINGS)
 * @param {string} [options.q] - free-text query
 * @param {'fuzzy'|'phrase'|'boolean'} [options.mode='fuzzy']
 * @param {Record<string, string|string[]>} [options.filters] - facet filters
 * @param {Record<string, {gte?: any, lte?: any, gt?: any, lt?: any}>} [options.ranges]
 * @param {number} [options.from=0]
 * @param {number} [options.size=20]
 */
export function buildSearchQuery({ index, q, mode = 'fuzzy', filters = {}, ranges = {}, from = 0, size = 20 }) {
  if (!INDEX_MAPPINGS[index]) throw new Error(`Unknown search index: ${index}`);
  const fields = RELEVANCE_FIELDS[index];
  const must = [];
  const filter = [];

  if (q && q.trim()) {
    const text = q.trim();
    if (mode === 'phrase') {
      must.push({ multi_match: { query: text, fields, type: 'phrase' } });
    } else if (mode === 'boolean') {
      must.push({ query_string: { query: text, fields, default_operator: 'AND' } });
    } else {
      const plain = fields.filter((f) => !NESTED_FIELD.test(f));
      const nested = fields.filter((f) => NESTED_FIELD.test(f));
      const should = [{ multi_match: { query: text, fields: plain, fuzziness: 'AUTO', prefix_length: 1 } }];
      if (nested.length) {
        should.push({
          nested: { path: 'claims', query: { multi_match: { query: text, fields: nested, fuzziness: 'AUTO' } } },
        });
      }
      must.push({ bool: { should, minimum_should_match: 1 } });
    }
  }

  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    filter.push(Array.isArray(value) ? { terms: { [field]: value } } : { term: { [field]: value } });
  }
  for (const [field, range] of Object.entries(ranges)) {
    if (range && Object.keys(range).length) filter.push({ range: { [field]: range } });
  }

  const aggs = {};
  for (const facet of FACETS[index]) aggs[facet] = { terms: { field: facet, size: 20 } };

  return {
    from: Math.max(0, Number(from) || 0),
    size: Math.min(100, Math.max(1, Number(size) || 20)),
    query: must.length || filter.length ? { bool: { must, filter } } : { match_all: {} },
    aggs,
  };
}

export class ElasticsearchClient {
  constructor({ node = process.env.ELASTICSEARCH_URL, apiKey = process.env.ELASTICSEARCH_API_KEY, prefix = process.env.ELASTICSEARCH_INDEX_PREFIX ?? 'soroban', fetchImpl = globalThis.fetch } = {}) {
    if (!node) throw new Error('ELASTICSEARCH_URL is required');
    if (typeof fetchImpl !== 'function') throw new Error('Elasticsearch client requires a fetch implementation');
    this.node = node.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.prefix = prefix;
    this.fetch = fetchImpl;
  }

  indexName(index) {
    return this.prefix ? `${this.prefix}_${index}` : index;
  }

  async request(method, path, body, contentType = 'application/json') {
    const headers = { 'content-type': contentType };
    if (this.apiKey) headers.authorization = `ApiKey ${this.apiKey}`;
    const res = await this.fetch(`${this.node}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(`Elasticsearch ${method} ${path} failed with ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  /** Create every index with its mapping; existing indices are left untouched. */
  async ensureIndices() {
    for (const [index, definition] of Object.entries(INDEX_MAPPINGS)) {
      try {
        await this.request('PUT', `/${this.indexName(index)}`, definition);
      } catch (err) {
        if (err.body?.error?.type !== 'resource_already_exists_exception') throw err;
      }
    }
  }

  async bulk(operations) {
    if (!operations.length) return { items: [], errors: false };
    const lines = [];
    for (const op of operations) {
      const _index = this.indexName(op.index);
      if (op.action === 'delete') {
        lines.push(JSON.stringify({ delete: { _index, _id: op.id } }));
      } else {
        lines.push(JSON.stringify({ index: { _index, _id: op.id } }), JSON.stringify(op.doc));
      }
    }
    return this.request('POST', '/_bulk?refresh=wait_for', `${lines.join('\n')}\n`, 'application/x-ndjson');
  }

  async search(options) {
    const body = buildSearchQuery(options);
    const data = await this.request('POST', `/${this.indexName(options.index)}/_search`, body);
    const facets = {};
    for (const [name, agg] of Object.entries(data.aggregations ?? {})) {
      facets[name] = (agg.buckets ?? []).map((b) => ({ value: b.key, count: b.doc_count }));
    }
    return {
      total: typeof data.hits?.total === 'object' ? data.hits.total.value : data.hits?.total ?? 0,
      hits: (data.hits?.hits ?? []).map((h) => ({ id: h._id, score: h._score, ...h._source })),
      facets,
    };
  }

  /** Autocomplete suggestions from the edge-ngram analysed credential title. */
  async suggest(prefix, { index = 'credentials', field = 'title', size = 5 } = {}) {
    if (!prefix || !prefix.trim()) return [];
    const data = await this.request('POST', `/${this.indexName(index)}/_search`, {
      size,
      _source: [field],
      query: { match: { [field]: { query: prefix.trim(), operator: 'and' } } },
    });
    return [...new Set((data.hits?.hits ?? []).map((h) => h._source?.[field]).filter(Boolean))];
  }
}

/**
 * Buffers index/delete operations and flushes them with the bulk API either
 * when `batchSize` is reached or every `flushIntervalMs`.
 */
export class SearchIndexer {
  constructor(client, { batchSize = 100, flushIntervalMs = 1000 } = {}) {
    this.client = client;
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.queue = [];
    this.timer = null;
  }

  index(index, id, doc) {
    return this.enqueue({ action: 'index', index, id, doc });
  }

  remove(index, id) {
    return this.enqueue({ action: 'delete', index, id });
  }

  enqueue(op) {
    this.queue.push(op);
    if (this.queue.length >= this.batchSize) return this.flush();
    if (!this.timer && this.flushIntervalMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush().catch(() => {});
      }, this.flushIntervalMs);
      this.timer.unref?.();
    }
    return Promise.resolve();
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const ops = this.queue.splice(0);
    if (!ops.length) return { items: [], errors: false };
    return this.client.bulk(ops);
  }
}

/** Records search queries into the analytics_events index. */
export function trackSearch(indexer, { query, index, results, now = new Date() }) {
  const id = `search-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  return indexer.index('analytics_events', id, {
    event: `search:${index}`,
    query,
    results,
    timestamp: now.toISOString(),
  });
}
