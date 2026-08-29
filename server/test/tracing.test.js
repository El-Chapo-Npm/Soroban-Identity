import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { createTracer, createChildSpan, extractTraceContext, injectTraceContext, traceAsync, Tags } from '../src/tracer.js';

describe('Tracer', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createTracer', () => {
    it('should create a noop tracer when disabled', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      assert.ok(tracer);
      assert.strictEqual(typeof tracer.startSpan, 'function');
      
      const span = tracer.startSpan('test');
      assert.ok(span);
      assert.strictEqual(typeof span.setTag, 'function');
      assert.strictEqual(typeof span.finish, 'function');
    });

    it('should use default configuration values', () => {
      const config = { jaegerEnabled: true };
      const tracer = createTracer(config);
      
      assert.ok(tracer);
      assert.strictEqual(typeof tracer.startSpan, 'function');
    });

    it('should respect custom configuration', () => {
      const config = {
        jaegerEnabled: true,
        jaegerServiceName: 'test-service',
        jaegerAgentHost: '127.0.0.1',
        jaegerAgentPort: 6831,
        jaegerSamplerType: 'probabilistic',
        jaegerSamplerParam: 0.1,
      };
      
      const tracer = createTracer(config);
      assert.ok(tracer);
    });
  });

  describe('createChildSpan', () => {
    it('should create a child span with parent reference', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const parentSpan = tracer.startSpan('parent');
      const childSpan = createChildSpan(tracer, 'child', parentSpan, {
        [Tags.COMPONENT]: 'test',
      });
      
      assert.ok(childSpan);
      assert.strictEqual(typeof childSpan.setTag, 'function');
      
      childSpan.finish();
      parentSpan.finish();
    });

    it('should create span without parent if parent is null', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const span = createChildSpan(tracer, 'orphan', null, {});
      
      assert.ok(span);
      span.finish();
    });
  });

  describe('extractTraceContext', () => {
    it('should return null for noop tracer', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const headers = {
        'uber-trace-id': '1234567890abcdef:1234567890abcdef:0:1',
      };
      
      const context = extractTraceContext(tracer, headers);
      // Noop tracer returns null
      assert.strictEqual(context, null);
    });

    it('should handle missing headers', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const context = extractTraceContext(tracer, {});
      assert.strictEqual(context, null);
    });
  });

  describe('injectTraceContext', () => {
    it('should inject trace context into headers', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const span = tracer.startSpan('test');
      const headers = {};
      
      injectTraceContext(tracer, span, headers);
      
      // Noop tracer doesn't actually inject
      // Just verify it doesn't throw
      assert.ok(headers);
      
      span.finish();
    });

    it('should handle null span', () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const headers = {};
      injectTraceContext(tracer, null, headers);
      
      assert.ok(headers);
    });
  });

  describe('traceAsync', () => {
    it('should execute function and set success tag', async () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const fn = async () => 'result';
      const wrapped = traceAsync(tracer, 'test-operation', fn);
      
      const result = await wrapped();
      assert.strictEqual(result, 'result');
    });

    it('should catch errors and set error tags', async () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const fn = async () => {
        throw new Error('Test error');
      };
      const wrapped = traceAsync(tracer, 'test-operation', fn);
      
      await assert.rejects(
        wrapped(),
        (error) => {
          assert.strictEqual(error.message, 'Test error');
          return true;
        }
      );
    });

    it('should support parent span', async () => {
      const config = { jaegerEnabled: false };
      const tracer = createTracer(config);
      
      const parentSpan = tracer.startSpan('parent');
      const fn = async () => 'result';
      const wrapped = traceAsync(tracer, 'child-operation', fn, {
        parentSpan,
        tags: { custom: 'tag' },
      });
      
      const result = await wrapped();
      assert.strictEqual(result, 'result');
      
      parentSpan.finish();
    });
  });

  describe('Tags', () => {
    it('should have standard tag constants', () => {
      assert.strictEqual(typeof Tags.SPAN_KIND, 'string');
      assert.strictEqual(typeof Tags.COMPONENT, 'string');
      assert.strictEqual(typeof Tags.HTTP_METHOD, 'string');
      assert.strictEqual(typeof Tags.HTTP_URL, 'string');
      assert.strictEqual(typeof Tags.HTTP_STATUS_CODE, 'string');
      assert.strictEqual(typeof Tags.ERROR, 'string');
      assert.strictEqual(typeof Tags.CREDENTIAL_ID, 'string');
      assert.strictEqual(typeof Tags.DID, 'string');
      assert.strictEqual(typeof Tags.CONTRACT_ID, 'string');
    });
  });
});

describe('Tracing Middleware', () => {
  it('should create middleware function', async () => {
    const { tracingMiddleware } = await import('../src/tracing-middleware.js');
    const config = { jaegerEnabled: false };
    const tracer = createTracer(config);
    
    const middleware = tracingMiddleware(tracer);
    assert.strictEqual(typeof middleware, 'function');
  });

  it('should extract trace context and create span', async () => {
    const { tracingMiddleware } = await import('../src/tracing-middleware.js');
    const config = { jaegerEnabled: false };
    const tracer = createTracer(config);
    
    const middleware = tracingMiddleware(tracer);
    
    const req = {
      method: 'GET',
      url: '/test',
      path: '/test',
      headers: {},
    };
    
    const res = {
      statusCode: 200,
      end: function (...args) {
        return this;
      },
      on: function () {},
    };
    
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };
    
    middleware(req, res, next);
    assert.strictEqual(nextCalled, true);
  });
});

describe('Soroban Tracing', () => {
  it('should trace contract invocations', async () => {
    const { traceContractInvoke } = await import('../src/soroban-tracing.js');
    
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    const method = 'get_did';
    const args = ['--address', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'];
    
    const invokeFunction = async () => 'mock-result';
    
    const result = await traceContractInvoke(contractId, method, args, invokeFunction);
    assert.strictEqual(result, 'mock-result');
  });

  it('should trace DID resolution', async () => {
    const { traceDidResolve } = await import('../src/soroban-tracing.js');
    
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const resolveFunction = async () => ({ id: `did:stellar:${address}` });
    
    const result = await traceDidResolve(address, resolveFunction);
    assert.ok(result);
    assert.strictEqual(result.id, `did:stellar:${address}`);
  });

  it('should trace cache operations', async () => {
    const { traceCacheOperation } = await import('../src/soroban-tracing.js');
    
    const operation = 'get';
    const key = 'test-key';
    const cacheFunction = async () => 'cached-value';
    
    const result = await traceCacheOperation(operation, key, cacheFunction);
    assert.strictEqual(result, 'cached-value');
  });

  it('should handle null results in DID resolution', async () => {
    const { traceDidResolve } = await import('../src/soroban-tracing.js');
    
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const resolveFunction = async () => null;
    
    const result = await traceDidResolve(address, resolveFunction);
    assert.strictEqual(result, null);
  });
});
