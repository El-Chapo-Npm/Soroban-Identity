import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useWalletState,
  loadWalletSession,
  persistWalletSession,
  WALLET_SESSION_KEY,
  DISCONNECTED_STATE,
} from "./useWalletState";

const PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("wallet session persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns null when nothing is persisted", () => {
    expect(loadWalletSession()).toBeNull();
  });

  it("ignores malformed persisted entries", () => {
    sessionStorage.setItem(WALLET_SESSION_KEY, "not json");
    expect(loadWalletSession()).toBeNull();

    sessionStorage.setItem(WALLET_SESSION_KEY, JSON.stringify({ publicKey: "" }));
    expect(loadWalletSession()).toBeNull();
  });

  it("persists and reloads the connected key and wallet type", () => {
    persistWalletSession(PUBLIC_KEY, "freighter");
    expect(loadWalletSession()).toEqual({
      publicKey: PUBLIC_KEY,
      walletType: "freighter",
    });
  });

  it("removes the stored session when disconnected", () => {
    persistWalletSession(PUBLIC_KEY, "walletconnect");
    persistWalletSession(null, null);
    expect(sessionStorage.getItem(WALLET_SESSION_KEY)).toBeNull();
  });

  it("hydrates the hook state from sessionStorage on mount", () => {
    persistWalletSession(PUBLIC_KEY, "freighter");

    const { result } = renderHook(() => useWalletState());

    expect(result.current.state.publicKey).toBe(PUBLIC_KEY);
    expect(result.current.state.walletType).toBe("freighter");
    expect(result.current.state.connected).toBe(true);
  });

  it("writes state changes to sessionStorage and clears them on disconnect", () => {
    const { result } = renderHook(() => useWalletState());

    expect(result.current.state.publicKey).toBeNull();
    expect(sessionStorage.getItem(WALLET_SESSION_KEY)).toBeNull();

    act(() => {
      result.current.setState({
        ...result.current.state,
        publicKey: PUBLIC_KEY,
        walletType: "walletconnect",
        connected: true,
      });
    });

    expect(loadWalletSession()).toEqual({
      publicKey: PUBLIC_KEY,
      walletType: "walletconnect",
    });

    act(() => {
      result.current.setState(DISCONNECTED_STATE);
    });

    expect(loadWalletSession()).toBeNull();
  });
});
