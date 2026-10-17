// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs public/sw.js in a sandbox with in-memory Cache Storage so the caching
 * strategies are tested against the real worker source (#1079).
 */

const ORIGIN = "https://app.test";
const SW_SOURCE = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
const STATIC_CACHE = "soroban-identity-static-v2";
const API_CACHE = "soroban-identity-api-v2";

const keyOf = (input: Request | string) =>
  new URL(typeof input === "string" ? input : input.url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();
  constructor(private fetchFn: (r: Request) => Promise<Response>) {}
  async match(input: Request | string) {
    const hit = this.entries.get(keyOf(input));
    return hit ? hit.clone() : undefined;
  }
  async put(input: Request | string, response: Response) {
    this.entries.set(keyOf(input), response);
  }
  async delete(input: Request | string) {
    return this.entries.delete(keyOf(input));
  }
  async keys() {
    return Array.from(this.entries.keys()).map((url) => new Request(url));
  }
  async addAll(urls: string[]) {
    const responses = await Promise.all(urls.map((u) => this.fetchFn(new Request(keyOf(u)))));
    if (responses.some((r) => !r.ok)) throw new TypeError("addAll: a request failed");
    urls.forEach((u, i) => this.entries.set(keyOf(u), responses[i]));
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  constructor(private fetchFn: (r: Request) => Promise<Response>) {}
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this.fetchFn));
    return this.caches.get(name)!;
  }
  async keys() {
    return Array.from(this.caches.keys());
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
  async match(input: Request | string) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(input);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** A same-origin network response, as a real worker's fetch would return. */
function basic(body: string, init: ResponseInit = {}) {
  const res = new Response(body, { status: 200, ...init });
  Object.defineProperty(res, "type", { value: "basic" });
  return res;
}

function loadWorker(fetchImpl: (r: Request) => Promise<Response>) {
  const handlers: Record<string, (event: any) => void> = {};
  const fetchMock = vi.fn(fetchImpl);
  const caches = new FakeCacheStorage(fetchMock);
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: any) => void) => {
      handlers[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [] },
    registration: { showNotification: async () => {} },
  };
  vm.runInNewContext(SW_SOURCE, {
    self,
    caches,
    fetch: fetchMock,
    Request,
    Response,
    Headers,
    URL,
    console: { warn: () => {}, error: () => {}, log: () => {} },
    // Resolved at call time so vi.useFakeTimers() applies inside the worker.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });

  async function lifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  /** Dispatch a fetch event; resolves with the response, or null if not intercepted. */
  async function request(
    path: string,
    init: { mode?: string; method?: string; headers?: HeadersInit } = {}
  ) {
    const req = new Request(new URL(path, ORIGIN).href, {
      method: init.method,
      headers: init.headers,
    });
    if (init.mode) Object.defineProperty(req, "mode", { value: init.mode });
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | null = null;
    handlers.fetch({
      request: req,
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    if (!responded) return null;
    const res = await responded;
    await Promise.all(waits);
    return res as Response;
  }

  return { caches, fetchMock, lifecycle, request, handlers };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("service worker (#1079)", () => {
  describe("lifecycle", () => {
    it("precaches the app shell from assets the build actually serves", async () => {
      const served = new Set(["/", "/index.html", "/manifest.json"]);
      const sw = loadWorker(async (r) =>
        served.has(new URL(r.url).pathname) ? basic("ok") : new Response("", { status: 404 })
      );
      await sw.lifecycle("install");

      const shell = sw.caches.caches.get(STATIC_CACHE)!;
      expect(shell.entries.size).toBe(3);
    });

    it("removes old versions of its own caches and leaves other caches alone", async () => {
      const sw = loadWorker(async () => basic("ok"));
      await sw.caches.open("soroban-identity-v1");
      await sw.caches.open("another-app-cache");
      await sw.caches.open(API_CACHE);
      await sw.lifecycle("activate");

      expect(await sw.caches.keys()).toEqual(["another-app-cache", API_CACHE]);
    });
  });

  describe("API responses", () => {
    it("serves the network response and stores a timestamped copy", async () => {
      const sw = loadWorker(async () =>
        basic('{"ok":true}', { headers: { "content-type": "application/json" } })
      );
      const res = await sw.request("/api/credentials/abc");

      expect(await res!.json()).toEqual({ ok: true });
      const stored = await sw.caches.caches.get(API_CACHE)!.match(`${ORIGIN}/api/credentials/abc`);
      expect(Number(stored!.headers.get("sw-cached-at"))).toBeGreaterThan(0);
    });

    it("falls back to the cached copy when offline and marks it", async () => {
      let online = true;
      const sw = loadWorker(async () => (online ? basic('{"v":1}') : offline()));
      await sw.request("/api/credentials/abc");

      online = false;
      const res = await sw.request("/api/credentials/abc");

      expect(res!.status).toBe(200);
      expect(res!.headers.get("x-sw-cache")).toBe("offline");
      expect(await res!.json()).toEqual({ v: 1 });
    });

    it("returns an offline JSON 503 when nothing is cached", async () => {
      const sw = loadWorker(offline);
      const res = await sw.request("/api/credentials/missing");

      expect(res!.status).toBe(503);
      expect(res!.headers.get("x-sw-cache")).toBe("miss");
      expect((await res!.json()).code).toBe("OFFLINE");
    });

    it("does not serve or keep a copy older than 24 hours", async () => {
      const sw = loadWorker(offline);
      const cache = await sw.caches.open(API_CACHE);
      const dayAndAMinuteAgo = Date.now() - (24 * 60 + 1) * 60 * 1000;
      await cache.put(
        `${ORIGIN}/api/old`,
        basic("{}", { headers: { "sw-cached-at": String(dayAndAMinuteAgo) } })
      );

      const res = await sw.request("/api/old");

      expect(res!.status).toBe(503);
      expect(cache.entries.size).toBe(0);
    });

    it("does not cache authenticated requests, no-store or private responses, or errors", async () => {
      const sw = loadWorker(async (r) => {
        const path = new URL(r.url).pathname;
        if (path === "/api/no-store")
          return basic("{}", { headers: { "cache-control": "no-store" } });
        if (path === "/api/private")
          return basic("{}", { headers: { "cache-control": "private, max-age=60" } });
        if (path === "/api/error") return basic("{}", { status: 500 });
        return basic("{}");
      });

      await sw.request("/api/me", { headers: { Authorization: "Bearer secret" } });
      await sw.request("/api/no-store");
      await sw.request("/api/private");
      await sw.request("/api/error");

      expect(sw.caches.caches.get(API_CACHE)?.entries.size ?? 0).toBe(0);
    });

    it("serves the cached copy when the network is slower than the timeout", async () => {
      vi.useFakeTimers();
      try {
        let release!: (r: Response) => void;
        let slow = false;
        const sw = loadWorker(() =>
          slow
            ? new Promise<Response>((resolve) => (release = resolve))
            : Promise.resolve(basic('{"v":1}'))
        );
        await sw.request("/api/slow");

        slow = true;
        const pending = sw.request("/api/slow");
        await vi.advanceTimersByTimeAsync(4000);
        release(basic('{"v":2}'));
        const res = await pending;

        expect(res!.headers.get("x-sw-cache")).toBe("offline");
        expect(await res!.json()).toEqual({ v: 1 });
        // The late network response still refreshes the cache.
        const stored = await sw.caches.caches.get(API_CACHE)!.match(`${ORIGIN}/api/slow`);
        expect(await stored!.json()).toEqual({ v: 2 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps at most 100 entries, dropping the oldest", async () => {
      const sw = loadWorker(async () => basic("{}"));
      for (let i = 0; i <= 100; i++) {
        await sw.request(`/api/item/${i}`);
      }

      const cache = sw.caches.caches.get(API_CACHE)!;
      expect(cache.entries.size).toBe(100);
      expect(cache.entries.has(`${ORIGIN}/api/item/0`)).toBe(false);
      expect(cache.entries.has(`${ORIGIN}/api/item/100`)).toBe(true);
    });

    it("clears the API cache on request from the page", async () => {
      const sw = loadWorker(async () => basic("{}"));
      await sw.request("/api/item/1");

      const waits: Promise<unknown>[] = [];
      sw.handlers.message({
        data: { type: "CLEAR_API_CACHE" },
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
      await Promise.all(waits);

      expect(sw.caches.caches.has(API_CACHE)).toBe(false);
    });
  });

  describe("pages and static assets", () => {
    let sw: ReturnType<typeof loadWorker>;
    let online: boolean;

    beforeEach(() => {
      online = true;
      sw = loadWorker(async (r) => (online ? basic(`page:${new URL(r.url).pathname}`) : offline()));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("loads pages from the network first and serves the cached shell offline", async () => {
      const first = await sw.request("/credentials", { mode: "navigate" });
      expect(await first!.text()).toBe("page:/credentials");

      online = false;
      const offlinePage = await sw.request("/settings", { mode: "navigate" });
      expect(offlinePage!.status).toBe(200);
      expect(await offlinePage!.text()).toBe("page:/credentials");
    });

    it("returns a 503 for an uncached page or asset instead of failing the request", async () => {
      online = false;
      const page = await sw.request("/settings", { mode: "navigate" });
      const asset = await sw.request("/assets/app-123.js");

      expect(page!.status).toBe(503);
      expect(asset!.status).toBe(503);
    });

    it("serves static assets from the cache once fetched", async () => {
      await sw.request("/assets/app-123.js");
      online = false;
      const res = await sw.request("/assets/app-123.js");

      expect(await res!.text()).toBe("page:/assets/app-123.js");
    });

    it("leaves cross-origin and non-GET requests to the browser", async () => {
      expect(await sw.request("https://soroban-testnet.stellar.org/rpc")).toBeNull();
      expect(await sw.request("/api/credentials", { method: "POST" })).toBeNull();
    });
  });
});
