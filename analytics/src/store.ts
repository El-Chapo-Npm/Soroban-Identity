import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

// ── Records ───────────────────────────────────────────────────────────────────

export interface DidEvent {
  id: string; // RPC event id, used for de-duplication
  kind: "created" | "updated" | "deactivated" | "reactivated";
  controller: string;
  ledger: number;
  ts: number; // unix ms
}

export interface CredentialEvent {
  id: string;
  kind: "issued" | "revoked";
  issuer?: string;
  subject?: string;
  credentialId?: string;
  /** Kyc, Reputation, Achievement, Custom … (issued events only). */
  credentialType?: string;
  ledger: number;
  ts: number;
}

export interface IssuerEvent {
  id: string;
  kind: "added" | "removed";
  issuer: string;
  ledger: number;
  ts: number;
}

export interface VerificationEvent {
  id: string;
  /** `onchain`: a submitted tx invoked verify_credential. `reported`: an app told us. */
  source: "onchain" | "reported";
  credentialId?: string;
  valid?: boolean;
  reason?: string;
  ts: number;
}

export interface IndexerCursor {
  eventCursor?: string;
  eventStartLedger?: number;
  txCursor?: string;
  txStartLedger?: number;
  latestLedger?: number;
}

export interface StoreData {
  version: 1;
  cursor: IndexerCursor;
  dids: DidEvent[];
  credentials: CredentialEvent[];
  issuers: IssuerEvent[];
  verifications: VerificationEvent[];
  /** controller address → ISO 3166-1 alpha-2 country code (null = not provided). */
  countries: Record<string, string | null>;
}

function empty(): StoreData {
  return {
    version: 1,
    cursor: {},
    dids: [],
    credentials: [],
    issuers: [],
    verifications: [],
    countries: {},
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

/**
 * In-memory event log with JSON-file persistence. Emits `change` whenever new
 * records land so the server can push updates to dashboard clients.
 */
export class AnalyticsStore extends EventEmitter {
  data: StoreData;
  private seen = new Set<string>();
  /** Unsaved changes, including cursor moves. */
  private dirty = false;
  /** New records since the last flush — only these trigger `change`. */
  private changed = false;

  constructor(private readonly file: string) {
    super();
    this.data = this.load();
    for (const list of [this.data.dids, this.data.credentials, this.data.issuers, this.data.verifications]) {
      for (const r of list) this.seen.add(r.id);
    }
  }

  private load(): StoreData {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as StoreData;
      return parsed.version === 1 ? { ...empty(), ...parsed } : empty();
    } catch {
      return empty();
    }
  }

  private add<T extends { id: string }>(list: T[], record: T): boolean {
    if (this.seen.has(record.id)) return false;
    this.seen.add(record.id);
    list.push(record);
    this.dirty = this.changed = true;
    return true;
  }

  addDid(e: DidEvent) {
    return this.add(this.data.dids, e);
  }
  addCredential(e: CredentialEvent) {
    return this.add(this.data.credentials, e);
  }
  addIssuer(e: IssuerEvent) {
    return this.add(this.data.issuers, e);
  }
  addVerification(e: VerificationEvent) {
    return this.add(this.data.verifications, e);
  }

  setCountry(controller: string, country: string | null) {
    this.data.countries[controller] = country;
    this.dirty = this.changed = true;
  }

  setCursor(cursor: Partial<IndexerCursor>) {
    this.data.cursor = { ...this.data.cursor, ...cursor };
    this.dirty = true;
  }

  /** Persist unsaved state, and notify listeners if new records arrived. */
  flush(): void {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
    if (this.changed) {
      this.changed = false;
      this.emit("change");
    }
  }
}
