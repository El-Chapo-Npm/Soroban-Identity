import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresence } from "./usePresence";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
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
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const currentUser = { id: "u1", name: "Ada" };

describe("usePresence reconnection (#1083)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(options: { reconnectDelayMs?: number; maxReconnectAttempts?: number } = {}) {
    return renderHook(() =>
      usePresence({
        url: "wss://example.test",
        resourceId: "did:1",
        currentUser,
        reconnectDelayMs: 100,
        ...options,
      })
    );
  }

  it("backs off exponentially between failed reconnects", () => {
    render();

    [100, 200, 400, 800].forEach((delay, attempt) => {
      act(() => latest().drop());
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeSocket.instances.length).toBe(attempt + 1);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeSocket.instances.length).toBe(attempt + 2);
    });
  });

  it("caps the reconnect delay at 30 seconds", () => {
    render({ reconnectDelayMs: 20_000 });

    act(() => latest().drop());
    act(() => vi.advanceTimersByTime(20_000));
    act(() => latest().drop());

    // Uncapped this would be 40s.
    act(() => vi.advanceTimersByTime(30_000));
    expect(FakeSocket.instances.length).toBe(3);
  });

  it("stops retrying after maxReconnectAttempts", () => {
    render({ maxReconnectAttempts: 2 });

    for (let i = 0; i < 6; i += 1) {
      act(() => latest().drop());
      act(() => vi.advanceTimersByTime(60_000));
    }
    expect(FakeSocket.instances.length).toBe(3);
  });

  it("resets the backoff after a successful connection", () => {
    render();

    act(() => latest().drop());
    act(() => vi.advanceTimersByTime(100));
    act(() => latest().drop());
    act(() => vi.advanceTimersByTime(200));

    act(() => latest().open());
    act(() => latest().drop());
    act(() => vi.advanceTimersByTime(100));
    expect(FakeSocket.instances.length).toBe(4);
  });

  it("pauses while offline and reconnects once when the network returns", () => {
    render();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.instances.length).toBe(1);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(FakeSocket.instances.length).toBe(2);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.instances.length).toBe(2);
  });

  it("stops reconnecting after unmount", () => {
    const { unmount } = render();
    act(() => latest().drop());
    unmount();

    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.instances.length).toBe(1);
  });
});
