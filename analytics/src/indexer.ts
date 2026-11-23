import {
  Account,
  Address,
  Contract,
  Keypair,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { AnalyticsConfig } from "./config";
import type { AnalyticsStore } from "./store";

const EVENT_PAGE_LIMIT = 1000;
const TX_PAGE_LIMIT = 200;
/** Safety bound on event pages drained per tick, to avoid infinite loops. */
const MAX_EVENT_PAGES_PER_TICK = 100;
/** Cap on resolve_did simulations per tick, to stay polite to the RPC. */
const COUNTRY_LOOKUPS_PER_TICK = 50;

type RpcEvent = SorobanRpc.Api.EventResponse;

/**
 * All `ts` fields written by the indexer are unix epoch milliseconds in UTC.
 * `Date.now()` is already UTC epoch ms; never build timestamps from
 * local-time strings.
 */
function utcNowMs(): number {
  return Date.now();
}

/**
 * Parse an ISO-8601 ledger close time as UTC. RPC normally returns a `Z`
 * suffix, but if the offset is missing we treat the value as UTC rather than
 * letting `Date.parse` fall back to the server's local timezone.
 */
function parseUtcMs(value: string): number {
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

function symbolOf(val: xdr.ScVal | undefined): string | undefined {
  try {
    return val ? String(scValToNative(val)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Event payloads are tuples whose first element is the contract's
 * EVENT_VERSION (currently 1). Returns the fields after the version.
 */
function payload(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return typeof value[0] === "number" ? value.slice(1) : value;
}

/** Unit enum variants decode as a one-element array, e.g. ["Kyc"]. */
function enumName(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
  return value === undefined || value === null ? undefined : String(value);
}

function hex(value: unknown): string | undefined {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return undefined;
}

/**
 * Polls Soroban RPC for identity-registry and credential-manager events,
 * plus (optionally) every transaction on the network that invokes
 * `verify_credential`, and appends them to the store.
 */
export class Indexer {
  private server: SorobanRpc.Server;
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Read-only simulations need a source account; it need not exist on-chain. */
  private readonly simAccount = new Account(Keypair.random().publicKey(), "0");
  private countryQueue: string[] = [];

  constructor(
    private readonly config: AnalyticsConfig,
    private readonly store: AnalyticsStore
  ) {
    this.server = new SorobanRpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });
  }

  start(): void {
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, this.config.pollIntervalMs);
    };
    void loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.pollEvents();
      if (this.config.trackVerificationTxs) await this.pollTransactions();
      if (this.config.resolveDidCountry) await this.resolveCountries();
    } catch (err) {
      console.error("[indexer]", err instanceof Error ? err.message : err);
    } finally {
      this.store.flush();
      this.running = false;
    }
  }

  // ── Contract events ─────────────────────────────────────────────────────────

  private async initialLedger(): Promise<number> {
    if (this.config.startLedger) return this.config.startLedger;
    const latest = await this.server.getLatestLedger();
    return Math.max(1, latest.sequence - this.config.lookbackLedgers);
  }

  private async pollEvents(): Promise<void> {
    const filters: SorobanRpc.Api.EventFilter[] = [
      {
        type: "contract",
        contractIds: [this.config.identityRegistryId, this.config.credentialManagerId],
      },
    ];

    // Drain all pages available right now. A page is only "done" when it comes
    // back empty; a short page can still be followed by more pages, so stopping
    // on `length < EVENT_PAGE_LIMIT` would silently drop the remainder.
    for (let page = 0; page < MAX_EVENT_PAGES_PER_TICK; page++) {
      const { eventCursor, eventStartLedger } = this.store.data.cursor;
      const request: SorobanRpc.Server.GetEventsRequest = eventCursor
        ? { filters, cursor: eventCursor, limit: EVENT_PAGE_LIMIT }
        : { filters, startLedger: eventStartLedger ?? (await this.initialLedger()), limit: EVENT_PAGE_LIMIT };

      let res: SorobanRpc.Api.GetEventsResponse;
      try {
        res = await this.server.getEvents(request);
      } catch (err) {
        if (this.recoverFromRangeError(err, "event")) continue;
        throw err;
      }

      for (const ev of res.events) this.handleEvent(ev);

      const last = res.events[res.events.length - 1];
      if (last) {
        // Persist after every page so a restart resumes from the right position.
        this.store.setCursor({ eventCursor: last.pagingToken, latestLedger: res.latestLedger });
      } else if (!eventCursor) {
        // Nothing yet: advance so the start ledger never ages out of RPC retention.
        this.store.setCursor({ eventStartLedger: res.latestLedger, latestLedger: res.latestLedger });
      } else {
        this.store.setCursor({ latestLedger: res.latestLedger });
      }

      if (res.events.length === 0) break;
    }
  }

  /**
   * RPC only keeps a window of recent ledgers. If our start ledger or cursor
   * fell out of it (e.g. the service was down for days), restart at the
   * oldest ledger the RPC reports.
   */
  private recoverFromRangeError(err: unknown, stream: "event" | "tx"): boolean {
    const message = err instanceof Error ? err.message : String(err);
    const match = message.match(/ledger range:?\s*(\d+)\s*-\s*(\d+)/i);
    if (!match && !/cursor|startLedger|range/i.test(message)) return false;

    const oldest = match ? Number(match[1]) + 1 : undefined;
    console.warn(`[indexer] ${stream} cursor out of RPC retention; restarting at ${oldest ?? "latest"}`);
    if (stream === "event") {
      this.store.setCursor({ eventCursor: undefined, eventStartLedger: oldest });
    } else {
      this.store.setCursor({ txCursor: undefined, txStartLedger: oldest });
    }
    return oldest !== undefined;
  }

  private handleEvent(ev: RpcEvent): void {
    if (!ev.inSuccessfulContractCall) return;

    const contractId = ev.contractId?.toString();
    // Horizon/RPC payloads can carry a null/missing topic list or null entries;
    // skip such events instead of throwing a TypeError that crashes the poller.
    if (!Array.isArray(ev.topic) || ev.topic.length < 2 || ev.topic.some((t) => t == null)) {
      console.warn(`[indexer] skipping event ${ev.id}: missing or null topic`);
      return;
    }
    const [ns, action] = ev.topic.map(symbolOf);
    // ts is unix ms UTC, parsed from the ledger close time (UTC).
    const ts = parseUtcMs(ev.ledgerClosedAt);
    const base = { id: ev.id, ledger: ev.ledger, ts };
    let fields: unknown[];
    try {
      fields = payload(scValToNative(ev.value));
    } catch {
      return;
    }

    if (contractId === this.config.identityRegistryId && ns === "IDENTITY") {
      // (version, controller, timestamp | metadata hash)
      const controller = String(fields[0]);
      if (action === "created" || action === "updated" || action === "reactivated") {
        this.store.addDid({ ...base, kind: action, controller });
        // Metadata may have changed; look the country up again.
        if (action === "updated") this.countryQueue.push(controller);
      } else if (action === "deact") {
        this.store.addDid({ ...base, kind: "deactivated", controller });
      }
      return;
    }

    if (contractId !== this.config.credentialManagerId) return;

    if (ns === "CRED" && action === "issued") {
      // (version, id, subject, issuer, credential_type, expires_at)
      const [id, subject, issuer, type] = fields;
      this.store.addCredential({
        ...base,
        kind: "issued",
        credentialId: hex(id),
        subject: String(subject),
        issuer: String(issuer),
        credentialType: enumName(type),
      });
    } else if (ns === "CRED" && action === "revoked") {
      // (version, id, issuer, revoked_at[, reason])
      const [id, issuer] = fields;
      this.store.addCredential({ ...base, kind: "revoked", credentialId: hex(id), issuer: String(issuer) });
    } else if (ns === "ISSUER" && (action === "added" || action === "removed")) {
      // (version, issuer)
      this.store.addIssuer({ ...base, kind: action, issuer: String(fields[0]) });
    }
  }

  // ── verify_credential transactions ──────────────────────────────────────────

  /**
   * Most verifications are read-only simulations and never hit the ledger.
   * The ones that do (e.g. contracts or dApps that verify inside a submitted
   * transaction) are found by scanning transactions for invocations of
   * `verify_credential` on the credential-manager.
   */
  private async pollTransactions(): Promise<void> {
    for (;;) {
      const { txCursor, txStartLedger } = this.store.data.cursor;
      const pagination = txCursor ? { cursor: txCursor, limit: TX_PAGE_LIMIT } : { limit: TX_PAGE_LIMIT };
      const params: Record<string, unknown> = { pagination };
      if (!txCursor) params.startLedger = txStartLedger ?? (await this.initialLedger());

      let result: GetTransactionsResult;
      try {
        result = await this.rpc<GetTransactionsResult>("getTransactions", params);
      } catch (err) {
        if (this.recoverFromRangeError(err, "tx")) continue;
        throw err;
      }

      for (const tx of result.transactions ?? []) {
        if (tx.status !== "SUCCESS") continue;
        const ids = this.verifyCallIn(tx.envelopeXdr);
        if (ids === null) continue;
        const txId = `tx:${tx.txHash ?? `${tx.ledger}:${tx.applicationOrder}`}`;
        // One record per credential checked, so batch calls count each check.
        // ts is unix ms UTC (createdAt is unix seconds UTC).
        (ids.length ? ids : [undefined]).forEach((credentialId, i) =>
          this.store.addVerification({ id: `${txId}:${i}`, source: "onchain", credentialId, ts: tx.createdAt * 1000 })
        );
      }

      this.store.setCursor({ txCursor: result.cursor });
      if ((result.transactions?.length ?? 0) < TX_PAGE_LIMIT) break;
    }
  }

  /**
   * Credential IDs (hex) checked by the envelope's verify_credential or
   * verify_credentials_batch call, or null if it makes no such call.
   */
  private verifyCallIn(envelopeXdr: string): string[] | null {
    let env: xdr.TransactionEnvelope;
    try {
      env = xdr.TransactionEnvelope.fromXDR(envelopeXdr, "base64");
    } catch {
      return null;
    }

    const ops =
      env.switch().name === "envelopeTypeTxFeeBump"
        ? env.feeBump().tx().innerTx().v1().tx().operations()
        : env.switch().name === "envelopeTypeTx"
          ? env.v1().tx().operations()
          : [];

    for (const op of ops) {
      if (op.body().switch().name !== "invokeHostFunction") continue;
      const fn = op.body().invokeHostFunctionOp().hostFunction();
      if (fn.switch().name !== "hostFunctionTypeInvokeContract") continue;
      const call = fn.invokeContract();
      if (Address.fromScAddress(call.contractAddress()).toString() !== this.config.credentialManagerId) continue;
      const fn_ = call.functionName().toString();
      if (fn_ !== "verify_credential" && fn_ !== "verify_credentials_batch") continue;
      try {
        const arg = scValToNative(call.args()[0]);
        const ids = Array.isArray(arg) ? arg.map(hex).filter((id): id is string => !!id) : [hex(arg)];
        return ids.filter((id): id is string => !!id);
      } catch {
        return [];
      }
    }
    return null;
  }

  /** Current time as unix ms UTC, for any locally-generated records. */
  private now(): number {
    return utcNowMs();
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }

  // ── Geography ───────────────────────────────────────────────────────────────

  /**
   * On-chain data has no location. DIDs may opt in by setting a `country`
   * metadata key (ISO 3166-1 alpha-2); we read it via resolve_did.
   */
  private async resolveCountries(): Promise<void> {
    const contract = new Contract(this.config.identityRegistryId);
    const { dids, countries } = this.store.data;
    const unresolved = dids
      .filter((d) => d.kind === "created" && !(d.controller in countries))
      .map((d) => d.controller);
    const pending = [...new Set([...this.countryQueue, ...unresolved])].slice(0, COUNTRY_LOOKUPS_PER_TICK);
    this.countryQueue = this.countryQueue.filter((c) => !pending.includes(c));

    for (const controller of pending) {
      try {
        const tx = new TransactionBuilder(this.simAccount, {
          fee: BASE_FEE,
          networkPassphrase: this.config.networkPassphrase,
        })
          .addOperation(contract.call("resolve_did", nativeToScVal(controller, { type: "address" })))
          .setTimeout(30)
          .build();
        const sim = await this.server.simulateTransaction(tx);
        if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) continue;

        const doc = scValToNative(sim.result.retval) as { metadata?: Record<string, string> };
        const raw = doc.metadata?.country ?? doc.metadata?.Country;
        const country = raw && /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
        this.store.setCountry(controller, country);
      } catch (err) {
        console.warn(`[indexer] resolve_did ${controller} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

interface GetTransactionsResult {
  transactions?: Array<{
    status: string;
    txHash?: string;
    applicationOrder: number;
    ledger: number;
    createdAt: number;
    envelopeXdr: string;
  }>;
  latestLedger: number;
  cursor: string;
}
