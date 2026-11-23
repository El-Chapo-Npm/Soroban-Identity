import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  getIdleTimeoutMs,
  useIdleSessionTimeout,
} from "./useIdleSessionTimeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("useIdleSessionTimeout", () => {
  it("logs out a connected session after the configured idle duration", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    renderHook(() => useIdleSessionTimeout(true, onIdle, 1_000, 200));

    act(() => vi.advanceTimersByTime(999));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("shows warning 2 minutes before disconnect and can extend session", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const { result } = renderHook(() =>
      useIdleSessionTimeout(true, onIdle, 120_000, 120_000)
    );

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.warningVisible).toBe(true);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(120);

    act(() => result.current.extendSession());
    expect(result.current.warningVisible).toBe(false);

    act(() => vi.advanceTimersByTime(119_000));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("resets the idle timer after user activity when warning is not shown", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    renderHook(() => useIdleSessionTimeout(true, onIdle, 1_000, 200));

    act(() => vi.advanceTimersByTime(700));
    act(() => window.dispatchEvent(new Event("pointerdown")));
    act(() => vi.advanceTimersByTime(700));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not time out a disconnected session and cleans up its timer", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleSessionTimeout(false, onIdle, 1_000, 200));
    act(() => vi.advanceTimersByTime(2_000));
    expect(onIdle).not.toHaveBeenCalled();
    unmount();
  });
});

describe("getIdleTimeoutMs", () => {
  it("uses the secure default when the setting is absent or invalid", () => {
    expect(getIdleTimeoutMs("")).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    expect(getIdleTimeoutMs("not-a-number")).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    expect(getIdleTimeoutMs("0")).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });

  it("accepts a positive timeout override in milliseconds", () => {
    expect(getIdleTimeoutMs("60000")).toBe(60_000);
  });
});
