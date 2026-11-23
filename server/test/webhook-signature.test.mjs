import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWebhookSignature, signWebhookRequest, verifyWebhookSignature } from '../src/webhooks/signature.js';

test('webhook signature generation and verification round trip', () => {
  const payload = { event: 'credential.issued', id: '123' };
  const secret = 'super-secret';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateWebhookSignature({ payload, secret, timestamp });
  const signed = signWebhookRequest({ payload, secret, timestamp, keyId: 'k-1' });

  assert.equal(signed['X-Signature'], `sha256=${signature}`);
  assert.equal(signed['X-Signature-Timestamp'], String(timestamp));
  assert.equal(signed['X-Signature-Key-Id'], 'k-1');
  assert.equal(verifyWebhookSignature({ payload, secret, signature: signed['X-Signature'], timestamp: signed['X-Signature-Timestamp'] }), true);
});
