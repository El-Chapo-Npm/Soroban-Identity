import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useWalletSigning,
  SIGNING_GESTURE_REQUIRED_MESSAGE,
} from "./useWalletSigning";

vi.mock("@walletconnect/sign-client", () => ({ default: { init: vi.fn() } }));

const PASSPHRASE = "Test SDF Network ; September 2015";

function setup() {
  const signTransaction = vi.fn().mockResolvedValue("signed-xdr");
  Object.defineProperty(window, "freighter", {
    value: { signTransaction },
    writable: true,
    configurable: true,
  });
  const hook = renderHook(() =>
    useWalletSigning({
      networkConfig: { walletConnectChain: "stellar:testnet" } as never,
      state: {
        connected: true,
        walletType: "freighter",
        networkPassphrase: PASSPHRASE,
      } as never,
      setState: vi.fn(),
      wcClientRef: { current: null },
      wcTopicRef: { current: null },
    })
  );
  return { signTransaction, hook };
}

function setActivation(value: { isActive: boolean } | undefined) {
  Object.defineProperty(navigator, "userActivation", {
    value,
    configurable: true,
  });
}

describe("useWalletSigning user-gesture guard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setActivation(undefined));

  it("signs when the user activation is active", async () => {
    setActivation({ isActive: true });
    const { signTransaction, hook } = setup();
    let out = "";
    await act(async () => {
      out = await hook.result.current.signTransaction("xdr");
    });
    expect(out).toBe("signed-xdr");
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not call Freighter without a user gesture", async () => {
    setActivation({ isActive: false });
    const { signTransaction, hook } = setup();
    await act(async () => {
      await expect(hook.result.current.signTransaction("xdr")).rejects.toThrow(
        SIGNING_GESTURE_REQUIRED_MESSAGE
      );
    });
    expect(signTransaction).not.toHaveBeenCalled();
    expect(hook.result.current.signingError).toBe(
      SIGNING_GESTURE_REQUIRED_MESSAGE
    );
  });

  it("still signs when the User Activation API is unavailable", async () => {
    setActivation(undefined);
    const { signTransaction, hook } = setup();
    await act(async () => {
      await hook.result.current.signTransaction("xdr");
    });
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });
});
