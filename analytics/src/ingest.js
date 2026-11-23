import { SorobanRpc, scValToNative } from '@stellar/stellar-sdk';

const KINDS = new Set(['created', 'issued', 'revoked']);

// Polls Soroban RPC for identity/credential contract events and feeds the aggregator.
export class EventIngestor {
  constructor({ rpcUrl, contractIds, aggregator, startLedger, intervalMs = 5000 }) {
    this.server = new SorobanRpc.Server(rpcUrl);
    this.contractIds = contractIds.filter(Boolean);
    this.aggregator = aggregator;
    this.cursor = undefined;
    this.startLedger = startLedger;
    this.intervalMs = intervalMs;
  }

  async poll() {
    if (!this.contractIds.length) return;
    if (!this.startLedger && !this.cursor) {
      this.startLedger = Math.max(1, (await this.server.getLatestLedger()).sequence - 17280);
    }
    const res = await this.server.getEvents({
      ...(this.cursor ? { cursor: this.cursor } : { startLedger: this.startLedger }),
      filters: [{ type: 'contract', contractIds: this.contractIds }],
      limit: 200,
    });
    for (const ev of res.events) {
      this.cursor = ev.pagingToken;
      const topics = ev.topic.map((t) => { try { return scValToNative(t); } catch { return null; } });
      const kind = topics.find((t) => typeof t === 'string' && KINDS.has(t));
      if (!kind) continue;
      let value = {};
      try { value = scValToNative(ev.value) ?? {}; } catch { /* undecodable payload */ }
      this.aggregator.record({
        kind,
        timestamp: ev.ledgerClosedAt,
        issuer: kind === 'issued' ? String(value.issuer ?? topics[2] ?? '') || undefined : undefined,
        country: typeof value.country === 'string' ? value.country : undefined,
      });
    }
  }

  start() {
    const tick = () => this.poll().catch((e) => console.error('ingest failed:', e.message));
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }
}
