import type { StoreData } from "./store";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface TimePoint {
  t: number; // bucket start, unix ms
  value: number;
}

export interface IssuerStat {
  issuer: string;
  issued: number;
  revoked: number;
  uniqueSubjects: number;
  lastIssuedAt: number;
}

export interface Summary {
  generatedAt: number;
  latestLedger: number | null;
  totals: {
    dids: number;
    activeDids: number;
    deactivatedDids: number;
    credentialsIssued: number;
    credentialsRevoked: number;
    activeIssuers: number;
    verifications: number;
    verificationsOnchain: number;
    verificationsReported: number;
  };
  rates: {
    didsLast24h: number;
    issuedLast24h: number;
    issuedPerHourLast24h: number;
    verificationsLast24h: number;
  };
  /** Daily new DIDs and running total. */
  didsDaily: Array<{ t: number; created: number; total: number }>;
  /** Hourly issuance over the last 48 hours. */
  issuanceHourly: TimePoint[];
  /** Daily issuance and revocations. */
  issuanceDaily: Array<{ t: number; issued: number; revoked: number }>;
  topIssuers: IssuerStat[];
  /** All-time issuance per credential type. */
  issuedByType: Array<{ type: string; issued: number }>;
  /** Daily verifications, split by where they were observed. */
  verificationsDaily: Array<{ t: number; onchain: number; reported: number }>;
  verificationOutcomes: { valid: number; invalid: number; unknown: number; reasons: Record<string, number> };
  geography: {
    countries: Array<{ country: string; dids: number }>;
    withCountry: number;
    withoutCountry: number;
  };
}

function floorTo(ts: number, size: number): number {
  return Math.floor(ts / size) * size;
}

/** Contiguous buckets from the first to the last timestamp (inclusive). */
function buckets(start: number, end: number, size: number): number[] {
  const out: number[] = [];
  for (let t = floorTo(start, size); t <= floorTo(end, size); t += size) out.push(t);
  return out;
}

function countBy<T>(items: T[], key: (item: T) => number): Map<number, number> {
  const m = new Map<number, number>();
  for (const item of items) {
    const k = key(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function countStrings(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

export function computeSummary(data: StoreData, now = Date.now()): Summary {
  const created = data.dids.filter((d) => d.kind === "created");
  // Replay deactivate/reactivate in ledger order to get each DID's current state.
  const deactivated = new Set<string>();
  for (const d of [...data.dids].sort((a, b) => a.ledger - b.ledger)) {
    if (d.kind === "deactivated") deactivated.add(d.controller);
    else if (d.kind === "reactivated") deactivated.delete(d.controller);
  }
  const issued = data.credentials.filter((c) => c.kind === "issued");
  const revoked = data.credentials.filter((c) => c.kind === "revoked");
  const onchain = data.verifications.filter((v) => v.source === "onchain");
  const reported = data.verifications.filter((v) => v.source === "reported");

  // Issuers currently registered: replay add/remove in ledger order.
  const issuers = new Set<string>();
  for (const e of [...data.issuers].sort((a, b) => a.ledger - b.ledger)) {
    if (e.kind === "added") issuers.add(e.issuer);
    else issuers.delete(e.issuer);
  }

  const since24h = now - DAY;
  const issuedLast24h = issued.filter((c) => c.ts >= since24h).length;

  // ── DIDs over time ──────────────────────────────────────────────────────────
  let earliest = now;
  for (const list of [created, data.credentials, data.verifications]) {
    for (const r of list) if (r.ts < earliest) earliest = r.ts;
  }
  const dayBuckets = buckets(earliest, now, DAY);
  const didsPerDay = countBy(created, (d) => floorTo(d.ts, DAY));
  let running = 0;
  const didsDaily = dayBuckets.map((t) => {
    const n = didsPerDay.get(t) ?? 0;
    running += n;
    return { t, created: n, total: running };
  });

  // ── Issuance ────────────────────────────────────────────────────────────────
  const issuedPerDay = countBy(issued, (c) => floorTo(c.ts, DAY));
  const revokedPerDay = countBy(revoked, (c) => floorTo(c.ts, DAY));
  const issuanceDaily = dayBuckets.map((t) => ({
    t,
    issued: issuedPerDay.get(t) ?? 0,
    revoked: revokedPerDay.get(t) ?? 0,
  }));

  const issuedPerHour = countBy(
    issued.filter((c) => c.ts >= now - 48 * HOUR),
    (c) => floorTo(c.ts, HOUR)
  );
  const issuanceHourly = buckets(now - 47 * HOUR, now, HOUR).map((t) => ({
    t,
    value: issuedPerHour.get(t) ?? 0,
  }));

  // ── Top issuers ─────────────────────────────────────────────────────────────
  const revokedByIssuer = countStrings(revoked.flatMap((c) => (c.issuer ? [c.issuer] : [])));
  const byIssuer = new Map<string, { issued: number; subjects: Set<string>; last: number }>();
  for (const c of issued) {
    if (!c.issuer) continue;
    const s = byIssuer.get(c.issuer) ?? { issued: 0, subjects: new Set(), last: 0 };
    s.issued++;
    if (c.subject) s.subjects.add(c.subject);
    s.last = Math.max(s.last, c.ts);
    byIssuer.set(c.issuer, s);
  }
  const topIssuers: IssuerStat[] = [...byIssuer.entries()]
    .map(([issuer, s]) => ({
      issuer,
      issued: s.issued,
      revoked: revokedByIssuer.get(issuer) ?? 0,
      uniqueSubjects: s.subjects.size,
      lastIssuedAt: s.last,
    }))
    .sort((a, b) => b.issued - a.issued)
    .slice(0, 10);

  // ── Verifications ───────────────────────────────────────────────────────────
  const onchainPerDay = countBy(onchain, (v) => floorTo(v.ts, DAY));
  const reportedPerDay = countBy(reported, (v) => floorTo(v.ts, DAY));
  const verificationsDaily = dayBuckets.map((t) => ({
    t,
    onchain: onchainPerDay.get(t) ?? 0,
    reported: reportedPerDay.get(t) ?? 0,
  }));

  const reasons: Record<string, number> = {};
  let valid = 0;
  let invalid = 0;
  let unknown = 0;
  for (const v of data.verifications) {
    if (v.valid === true) valid++;
    else if (v.valid === false) {
      invalid++;
      const r = v.reason ?? "unknown";
      reasons[r] = (reasons[r] ?? 0) + 1;
    } else unknown++;
  }

  // ── Geography ───────────────────────────────────────────────────────────────
  const perCountry = new Map<string, number>();
  let withCountry = 0;
  let withoutCountry = 0;
  for (const d of created) {
    const c = data.countries[d.controller];
    if (c) {
      perCountry.set(c, (perCountry.get(c) ?? 0) + 1);
      withCountry++;
    } else {
      withoutCountry++;
    }
  }

  return {
    generatedAt: now,
    latestLedger: data.cursor.latestLedger ?? null,
    totals: {
      dids: created.length,
      activeDids: created.filter((d) => !deactivated.has(d.controller)).length,
      deactivatedDids: deactivated.size,
      credentialsIssued: issued.length,
      credentialsRevoked: revoked.length,
      activeIssuers: issuers.size,
      verifications: data.verifications.length,
      verificationsOnchain: onchain.length,
      verificationsReported: reported.length,
    },
    rates: {
      didsLast24h: created.filter((d) => d.ts >= since24h).length,
      issuedLast24h,
      issuedPerHourLast24h: Math.round((issuedLast24h / 24) * 100) / 100,
      verificationsLast24h: data.verifications.filter((v) => v.ts >= since24h).length,
    },
    didsDaily,
    issuanceHourly,
    issuanceDaily,
    topIssuers,
    issuedByType: [...countStrings(issued.map((c) => c.credentialType ?? "Unknown")).entries()]
      .map(([type, n]) => ({ type, issued: n }))
      .sort((a, b) => b.issued - a.issued),
    verificationsDaily,
    verificationOutcomes: { valid, invalid, unknown, reasons },
    geography: {
      countries: [...perCountry.entries()]
        .map(([country, dids]) => ({ country, dids }))
        .sort((a, b) => b.dids - a.dids),
      withCountry,
      withoutCountry,
    },
  };
}
