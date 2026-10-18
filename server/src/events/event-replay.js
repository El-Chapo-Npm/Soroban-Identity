import { EventTypes } from './event-schema.js';

/**
 * Replays domain events to reconstruct state of an aggregate (e.g. Credential or DID)
 */
export class EventReplayer {
  constructor(eventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Replay events for a Credential aggregate
   */
  async reconstructCredential(credentialId) {
    const snapshot = await this.eventStore.getSnapshot(credentialId);
    let state = snapshot ? { ...snapshot.state } : null;
    const fromTimestamp = snapshot ? snapshot.updatedAt : null;

    const events = await this.eventStore.getEvents({
      aggregateId: credentialId,
      fromTimestamp,
    });

    for (const evt of events) {
      state = this.applyCredentialEvent(state, evt);
    }

    return state;
  }

  /**
   * Replay events for a DID aggregate
   */
  async reconstructDid(did) {
    const snapshot = await this.eventStore.getSnapshot(did);
    let state = snapshot ? { ...snapshot.state } : null;
    const fromTimestamp = snapshot ? snapshot.updatedAt : null;

    const events = await this.eventStore.getEvents({
      aggregateId: did,
      fromTimestamp,
    });

    for (const evt of events) {
      state = this.applyDidEvent(state, evt);
    }

    return state;
  }

  applyCredentialEvent(state, event) {
    switch (event.type) {
      case EventTypes.CREDENTIAL_ISSUED:
        return {
          id: event.aggregateId,
          tenant_id: event.tenantId,
          ...event.payload,
          revoked: false,
          suspended: false,
          verified: false,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        };

      case EventTypes.CREDENTIAL_REVOKED:
        if (!state) return null;
        return {
          ...state,
          revoked: true,
          revokedAt: event.timestamp,
          revocationReason: event.payload?.reason || 'unspecified',
          updatedAt: event.timestamp,
        };

      case EventTypes.CREDENTIAL_SUSPENDED:
        if (!state) return null;
        return {
          ...state,
          suspended: true,
          suspendedAt: event.timestamp,
          suspensionReason: event.payload?.reason || 'unspecified',
          updatedAt: event.timestamp,
        };

      case EventTypes.CREDENTIAL_RESUMED:
        if (!state) return null;
        return {
          ...state,
          suspended: false,
          resumedAt: event.timestamp,
          updatedAt: event.timestamp,
        };

      case EventTypes.CREDENTIAL_RENEWED:
        if (!state) return null;
        return {
          ...state,
          ...event.payload,
          renewedAt: event.timestamp,
          expiresAt: event.payload?.expiresAt || state.expiresAt,
          updatedAt: event.timestamp,
        };

      case EventTypes.CREDENTIAL_VERIFIED:
        if (!state) return null;
        return {
          ...state,
          verified: true,
          verifiedAt: event.timestamp,
          lastVerification: event.payload || {},
          updatedAt: event.timestamp,
        };

      default:
        return state;
    }
  }

  applyDidEvent(state, event) {
    switch (event.type) {
      case EventTypes.DID_CREATED:
        return {
          id: event.aggregateId,
          controller: event.payload.controller,
          metadata: event.payload.metadata || {},
          active: true,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        };

      case EventTypes.DID_UPDATED:
        if (!state) return null;
        return {
          ...state,
          metadata: { ...state.metadata, ...event.payload.metadata },
          updatedAt: event.timestamp,
        };

      case EventTypes.DID_DEACTIVATED:
        if (!state) return null;
        return {
          ...state,
          active: false,
          deactivatedAt: event.timestamp,
          updatedAt: event.timestamp,
        };

      default:
        return state;
    }
  }
}

/**
 * Read model / projection that maintains the current state of all credentials.
 * Updated incrementally via event handlers.
 */
export class CurrentCredentialsProjection {
  constructor() {
    this.credentials = new Map();
  }

  /**
   * Apply a single event to the projection.
   */
  apply(event) {
    const replayer = new EventReplayer(null);
    const existing = this.credentials.get(event.aggregateId) || null;
    const next = replayer.applyCredentialEvent(existing, event);
    if (next) {
      this.credentials.set(event.aggregateId, next);
    }
    return next;
  }

  get(credentialId) {
    return this.credentials.get(credentialId) || null;
  }

  list() {
    return Array.from(this.credentials.values());
  }

  clear() {
    this.credentials.clear();
  }
}

/**
 * Read model / projection that maintains an append-only audit log of
 * credential lifecycle events.
 */
export class CredentialAuditLogProjection {
  constructor() {
    this.entries = [];
  }

  apply(event) {
    this.entries.push({
      id: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
      tenantId: event.tenantId,
      payload: event.payload,
      timestamp: event.timestamp,
      version: event.version,
    });
    return this.entries[this.entries.length - 1];
  }

  list({ aggregateId } = {}) {
    if (!aggregateId) return [...this.entries];
    return this.entries.filter((e) => e.aggregateId === aggregateId);
  }

  clear() {
    this.entries = [];
  }
}

/**
 * Coordinates projections and event stream subscriptions. Rebuilds read
 * models from the event store and keeps them updated as new events arrive.
 */
export class ProjectionManager {
  constructor(eventStore) {
    this.eventStore = eventStore;
    this.replayer = new EventReplayer(eventStore);
    this.projections = new Map();
    this.subscriptions = new Map();
  }

  register(name, projection) {
    this.projections.set(name, projection);
    return projection;
  }

  getProjection(name) {
    return this.projections.get(name) || null;
  }

  /**
   * Rebuild all registered projections from the full event stream.
   */
  async rebuild({ aggregateId } = {}) {
    for (const projection of this.projections.values()) {
      if (typeof projection.clear === 'function') {
        projection.clear();
      }
    }

    const events = await this.eventStore.getEvents({ aggregateId });
    for (const event of events) {
      this.dispatch(event);
    }
    return this;
  }

  /**
   * Dispatch an event to all registered projections.
   */
  dispatch(event) {
    for (const projection of this.projections.values()) {
      if (typeof projection.apply === 'function') {
        projection.apply(event);
      }
    }
    return event;
  }

  /**
   * Subscribe a handler to the event stream. Returns an unsubscribe function.
   */
  subscribe(name, handler) {
    this.subscriptions.set(name, handler);
    return () => {
      this.subscriptions.delete(name);
    };
  }

  /**
   * Notify subscribers of an event and update projections.
   */
  async publish(event) {
    this.dispatch(event);
    for (const handler of this.subscriptions.values()) {
      await handler(event);
    }
    return event;
  }
}
