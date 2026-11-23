'use strict';

const crypto = require('crypto');

/**
 * Billing service for API usage metering and billing.
 *
 * Provides tiered pricing, monthly invoice generation, Stripe integration,
 * usage dashboard aggregation, overage alerts, and usage-based discounts.
 */

const PRICING_TIERS = {
  free: {
    name: 'Free',
    monthlyIncludedCalls: 1000,
    basePriceCents: 0,
    overagePricePerCallCents: 0,
    maxOverageCalls: 0,
    features: ['basic'],
  },
  pro: {
    name: 'Pro',
    monthlyIncludedCalls: 50000,
    basePriceCents: 4900,
    overagePricePerCallCents: 1, // $0.01 per call
    maxOverageCalls: 100000,
    features: ['basic', 'priority_support', 'analytics'],
  },
  enterprise: {
    name: 'Enterprise',
    monthlyIncludedCalls: null, // custom
    basePriceCents: null, // custom
    overagePricePerCallCents: null, // custom
    maxOverageCalls: null,
    features: ['basic', 'priority_support', 'analytics', 'sla', 'dedicated_support'],
  },
};

const METERING_POINTS = [
  'credential_issuance',
  'verification_request',
  'did_resolution',
  'storage_usage',
];

const OVERAGE_ALERT_THRESHOLDS = [0.5, 0.8, 0.9, 1.0];

function nowIso() {
  return new Date().toISOString();
}

function monthKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(date = new Date()) {
  const d = new Date(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

class BillingError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'BillingError';
    this.code = code || 'BILLING_ERROR';
    this.statusCode = statusCode || 400;
  }
}

class BillingService {
  /**
   * @param {Object} options
   * @param {Object} options.store - persistence adapter (see InMemoryBillingStore)
   * @param {Object} [options.stripe] - Stripe client (must expose invoices.create, customers.create, etc.)
   * @param {Object} [options.logger] - logger with info/warn/error
   * @param {Function} [options.now] - clock function returning Date
   */
  constructor(options = {}) {
    if (!options.store) {
      throw new BillingError('BillingService requires a store', 'MISSING_STORE', 500);
    }
    this.store = options.store;
    this.stripe = options.stripe || null;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.pricingTiers = options.pricingTiers || PRICING_TIERS;
  }

  // ---------------------------------------------------------------------------
  // Tier / customer management
  // ---------------------------------------------------------------------------

  getPricingTiers() {
    return Object.entries(this.pricingTiers).map(([key, tier]) => ({
      id: key,
      ...tier,
    }));
  }

  getTier(tierId) {
    const tier = this.pricingTiers[tierId];
    if (!tier) {
      throw new BillingError(`Unknown pricing tier: ${tierId}`, 'UNKNOWN_TIER', 400);
    }
    return tier;
  }

  async getOrCreateCustomer(customerId, options = {}) {
    if (!customerId) {
      throw new BillingError('customerId is required', 'MISSING_CUSTOMER_ID', 400);
    }
    let customer = await this.store.getCustomer(customerId);
    if (!customer) {
      const tierId = options.tier || 'free';
      this.getTier(tierId);
      customer = {
        id: customerId,
        tier: tierId,
        email: options.email || null,
        stripeCustomerId: options.stripeCustomerId || null,
        customPricing: options.customPricing || null,
        discounts: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await this.store.saveCustomer(customer);
    }
    return customer;
  }

  async updateCustomerTier(customerId, tierId, customPricing) {
    const customer = await this.getOrCreateCustomer(customerId);
    this.getTier(tierId);
    customer.tier = tierId;
    if (customPricing) {
      customer.customPricing = customPricing;
    }
    customer.updatedAt = nowIso();
    await this.store.saveCustomer(customer);
    return customer;
  }

  // ---------------------------------------------------------------------------
  // Usage metering
  // ---------------------------------------------------------------------------

  async recordUsage(customerId, meteringPoint, quantity = 1, metadata = {}) {
    if (!METERING_POINTS.includes(meteringPoint)) {
      throw new BillingError(
        `Unknown metering point: ${meteringPoint}`,
        'UNKNOWN_METERING_POINT',
        400
      );
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new BillingError('quantity must be a non-negative number', 'INVALID_QUANTITY', 400);
    }
    await this.getOrCreateCustomer(customerId);
    const period = monthKey(this.now());
    const record = {
      id: crypto.randomUUID(),
      customerId,
      meteringPoint,
      quantity: qty,
      period,
      metadata,
      timestamp: nowIso(),
    };
    await this.store.addUsageRecord(record);
    return record;
  }

  async getUsage(customerId, period) {
    const p = period || monthKey(this.now());
    const records = await this.store.getUsageRecords(customerId, p);
    const totals = {};
    for (const point of METERING_POINTS) {
      totals[point] = 0;
    }
    for (const r of records) {
      totals[r.meteringPoint] = (totals[r.meteringPoint] || 0) + r.quantity;
    }
    const totalCalls = totals.credential_issuance + totals.verification_request + totals.did_resolution;
    return {
      customerId,
      period: p,
      totals,
      totalCalls,
      recordCount: records.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Quota enforcement
  // ---------------------------------------------------------------------------

  async checkQuota(customerId, meteringPoint) {
    const customer = await this.getOrCreateCustomer(customerId);
    const tier = this.getTier(customer.tier);
    const usage = await this.getUsage(customerId);
    const included = this._includedCalls(customer, tier);
    const used = usage.totalCalls;
    const remaining = included == null ? null : Math.max(0, included - used);
    const exceeded = included != null && used >= included;
    const overage = included != null ? Math.max(0, used - included) : 0;
    return {
      customerId,
      tier: customer.tier,
      meteringPoint,
      included,
      used,
      remaining,
      exceeded,
      overage,
      allowed: !exceeded || this._overageAllowed(customer, tier, overage),
    };
  }

  async enforceQuota(customerId, meteringPoint) {
    const status = await this.checkQuota(customerId, meteringPoint);
    if (!status.allowed) {
      throw new BillingError(
        `Usage quota exceeded for customer ${customerId} (${status.used}/${status.included})`,
        'QUOTA_EXCEEDED',
        429
      );
    }
    return status;
  }

  _includedCalls(customer, tier) {
    if (customer.customPricing && customer.customPricing.monthlyIncludedCalls != null) {
      return customer.customPricing.monthlyIncludedCalls;
    }
    return tier.monthlyIncludedCalls;
  }

  _overageAllowed(customer, tier, overage) {
    const maxOverage =
      customer.customPricing && customer.customPricing.maxOverageCalls != null
        ? customer.customPricing.maxOverageCalls
        : tier.maxOverageCalls;
    if (maxOverage == null) return true;
    return overage <= maxOverage;
  }

  // ---------------------------------------------------------------------------
  // Discounts
  // ---------------------------------------------------------------------------

  async applyDiscount(customerId, discount) {
    if (!discount || typeof discount !== 'object') {
      throw new BillingError('discount object is required', 'INVALID_DISCOUNT', 400);
    }
    const customer = await this.getOrCreateCustomer(customerId);
    const normalized = this._normalizeDiscount(discount);
    customer.discounts = customer.discounts || [];
    customer.discounts.push(normalized);
    customer.updatedAt = nowIso();
    await this.store.saveCustomer(customer);
    return normalized;
  }

  async removeDiscount(customerId, discountId) {
    const customer = await this.getOrCreateCustomer(customerId);
    const before = (customer.discounts || []).length;
    customer.discounts = (customer.discounts || []).filter((d) => d.id !== discountId);
    customer.updatedAt = nowIso();
    await this.store.saveCustomer(customer);
    return { removed: before !== customer.discounts.length };
  }

  _normalizeDiscount(discount) {
    const type = discount.type || 'percentage';
    if (!['percentage', 'fixed', 'usage_tier'].includes(type)) {
      throw new BillingError(`Unknown discount type: ${type}`, 'INVALID_DISCOUNT', 400);
    }
    const normalized = {
      id: discount.id || crypto.randomUUID(),
      type,
      description: discount.description || null,
      createdAt: nowIso(),
    };
    if (type === 'percentage') {
      const value = Number(discount.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new BillingError('percentage discount value must be 0-100', 'INVALID_DISCOUNT', 400);
      }
      normalized.value = value;
    } else if (type === 'fixed') {
      const value = Number(discount.value);
      if (!Number.isFinite(value) || value < 0) {
        throw new BillingError('fixed discount value must be >= 0', 'INVALID_DISCOUNT', 400);
      }
      normalized.value = value;
    } else if (type === 'usage_tier') {
      // Usage-based discount: applies when usage exceeds thresholdCalls.
      const thresholdCalls = Number(discount.thresholdCalls);
      const percentage = Number(discount.percentage);
      if (!Number.isFinite(thresholdCalls) || thresholdCalls < 0) {
        throw new BillingError('thresholdCalls must be >= 0', 'INVALID_DISCOUNT', 400);
      }
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new BillingError('percentage must be 0-100', 'INVALID_DISCOUNT', 400);
      }
      normalized.thresholdCalls = thresholdCalls;
      normalized.percentage = percentage;
    }
    if (discount.expiresAt) {
      normalized.expiresAt = discount.expiresAt;
    }
    return normalized;
  }

  _activeDiscounts(customer, usage) {
    const now = this.now().getTime();
    return (customer.discounts || []).filter((d) => {
      if (d.expiresAt && new Date(d.expiresAt).getTime() < now) return false;
      if (d.type === 'usage_tier') {
        return usage.totalCalls >= d.thresholdCalls;
      }
      return true;
    });
  }

  _applyDiscountsToAmount(amountCents, discounts) {
    let amount = amountCents;
    const applied = [];
    for (const d of discounts) {
      let reduction = 0;
      if (d.type === 'percentage') {
        reduction = Math.round((amount * d.value) / 100);
      } else if (d.type === 'fixed') {
        reduction = toCents(d.value);
      } else if (d.type === 'usage_tier') {
        reduction = Math.round((amount * d.percentage) / 100);
      }
      reduction = Math.min(reduction, amount);
      amount -= reduction;
      applied.push({ id: d.id, type: d.type, reductionCents: reduction });
    }
    return { amountCents: amount, applied };
  }

  // ---------------------------------------------------------------------------
  // Invoice generation
  // ---------------------------------------------------------------------------

  async calculateInvoice(customerId, period) {
    const customer = await this.getOrCreateCustomer(customerId);
    const tier = this.getTier(customer.tier);
    const p = period || monthKey(this.now());
    const usage = await this.getUsage(customerId, p);

    const included = this._includedCalls(customer, tier);
    const basePriceCents =
      customer.customPricing && customer.customPricing.basePriceCents != null
        ? customer.customPricing.basePriceCents
        : tier.basePriceCents || 0;

    const overagePricePerCallCents =
      customer.customPricing && customer.customPricing.overagePricePerCallCents != null
        ? customer.customPricing.overagePricePerCallCents
        : tier.overagePricePerCallCents || 0;

    const overageCalls = included == null ? 0 : Math.max(0, usage.totalCalls - included);
    const overageCents = overageCalls * overagePricePerCallCents;

    const lineItems = [];
    lineItems.push({
      description: `${tier.name} plan base fee (${p})`,
      quantity: 1,
      unitAmountCents: basePriceCents,
      amountCents: basePriceCents,
    });

    if (included != null) {
      lineItems.push({
        description: `Included API calls (${included})`,
        quantity: included,
        unitAmountCents: 0,
        amountCents: 0,
      });
    }

    if (overageCalls > 0) {
      lineItems.push({
        description: `Overage API calls (${overageCalls} @ $${(overagePricePerCallCents / 100).toFixed(4)})`,
        quantity: overageCalls,
        unitAmountCents: overagePricePerCallCents,
        amountCents: overageCents,
      });
    }

    const subtotalCents = basePriceCents + overageCents;
    const activeDiscounts = this._activeDiscounts(customer, usage);
    const { amountCents: totalCents, applied } = this._applyDiscountsToAmount(
      subtotalCents,
      activeDiscounts
    );

    return {
      customerId,
      period: p,
      tier: customer.tier,
      usage,
      lineItems,
      subtotalCents,
      discounts: applied,
      totalCents,
      currency: 'usd',
      generatedAt: nowIso(),
    };
  }

  async generateInvoice(customerId, period, options = {}) {
    const customer = await this.getOrCreateCustomer(customerId);
    const calculation = await this.calculateInvoice(customerId, period);

    const invoice = {
      id: crypto.randomUUID(),
      customerId,
      period: calculation.period,
      status: 'draft',
      currency: calculation.currency,
      lineItems: calculation.lineItems,
      subtotalCents: calculation.subtotalCents,
      discounts: calculation.discounts,
      totalCents: calculation.totalCents,
      usage: calculation.usage,
      stripeInvoiceId: null,
      createdAt: nowIso(),
    };

    if (this.stripe && options.finalize !== false) {
      try {
        const stripeInvoice = await this._createStripeInvoice(customer, invoice);
        invoice.stripeInvoiceId = stripeInvoice.id;
        invoice.status = stripeInvoice.status || 'open';
        invoice.hostedInvoiceUrl = stripeInvoice.hosted_invoice_url || null;
      } catch (err) {
        this.logger.error('Failed to create Stripe invoice', err);
        invoice.status = 'draft';
        invoice.stripeError = err.message;
        if (options.throwOnStripeError) {
          throw err;
        }
      }
    }

    await this.store.saveInvoice(invoice);
    return invoice;
  }

  async _createStripeInvoice(customer, invoice) {
    if (!this.stripe) {
      throw new BillingError('Stripe client not configured', 'STRIPE_NOT_CONFIGURED', 500);
    }
    let stripeCustomerId = customer.stripeCustomerId;
    if (!stripeCustomerId) {
      const created = await this.stripe.customers.create({
        email: customer.email || undefined,
        metadata: { customerId: customer.id },
      });
      stripeCustomerId = created.id;
      customer.stripeCustomerId = stripeCustomerId;
      customer.updatedAt = nowIso();
      await this.store.saveCustomer(customer);
    }

    const stripeInvoice = await this.stripe.invoices.create({
      customer: stripeCustomerId,
      auto_advance: false,
      collection_method: 'charge_automatically',
      metadata: {
        customerId: customer.id,
        period: invoice.period,
        internalInvoiceId: invoice.id,
      },
    });

    for (const item of invoice.lineItems) {
      if (item.amountCents === 0) continue;
      await this.stripe.invoiceItems.create({
        customer: stripeCustomerId,
        invoice: stripeInvoice.id,
        amount: item.amountCents,
        currency: invoice.currency,
        description: item.description,
      });
    }

    if (invoice.discounts && invoice.discounts.length > 0) {
      const totalReduction = invoice.discounts.reduce((s, d) => s + d.reductionCents, 0);
      if (totalReduction > 0) {
        await this.stripe.invoiceItems.create({
          customer: stripeCustomerId,
          invoice: stripeInvoice.id,
          amount: -totalReduction,
          currency: invoice.currency,
          description: 'Discounts applied',
        });
      }
    }

    const finalized = await this.stripe.invoices.finalizeInvoice(stripeInvoice.id);
    return finalized;
  }

  async getInvoice(invoiceId) {
    return this.store.getInvoice(invoiceId);
  }

  async listInvoices(customerId, options = {}) {
    return this.store.listInvoices(customerId, options);
  }

  // ---------------------------------------------------------------------------
  // Overage alerts
  // ---------------------------------------------------------------------------

  async checkOverageAlerts(customerId) {
    const customer = await this.getOrCreateCustomer(customerId);
    const tier = this.getTier(customer.tier);
    const usage = await this.getUsage(customerId);
    const included = this._includedCalls(customer, tier);
    if (included == null || included === 0) {
      return { customerId, alerts: [] };
    }
    const ratio = usage.totalCalls / included;
    const alerts = [];
    for (const threshold of OVERAGE_ALERT_THRESHOLDS) {
      if (ratio >= threshold) {
        alerts.push({
          customerId,
          period: usage.period,
          threshold,
          ratio,
          used: usage.totalCalls,
          included,
          severity: threshold >= 1.0 ? 'critical' : threshold >= 0.9 ? 'high' : 'warning',
          message:
            threshold >= 1.0
              ? `Usage quota exceeded (${usage.totalCalls}/${included})`
              : `Usage at ${Math.round(ratio * 100)}% of quota (${usage.totalCalls}/${included})`,
        });
      }
    }
    return { customerId, alerts };
  }

  // ---------------------------------------------------------------------------
  // Usage dashboard
  // ---------------------------------------------------------------------------

  async getUsageDashboard(customerId, options = {}) {
    const customer = await this.getOrCreateCustomer(customerId);
    const tier = this.getTier(customer.tier);
    const currentPeriod = monthKey(this.now());
    const usage = await this.getUsage(customerId, currentPeriod);
    const included = this._includedCalls(customer, tier);

    const historyMonths = options.historyMonths || 6;
    const history = [];
    const base = this.now();
    for (let i = 0; i < historyMonths; i += 1) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
      const p = monthKey(d);
      const u = await this.getUsage(customerId, p);
      history.push({
        period: p,
        totalCalls: u.totalCalls,
        totals: u.totals,
      });
    }
    history.reverse();

    const projection = await this.calculateInvoice(customerId, currentPeriod);
    const alerts = (await this.checkOverageAlerts(customerId)).alerts;

    return {
      customerId,
      tier: customer.tier,
      tierName: tier.name,
      period: currentPeriod,
      included,
      used: usage.totalCalls,
      remaining: included == null ? null : Math.max(0, included - usage.totalCalls),
      percentUsed: included ? Math.min(100, Math.round((usage.totalCalls / included) * 100)) : null,
      breakdown: usage.totals,
      history,
      projectedInvoice: {
        subtotalCents: projection.subtotalCents,
        discounts: projection.discounts,
        totalCents: projection.totalCents,
        currency: projection.currency,
      },
      alerts,
      discounts: customer.discounts || [],
    };
  }

  // ---------------------------------------------------------------------------
  // Monthly invoice run
  // ---------------------------------------------------------------------------

  async generateMonthlyInvoices(period, options = {}) {
    const p = period || monthKey(new Date(Date.UTC(this.now().getUTCFullYear(), this.now().getUTCMonth() - 1, 1)));
    const customers = await this.store.listCustomers();
    const results = [];
    for (const customer of customers) {
      try {
        const invoice = await this.generateInvoice(customer.id, p, options);
        results.push({ customerId: customer.id, invoiceId: invoice.id, status: invoice.status });
      } catch (err) {
        this.logger.error(`Failed to generate invoice for ${customer.id}`, err);
        results.push({ customerId: customer.id, error: err.message });
      }
    }
    return { period: p, results };
  }
}

/**
 * Simple in-memory persistence adapter. Production deployments should provide
 * a database-backed implementation with the same interface.
 */
class InMemoryBillingStore {
  constructor() {
    this.customers = new Map();
    this.usage = new Map(); // key: `${customerId}:${period}` -> records[]
    this.invoices = new Map();
  }

  async getCustomer(id) {
    return this.customers.get(id) || null;
  }

  async saveCustomer(customer) {
    this.customers.set(customer.id, customer);
    return customer;
  }

  async listCustomers() {
    return Array.from(this.customers.values());
  }

  async addUsageRecord(record) {
    const key = `${record.customerId}:${record.period}`;
    const list = this.usage.get(key) || [];
    list.push(record);
    this.usage.set(key, list);
    return record;
  }

  async getUsageRecords(customerId, period) {
    return this.usage.get(`${customerId}:${period}`) || [];
  }

  async saveInvoice(invoice) {
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  async getInvoice(id) {
    return this.invoices.get(id) || null;
  }

  async listInvoices(customerId, options = {}) {
    const all = Array.from(this.invoices.values()).filter((i) => i.customerId === customerId);
    all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const limit = options.limit || all.length;
    return all.slice(0, limit);
  }
}

module.exports = {
  BillingService,
  BillingError,
  InMemoryBillingStore,
  PRICING_TIERS,
  METERING_POINTS,
  OVERAGE_ALERT_THRESHOLDS,
  monthKey,
  monthRange,
};