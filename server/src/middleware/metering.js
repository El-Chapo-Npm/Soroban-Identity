'use strict';

const { createClient } = require('redis');
const { Pool } = require('pg');

/**
 * Usage metering middleware.
 *
 * Records per-endpoint, per-tenant API usage into Redis (fast counters) and
 * Postgres (durable records for invoicing). Enforces monthly quotas against
 * pricing tiers, detects overages, emits alerts, and computes usage-based
 * discounts.
 */

// ---------------------------------------------------------------------------
// Pricing tiers
// ---------------------------------------------------------------------------

const TIERS = {
  free: {
    name: 'free',
    includedCalls: 1000,
    basePriceCents: 0,
    overagePricePerCallCents: 0, // hard cap, no overage billing
    hardCap: true,
  },
  pro: {
    name: 'pro',
    includedCalls: 50000,
    basePriceCents: 4900,
    overagePricePerCallCents: 0.05, // $0.0005 per call
    hardCap: false,
  },
  enterprise: {
    name: 'enterprise',
    includedCalls: null, // custom, resolved per tenant
    basePriceCents: null,
    overagePricePerCallCents: null,
    hardCap: false,
  },
};

// Usage-based discount schedule. Applied to overage charges based on the
// percentage of the included quota consumed.
const DISCOUNT_SCHEDULE = [
  { minUtilization: 0.0, discount: 0.0 },
  { minUtilization: 0.5, discount: 0.05 },
  { minUtilization: 0.75, discount: 0.1 },
  { minUtilization: 0.9, discount: 0.15 },
];

// Overage alert thresholds (fraction of included quota).
const ALERT_THRESHOLDS = [0.8, 0.9, 1.0];

// Metering points -> endpoint matchers.
const METERING_POINTS = {
  credential_issuance: (req) =>
    /\/credentials?(\/|$)/i.test(req.path) && req.method === 'POST',
  verification: (req) =>
    /\/verif(y|ication)/i.test(req.path),
  did_resolution: (req) =>
    /\/dids?(\/|$)/i.test(req.path) && req.method === 'GET',
  storage: (req) =>
    /\/storage(\/|$)/i.test(req.path),
};

// ---------------------------------------------------------------------------
// Clients (lazily initialized, injectable for tests)
// ---------------------------------------------------------------------------

let redisClient = null;
let pgPool = null;
let initialized = false;

async function initClients() {
  if (initialized) return;
  initialized = true;

  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[metering] redis error:', err.message);
    });
    if (!redisClient.isOpen) {
      await redisClient.connect().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[metering] redis connect failed:', err.message);
      });
    }
  }

  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
}

/**
 * Allows tests / app bootstrap to inject clients.
 */
function setClients({ redis, pg } = {}) {
  if (redis) redisClient = redis;
  if (pg) pgPool = pg;
  initialized = true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentPeriod(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function usageKey(tenantId, period) {
  return `usage:${tenantId}:${period}`;
}

function endpointKey(tenantId, period, endpoint) {
  return `usage:${tenantId}:${period}:ep:${endpoint}`;
}

function alertKey(tenantId, period, threshold) {
  return `usage:${tenantId}:${period}:alert:${threshold}`;
}

function resolveTier(tenant) {
  const tierName = (tenant && tenant.tier) || 'free';
  const base = TIERS[tierName] || TIERS.free;
  if (tierName === 'enterprise') {
    return {
      ...base,
      includedCalls:
        tenant.includedCalls != null ? tenant.includedCalls : 500000,
      basePriceCents:
        tenant.basePriceCents != null ? tenant.basePriceCents : 49900,
      overagePricePerCallCents:
        tenant.overagePricePerCallCents != null
          ? tenant.overagePricePerCallCents
          : 0.03,
    };
  }
  return base;
}

function classifyMeteringPoint(req) {
  for (const [point, matcher] of Object.entries(METERING_POINTS)) {
    try {
      if (matcher(req)) return point;
    } catch (_) {
      // ignore matcher errors
    }
  }
  return 'api_call';
}

function computeDiscount(utilization) {
  let discount = 0;
  for (const step of DISCOUNT_SCHEDULE) {
    if (utilization >= step.minUtilization) discount = step.discount;
  }
  return discount;
}

/**
 * Computes the billable amount for a tenant given usage and tier.
 */
function computeBilling({ usage, tier }) {
  const included = tier.includedCalls || 0;
  const overageCalls = Math.max(0, usage - included);
  const utilization = included > 0 ? usage / included : 0;
  const discountRate = computeDiscount(utilization);
  const overageRawCents = overageCalls * (tier.overagePricePerCallCents || 0);
  const discountCents = Math.round(overageRawCents * discountRate);
  const overageCents = Math.round(overageRawCents) - discountCents;
  const totalCents = (tier.basePriceCents || 0) + overageCents;

  return {
    usage,
    includedCalls: included,
    overageCalls,
    utilization,
    discountRate,
    overageCents,
    discountCents,
    basePriceCents: tier.basePriceCents || 0,
    totalCents,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function recordToDb({
  tenantId,
  period,
  endpoint,
  meteringPoint,
  method,
  statusCode,
  timestamp,
}) {
  if (!pgPool) return;
  try {
    await pgPool.query(
      `INSERT INTO api_usage_events
         (tenant_id, period, endpoint, metering_point, method, status_code, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        period,
        endpoint,
        meteringPoint,
        method,
        statusCode,
        timestamp,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[metering] db insert failed:', err.message);
  }
}

async function incrementRedis(tenantId, period, endpoint) {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    const multi = redisClient.multi();
    multi.incr(usageKey(tenantId, period));
    multi.incr(endpointKey(tenantId, period, endpoint));
    const results = await multi.exec();
    // results[0] is the total count
    const total = results && results[0] != null ? Number(results[0]) : null;
    return total;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[metering] redis incr failed:', err.message);
    return null;
  }
}

async function getUsage(tenantId, period) {
  if (redisClient && redisClient.isOpen) {
    try {
      const val = await redisClient.get(usageKey(tenantId, period));
      if (val != null) return Number(val);
    } catch (_) {
      // fall through to db
    }
  }
  if (pgPool) {
    try {
      const res = await pgPool.query(
        `SELECT COUNT(*)::int AS count FROM api_usage_events
         WHERE tenant_id = $1 AND period = $2`,
        [tenantId, period]
      );
      return res.rows[0] ? res.rows[0].count : 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[metering] db count failed:', err.message);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

async function emitAlert({ tenantId, period, threshold, usage, tier, req }) {
  const payload = {
    type: 'usage_overage_alert',
    tenantId,
    period,
    threshold,
    usage,
    includedCalls: tier.includedCalls,
    utilization: tier.includedCalls ? usage / tier.includedCalls : 0,
    timestamp: new Date().toISOString(),
  };

  // eslint-disable-next-line no-console
  console.warn('[metering] overage alert:', JSON.stringify(payload));

  // Persist alert for the dashboard / notification workers.
  if (pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO usage_alerts
           (tenant_id, period, threshold, usage, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [tenantId, period, threshold, usage]
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[metering] alert persist failed:', err.message);
    }
  }

  // Allow an application-level hook (email, Slack, webhook) to be wired in.
  if (typeof module.exports.onAlert === 'function') {
    try {
      await module.exports.onAlert(payload, req);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[metering] alert hook failed:', err.message);
    }
  }
}

async function checkAlerts({ tenantId, period, usage, tier, req }) {
  if (!tier.includedCalls) return;
  const utilization = usage / tier.includedCalls;
  for (const threshold of ALERT_THRESHOLDS) {
    if (utilization < threshold) continue;
    const key = alertKey(tenantId, period, threshold);
    let alreadySent = false;
    if (redisClient && redisClient.isOpen) {
      try {
        const set = await redisClient.set(key, '1', { NX: true, EX: 60 * 60 * 24 * 40 });
        alreadySent = set === null;
      } catch (_) {
        alreadySent = false;
      }
    }
    if (!alreadySent) {
      await emitAlert({ tenantId, period, threshold, usage, tier, req });
    }
  }
}

// ---------------------------------------------------------------------------
// Quota enforcement
// ---------------------------------------------------------------------------

function quotaExceededResponse(res, { tier, usage, period }) {
  res.status(429).json({
    error: 'quota_exceeded',
    message: 'Monthly API usage quota exceeded for your plan.',
    tier: tier.name,
    period,
    usage,
    includedCalls: tier.includedCalls,
    upgradeUrl: '/billing/plans',
  });
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates the metering middleware.
 *
 * @param {object} [options]
 * @param {function} [options.getTenant] - resolves tenant from req
 * @param {boolean}  [options.enforceQuota=true] - enforce hard caps
 * @param {boolean}  [options.recordDb=true] - persist events to DB
 * @returns {function} express middleware
 */
function createMeteringMiddleware(options = {}) {
  const {
    getTenant = (req) => req.tenant || req.user || { id: req.tenantId, tier: 'free' },
    enforceQuota = true,
    recordDb = true,
  } = options;

  return async function meteringMiddleware(req, res, next) {
    try {
      await initClients();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[metering] init failed:', err.message);
      return next();
    }

    let tenant;
    try {
      tenant = getTenant(req) || {};
    } catch (_) {
      tenant = {};
    }

    const tenantId = tenant.id || tenant.tenantId || req.tenantId;
    if (!tenantId) {
      // No tenant context: skip metering.
      return next();
    }

    const period = currentPeriod();
    const tier = resolveTier(tenant);
    const endpoint = `${req.method} ${req.baseUrl || ''}${req.route ? req.route.path : req.path}`;
    const meteringPoint = classifyMeteringPoint(req);

    // Pre-check quota (best-effort, based on current counter).
    if (enforceQuota && tier.hardCap) {
      const usage = await getUsage(tenantId, period);
      if (usage >= tier.includedCalls) {
        return quotaExceededResponse(res, { tier, usage, period });
      }
    }

    // Record the call. We increment on request start so that concurrent
    // requests are counted even if the handler fails.
    const timestamp = new Date();
    const total = await incrementRedis(tenantId, period, endpoint);

    if (recordDb) {
      // Fire-and-forget; do not block the request.
      recordToDb({
        tenantId,
        period,
        endpoint,
        meteringPoint,
        method: req.method,
        statusCode: null,
        timestamp,
      }).catch(() => {});
    }

    // Attach usage info for downstream handlers / dashboard.
    req.usage = {
      tenantId,
      period,
      tier: tier.name,
      meteringPoint,
      total: total != null ? total : undefined,
    };

    // Post-response hooks: finalize status code, check alerts.
    res.on('finish', () => {
      const usage = total != null ? total : null;
      if (usage != null) {
        checkAlerts({ tenantId, period, usage, tier, req }).catch(() => {});
      }
      if (recordDb && pgPool) {
        pgPool
          .query(
            `UPDATE api_usage_events
             SET status_code = $1
             WHERE tenant_id = $2 AND period = $3 AND endpoint = $4
               AND status_code IS NULL
               AND occurred_at = $5`,
            [res.statusCode, tenantId, period, endpoint, timestamp]
          )
          .catch(() => {});
      }
    });

    return next();
  };
}

// ---------------------------------------------------------------------------
// Dashboard / invoicing helpers
// ---------------------------------------------------------------------------

/**
 * Returns a usage summary for the dashboard.
 */
async function getUsageSummary(tenantId, period = currentPeriod()) {
  await initClients();
  const tier = resolveTier({ id: tenantId, tier: 'free' });
  const usage = await getUsage(tenantId, period);

  let byEndpoint = {};
  if (redisClient && redisClient.isOpen) {
    try {
      const keys = await redisClient.keys(`usage:${tenantId}:${period}:ep:*`);
      if (keys.length) {
        const values = await redisClient.mGet(keys);
        keys.forEach((k, i) => {
          const ep = k.split(':ep:')[1];
          byEndpoint[ep] = Number(values[i] || 0);
        });
      }
    } catch (_) {
      byEndpoint = {};
    }
  }

  const billing = computeBilling({ usage, tier });
  return {
    tenantId,
    period,
    tier: tier.name,
    usage,
    byEndpoint,
    billing,
  };
}

/**
 * Generates a monthly invoice record for a tenant.
 */
async function generateInvoice(tenantId, period = currentPeriod(), tenant = {}) {
  await initClients();
  const tier = resolveTier({ id: tenantId, ...tenant });
  const usage = await getUsage(tenantId, period);
  const billing = computeBilling({ usage, tier });

  const invoice = {
    tenantId,
    period,
    tier: tier.name,
    usage,
    includedCalls: billing.includedCalls,
    overageCalls: billing.overageCalls,
    discountRate: billing.discountRate,
    discountCents: billing.discountCents,
    basePriceCents: billing.basePriceCents,
    overageCents: billing.overageCents,
    totalCents: billing.totalCents,
    currency: 'usd',
    status: 'draft',
    createdAt: new Date().toISOString(),
  };

  if (pgPool) {
    try {
      const res = await pgPool.query(
        `INSERT INTO invoices
           (tenant_id, period, tier, usage, included_calls, overage_calls,
            discount_rate, discount_cents, base_price_cents, overage_cents,
            total_cents, currency, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         RETURNING id`,
        [
          tenantId,
          period,
          invoice.tier,
          invoice.usage,
          invoice.includedCalls,
          invoice.overageCalls,
          invoice.discountRate,
          invoice.discountCents,
          invoice.basePriceCents,
          invoice.overageCents,
          invoice.totalCents,
          invoice.currency,
          invoice.status,
        ]
      );
      if (res.rows[0]) invoice.id = res.rows[0].id;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[metering] invoice persist failed:', err.message);
    }
  }

  return invoice;
}

module.exports = {
  createMeteringMiddleware,
  meteringMiddleware: createMeteringMiddleware(),
  getUsageSummary,
  generateInvoice,
  computeBilling,
  computeDiscount,
  resolveTier,
  currentPeriod,
  setClients,
  TIERS,
  DISCOUNT_SCHEDULE,
  ALERT_THRESHOLDS,
  METERING_POINTS,
  onAlert: null,
};