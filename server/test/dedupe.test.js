import { Readable } from "node:stream";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createRequestDeduplication } from "../src/middleware/dedupe.js";

function request(body, headers = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = "POST";
  req.url = "/credentials";
  req.headers = { "content-length": String(Buffer.byteLength(body)), ...headers };
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function response() {
  const state = { statusCode: 200, headers: {}, body: Buffer.alloc(0), writableEnded: false };
  return {
    get state() { return state; },
    get headersSent() { return state.headersSent === true; },
    setHeader(name, value) { state.headers[name] = value; },
    writeHead(statusCode, headers = {}) { state.statusCode = statusCode; Object.assign(state.headers, headers); state.headersSent = true; },
    end(chunk = "") { state.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); state.writableEnded = true; },
  };
}

const config = { maxBodyBytes: 1024 };

describe("request deduplication", () => {
  it("shares an in-flight response and marks the replay", async () => {
    const dedupe = createRequestDeduplication({ ttlMs: 5000 });
    const first = response();
    const second = response();
    let release;
    const work = new Promise((resolve) => { release = resolve; });
    const next = async (res) => {
      await work;
      res.writeHead(201, { "content-type": "application/json" });
      res.end('{"ok":true}');
    };
    const p1 = dedupe(request('{"x":1}', { authorization: "Bearer a" }), first, () => next(first), config);
    const p2 = dedupe(request('{"x":1}', { authorization: "Bearer a" }), second, () => next(second), config);
    release();
    await Promise.all([p1, p2]);
    assert.equal(first.state.statusCode, 201);
    assert.equal(second.state.statusCode, 201);
    assert.equal(second.state.headers["X-Dedupe-Hit"], "true");
    assert.equal(second.state.body.toString(), '{"ok":true}');
  });

  it("does not replay across caller identities and expires entries", async () => {
    const dedupe = createRequestDeduplication({ ttlMs: 5000 });
    const run = mock.fn(async (res) => { res.writeHead(200); res.end("ok"); });
    const first = response();
    await dedupe(request("{}", { authorization: "Bearer a" }), first, () => run(first), config);
    const other = response();
    await dedupe(request("{}", { authorization: "Bearer b" }), other, () => run(other), config);
    assert.equal(run.mock.callCount(), 2);
    await new Promise((resolve) => setTimeout(resolve, 5010));
    const expired = response();
    await dedupe(request("{}", { authorization: "Bearer a" }), expired, () => run(expired), config);
    assert.equal(run.mock.callCount(), 3);
  });
});
