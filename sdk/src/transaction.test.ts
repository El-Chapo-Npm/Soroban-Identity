import { describe, it, expect, vi } from "vitest";
import { Account, Keypair, Networks, Operation, SorobanRpc, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { executeTransaction } from "./transaction";
import { SorobanIdentityError } from "./errors";

function buildTestTransaction(): Transaction {
  const account = new Account(Keypair.random().publicKey(), "0");
  return new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "0" }))
    .setTimeout(30)
    .build();
}

describe("executeTransaction signer", () => {
  it("passes the prepared transaction's XDR to signer and submits its signed XDR response", async () => {
    const tx = buildTestTransaction();
    const sendTransaction = vi.fn(async () => ({ status: "PENDING", hash: "abc123" }));

    const server = {
      prepareTransaction: async (t: Transaction) => t,
      sendTransaction,
      getTransaction: async () => ({ status: SorobanRpc.Api.GetTransactionStatus.SUCCESS }),
    } as unknown as SorobanRpc.Server;

    const signer = vi.fn(async (xdr: string) => xdr);

    await executeTransaction(server, tx, signer, { pollRetries: 1, pollInterval: 0 });

    expect(signer).toHaveBeenCalledWith(tx.toXDR());
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    const submitted = sendTransaction.mock.calls[0]![0] as Transaction;
    expect(submitted.toXDR()).toBe(tx.toXDR());
  });
});

describe("executeTransaction confirmation timeout", () => {
  it("attaches the transaction hash to the thrown error so callers can avoid resubmission", async () => {
    const hash = "abc123deadbeef";

    const server = {
      prepareTransaction: async (t: Transaction) => t,
      sendTransaction: async () => ({ status: "PENDING", hash }),
      getTransaction: async () => ({ status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND }),
    } as unknown as SorobanRpc.Server;

    const tx = buildTestTransaction();
    const signer = async (xdr: string) => xdr;

    await expect(
      executeTransaction(server, tx, signer, { pollRetries: 1, pollInterval: 0 })
    ).rejects.toMatchObject({
      txHash: hash,
    });

    try {
      await executeTransaction(server, tx, signer, { pollRetries: 1, pollInterval: 0 });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SorobanIdentityError);
      expect((err as SorobanIdentityError).txHash).toBe(hash);
      expect((err as SorobanIdentityError).code).toBe("TIMEOUT");
    }
  });
});
