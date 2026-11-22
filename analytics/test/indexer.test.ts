import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { Indexer } from "../src/indexer.js";

const sym = (s: string) => nativeToScVal(s, { type: "symbol" });

function makeIndexer() {
  const dids: unknown[] = [];
  const store = { addDid: (e: unknown) => dids.push(e) } as never;
  const config = {
    rpcUrl: "https://soroban-testnet.stellar.org",
    identityRegistryId: "CID",
    credentialManagerId: "CCM",
  } as never;
  return { indexer: new Indexer(config, store), dids };
}

function event(topic: unknown) {
  return {
    id: "e1",
    ledger: 1,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    inSuccessfulContractCall: true,
    contractId: { toString: () => "CID" },
    topic,
    value: xdr.ScVal.scvVec([nativeToScVal(1, { type: "u32" }), nativeToScVal("GCONTROLLER", { type: "string" })]),
  };
}

const handle = (i: Indexer, ev: unknown) => (i as any).handleEvent(ev);

test("null topic does not throw and is skipped", () => {
  const { indexer, dids } = makeIndexer();
  assert.doesNotThrow(() => handle(indexer, event(null)));
  assert.doesNotThrow(() => handle(indexer, event(undefined)));
  assert.equal(dids.length, 0);
});

test("null entry inside topic does not throw and is skipped", () => {
  const { indexer, dids } = makeIndexer();
  assert.doesNotThrow(() => handle(indexer, event([sym("IDENTITY"), null])));
  assert.doesNotThrow(() => handle(indexer, event([null, null])));
  assert.equal(dids.length, 0);
});

test("valid topic is still processed", () => {
  const { indexer, dids } = makeIndexer();
  handle(indexer, event([sym("IDENTITY"), sym("created")]));
  assert.equal(dids.length, 1);
});
