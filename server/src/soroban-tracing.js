import { getCurrentTracer, startSpan, traceOperation } from './tracing-middleware.js';
import { Tags } from './tracer.js';

/**
 * Wrap a Soroban contract invocation with distributed tracing.
 * 
 * Creates a span for the contract call with relevant tags and logs.
 * 
 * @param {string} contractId - Contract ID
 * @param {string} method - Contract method name
 * @param {Array} args - Method arguments
 * @param {Function} invokeFunction - The actual invoke function
 * @returns {Promise<string>} Result of the invocation
 */
export async function traceContractInvoke(contractId, method, args, invokeFunction) {
  const tracer = getCurrentTracer();
  
  if (!tracer) {
    // No tracing, call directly
    return invokeFunction();
  }

  return traceOperation(
    'contract.invoke',
    async (span) => {
      // Add tags for the contract call
      span.addTags({
        [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_CLIENT,
        [Tags.COMPONENT]: 'soroban-client',
        [Tags.CONTRACT_ID]: contractId,
        [Tags.RPC_SYSTEM]: 'soroban',
        [Tags.RPC_SERVICE]: 'contract',
        [Tags.RPC_METHOD]: method,
        'contract.args_count': args.length,
      });

      // Log the invocation start
      span.log({
        event: 'contract_invoke_start',
        contract_id: contractId,
        method,
        args_count: args.length,
      });

      try {
        const result = await invokeFunction();
        
        // Log successful completion
        span.log({
          event: 'contract_invoke_complete',
          result_length: result?.length || 0,
        });

        return result;
      } catch (error) {
        // Error handling is done by traceOperation
        throw error;
      }
    },
    {
      [Tags.RPC_SYSTEM]: 'soroban',
      [Tags.COMPONENT]: 'soroban-client',
    }
  );
}

/**
 * Wrap a DID resolution with distributed tracing.
 * 
 * @param {string} address - Stellar address
 * @param {Function} resolveFunction - The actual resolve function
 * @returns {Promise<object|null>} DID document or null
 */
export async function traceDidResolve(address, resolveFunction) {
  const tracer = getCurrentTracer();
  
  if (!tracer) {
    return resolveFunction();
  }

  return traceOperation(
    'did.resolve',
    async (span) => {
      span.addTags({
        [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_CLIENT,
        [Tags.COMPONENT]: 'did-resolver',
        [Tags.DID]: `did:stellar:${address}`,
        'did.address': address,
      });

      span.log({
        event: 'did_resolve_start',
        address,
      });

      try {
        const document = await resolveFunction();
        
        span.setTag('did.found', document !== null);
        
        if (document) {
          span.log({
            event: 'did_resolve_complete',
            has_document: true,
          });
        } else {
          span.log({
            event: 'did_not_found',
          });
        }

        return document;
      } catch (error) {
        throw error;
      }
    }
  );
}

/**
 * Wrap a cache operation with distributed tracing.
 * 
 * @param {string} operation - Cache operation (get, set, invalidate)
 * @param {string} key - Cache key
 * @param {Function} cacheFunction - The actual cache function
 * @returns {Promise<*>} Cache operation result
 */
export async function traceCacheOperation(operation, key, cacheFunction) {
  const tracer = getCurrentTracer();
  
  if (!tracer) {
    return cacheFunction();
  }

  return traceOperation(
    `cache.${operation}`,
    async (span) => {
      span.addTags({
        [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_CLIENT,
        [Tags.COMPONENT]: 'cache',
        [Tags.DB_TYPE]: 'redis',
        'cache.operation': operation,
        'cache.key': key,
      });

      try {
        const result = await cacheFunction();
        
        if (operation === 'get') {
          span.setTag('cache.hit', result !== null && result !== undefined);
        }
        
        span.log({
          event: `cache_${operation}_complete`,
        });

        return result;
      } catch (error) {
        throw error;
      }
    }
  );
}

/**
 * Trace an RPC retry attempt.
 * 
 * @param {number} attempt - Retry attempt number
 * @param {number} maxRetries - Maximum retries
 * @param {number} delayMs - Delay before retry
 * @param {string} reason - Reason for retry
 */
export function logRpcRetry(attempt, maxRetries, delayMs, reason) {
  const tracer = getCurrentTracer();
  
  if (!tracer) return;

  const span = startSpan('rpc.retry', {
    [Tags.COMPONENT]: 'soroban-client',
    'retry.attempt': attempt,
    'retry.max_retries': maxRetries,
    'retry.delay_ms': delayMs,
    'retry.reason': reason,
  });

  span.log({
    event: 'rpc_retry',
    attempt,
    max_retries: maxRetries,
    delay_ms: delayMs,
    reason,
  });

  span.finish();
}

/**
 * Trace a circuit breaker state change.
 * 
 * @param {string} state - New circuit breaker state (open, closed, half_open)
 * @param {string} reason - Reason for state change
 */
export function logCircuitBreakerState(state, reason) {
  const tracer = getCurrentTracer();
  
  if (!tracer) return;

  const span = startSpan('circuit_breaker.state_change', {
    [Tags.COMPONENT]: 'circuit-breaker',
    'circuit_breaker.state': state,
    'circuit_breaker.reason': reason,
  });

  span.log({
    event: 'circuit_breaker_state_change',
    state,
    reason,
  });

  span.finish();
}
