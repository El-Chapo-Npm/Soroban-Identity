/**
 * Compliance reporting (#1117): GDPR exports, right to be forgotten, consent
 * tracking, retention policies, SOC2 evidence and automated checks.
 *
 * Storage is abstracted behind a `store` with `listSubjectData(subjectId)`,
 * `deleteSubjectData(subjectId)` and `purgeOlderThan(category, cutoffDate)`
 * so it can sit in front of any backing database.
 */

import crypto from 'node:crypto';

export const DEFAULT_RETENTION_DAYS = {
  audit_logs: 365 * 7,
  access_logs: 365,
  analytics_events: 395,
  expired_credentials: 90,
};

export const SOC2_CONTROLS = {
  'CC6.1': 'Logical access controls restrict access to authorised users',
  'CC6.7': 'Data is encrypted in transit and at rest',
  'CC7.2': 'System activity is monitored and logged',
  'CC8.1': 'Changes are authorised, tested and approved',
  'P4.2': 'Personal information is retained per policy and disposed of securely',
};

export class ComplianceService {
  constructor({ store, now = () => new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    this.store = store;
    this.now = now;
    this.retentionDays = { ...retentionDays };
    this.trail = [];
    this.consents = new Map();
    this.sharing = [];
    this.breaches = [];
  }

  /** Append-only, hash-chained audit trail entry. */
  record(event, details = {}) {
    const prev = this.trail.at(-1)?.hash ?? '0'.repeat(64);
    const entry = { seq: this.trail.length + 1, event, details, timestamp: this.now().toISOString(), prev };
    entry.hash = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    this.trail.push(entry);
    return entry;
  }

  verifyTrail() {
    let prev = '0'.repeat(64);
    for (const entry of this.trail) {
      const { hash, ...rest } = entry;
      if (rest.prev !== prev) return false;
      if (crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex') !== hash) return false;
      prev = hash;
    }
    return true;
  }

  recordAccess({ actor, resource, action }) {
    return this.record('data_access', { actor, resource, action });
  }

  setConsent(subjectId, purpose, granted, source = 'user') {
    const list = this.consents.get(subjectId) ?? [];
    const item = { purpose, granted: Boolean(granted), source, timestamp: this.now().toISOString() };
    list.push(item);
    this.consents.set(subjectId, list);
    this.record('consent_change', { subjectId, purpose, granted: item.granted });
    return item;
  }

  hasConsent(subjectId, purpose) {
    const history = (this.consents.get(subjectId) ?? []).filter((c) => c.purpose === purpose);
    return history.at(-1)?.granted ?? false;
  }

  recordThirdPartySharing({ subjectId, recipient, purpose, categories = [] }) {
    const item = { subjectId, recipient, purpose, categories, timestamp: this.now().toISOString() };
    this.sharing.push(item);
    this.record('third_party_sharing', item);
    return item;
  }

  /** GDPR Art. 15/20 data export. */
  async exportSubjectData(subjectId) {
    const data = (await this.store?.listSubjectData?.(subjectId)) ?? {};
    this.record('gdpr_export', { subjectId });
    return {
      subjectId,
      generatedAt: this.now().toISOString(),
      data,
      consents: this.consents.get(subjectId) ?? [],
      thirdPartySharing: this.sharing.filter((s) => s.subjectId === subjectId),
      accessLog: this.trail.filter((e) => e.event === 'data_access' && e.details.resource?.includes?.(subjectId)),
    };
  }

  /** GDPR Art. 17 erasure, returning a verifiable deletion confirmation. */
  async forgetSubject(subjectId, { requestedBy = subjectId } = {}) {
    const deleted = (await this.store?.deleteSubjectData?.(subjectId)) ?? {};
    this.consents.delete(subjectId);
    const entry = this.record('gdpr_erasure', { subjectId, requestedBy, deleted });
    return { subjectId, deletedAt: entry.timestamp, deleted, confirmation: entry.hash };
  }

  async applyRetention() {
    const results = {};
    for (const [category, days] of Object.entries(this.retentionDays)) {
      const cutoff = new Date(this.now().getTime() - days * 86400000);
      results[category] = (await this.store?.purgeOlderThan?.(category, cutoff)) ?? 0;
    }
    this.record('retention_applied', results);
    return results;
  }

  reportBreach({ description, affectedSubjects = 0, categories = [], detectedAt = this.now() }) {
    const detected = new Date(detectedAt);
    const breach = {
      id: crypto.randomUUID(),
      description,
      affectedSubjects,
      categories,
      detectedAt: detected.toISOString(),
      // GDPR Art. 33: notify the supervisory authority within 72 hours.
      notifyAuthorityBy: new Date(detected.getTime() + 72 * 3600000).toISOString(),
    };
    this.breaches.push(breach);
    this.record('breach_reported', { id: breach.id, affectedSubjects });
    return breach;
  }

  /** Automated checks; `config` describes the deployment's security posture. */
  runChecks(config = {}) {
    const checks = [
      { id: 'audit_trail_integrity', control: 'CC7.2', pass: this.verifyTrail() },
      { id: 'encryption_at_rest', control: 'CC6.7', pass: Boolean(config.encryptionAtRest) },
      { id: 'tls_enforced', control: 'CC6.7', pass: Boolean(config.tlsEnforced) },
      { id: 'access_control', control: 'CC6.1', pass: Boolean(config.authRequired) },
      { id: 'retention_policy', control: 'P4.2', pass: Object.keys(this.retentionDays).length > 0 },
      { id: 'breach_notification_sla', control: 'P4.2', pass: this.breaches.every((b) => new Date(b.notifyAuthorityBy) > this.now() || b.notifiedAt) },
    ];
    this.record('compliance_checks', { passed: checks.filter((c) => c.pass).length, total: checks.length });
    return checks;
  }

  soc2Evidence(config = {}) {
    const checks = this.runChecks(config);
    return Object.entries(SOC2_CONTROLS).map(([control, description]) => {
      const related = checks.filter((c) => c.control === control);
      return {
        control,
        description,
        status: related.length === 0 ? 'manual' : related.every((c) => c.pass) ? 'effective' : 'deficient',
        evidence: related,
      };
    });
  }

  /** GDPR Art. 30 record of processing activities. */
  processingActivities() {
    return [
      { activity: 'Credential issuance', purpose: 'Identity verification', lawfulBasis: 'contract', categories: ['credential claims'] },
      { activity: 'DID management', purpose: 'Decentralised identity', lawfulBasis: 'contract', categories: ['DID metadata'] },
      { activity: 'Access logging', purpose: 'Security monitoring', lawfulBasis: 'legitimate interest', categories: ['IP address', 'user agent'] },
      { activity: 'Analytics', purpose: 'Service improvement', lawfulBasis: 'consent', categories: ['usage events'] },
    ].map((a) => ({ ...a, retentionDays: this.retentionDays }));
  }

  dashboard(config = {}) {
    const checks = this.runChecks(config);
    const count = (event) => this.trail.filter((e) => e.event === event).length;
    return {
      generatedAt: this.now().toISOString(),
      score: Math.round((checks.filter((c) => c.pass).length / checks.length) * 100),
      checks,
      totals: {
        exports: count('gdpr_export'),
        erasures: count('gdpr_erasure'),
        consentChanges: count('consent_change'),
        thirdPartyShares: this.sharing.length,
        breaches: this.breaches.length,
      },
    };
  }
}
