// In-memory aggregation of identity/credential activity.
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

export class Aggregator {
  constructor() {
    this.didsByDay = new Map();
    this.issuedByDay = new Map();
    this.revokedByDay = new Map();
    this.verificationsByDay = new Map();
    this.issuers = new Map();
    this.countries = new Map();
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn(this.snapshot());
  }

  // event: { kind: 'created'|'issued'|'revoked', timestamp, issuer?, country? }
  record(event, { silent = false } = {}) {
    const d = day(event.timestamp ?? Date.now());
    if (event.kind === 'created') bump(this.didsByDay, d);
    if (event.kind === 'issued') {
      bump(this.issuedByDay, d);
      if (event.issuer) bump(this.issuers, event.issuer);
    }
    if (event.kind === 'revoked') bump(this.revokedByDay, d);
    if (event.kind === 'verified') bump(this.verificationsByDay, d);
    if (event.country) bump(this.countries, event.country.toUpperCase());
    if (!silent) this.#emit();
  }

  snapshot() {
    const series = (m) => [...m].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
    const cumulative = (s) => { let t = 0; return s.map((p) => ({ date: p.date, count: (t += p.count) })); };
    const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
    return {
      totals: {
        dids: sum(this.didsByDay),
        credentialsIssued: sum(this.issuedByDay),
        credentialsRevoked: sum(this.revokedByDay),
        verifications: sum(this.verificationsByDay),
      },
      didsOverTime: cumulative(series(this.didsByDay)),
      issuanceRate: series(this.issuedByDay),
      verificationFrequency: series(this.verificationsByDay),
      topIssuers: [...this.issuers].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([issuer, count]) => ({ issuer, count })),
      geography: [...this.countries].sort((a, b) => b[1] - a[1]).map(([country, count]) => ({ country, count })),
      generatedAt: new Date().toISOString(),
    };
  }
}
