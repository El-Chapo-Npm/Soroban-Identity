import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";

export interface EventFilter {
  topic?: string[] | string[][];
  contractId?: string;
}

export interface ContractEvent {
  type: string;
  contractId: string;
  topic: string[];
  value: Record<string, unknown>;
  ledger: number;
  txHash: string;
}

export class SorobanEventListener {
  private server: SorobanRpc.Server;
  private contractId: string;
  private filter?: EventFilter;
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private lastLedger = 0;

  constructor(rpcUrl: string, contractId: string, filter?: EventFilter) {
    this.server = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
    this.filter = filter;
  }

  /**
   * Start polling for events at the specified interval.
   * @param callback Function called with matching events
   * @param intervalMs Polling interval in milliseconds (default: 5000)
   */
  start(
    callback: (events: ContractEvent[]) => void,
    intervalMs = 5000
  ): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      try {
        const events = await this.server.getEvents({
          startLedger: this.lastLedger || undefined,
          filters: [
            {
              type: "contract",
              contractIds: [this.contractId],
              topics: this.getTopicsFilter(),
            },
          ],
          limit: 100,
        });

        if (events.events && events.events.length > 0) {
          const contractEvents = events.events
            .map((e) => this.parseEvent(e))
            .filter((e) => e !== null) as ContractEvent[];

          if (contractEvents.length > 0) {
            callback(contractEvents);
            this.lastLedger =
              Math.max(...contractEvents.map((e) => e.ledger)) + 1;
          }
        }
      } catch (error) {
        console.error("Error polling events:", error);
      }
    };

    poll();
    this.intervalId = setInterval(poll, intervalMs);
  }

  /**
   * Stop polling for events.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
  }

  /**
   * Parse a raw Soroban event into a ContractEvent.
   */
  private parseEvent(
    event: SorobanRpc.Api.EventResponse
  ): ContractEvent | null {
    try {
      if (event.type !== "contract") return null;

      const contractId = String(event.contractId ?? "");
      const topic = (event.topic ?? []).map((entry) =>
        String(scValToNative(entry))
      );
      const nativeValue = scValToNative(event.value);
      const value =
        nativeValue !== null && typeof nativeValue === "object"
          ? (nativeValue as Record<string, unknown>)
          : { value: nativeValue };

      return {
        type: event.type,
        contractId,
        topic,
        value,
        ledger: event.ledger,
        txHash: event.txHash,
      };
    } catch {
      return null;
    }
  }

  private getTopicsFilter(): string[][] | undefined {
    const topic = this.filter?.topic;
    if (!topic) return undefined;
    return Array.isArray(topic[0]) ? (topic as string[][]) : [topic as string[]];
  }
}
