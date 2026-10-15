import { MetricsService } from '../services/metricsService.js';

const metrics = new MetricsService();

export const gatewayMetrics = {
  recordRequest({ method, path, status, durationMs }) {
    metrics.incrementCounter('gateway_requests_total', {
      method: method || 'unknown',
      path: path || 'unknown',
      status: String(status || 'unknown'),
    });
    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
      metrics.observeHistogram('gateway_request_duration_ms', durationMs, {
        method: method || 'unknown',
        path: path || 'unknown',
      });
    }
  },

  recordAuthFailure({ reason, path }) {
    metrics.incrementCounter('gateway_auth_failures_total', {
      reason: reason || 'unknown',
      path: path || 'unknown',
    });
  },

  recordRateLimitDenial({ key, path }) {
    metrics.incrementCounter('gateway_rate_limit_denials_total', {
      key: key || 'unknown',
      path: path || 'unknown',
    });
  },

  recordCircuitBreakerEvent({ name, event }) {
    metrics.incrementCounter('gateway_circuit_breaker_events_total', {
      name: name || 'unknown',
      event: event || 'unknown',
    });
  },

  recordPluginExecution({ plugin, outcome, durationMs }) {
    metrics.incrementCounter('gateway_plugin_executions_total', {
      plugin: plugin || 'unknown',
      outcome: outcome || 'unknown',
    });
    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
      metrics.observeHistogram('gateway_plugin_execution_duration_ms', durationMs, {
        plugin: plugin || 'unknown',
      });
    }
  },

  snapshot() {
    return metrics.snapshot();
  },
};

export default gatewayMetrics;
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>