import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PresenceClient } from "./presenceProtocol";

/** Minimal fake WebSocket the test fully controls, with no network I/O. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send() {}

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];

describe("PresenceClient reconnection (#1083)", () => {
  // Each client listens on window online/offline, so a client left connected
  // by one test would react to the network events dispatched by the next.
  let clients: PresenceClient[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    clients = [];
  });

  afterEach(() => {
    clients.forEach((client) => client.disconnect());
    vi.useRealTimers();
  });

  function makeClient(overrides = {}) {
    const client = new PresenceClient({
      url: "wss://example.test/presence",
      userId: "u1",
      displayName: "Ada",
      socketFactory: (url) => new FakeSocket(url) as unknown as WebSocket,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 1_000,
      maxReconnectAttempts: 10,
      ...overrides,
    });
    clients.push(client);
    client.connect();
    return client;
  }

  it("backs off exponentially, capped, instead of retrying at a flat interval", () => {
    makeClient();
    const expected = [100, 200, 400, 800, 1_000, 1_000];

    expected.forEach((delay, attempt) => {
      latest().drop();
      vi.advanceTimersByTime(delay - 1);
      expect(FakeSocket.instances.length).toBe(attempt + 1);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances.length).toBe(attempt + 2);
    });
  });

  it("stops retrying after maxReconnectAttempts", () => {
    makeClient({ maxReconnectAttempts: 3 });

    for (let i = 0; i < 10; i += 1) {
      latest().drop();
      vi.advanceTimersByTime(10_000);
    }
    // The initial socket plus exactly three retries.
    expect(FakeSocket.instances.length).toBe(4);
  });

  it("resets the backoff after a successful reconnect", () => {
    makeClient();
    latest().drop();
    vi.advanceTimersByTime(100);
    latest().drop();
    vi.advanceTimersByTime(200);

    latest().open();
    latest().drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances.length).toBe(4);
  });

  it("waits while offline and reconnects exactly once when the network returns", () => {
    makeClient();
    window.dispatchEvent(new Event("offline"));
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(1);

    window.dispatchEvent(new Event("online"));
    expect(FakeSocket.instances.length).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it("collapses a network change with a pending retry into a single connection", () => {
    makeClient();
    latest().drop();
    window.dispatchEvent(new Event("online"));
    expect(FakeSocket.instances.length).toBe(2);

    // The retry that was pending before the network change must not also fire.
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it("stops retrying once disconnected", () => {
    const client = makeClient();
    latest().drop();
    client.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(1);
  });
});
