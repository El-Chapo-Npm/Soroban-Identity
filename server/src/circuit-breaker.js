import { EventEmitter } from 'node:events';
import { logger } from './logger.js';
import { logCircuitBreakerState } from './soroban-tracing.js';

const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

export class SorobanUnavailableError extends Error {
  constructor(message = 'Soroban RPC is unavailable') {
    super(message);
    this.name = 'SorobanUnavailableError';
  }
}

/**
 * Three-state circuit breaker for Soroban RPC calls.
 *
 * States:
 *   CLOSED    — normal operation; failures are counted.
 *   OPEN      — failing fast; calls reject immediately without hitting the RPC.
 *   HALF_OPEN — probing; a success closes the breaker, a failure reopens it.
 *
 * Configuration (all optional, defaults shown):
 *   failureThreshold  5     — consecutive failures before opening.
 *   successThreshold  2     — consecutive successes in HALF_OPEN before closing.
 *   openDurationMs    30000 — ms to wait in OPEN before probing.
 *   timeoutMs         10000 — max duration for a call before timing out (0 = disabled).
 *   enabled           true  — master switch to enable/disable breaker logic.
 *   onStateChange     null  — optional callback on state transitions.
 */
export class CircuitBreaker extends EventEmitter {
  #state = STATE.CLOSED;
  #failures = 0;
  #successes = 0;
  #rejects = 0;
  #fallbacks = 0;
  #breaks = 0;
  #openedAt = null;
  #lastStateChange;
  #cfg;

  constructor({
    failureThreshold = 5,
    successThreshold = 2,
    openDurationMs = 30_000,
    timeoutMs = 10_000,
    enabled = true,
    onStateChange = null,
  } = {}) {
    super();
    this.#cfg = { failureThreshold, successThreshold, openDurationMs, timeoutMs, enabled, onStateChange };
    this.#lastStateChange = new Date().toISOString();
  }

  get state() { return this.#state; }
  get failures() { return this.#failures; }
  get rejects() { return this.#rejects; }
  get fallbacks() { return this.#fallbacks; }
  get breaks() { return this.#breaks; }
  get lastStateChange() { return this.#lastStateChange; }
  get enabled() { return this.#cfg.enabled; }

  /**
   * Execute `fn`. In OPEN state rejects immediately (or invokes fallbackFn).
   * In CLOSED/HALF_OPEN, runs `fn` with timeout protection and updates counters.
   *
   * @param {() => Promise<any>} fn
   * @param {object} [options]
   * @param {(err: Error) => any} [options.fallbackFn] - Fallback handler when call fails or circuit is OPEN
   * @param {number} [options.timeoutMs] - Override call timeout in ms
   */
  async call(fn, { fallbackFn = null, timeoutMs = undefined } = {}) {
    if (!this.#cfg.enabled) {
      return fn();
    }

    if (this.#state === STATE.OPEN) {
      if (Date.now() - this.#openedAt >= this.#cfg.openDurationMs) {
        this.#transition(STATE.HALF_OPEN, 'Open duration elapsed');
      } else {
        this.#rejects++;
        this.emit('reject');
        const err = new SorobanUnavailableError('Circuit breaker is OPEN — Soroban RPC is unavailable');
        if (typeof fallbackFn === 'function') {
          this.#fallbacks++;
          this.emit('fallback', { error: err, state: this.#state });
          return fallbackFn(err);
        }
        throw err;
      }
    }

    const effectiveTimeout = timeoutMs ?? this.#cfg.timeoutMs;
    try {
      let result;
      if (effectiveTimeout && effectiveTimeout > 0) {
        let timerId;
        const timeoutPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => {
            reject(new Error(`Circuit breaker operation timed out after ${effectiveTimeout}ms`));
          }, effectiveTimeout);
        });
        try {
          result = await Promise.race([fn(), timeoutPromise]);
        } finally {
          clearTimeout(timerId);
        }
      } else {
        result = await fn();
      }

      this.#onSuccess();
      return result;
    } catch (err) {
      this.#onFailure(err);
      if (typeof fallbackFn === 'function') {
        this.#fallbacks++;
        this.emit('fallback', { error: err, state: this.#state });
        return fallbackFn(err);
      }
      throw err;
    }
  }

  #onSuccess() {
    if (this.#state === STATE.HALF_OPEN) {
      this.#successes++;
      if (this.#successes >= this.#cfg.successThreshold) {
        this.#failures = 0;
        this.#successes = 0;
        this.#transition(STATE.CLOSED, 'Success threshold met in HALF_OPEN');
      }
    } else {
      this.#failures = 0;
    }
  }

  #onFailure(err) {
    this.#failures++;
    this.emit('failure', { error: err, state: this.#state, failures: this.#failures });
    if (this.#state === STATE.HALF_OPEN || this.#failures >= this.#cfg.failureThreshold) {
      this.#openedAt = Date.now();
      this.#successes = 0;
      this.#breaks++;
      this.emit('break', { failures: this.#failures, error: err });
      this.#transition(STATE.OPEN, err ? err.message : 'Failure threshold reached');
    }
  }

  #transition(newState, reason = '') {
    const prev = this.#state;
    this.#state = newState;
    this.#lastStateChange = new Date().toISOString();

    if (newState === STATE.OPEN) {
      logger.error({ from: prev, to: newState, failures: this.#failures, reason }, 'Circuit breaker TRIPPED OPEN — Soroban RPC endpoint failing');
    } else {
      logger.info({ from: prev, to: newState, failures: this.#failures, reason }, 'Circuit breaker state transition');
    }

    try {
      logCircuitBreakerState(newState.toLowerCase(), reason);
    } catch {
      // Ignore tracing failures
    }

    const payload = { from: prev, to: newState, reason, failures: this.#failures };
    this.emit('stateChange', payload);
    if (newState === STATE.OPEN) this.emit('open', payload);
    else if (newState === STATE.HALF_OPEN) this.emit('halfOpen', payload);
    else if (newState === STATE.CLOSED) this.emit('close', payload);

    if (typeof this.#cfg.onStateChange === 'function') {
      try {
        this.#cfg.onStateChange(payload);
      } catch (err) {
        logger.error({ err }, 'Error in onStateChange callback');
      }
    }
  }

  /** Snapshot suitable for inclusion in the /health response. */
  toHealthInfo() {
    return {
      state: this.#state,
      failures: this.#failures,
      rejects: this.#rejects,
      fallbacks: this.#fallbacks,
      breaks: this.#breaks,
      lastStateChange: this.#lastStateChange,
      enabled: this.#cfg.enabled,
      openDurationMs: this.#cfg.openDurationMs,
      failureThreshold: this.#cfg.failureThreshold,
      successThreshold: this.#cfg.successThreshold,
      timeoutMs: this.#cfg.timeoutMs,
    };
  }
}

