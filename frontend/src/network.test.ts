import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVE_NETWORK_STORAGE_KEY,
  DEFAULT_NETWORK,
  getActiveNetwork,
  normalizeNetworkName,
  persistActiveNetwork,
} from "./network";

describe("network selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizes unknown values to the safe Testnet selection", () => {
    expect(normalizeNetworkName("staging")).toBe("testnet");
    expect(normalizeNetworkName(undefined)).toBe("testnet");
  });

  it("uses the persisted network when one is available", () => {
    persistActiveNetwork("mainnet");

    expect(window.localStorage.getItem(ACTIVE_NETWORK_STORAGE_KEY)).toBe("mainnet");
    expect(getActiveNetwork()).toBe("mainnet");
  });

  it("falls back to the configured default when no selection is persisted", () => {
    expect(getActiveNetwork()).toBe(DEFAULT_NETWORK);
  });
});
