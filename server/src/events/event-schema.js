import crypto from 'node:crypto';

/**
 * Supported Domain Event Types
 */
export const EventTypes = {
  CREDENTIAL_ISSUED: 'CredentialIssued',
  CREDENTIAL_REVOKED: 'CredentialRevoked',
  DID_CREATED: 'DIDCreated',
  DID_UPDATED: 'DIDUpdated',
  DID_DEACTIVATED: 'DIDDeactivated',
  REPUTATION_UPDATED: 'ReputationUpdated',
  TENANT_CREATED: 'TenantCreated',
  TENANT_UPDATED: 'TenantUpdated',
};

export const CURRENT_EVENT_SCHEMA_VERSION = 1;

/**
 * Create a strongly typed, versioned domain event
 */
export function createEvent({ type, aggregateId, aggregateType, payload = {}, metadata = {}, tenantId = 'default', version = CURRENT_EVENT_SCHEMA_VERSION }) {
  if (!type) throw new Error('Event type is required');
  if (!aggregateId) throw new Error('Aggregate ID is required');

  return {
    id: `evt_${crypto.randomUUID()}`,
    type,
    aggregateId: String(aggregateId),
    aggregateType: aggregateType || type.replace(/(Created|Issued|Revoked|Updated|Deactivated)/, ''),
    tenantId: tenantId || 'default',
    version,
    timestamp: new Date().toISOString(),
    payload,
    metadata: {
      traceId: metadata.traceId || null,
      actor: metadata.actor || 'system',
      ...metadata,
    },
  };
}

/**
 * Event Serializer with schema migration tooling
 */
export class EventSerializer {
  static serialize(event) {
    return JSON.stringify(event);
  }

  static deserialize(rawString) {
    const event = typeof rawString === 'string' ? JSON.parse(rawString) : rawString;
    return this.migrate(event);
  }

  /**
   * Migrate older event versions to the latest schema
   */
  static migrate(event) {
    const version = event.version || 1;
    let migrated = { ...event };

    // Migration v1 -> v2 example (if needed in future)
    if (version < 2) {
      if (!migrated.tenantId) migrated.tenantId = 'default';
      if (!migrated.metadata) migrated.metadata = {};
    }

    return migrated;
  }
}
