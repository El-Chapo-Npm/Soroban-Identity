const CircuitBreaker = require('../utils/circuit-breaker');
const logger = require('../utils/logger');

/**
 * Gateway-level circuit breaker.
 *
 * Wraps the shared circuit-breaker utility so that downstream Soroban/RPC
 * calls made through the gateway are protected. Exposes a `call(fn, options)`
 * helper and surfaces breaker state for gateway metrics.
 */

const DEFAULT_OPTIONS = {
  name: 'gateway-downstream',
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

class GatewayCircuitBreaker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.name = this.options.name;

    this.breaker = new CircuitBreaker(this._execute.bind(this), {
      timeout: this.options.timeout,
      errorThresholdPercentage: this.options.errorThresholdPercentage,
      resetTimeout: this.options.resetTimeout,
      volumeThreshold: this.options.volumeThreshold,
    });

    this._registerEvents();
  }

  _registerEvents() {
    this.breaker.on('open', () => {
      logger.warn(`[gateway-circuit-breaker] Circuit "${this.name}" opened`);
    });

    this.breaker.on('halfOpen', () => {
      logger.info(`[gateway-circuit-breaker] Circuit "${this.name}" half-open`);
    });

    this.breaker.on('close', () => {
      logger.info(`[gateway-circuit-breaker] Circuit "${this.name}" closed`);
    });

    this.breaker.on('timeout', () => {
      logger.warn(`[gateway-circuit-breaker] Circuit "${this.name}" timed out`);
    });

    this.breaker.on('reject', () => {
      logger.warn(`[gateway-circuit-breaker] Circuit "${this.name}" rejected call`);
    });

    this.breaker.on('failure', (err) => {
      logger.error(
        `[gateway-circuit-breaker] Circuit "${this.name}" failure: ${err && err.message}`
      );
    });
  }

  /**
   * Executes the provided function under circuit breaker protection.
   * @param {Function} fn - Async function performing the downstream call.
   * @param {Object} [options] - Per-call options.
   * @param {*} [options.fallback] - Value or function returned when the call fails.
   * @returns {Promise<*>}
   */
  async _execute(fn, options = {}) {
    try {
      return await fn();
    } catch (err) {
      if (typeof options.fallback === 'function') {
        return options.fallback(err);
      }
      if (options.fallback !== undefined) {
        return options.fallback;
      }
      throw err;
    }
  }

  /**
   * Public helper to run a downstream call through the breaker.
   * @param {Function} fn - Async function performing the downstream call.
   * @param {Object} [options] - Per-call options (e.g. fallback).
   * @returns {Promise<*>}
   */
  async call(fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new TypeError('gateway circuit breaker call() requires a function');
    }
    return this.breaker.fire(fn, options);
  }

  /**
   * Returns the current breaker state for metrics reporting.
   * @returns {{name: string, state: string, stats: Object}}
   */
  getState() {
    return {
      name: this.name,
      state: this.breaker.opened
        ? 'open'
        : this.breaker.halfOpen
        ? 'half-open'
        : 'closed',
      stats: this.breaker.stats || {},
    };
  }

  /**
   * Convenience accessor for the underlying breaker state string.
   * @returns {string}
   */
  get status() {
    return this.getState().state;
  }

  /**
   * Resets the breaker to a closed state.
   */
  reset() {
    if (typeof this.breaker.close === 'function') {
      this.breaker.close();
    }
  }
}

module.exports = GatewayCircuitBreaker;
module.exports.GatewayCircuitBreaker = GatewayCircuitBreaker;
module.exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;