import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContextStore = new AsyncLocalStorage();

/**
 * Store the resolved DID in the current request context.
 * @param {object} store - The request context store (from AsyncLocalStorage).
 * @param {string} did - The resolved DID for the request.
 */
export function setRequestDid(store, did) {
  if (store && typeof store === 'object') {
    store.did = did;
  }
}

/**
 * Compute the latency (in milliseconds) since the request started.
 * @param {object} store - The request context store (from AsyncLocalStorage).
 * @returns {number|undefined} Latency in ms, or undefined if no start time is available.
 */
export function getRequestLatency(store) {
  if (!store || typeof store !== 'object') {
    return undefined;
  }
  const startTime = store.startTime ?? store.startTimeMs;
  if (startTime === undefined || startTime === null) {
    return undefined;
  }
  const startMs = startTime instanceof Date ? startTime.getTime() : Number(startTime);
  if (Number.isNaN(startMs)) {
    return undefined;
  }
  return Date.now() - startMs;
}