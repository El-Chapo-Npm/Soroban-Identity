import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export const SUBSCRIPTION_SCHEMA = `
type Subscription {
  credentialUpdated(subject: String, credentialType: String): CredentialEvent!
  didUpdated(subject: String): DidEvent!
  reputationChanged(subject: String): ReputationEvent!
}
type CredentialEvent { id: ID!, subject: String, credentialType: String, action: String!, credential: String, timestamp: String! }
type DidEvent { did: ID!, action: String!, document: String, timestamp: String! }
type ReputationEvent { subject: ID!, score: Float!, tier: String, timestamp: String! }
`;

export const SUBSCRIPTION_TOPICS = new Set(['credentialUpdated', 'didUpdated', 'reputationChanged']);

function matches(filter, event) {
  if (!filter) return true;
  if (filter.subject && filter.subject !== (event.subject ?? event.did)) return false;
  if (filter.credentialType && filter.credentialType !== event.credentialType) return false;
  return true;
}

export class SubscriptionHub extends EventEmitter {
  constructor({ authenticate = async () => true, maxEventsPerMinute = 120, heartbeatMs = 30_000, now = () => Date.now() } = {}) {
    super();
    this.authenticate = authenticate;
    this.maxEventsPerMinute = maxEventsPerMinute;
    this.heartbeatMs = heartbeatMs;
    this.now = now;
    this.subscriptions = new Map();
  }

  async subscribe({ topic, filter = {}, credentials, onEvent, onClose = () => {} }) {
    if (!SUBSCRIPTION_TOPICS.has(topic)) throw new Error(`Unsupported subscription topic: ${topic}`);
    if (!(await this.authenticate(credentials))) throw new Error('Subscription authentication failed');
    const id = randomUUID();
    const subscription = { id, topic, filter, onEvent, onClose, windowStart: this.now(), eventCount: 0 };
    this.subscriptions.set(id, subscription);
    return { id, unsubscribe: () => this.unsubscribe(id) };
  }

  unsubscribe(id) {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return false;
    this.subscriptions.delete(id);
    subscription.onClose();
    return true;
  }

  publish(topic, event) {
    if (!SUBSCRIPTION_TOPICS.has(topic)) return 0;
    let delivered = 0;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.topic !== topic || !matches(subscription.filter, event)) continue;
      const now = this.now();
      if (now - subscription.windowStart >= 60_000) {
        subscription.windowStart = now;
        subscription.eventCount = 0;
      }
      if (++subscription.eventCount > this.maxEventsPerMinute) {
        this.unsubscribe(subscription.id);
        continue;
      }
      subscription.onEvent({ ...event, __typename: topic });
      delivered += 1;
    }
    this.emit(topic, event);
    return delivered;
  }

  close() {
    for (const id of [...this.subscriptions.keys()]) this.unsubscribe(id);
    this.removeAllListeners();
  }
}

export function createSubscriptionContext({ req, apiKeyService, config, hub }) {
  return {
    hub,
    authenticate: async (credentials = {}) => {
      const token = credentials.token || req?.headers?.authorization?.replace(/^Bearer\s+/i, '') || req?.headers?.['x-api-key'];
      if (!token) return false;
      if (apiKeyService) return Boolean(await apiKeyService.validateKey(token));
      return Boolean(config?.adminApiKey && token.split(':')[0] === config.adminApiKey);
    },
  };
}

export function publishContractEvent(hub, event) {
  const type = event?.type || event?.eventType;
  if (!hub || !type) return 0;
  if (type.includes('credential')) return hub.publish('credentialUpdated', event);
  if (type.includes('did')) return hub.publish('didUpdated', event);
  if (type.includes('reputation')) return hub.publish('reputationChanged', event);
  return 0;
}
