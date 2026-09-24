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
