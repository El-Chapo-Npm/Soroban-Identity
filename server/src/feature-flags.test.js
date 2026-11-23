import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createFlag,
  evaluate,
  getFlag,
  getVariant,
  initFeatureFlags,
  isEnabled,
  listFlags,
  updateFlag,
} from './feature-flags.js';

test('creates, evaluates, and lists feature flags', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soroban-ff-'));
  await initFeatureFlags(dataDir);
  const flag = await createFlag(dataDir, { key: 'beta_dashboard', type: 'boolean' });

  assert.equal(flag.enabled, false);
  assert.equal(isEnabled('beta_dashboard', {}), false);

  await updateFlag(dataDir, 'beta_dashboard', { enabled: true });
  assert.equal(isEnabled('beta_dashboard', {}), true);

  const flags = listFlags();
  assert.equal(flags.length, 1);
  assert.equal(getFlag('beta_dashboard').key, 'beta_dashboard');

  await rm(dataDir, { recursive: true, force: true });
});

test('evaluates variant flags with percentage rollout', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soroban-ff-'));
  await initFeatureFlags(dataDir);
  await createFlag(dataDir, {
    key: 'checkout_ui',
    type: 'variant',
    defaultValue: 'old',
    targetingRules: [
      { attribute: 'userId', operator: 'percentage', value: 50, variant: 'new' },
    ],
  });
  await updateFlag(dataDir, 'checkout_ui', { enabled: true });

  const seenNew = [];
  const seenOld = [];
  for (let i = 0; i < 100; i++) {
    const { variant } = evaluate('checkout_ui', { userId: `user-${i}` });
    if (variant === 'new') seenNew.push(i);
    else seenOld.push(i);
  }
  assert.ok(seenNew.length > 10, `expected ~50% new, got ${seenNew.length}`);
  assert.ok(seenOld.length > 10, `expected ~50% old, got ${seenOld.length}`);
  assert.equal(getVariant('checkout_ui', { userId: `user-${seenNew[0]}` }), 'new');

  await rm(dataDir, { recursive: true, force: true });
});

test('returns default when flag is disabled or unknown', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soroban-ff-disabled-'));

  const result = evaluate('unknown_flag', {});
  assert.equal(result.reason, 'flag_not_found');

  await initFeatureFlags(dataDir);
  await createFlag(dataDir, { key: 'off_flag', defaultValue: 'fallback' });
  const res = evaluate('off_flag', {});
  assert.equal(res.reason, 'disabled');
  assert.equal(res.value, 'fallback');

  await rm(dataDir, { recursive: true, force: true });
});
