import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPluginRegistry,
  createPluginPipeline,
} from '../src/gateway/plugins.js';

describe('gateway plugin registry', () => {
  let registry;

  beforeEach(() => {
    registry = createPluginRegistry();
  });

  it('registers a plugin and reports it as enabled by default', () => {
    const plugin = { name: 'auth', before: vi.fn(), after: vi.fn() };
    registry.register(plugin);

    expect(registry.has('auth')).toBe(true);
    expect(registry.isEnabled('auth')).toBe(true);
    expect(registry.get('auth')).toBe(plugin);
  });

  it('throws when registering a plugin without a name', () => {
    expect(() => registry.register({ before: vi.fn() })).toThrow(/name/i);
  });

  it('throws when registering a duplicate plugin name', () => {
    registry.register({ name: 'auth' });
    expect(() => registry.register({ name: 'auth' })).toThrow(/already/i);
  });

  it('lists registered plugin names in registration order', () => {
    registry.register({ name: 'auth' });
    registry.register({ name: 'logging' });
    registry.register({ name: 'metrics' });

    expect(registry.list()).toEqual(['auth', 'logging', 'metrics']);
  });

  it('enables and disables a plugin', () => {
    registry.register({ name: 'auth' });

    registry.disable('auth');
    expect(registry.isEnabled('auth')).toBe(false);

    registry.enable('auth');
    expect(registry.isEnabled('auth')).toBe(true);
  });

  it('throws when enabling or disabling an unknown plugin', () => {
    expect(() => registry.enable('missing')).toThrow(/unknown/i);
    expect(() => registry.disable('missing')).toThrow(/unknown/i);
  });

  it('unregisters a plugin', () => {
    registry.register({ name: 'auth' });
    registry.unregister('auth');

    expect(registry.has('auth')).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it('throws when unregistering an unknown plugin', () => {
    expect(() => registry.unregister('missing')).toThrow(/unknown/i);
  });
});

describe('gateway plugin pipeline', () => {
  const makeContext = () => ({ request: { id: 'req-1' }, response: null });

  it('runs before hooks in registration order', async () => {
    const order = [];
    const registry = createPluginRegistry();
    registry.register({
      name: 'a',
      before: () => order.push('a'),
    });
    registry.register({
      name: 'b',
      before: () => order.push('b'),
    });

    const pipeline = createPluginPipeline(registry);
    await pipeline.runBefore(makeContext());

    expect(order).toEqual(['a', 'b']);
  });

  it('runs after hooks in reverse registration order', async () => {
    const order = [];
    const registry = createPluginRegistry();
    registry.register({
      name: 'a',
      after: () => order.push('a'),
    });
    registry.register({
      name: 'b',
      after: () => order.push('b'),
    });

    const pipeline = createPluginPipeline(registry);
    await pipeline.runAfter(makeContext());

    expect(order).toEqual(['b', 'a']);
  });

  it('passes the context through before and after hooks', async () => {
    const registry = createPluginRegistry();
    const before = vi.fn((ctx) => {
      ctx.request.stamped = true;
    });
    const after = vi.fn((ctx) => {
      ctx.response = { ok: true };
    });
    registry.register({ name: 'a', before, after });

    const pipeline = createPluginPipeline(registry);
    const ctx = makeContext();

    await pipeline.runBefore(ctx);
    await pipeline.runAfter(ctx);

    expect(before).toHaveBeenCalledWith(ctx);
    expect(after).toHaveBeenCalledWith(ctx);
    expect(ctx.request.stamped).toBe(true);
    expect(ctx.response).toEqual({ ok: true });
  });

  it('skips disabled plugins', async () => {
    const before = vi.fn();
    const after = vi.fn();
    const registry = createPluginRegistry();
    registry.register({ name: 'a', before, after });
    registry.disable('a');

    const pipeline = createPluginPipeline(registry);
    await pipeline.runBefore(makeContext());
    await pipeline.runAfter(makeContext());

    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('ignores plugins without before or after hooks', async () => {
    const registry = createPluginRegistry();
    registry.register({ name: 'noop' });

    const pipeline = createPluginPipeline(registry);

    await expect(pipeline.runBefore(makeContext())).resolves.toBeUndefined();
    await expect(pipeline.runAfter(makeContext())).resolves.toBeUndefined();
  });

  it('awaits async hooks', async () => {
    const registry = createPluginRegistry();
    const before = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    registry.register({ name: 'a', before });

    const pipeline = createPluginPipeline(registry);
    await pipeline.runBefore(makeContext());

    expect(before).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown by before hooks', async () => {
    const registry = createPluginRegistry();
    registry.register({
      name: 'a',
      before: () => {
        throw new Error('before failed');
      },
    });

    const pipeline = createPluginPipeline(registry);

    await expect(pipeline.runBefore(makeContext())).rejects.toThrow(
      'before failed',
    );
  });

  it('propagates errors thrown by after hooks', async () => {
    const registry = createPluginRegistry();
    registry.register({
      name: 'a',
      after: () => {
        throw new Error('after failed');
      },
    });

    const pipeline = createPluginPipeline(registry);

    await expect(pipeline.runAfter(makeContext())).rejects.toThrow(
      'after failed',
    );
  });

  it('stops running subsequent before hooks after an error', async () => {
    const second = vi.fn();
    const registry = createPluginRegistry();
    registry.register({
      name: 'a',
      before: () => {
        throw new Error('boom');
      },
    });
    registry.register({ name: 'b', before: second });

    const pipeline = createPluginPipeline(registry);

    await expect(pipeline.runBefore(makeContext())).rejects.toThrow('boom');
    expect(second).not.toHaveBeenCalled();
  });

  it('runs the full pipeline with before and after around a handler', async () => {
    const order = [];
    const registry = createPluginRegistry();
    registry.register({
      name: 'a',
      before: () => order.push('before-a'),
      after: () => order.push('after-a'),
    });
    registry.register({
      name: 'b',
      before: () => order.push('before-b'),
      after: () => order.push('after-b'),
    });

    const pipeline = createPluginPipeline(registry);
    const ctx = makeContext();

    await pipeline.runBefore(ctx);
    order.push('handler');
    await pipeline.runAfter(ctx);

    expect(order).toEqual([
      'before-a',
      'before-b',
      'handler',
      'after-b',
      'after-a',
    ]);
  });
});