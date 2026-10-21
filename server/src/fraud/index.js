import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

/**
 * Fraud detection for credential issuance/verification (issue #1111).
 *
 * Pipeline:
 *   event -> FeatureExtractor (velocity, verification pattern, geo, device)
 *         -> IsolationForest anomaly score (+ optional pluggable models)
 *         -> rule engine (automated blocking)
 *         -> decision: allow | review | block
 *
 * Reviewer feedback is recorded, tracks false positives, and is folded back
 * into the training set on `retrain()`. The LSTM / Random Forest models listed
 * in the issue are trained offline; they plug in via `addModel(name, fn)`
 * where `fn(features) -> score in [0,1]`.
 */

const EULER = 0.5772156649;

function c(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export class IsolationForest {
  constructor({ trees = 100, sampleSize = 256, seed = 42 } = {}) {
    this.nTrees = trees;
    this.sampleSize = sampleSize;
    this.rand = seededRandom(seed);
    this.trees = [];
    this.psi = 0;
  }

  fit(data) {
    if (!data.length) throw new Error('cannot fit on empty data');
    this.psi = Math.min(this.sampleSize, data.length);
    const limit = Math.ceil(Math.log2(this.psi));
    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      const sample = [];
      for (let i = 0; i < this.psi; i++) sample.push(data[Math.floor(this.rand() * data.length)]);
      this.trees.push(this.#build(sample, 0, limit));
    }
    return this;
  }

  /** Anomaly score in (0, 1]; > ~0.6 is anomalous. */
  score(x) {
    if (!this.trees.length) return 0.5;
    const avg = this.trees.reduce((s, t) => s + this.#pathLength(x, t, 0), 0) / this.trees.length;
    return 2 ** (-avg / c(this.psi));
  }

  #build(rows, depth, limit) {
    if (depth >= limit || rows.length <= 1) return { size: rows.length };
    const dims = rows[0].length;
    for (let tries = 0; tries < dims; tries++) {
      const d = Math.floor(this.rand() * dims);
      let min = Infinity, max = -Infinity;
      for (const r of rows) { if (r[d] < min) min = r[d]; if (r[d] > max) max = r[d]; }
      if (min === max) continue;
      const split = min + this.rand() * (max - min);
      return {
        d, split,
        left: this.#build(rows.filter((r) => r[d] < split), depth + 1, limit),
        right: this.#build(rows.filter((r) => r[d] >= split), depth + 1, limit),
      };
    }
    return { size: rows.length };
  }

  #pathLength(x, node, depth) {
    if (node.size !== undefined) return depth + c(node.size);
    return this.#pathLength(x, x[node.d] < node.split ? node.left : node.right, depth + 1);
  }
}

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const FEATURE_NAMES = [
  'issuanceVelocity1h',
  'verificationVelocity1h',
  'failedVerificationRatio',
  'distinctSubjects1h',
  'geoSpeedKmh',
  'newDevice',
  'devicesPerActor24h',
];

export class FeatureExtractor {
  #history = new Map(); // actor -> events[]
  #deviceActors = new Map(); // device -> Set(actor)

  observe(event) {
    const e = { ts: Date.now(), ...event };
    if (!this.#history.has(e.actor)) this.#history.set(e.actor, []);
    const h = this.#history.get(e.actor);
    h.push(e);
    const dayAgo = e.ts - 86_400_000;
    while (h.length && h[0].ts < dayAgo) h.shift();
    if (e.device) {
      if (!this.#deviceActors.has(e.device)) this.#deviceActors.set(e.device, new Set());
      this.#deviceActors.get(e.device).add(e.actor);
    }
    return e;
  }

  extract(event) {
    const e = { ts: Date.now(), ...event };
    const h = this.#history.get(e.actor) ?? [];
    const hourAgo = e.ts - 3_600_000;
    const recent = h.filter((x) => x.ts >= hourAgo && x !== event);
    const issues = recent.filter((x) => x.type === 'issue');
    const verifies = recent.filter((x) => x.type === 'verify');
    const failed = verifies.filter((x) => x.success === false).length;
    const prevGeo = [...h].reverse().find((x) => x.geo && x.ts < e.ts);
    let geoSpeed = 0;
    if (e.geo && prevGeo) {
      const hours = Math.max((e.ts - prevGeo.ts) / 3_600_000, 1 / 60);
      geoSpeed = haversineKm(prevGeo.geo, e.geo) / hours;
    }
    const devices = new Set(h.map((x) => x.device).filter(Boolean));
    return {
      issuanceVelocity1h: issues.length + (e.type === 'issue' ? 1 : 0),
      verificationVelocity1h: verifies.length + (e.type === 'verify' ? 1 : 0),
      failedVerificationRatio: verifies.length ? failed / verifies.length : 0,
      distinctSubjects1h: new Set(issues.map((x) => x.subject)).size,
      geoSpeedKmh: geoSpeed,
      newDevice: e.device && h.length && !devices.has(e.device) ? 1 : 0,
      devicesPerActor24h: devices.size + (e.device && !devices.has(e.device) ? 1 : 0),
    };
  }

  static vector(features) {
    return FEATURE_NAMES.map((n) => features[n]);
  }
}

export const DEFAULT_RULES = [
  { id: 'issuance-burst', when: (f) => f.issuanceVelocity1h > 100, action: 'block', reason: 'Issuance velocity exceeds 100/h' },
  { id: 'impossible-travel', when: (f) => f.geoSpeedKmh > 1000, action: 'review', reason: 'Impossible travel between requests' },
  { id: 'verification-probing', when: (f) => f.verificationVelocity1h > 20 && f.failedVerificationRatio > 0.5, action: 'block', reason: 'High failed verification ratio' },
  { id: 'device-farm', when: (f) => f.devicesPerActor24h > 10, action: 'review', reason: 'Too many devices for one actor' },
];

export class FraudDetector extends EventEmitter {
  constructor({ reviewThreshold = 0.62, blockThreshold = 0.75, rules = DEFAULT_RULES, forest } = {}) {
    super();
    this.reviewThreshold = reviewThreshold;
    this.blockThreshold = blockThreshold;
    this.rules = [...rules];
    this.forest = forest ?? new IsolationForest();
    this.features = new FeatureExtractor();
    this.models = new Map();
    this.trainingSet = [];
    this.reviewQueue = new Map();
    this.decisions = [];
    this.feedback = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
    this.trained = false;
  }

  addModel(name, fn) { this.models.set(name, fn); }
  addRule(rule) { this.rules.push(rule); }

  /** Train on historical feature vectors (or events, which are replayed). */
  train(history) {
    const vectors = history.map((h) => (Array.isArray(h) ? h : this.#vectorFor(h)));
    this.trainingSet = vectors;
    this.forest.fit(vectors);
    this.trained = true;
    return { samples: vectors.length };
  }

  /** Retrain with confirmed-legitimate feedback folded into the dataset. */
  retrain() {
    const legit = this.decisions.filter((d) => d.label === 'legitimate').map((d) => d.vector);
    return this.train([...this.trainingSet, ...legit]);
  }

  /** Real-time scoring. Returns { id, score, decision, reasons }. */
  evaluate(event) {
    const features = this.features.extract(event);
    this.features.observe(event);
    const vector = FeatureExtractor.vector(features);
    const scores = { isolationForest: this.trained ? this.forest.score(vector) : 0 };
    for (const [name, fn] of this.models) scores[name] = fn(features);
    const score = Math.max(...Object.values(scores));
    const reasons = [];
    let decision = 'allow';
    for (const r of this.rules) {
      if (r.when(features)) {
        reasons.push({ rule: r.id, reason: r.reason });
        if (r.action === 'block') decision = 'block';
        else if (decision === 'allow') decision = 'review';
      }
    }
    if (score >= this.blockThreshold) { decision = 'block'; reasons.push({ rule: 'model', reason: `Anomaly score ${score.toFixed(3)}` }); }
    else if (score >= this.reviewThreshold && decision === 'allow') { decision = 'review'; reasons.push({ rule: 'model', reason: `Anomaly score ${score.toFixed(3)}` }); }

    const record = { id: crypto.randomUUID(), at: Date.now(), event, features, vector, scores, score, decision, reasons, label: null };
    this.decisions.push(record);
    if (this.decisions.length > 10_000) this.decisions.shift();
    if (decision === 'review') this.reviewQueue.set(record.id, record);
    if (decision !== 'allow') this.emit(decision, record);
    return { id: record.id, score, decision, reasons };
  }

  listReviews() {
    return [...this.reviewQueue.values()].map(({ vector, ...r }) => r);
  }

  /** Reviewer verdict: label is 'fraud' or 'legitimate'. */
  resolveReview(id, label) {
    const rec = this.reviewQueue.get(id) ?? this.decisions.find((d) => d.id === id);
    if (!rec) throw new Error(`unknown decision ${id}`);
    if (!['fraud', 'legitimate'].includes(label)) throw new Error('label must be fraud or legitimate');
    rec.label = label;
    this.reviewQueue.delete(id);
    if (rec.decision !== 'allow') {
      if (label === 'fraud') this.feedback.truePositives++;
      else this.feedback.falsePositives++;
    } else if (label === 'fraud') {
      this.feedback.falseNegatives++;
    }
    return rec;
  }

  report({ since = 0 } = {}) {
    const ds = this.decisions.filter((d) => d.at >= since);
    const by = (k) => ds.filter((d) => d.decision === k).length;
    const ruleHits = {};
    for (const d of ds) for (const r of d.reasons) ruleHits[r.rule] = (ruleHits[r.rule] ?? 0) + 1;
    const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = this.feedback;
    return {
      generatedAt: new Date().toISOString(),
      total: ds.length,
      allowed: by('allow'),
      reviewed: by('review'),
      blocked: by('block'),
      pendingReviews: this.reviewQueue.size,
      ruleHits,
      feedback: { ...this.feedback, precision: tp + fp ? tp / (tp + fp) : null, falsePositiveRate: tp + fp ? fp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null },
      topRisk: [...ds].sort((a, b) => b.score - a.score).slice(0, 10).map((d) => ({ id: d.id, actor: d.event.actor, score: d.score, decision: d.decision })),
    };
  }

  #vectorFor(event) {
    const f = this.features.extract(event);
    this.features.observe(event);
    return FeatureExtractor.vector(f);
  }
}

/** Express-style middleware: blocks requests the detector rejects. */
export function fraudMiddleware(detector, toEvent) {
  return (req, res, next) => {
    const event = toEvent(req);
    if (!event) return next();
    const result = detector.evaluate(event);
    req.fraud = result;
    if (result.decision === 'block') {
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Request blocked by fraud detection', id: result.id }));
      return;
    }
    next();
  };
}
