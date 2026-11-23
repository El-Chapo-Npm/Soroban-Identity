import crypto from 'node:crypto';

/**
 * Supported Domain Event Types
 */
export const EventTypes = {
  CREDENTIAL_ISSUED: 'CredentialIssued',
  CREDENTIAL_REVOKED: 'CredentialRevoked',
  CREDENTIAL_SUSPENDED: 'CredentialSuspended',
  CREDENTIAL_RENEWED: 'CredentialRenewed',
  CREDENTIAL_VERIFIED: 'CredentialVerified',
  DID_CREATED: 'DIDCreated',
  DID_UPDATED: 'DIDUpdated',
  DID_DEACTIVATED: 'DIDDeactivated',
  REPUTATION_UPDATED: 'ReputationUpdated',
  TENANT_CREATED: 'TenantCreated',
  TENANT_UPDATED: 'TenantUpdated',
};

/**
 * Credential lifecycle event types (event sourcing)
 */
export const CredentialEventTypes = {
  ISSUE: EventTypes.CREDENTIAL_ISSUED,
  REVOKE: EventTypes.CREDENTIAL_REVOKED,
  SUSPEND: EventTypes.CREDENTIAL_SUSPENDED,
  RENEW: EventTypes.CREDENTIAL_RENEWED,
  VERIFY: EventTypes.CREDENTIAL_VERIFIED,
};

export const CURRENT_EVENT_SCHEMA_VERSION = 2;

/**
 * Per-event-type payload schemas for credential lifecycle operations.
 * Used for validation and documentation of the event contract.
 */
export const CredentialEventPayloadSchemas = {
  [EventTypes.CREDENTIAL_ISSUED]: {
    required: ['credentialId', 'subject', 'issuer'],
    optional: ['type', 'claims', 'expiresAt', 'issuedAt'],
  },
  [EventTypes.CREDENTIAL_REVOKED]: {
    required: ['credentialId'],
    optional: ['reason', 'revokedAt', 'revokedBy'],
  },
  [EventTypes.CREDENTIAL_SUSPENDED]: {
    required: ['credentialId'],
    optional: ['reason', 'suspendedAt', 'suspendedBy', 'until'],
  },
  [EventTypes.CREDENTIAL_RENEWED]: {
    required: ['credentialId'],
    optional: ['previousCredentialId', 'expiresAt', 'renewedAt', 'renewedBy'],
  },
  [EventTypes.CREDENTIAL_VERIFIED]: {
    required: ['credentialId'],
    optional: ['verifiedAt', 'verifiedBy', 'result', 'method'],
  },
};

/**
 * Upcasters migrate an event from one schema version to the next.
 * Each upcaster receives the event at version N and returns it at version N+1.
 */
export const EventUpcasters = {
  // v1 -> v2: normalize credential lifecycle events and ensure metadata/tenant fields.
  1: (event) => {
    const upgraded = { ...event, version: 2 };

    if (!upgraded.tenantId) upgraded.tenantId = 'default';
    if (!upgraded.metadata) upgraded.metadata = {};
    if (!upgraded.metadata.actor) upgraded.metadata.actor = 'system';
    if (upgraded.metadata.traceId === undefined) upgraded.metadata.traceId = null;

    // Normalize legacy credential event names to the versioned set.
    const legacyAliases = {
      CredentialIssue: EventTypes.CREDENTIAL_ISSUED,
      CredentialRevoke: EventTypes.CREDENTIAL_REVOKED,
      CredentialSuspend: EventTypes.CREDENTIAL_SUSPENDED,
      CredentialRenew: EventTypes.CREDENTIAL_RENEWED,
      CredentialVerify: EventTypes.CREDENTIAL_VERIFIED,
    };
    if (legacyAliases[upgraded.type]) {
      upgraded.type = legacyAliases[upgraded.type];
    }

    // Ensure credential lifecycle payloads carry a credentialId.
    if (
      Object.values(CredentialEventTypes).includes(upgraded.type) &&
      upgraded.payload &&
      !upgraded.payload.credentialId &&
      upgraded.aggregateId
    ) {
      upgraded.payload = { ...upgraded.payload, credentialId: upgraded.aggregateId };
    }

    return upgraded;
  },
};

/**
 * Create a strongly typed, versioned domain event
 */
export function createEvent({ type, aggregateId, aggregateType, payload = {}, metadata = {}, tenantId = 'default', version = CURRENT_EVENT_SCHEMA_VERSION }) {
  if (!type) throw new Error('Event type is required');
  if (!aggregateId) throw new Error('Aggregate ID is required');

  const knownTypes = Object.values(EventTypes);
  if (!knownTypes.includes(type)) {
    throw new Error(`Unknown event type: ${type}`);
  }

  // Validate credential lifecycle payloads against their schema.
  const payloadSchema = CredentialEventPayloadSchemas[type];
  if (payloadSchema) {
    for (const field of payloadSchema.required) {
      if (payload[field] === undefined || payload[field] === null) {
        throw new Error(`Event ${type} requires payload field: ${field}`);
      }
    }
  }

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
    let version = event.version || 1;
    let migrated = { ...event };

    // Apply upcasters sequentially until the event reaches the current version.
    while (version < CURRENT_EVENT_SCHEMA_VERSION) {
      const upcaster = EventUpcasters[version];
      if (!upcaster) {
        // No upcaster registered; just bump the version to avoid an infinite loop.
        migrated = { ...migrated, version: version + 1 };
      } else {
        migrated = upcaster(migrated);
      }
      version = migrated.version || version + 1;
    }

    // Ensure baseline fields exist regardless of version.
    if (!migrated.tenantId) migrated.tenantId = 'default';
    if (!migrated.metadata) migrated.metadata = {};
    if (!migrated.version) migrated.version = CURRENT_EVENT_SCHEMA_VERSION;

    return migrated;
  }
}
