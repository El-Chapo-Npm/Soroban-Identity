/**
 * Contract invokes must be signed through the connected wallet. For Freighter
 * that is window.freighter.signTransaction via useWalletSigning (issue #1257).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const m = vi.hoisted(() => ({
  signTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  prepareTransaction: vi.fn(),
  getAccount: vi.fn(),
  fromXDR: vi.fn(),
  addOperation: vi.fn(),
  setTimeout: vi.fn(),
  build: vi.fn(),
  contractCall: vi.fn(),
  getNetworkConfig: vi.fn(),
  useWalletContext: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  BASE_FEE: "100",
  Contract: vi.fn().mockImplementation(() => ({ call: m.contractCall })),
  SorobanRpc: {
    Server: vi.fn().mockImplementation(() => ({
      getAccount: m.getAccount,
      prepareTransaction: m.prepareTransaction,
      sendTransaction: m.sendTransaction,
      getTransaction: m.getTransaction,
    })),
  },
  TransactionBuilder: Object.assign(
    vi.fn().mockImplementation(() => ({
      addOperation: m.addOperation,
      setTimeout: m.setTimeout,
      build: m.build,
    })),
    { fromXDR: m.fromXDR },
  ),
}));

vi.mock("../network", () => ({
  getNetworkConfig: m.getNetworkConfig,
}));

vi.mock("../context/WalletContext", () => ({
  useWalletContext: m.useWalletContext,
}));

import { useSorobanInvoke } from "./useSorobanInvoke";

const connectedWallet = {
  connected: true,
  publicKey: "GABCDEF",
  signTransaction: m.signTransaction,
};

describe("useSorobanInvoke (#1257)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getNetworkConfig.mockReturnValue({
      rpcUrl: "https://rpc.example",
      networkPassphrase: "Test Network ; 2026",
      identityRegistryId: "CREGISTRY",
      credentialManagerId: "CCREDENTIALS",
    });
    m.useWalletContext.mockReturnValue({ connected: false, publicKey: null, signTransaction: m.signTransaction });
    m.getAccount.mockResolvedValue({ accountId: () => "GTEST" });
    m.addOperation.mockReturnValue({ setTimeout: m.setTimeout });
    m.setTimeout.mockReturnValue({ build: m.build });
    m.build.mockReturnValue({ built: true });
    m.contractCall.mockReturnValue({ operation: true });
    m.fromXDR.mockReturnValue({ parsed: true });
    m.signTransaction.mockResolvedValue("signed-xdr");
    m.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
    m.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    m.prepareTransaction.mockResolvedValue({ fee: "1234", toXDR: () => "prepared-xdr" });
  });

  it("signs the prepared XDR through the wallet before submitting", async () => {
    const { result } = renderHook(() => useSorobanInvoke(connectedWallet));
    const outcome = await result.current({
      contractId: "CREGISTRY",
      method: "create_did",
      args: ["address-arg" as never],
    });

    expect(m.signTransaction).toHaveBeenCalledTimes(1);
    expect(m.signTransaction).toHaveBeenCalledWith("prepared-xdr");
    expect(m.fromXDR).toHaveBeenCalledWith("signed-xdr", "Test Network ; 2026");
    expect(m.sendTransaction).toHaveBeenCalledWith({ parsed: true });
    expect(m.contractCall).toHaveBeenCalledWith("create_did", "address-arg");
    expect(outcome).toMatchObject({ hash: "tx-hash", fee: 1234, status: "SUCCESS" });
  });

  it("refuses to invoke without a connected wallet", async () => {
    const { result } = renderHook(() => useSorobanInvoke());
    await expect(
      result.current({ contractId: "CREGISTRY", method: "create_did", args: [] }),
    ).rejects.toThrow("Wallet not connected");
    expect(m.signTransaction).not.toHaveBeenCalled();
  });

  it("propagates signing rejection without submitting", async () => {
    m.signTransaction.mockRejectedValueOnce(new Error("Transaction signing was cancelled."));
    const { result } = renderHook(() => useSorobanInvoke(connectedWallet));

    await expect(
      result.current({ contractId: "CREGISTRY", method: "create_did", args: [] }),
    ).rejects.toThrow("Transaction signing was cancelled.");
    expect(m.sendTransaction).not.toHaveBeenCalled();
  });
});
