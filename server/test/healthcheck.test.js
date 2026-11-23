import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkHealth,
  DEFAULT_PATH,
  DEFAULT_PORT,
  resolveTarget,
} from '../scripts/healthcheck.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/healthcheck.mjs', import.meta.url));

// Stub server: /live answers 200, /ready answers 503, /hang never answers.
let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"alive"}');
    } else if (req.url === '/ready') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"ready":false}');
    }
    // `/hang` is left open on purpose.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** A port with nothing listening on it. */
async function closedPort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port: free } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return free;
}

/**
 * Run the CLI in a child process. Asynchronous on purpose: a synchronous spawn
 * would block this process, and with it the stub server the CLI is probing.
 */
function runScript(env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, ...env },
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stderr }));
  });
}

test('resolveTarget defaults to the liveness endpoint on port 3001', () => {
  assert.equal(resolveTarget({}, []), `http://127.0.0.1:${DEFAULT_PORT}${DEFAULT_PATH}`);
  assert.equal(DEFAULT_PATH, '/live');
});

test('resolveTarget honours PORT, HEALTHCHECK_PATH, the path argument and HEALTHCHECK_URL', () => {
  assert.equal(resolveTarget({ PORT: '8080' }, []), 'http://127.0.0.1:8080/live');
  assert.equal(resolveTarget({ HEALTHCHECK_PATH: '/ready' }, []), 'http://127.0.0.1:3001/ready');
  assert.equal(resolveTarget({ HEALTHCHECK_PATH: '/ready' }, ['/health']), 'http://127.0.0.1:3001/health');
  assert.equal(
    resolveTarget({ PORT: '8080', HEALTHCHECK_URL: 'http://api:3001/live' }, ['/ready']),
    'http://api:3001/live',
  );
});

test('checkHealth reports a 2xx response as healthy', async () => {
  assert.deepEqual(await checkHealth(`http://127.0.0.1:${port}/live`), { ok: true, status: 200 });
});

test('checkHealth reports a non-2xx response as unhealthy', async () => {
  assert.deepEqual(await checkHealth(`http://127.0.0.1:${port}/ready`), { ok: false, status: 503 });
});

test('checkHealth gives up after the timeout', async () => {
  const started = Date.now();
  const result = await checkHealth(`http://127.0.0.1:${port}/hang`, { timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out after 200ms/);
  assert.ok(Date.now() - started < 2_000, 'timeout was not enforced');
});

test('checkHealth reports a refused connection as unhealthy', async () => {
  const result = await checkHealth(`http://127.0.0.1:${await closedPort()}/live`);
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('checkHealth reports a malformed URL as unhealthy instead of throwing', async () => {
  const result = await checkHealth('http://127.0.0.1:3001no-slash');
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid URL/);
});

test('the CLI exits 0 when the server is live', async () => {
  const run = await runScript({ PORT: String(port) });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
});

test('the CLI exits 1 with a reason when the probe fails', async () => {
  const notReady = await runScript({ PORT: String(port) }, ['/ready']);
  assert.equal(notReady.status, 1);
  assert.match(notReady.stderr, /unhealthy: GET http:\/\/127\.0\.0\.1:\d+\/ready -> HTTP 503/);

  const down = await runScript({ PORT: String(await closedPort()) });
  assert.equal(down.status, 1);
  assert.match(down.stderr, /ECONNREFUSED/);

  const hung = await runScript({ PORT: String(port), HEALTHCHECK_TIMEOUT_MS: '200' }, ['/hang']);
  assert.equal(hung.status, 1);
  assert.match(hung.stderr, /timed out after 200ms/);

  const malformed = await runScript({ HEALTHCHECK_URL: 'not a url' });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /unhealthy: GET not a url -> Invalid URL/);
});
