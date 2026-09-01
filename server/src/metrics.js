/**
 * Prometheus metrics (#649)
 *
 * Backed by `prom-client`. All series are registered on a private Registry so
 * two MetricsService instances (as created by tests) never collide on the
 * global default registry.
 *
 * The `counters` property is preserved as a live proxy over the underlying
 * prom-client counters: existing callers such as `soroban.js` mutate
 * `metrics.counters.rpc_cache_hits_total` directly, and reads must reflect the
 * registry rather than a detached copy.
 */

import client from 'prom-client';

const HISTOGRAM_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Latency buckets for inbound HTTP requests, in seconds. */
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Business counters exposed by the server, with the HELP text rendered for
 * each. Names are unchanged from the hand-rolled renderer they replace.
 */
const COUNTER_DEFINITIONS = {
  dids_created_total: 'Total number of DIDs created',
  credentials_issued_total: 'Total number of credentials issued',
  credentials_revoked_total: 'Total number of credentials revoked',
  reputation_scores_submitted_total: 'Total number of reputation scores submitted',
  rpc_cache_hits_total: 'Total number of RPC cache hits',
  rpc_cache_misses_total: 'Total number of RPC cache misses',
  rpc_retries_total: 'Total number of RPC retries',
  did_cache_hits_total: 'Total DID document cache hits',
  did_cache_misses_total: 'Total DID document cache misses',
  did_cache_sets_total: 'Total DID documents written to the cache',
  did_cache_errors_total: 'Total DID cache operation failures',
  did_cache_invalidations_total: 'Total DID cache invalidations',
  query_cache_hits_total: 'Total query-result cache hits',
  query_cache_misses_total: 'Total query-result cache misses',
  query_cache_errors_total: 'Total query-result cache errors',
};

/**
 * Read a prom-client counter's current value synchronously.
 *
 * prom-client exposes values through the async `get()` API, but an unlabelled
 * counter keeps its state in `hashMap` under the empty-label key, so a
 * synchronous read is possible — which is what the `counters` proxy needs.
 *
 * @param {import('prom-client').Counter} counter
 * @returns {number}
 */
function readCounter(counter) {
  return counter.hashMap?.['']?.value ?? 0;
}

export class MetricsService {
  /**
   * @param {object} [options]
   * @param {boolean} [options.collectDefaultMetrics=true] - Register Node.js
   *   runtime metrics (heap, event loop lag, GC, handles) on this registry.
   */
  constructor({ collectDefaultMetrics = true } = {}) {
    this.registry = new client.Registry();

    /** @type {Record<string, import('prom-client').Counter>} */
    this._counters = {};
    for (const [name, help] of Object.entries(COUNTER_DEFINITIONS)) {
      this._counters[name] = new client.Counter({
        name,
        help,
        registers: [this.registry],
      });
    }

    this.rpcLatency = new client.Histogram({
      name: 'soroban_rpc_call_latency_seconds',
      help: 'Soroban RPC call latency in seconds',
      buckets: HISTOGRAM_BUCKETS,
      registers: [this.registry],
    });

    this.httpRequests = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests handled, by method, route and status code',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds, by method, route and status code',
      labelNames: ['method', 'route', 'status_code'],
      buckets: HTTP_DURATION_BUCKETS,
      registers: [this.registry],
    });

    this.httpInFlight = new client.Gauge({
      name: 'http_requests_in_flight',
      help: 'Number of HTTP requests currently being processed',
      registers: [this.registry],
    });

    this.credentialsVerified = new client.Counter({
      name: 'credentials_verified_total',
      help: 'Total number of credential verification attempts, by result',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.activeDids = new client.Gauge({
      name: 'active_dids',
      help: 'Number of distinct DIDs holding at least one active credential',
      registers: [this.registry],
    });

    this.activeCredentials = new client.Gauge({
      name: 'active_credentials',
      help: 'Number of credentials that are neither revoked nor expired, by credential type',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.credentialTypes = new client.Gauge({
      name: 'credential_types',
      help: 'Number of distinct credential types present in the credential store',
      registers: [this.registry],
    });

    this.cspViolations = new client.Counter({
      name: 'csp_violations_total',
      help: 'Total number of Content Security Policy violation reports received, by directive',
      labelNames: ['directive'],
      registers: [this.registry],
    });

    this.batchOperations = new client.Counter({
      name: 'batch_operations_total',
      help: 'Total batch sub-operations processed via POST /batch, by operation type and result',
      labelNames: ['type', 'result'],
      registers: [this.registry],
    });

    this.batchRequests = new client.Counter({
      name: 'batch_requests_total',
      help: 'Total POST /batch requests, by atomic mode and whether the batch aborted early',
      labelNames: ['atomic', 'aborted'],
      registers: [this.registry],
    });

    this.quotaThresholdEvents = new client.Counter({
      name: 'quota_threshold_events_total',
      help: 'Total quota threshold crossings (80%/100% of a daily or monthly quota), by tier, period and threshold',
      labelNames: ['tier', 'period', 'threshold'],
      registers: [this.registry],
    });

    this.deprecatedEndpointUsage = new client.Counter({
      name: 'deprecated_endpoint_usage_total',
      help: 'Total requests to endpoints marked deprecated, by endpoint rule name',
      labelNames: ['endpoint'],
      registers: [this.registry],
    });

    this.ddosEvents = new client.Counter({
      name: 'ddos_events_total',
      help: 'Total DDoS protection events by type',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.queryCacheLatency = new client.Histogram({
      name: 'query_cache_lookup_latency_seconds',
      help: 'Query-result cache lookup latency in seconds',
      labelNames: ['outcome'],
      buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
      registers: [this.registry],
    });

    this.circuitBreakerState = new client.Gauge({
      name: 'soroban_circuit_breaker_state',
      help: 'Current state of the Soroban circuit breaker (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
      registers: [this.registry],
    });
    this.circuitBreakerState.set(0);

    this.circuitBreakerStateChanges = new client.Counter({
      name: 'soroban_circuit_breaker_state_changes_total',
      help: 'Total circuit breaker state changes by from and to state',
      labelNames: ['from', 'to'],
      registers: [this.registry],
    });

    this.circuitBreakerBreaks = new client.Counter({
      name: 'soroban_circuit_breaker_breaks_total',
      help: 'Total number of times the circuit breaker tripped OPEN',
      registers: [this.registry],
    });

    this.circuitBreakerFailures = new client.Counter({
      name: 'soroban_circuit_breaker_failures_total',
      help: 'Total number of RPC failures recorded by circuit breaker',
      registers: [this.registry],
    });

    this.circuitBreakerRejects = new client.Counter({
      name: 'soroban_circuit_breaker_rejects_total',
      help: 'Total number of RPC calls rejected fast by open circuit breaker',
      registers: [this.registry],
    });

    this.circuitBreakerFallbacks = new client.Counter({
      name: 'soroban_circuit_breaker_fallbacks_total',
      help: 'Total number of fallback responses served by circuit breaker',
      registers: [this.registry],
    });

    if (collectDefaultMetrics) {
      client.collectDefaultMetrics({ register: this.registry });
    }

    /**
     * Live view over the business counters.
     *
     * Reads return the registry's current value; writes compute the delta and
     * apply it with `inc()`, because a Prometheus counter can only move
     * forward. Assigning a lower value is ignored rather than silently
     * corrupting the series.
     */
    this.counters = new Proxy(this._counters, {
      get: (target, name) => (name in target ? readCounter(target[name]) : undefined),
      set: (target, name, value) => {
        if (!(name in target)) return false;
        const delta = Number(value) - readCounter(target[name]);
        if (Number.isFinite(delta) && delta > 0) target[name].inc(delta);
        return true;
      },
      has: (target, name) => name in target,
      ownKeys: (target) => Reflect.ownKeys(target),
      getOwnPropertyDescriptor: (target, name) =>
        name in target
          ? { enumerable: true, configurable: true, value: readCounter(target[name]) }
          : undefined,
    });
  }

  /**
   * Record a Soroban RPC call's latency.
   * @param {number} seconds
   */
  observeRpcLatency(seconds) {
    this.rpcLatency.observe(seconds);
  }

  /**
   * Record a completed HTTP request.
   *
   * @param {object} sample
   * @param {string} sample.method
   * @param {string} sample.route      - Normalized route pattern, not the raw path
   * @param {number} sample.statusCode
   * @param {number} sample.durationSeconds
   */
  observeHttpRequest({ method, route, statusCode, durationSeconds }) {
    const labels = {
      method: String(method ?? 'UNKNOWN').toUpperCase(),
      route: route ?? 'unmatched',
      status_code: String(statusCode ?? 0),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  /**
   * Record the outcome of a credential verification.
   * @param {'verified'|'revoked'|'expired'|'not_found'} result
   */
  observeCredentialVerification(result) {
    this.credentialsVerified.inc({ result: result ?? 'unknown' });
  }

  /**
   * Record a CSP violation report.
   *
   * Labelled by directive so a dashboard shows *what* is being blocked: a
   * spike in `script-src` is a possible injection, whereas a steady trickle
   * from `img-src` is usually a policy that needs widening.
   *
   * @param {string} directive
   */
  observeCspViolation(directive) {
    this.cspViolations.inc({ directive: directive || 'unknown' });
  }

  /**
   * Record one batch sub-operation's outcome (#749).
   * @param {object} sample
   * @param {'issue'|'verify'|'revoke'} sample.type
   * @param {'success'|'failed'} sample.result
   */
  observeBatchOperation({ type, result }) {
    this.batchOperations.inc({ type: type || 'unknown', result: result || 'unknown' });
  }

  /**
   * Record one completed POST /batch request (#749).
   * @param {object} sample
   * @param {boolean} sample.atomic
   * @param {boolean} sample.aborted
   */
  observeBatchRequest({ atomic, aborted }) {
    this.batchRequests.inc({ atomic: String(Boolean(atomic)), aborted: String(Boolean(aborted)) });
  }

  /**
   * Record a quota threshold crossing (#748).
   * @param {object} sample
   * @param {string} sample.tier
   * @param {'daily'|'monthly'} sample.period
   * @param {number} sample.threshold - e.g. 0.8 or 1
   */
  observeQuotaThreshold({ tier, period, threshold }) {
    this.quotaThresholdEvents.inc({ tier: tier || 'unknown', period: period || 'unknown', threshold: String(threshold) });
  }

  /**
   * Record a request to a deprecated endpoint (#751).
   * @param {string} endpoint - Deprecation rule name
   */
  observeDeprecatedEndpointUsage(endpoint) {
    this.deprecatedEndpointUsage.inc({ endpoint: endpoint || 'unknown' });
  }

  observeQueryCache(outcome, durationSeconds = undefined) {
    const name = outcome === 'hit' ? 'query_cache_hits_total' : outcome === 'miss' ? 'query_cache_misses_total' : 'query_cache_errors_total';
    this._counters[name].inc();
    if (durationSeconds !== undefined) this.queryCacheLatency.observe({ outcome: outcome || 'unknown' }, durationSeconds);
  }

  observeDdosEvent(type) { this.ddosEvents.inc({ type: type || 'unknown' }); }

  observeCircuitBreakerState(toState, fromState) {
    const map = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 };
    const num = map[String(toState).toUpperCase()] ?? 0;
    this.circuitBreakerState.set(num);
    if (fromState && toState) {
      this.circuitBreakerStateChanges.inc({
        from: String(fromState).toUpperCase(),
        to: String(toState).toUpperCase(),
      });
    }
  }

  observeCircuitBreakerEvent(event) {
    if (event === 'break') this.circuitBreakerBreaks.inc();
    else if (event === 'failure') this.circuitBreakerFailures.inc();
    else if (event === 'reject') this.circuitBreakerRejects.inc();
    else if (event === 'fallback') this.circuitBreakerFallbacks.inc();
  }

  /**
   * Recompute the business gauges from the current credential store contents.
   *
   * A credential counts as active when it is not revoked and either has no
   * expiry (`expiresAt` of 0) or expires in the future.
   *
   * @param {Array<object>} credentials
   * @param {number} [nowSeconds] - Injectable clock for tests
   */
  updateBusinessMetrics(credentials, nowSeconds = Math.floor(Date.now() / 1000)) {
    const subjects = new Set();
    const byType = new Map();
    const allTypes = new Set();

    for (const credential of credentials ?? []) {
      const type = credential?.type ?? 'unspecified';
      allTypes.add(type);

      const expiresAt = Number(credential?.expiresAt ?? 0);
      const expired = expiresAt > 0 && expiresAt < nowSeconds;
      if (credential?.revoked || expired) continue;

      const subject = credential?.subject ?? credential?.did;
      if (subject) subjects.add(subject);
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }

    this.activeDids.set(subjects.size);
    this.credentialTypes.set(allTypes.size);

    // Reset first so a type that dropped to zero is reported as zero rather
    // than keeping its last non-zero value forever.
    this.activeCredentials.reset();
    for (const type of allTypes) {
      this.activeCredentials.set({ type }, byType.get(type) ?? 0);
    }
  }

  /**
   * Apply on-chain events to the business counters.
   *
   * Classified by the event's real topic (entity + action), mutually exclusive
   * so a single event increments exactly one counter.
   *
   * @param {Array<{topic?: unknown[]}>} events
   */
  applyEvents(events) {
    for (const event of events) {
      const [entity, action] = Array.isArray(event?.topic) ? event.topic : [];
      const entityKey = typeof entity === 'string' ? entity.toUpperCase() : '';
      const actionText = typeof action === 'string' ? action.toLowerCase() : '';

      if (entityKey === 'DID' && actionText.includes('create')) {
        this._counters.dids_created_total.inc();
      } else if (entityKey === 'CRED' && actionText.includes('issue')) {
        this._counters.credentials_issued_total.inc();
      } else if (entityKey === 'CRED' && actionText.includes('revoke')) {
        this._counters.credentials_revoked_total.inc();
      } else if (entityKey === 'SCORE' && actionText.includes('submit')) {
        this._counters.reputation_scores_submitted_total.inc();
      }
    }
  }

  /** Content type Prometheus expects for a scrape response. */
  get contentType() {
    return this.registry.contentType;
  }

  /**
   * Render the full registry in the Prometheus text exposition format.
   * @returns {Promise<string>}
   */
  renderPrometheus() {
    return this.registry.metrics();
  }

  /** Reset every series. Intended for tests. */
  reset() {
    this.registry.resetMetrics();
  }
}

export class MetricsAggregator {
  constructor(soroban, metrics, { startLedger = 0 } = {}) {
    this.soroban = soroban;
    this.metrics = metrics;
    this.nextLedger = startLedger;
    /** @type {Promise<number>|null} In-flight refresh promise for single-flight dedup */
    this._refreshPromise = null;
  }

  /**
   * Fetch new ledger events and apply them to the metrics counters.
   *
   * Single-flight: if a refresh is already in progress when this method is
   * called again (e.g. two concurrent Prometheus scrapes), the second caller
   * receives the same Promise as the first so the same ledger range is never
   * processed twice.
   *
   * @returns {Promise<number>} Number of events processed in this refresh.
   */
  refresh() {
    if (this._refreshPromise !== null) {
      return this._refreshPromise;
    }
    this._refreshPromise = this._doRefresh().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  async _doRefresh() {
    const events = await this.soroban.getEvents(this.nextLedger);
    this.metrics.applyEvents(events);
    const newest = events.map((event) => Number(event.ledger ?? event.ledgerClosedAt ?? 0)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (newest) this.nextLedger = newest + 1;
    return events.length;
  }
}
