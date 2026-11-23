import { test } from "node:test";
import assert from "node:assert/strict";
import { SorobanClient } from "../src/soroban.js";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const DOCUMENT = {
  id: `did:stellar:${ADDRESS}`,
  controller: `did:stellar:${ADDRESS}`,
  createdAt: 1,
  updatedAt: 1,
  metadata: {},
  active: true,
};

function makeCache(initial = new Map()) {
  return {
    values: initial,
    gets: [],
    sets: [],
    invalidationKeys: [],
    client: null,
    async get(key) {
      this.gets.push(key);
      return this.values.get(key) ?? null;
    },
    async set(key, value) {
      this.sets.push({ key, value });
      this.values.set(key, value);
    },
    async invalidate(key) {
      this.invalidationKeys.push(key);
      const address = String(key).startsWith("did:stellar:")
        ? String(key).slice("did:stellar:".length)
        : String(key);
      return this.values.delete(address);
    },
  };
}

function makeClient(didCache, invokeImpl) {
  const client = new SorobanClient(
    {
      contracts: { identity: "CONTRACT_ID" },
      rpcCacheTtlMs: 1000,
      eventPollIntervalMs: 0,
    },
    null,
    { didCache },
  );
  client.invoke = invokeImpl;
  return client;
}

test("resolveDid returns a cached document without calling the contract", async () => {
  const didCache = makeCache(new Map([[ADDRESS, DOCUMENT]]));
  let invocations = 0;
  const client = makeClient(didCache, async () => {
    invocations += 1;
    return JSON.stringify({});
  });

  const result = await client.resolveDid(`did:stellar:${ADDRESS}`);

  assert.deepEqual(result, DOCUMENT);
  assert.equal(invocations, 0);
  assert.deepEqual(didCache.gets, [ADDRESS]);
});

test("resolveDid caches a successful contract resolution", async () => {
  const didCache = makeCache();
  const client = makeClient(didCache, async () => JSON.stringify({ active: true }));

  const result = await client.resolveDid(ADDRESS);

  assert.equal(result.id, `did:stellar:${ADDRESS}`);
  assert.equal(result.active, true);
  assert.equal(didCache.sets.length, 1);
  assert.equal(didCache.sets[0].key, ADDRESS);
});

test("resolveDid does not cache a missing DID", async () => {
  const didCache = makeCache();
  const client = makeClient(didCache, async () => "null");

  const result = await client.resolveDid(ADDRESS);

  assert.equal(result, null);
  assert.equal(didCache.sets.length, 0);
});

test("resolveDid still resolves when the cache read fails", async () => {
  const didCache = makeCache();
  didCache.get = async () => {
    throw new Error("redis unavailable");
  };
  didCache.set = async () => {};
  const client = makeClient(didCache, async () => JSON.stringify({ active: true }));

  const result = await client.resolveDid(ADDRESS);

  assert.equal(result.id, `did:stellar:${ADDRESS}`);
});

test("invalidateDid removes the cached document", async () => {
  const didCache = makeCache(new Map([[ADDRESS, DOCUMENT]]));
  const client = makeClient(didCache, async () => "null");

  const removed = await client.invalidateDid(`did:stellar:${ADDRESS}`);

  assert.equal(removed, true);
  assert.deepEqual(didCache.invalidationKeys, [`did:stellar:${ADDRESS}`]);
});

test("resolveDid falls back safely when no cache is configured", async () => {
  const client = makeClient(null, async () => JSON.stringify({ active: true }));

  const result = await client.resolveDid(ADDRESS);

  assert.equal(result.id, `did:stellar:${ADDRESS}`);
});
