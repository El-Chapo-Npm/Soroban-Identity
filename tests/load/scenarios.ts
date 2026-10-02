import http from 'k6/http';
import { check, sleep } from 'k6';
import execution from 'k6/execution';
import { Rate } from 'k6/metrics';

// Each fixture needs a funded, authorized controller with no existing DID.
const fixtures = JSON.parse(open(__ENV.FIXTURES || './fixtures.json'));
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!base) throw new Error('BASE_URL must point to the dedicated load environment');
const mode = __ENV.SCENARIO || 'normal';
const profiles = {
  normal: [{ duration: '1m', target: 100 }, { duration: '5m', target: 100 }, { duration: '1m', target: 0 }],
  peak: [{ duration: '2m', target: 500 }, { duration: '5m', target: 500 }, { duration: '1m', target: 0 }],
  stress: [{ duration: '2m', target: 100 }, { duration: '3m', target: 500 }, { duration: '3m', target: 1000 }, { duration: '1m', target: 0 }],
  spike: [{ duration: '1m', target: 100 }, { duration: '10s', target: 1000 }, { duration: '1m', target: 1000 }, { duration: '10s', target: 100 }, { duration: '1m', target: 0 }],
};
if (!profiles[mode]) throw new Error(`Unknown SCENARIO: ${mode}`);
const failures = new Rate('lifecycle_failed');
export const options = {
  stages: profiles[mode],
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    lifecycle_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${__ENV.P95_MS || 1000}`, `p(99)<${__ENV.P99_MS || 2000}`],
    checks: ['rate>0.99'],
  },
};
export default function () {
  const index = execution.scenario.iterationInTest;
  if (index >= fixtures.length) execution.test.abort('Fixture pool exhausted; supply a unique controller per iteration');
  const fixture = fixtures[index];
  const params = (name) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${__ENV.API_TOKEN || ''}` }, tags: { name } });
  const did = http.post(`${base}/identity/dids`, JSON.stringify({ controller: fixture.controller, metadata: { purpose: 'load-test' } }), params('create_did'));
  if (!check(did, { 'DID created': (r) => r.status === 201 })) { failures.add(true); return; }
  const issued = http.post(`${base}/credentials`, JSON.stringify({ ...fixture.credential, subject: fixture.controller }), params('issue_credential'));
  let id;
  try { id = issued.json('data.credentialId'); } catch (_) { /* check below records malformed responses */ }
  if (!check(issued, { 'credential issued': (r) => r.status === 201 && typeof id === 'string' && id.length > 0 })) { failures.add(true); return; }
  const verified = http.post(`${base}/credentials/${encodeURIComponent(id)}/verify`, '{}', params('verify_credential'));
  let valid = false;
  try { valid = verified.json('verified') === true; } catch (_) { /* counted as failure */ }
  const ok = check(verified, { 'credential verified': (r) => r.status === 200 && valid });
  failures.add(!ok);
  sleep(1);
}
export function handleSummary(data) {
  const rows = Object.entries(data.metrics).map(([name, metric]) => `<tr><td>${name}</td><td><pre>${JSON.stringify(metric.values, null, 2)}</pre></td></tr>`).join('');
  return {
    'summary.json': JSON.stringify(data, null, 2),
    'report.html': `<!doctype html><meta charset="utf-8"><title>Identity load results</title><style>body{font:16px system-ui;margin:3rem}td{padding:1rem;border-bottom:1px solid #ddd}pre{white-space:pre-wrap}</style><h1>${mode} load results</h1><table>${rows}</table>`,
  };
}
