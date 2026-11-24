/**
 * WebSocket server for real-time updates (#652).
 *
 * Clients connect to `/ws`, authenticate during the HTTP upgrade, and
 * subscribe to DID-specific rooms. Credential status changes and DID updates
 * are broadcast to the rooms that asked for them.
 *
 * The server runs in `noServer` mode so authentication happens *before* the
 * handshake completes: an unauthenticated client is answered with a plain
 * HTTP 401 and never becomes a WebSocket at all.
 */

import { WebSocketServer } from 'ws';
import { URL } from 'node:url';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { logger } from './logger.js';
import { normalizeContractEvent } from './sse.js';
import {
  CLOSE_HANDSHAKE_TIMEOUT,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  HandshakeState,
  authenticateConnection,
} from './websocket/auth.js';

/** How often to ping each client to detect a half-open connection. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Default token-bucket size for inbound messages, per connection. */
export const DEFAULT_MESSAGE_LIMIT = 60;

/** Default token-bucket window for inbound messages, per connection. */
export const DEFAULT_MESSAGE_WINDOW_MS = 60_000;

/** Largest inbound message accepted, in bytes. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** Most rooms a single connection may join. */
export const MAX_SUBSCRIPTIONS_PER_CLIENT = 50;

/** Close code sent when a client exceeds its message rate limit. */
export const CLOSE_RATE_LIMITED = 4029;

/** Close code sent when a client's credentials stop being valid. */
export const CLOSE_UNAUTHORIZED = 4001;

/** Maximum recently observed attestation IDs retained for subject routing. */
const MAX_ATTESTATION_SUBJECTS = 10_000;

/**
 * Room name for a DID subscription.
 *
 * A subject may be given as a bare Stellar account or as a did:stellar DID;
 * both name the same room so a client is not required to know which form the
 * credential was stored with.
 *
 * @param {string} subject
 * @returns {string}
 */
export function didRoom(subject) {
  const value = String(subject ?? '').trim();
  const stripped = value.startsWith('did:stellar:') ? value.slice('did:stellar:'.length) : value;
  return `did:${stripped}`;
}

/** Room every connection may join to receive all events. */
export const GLOBAL_ROOM = 'all';

/** Room clients join to receive analytics summary updates. */
export const ANALYTICS_ROOM = 'analytics';

/**
 * Per-connection token bucket for inbound messages.
 *
 * A client that exhausts its bucket is closed rather than throttled, because
 * silently dropping subscription messages would leave it believing it is
 * subscribed when it is not.
 */
export class MessageRateLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.limit]    - Messages allowed per window
   * @param {number} [options.windowMs] - Window length in milliseconds
   * @param {() => number} [options.now] - Injectable clock for tests
   */
  constructor({ limit = DEFAULT_MESSAGE_LIMIT, windowMs = DEFAULT_MESSAGE_WINDOW_MS, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.count = 0;
    this.resetAt = now() + windowMs;
  }

  /**
   * Consume one message allowance.
   * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
   */
  consume() {
    const now = this.now();
    if (now >= this.resetAt) {
      this.count = 0;
      this.resetAt = now + this.windowMs;
    }
    this.count += 1;
    const allowed = this.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - this.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((this.resetAt - now) / 1000)),
    };
  }
}

/**
 * Tracks which connections are listening to which rooms.
 *
 * Two indexes are kept — room to sockets, and socket to rooms — so both a
 * broadcast and a disconnect are O(subscriptions) rather than O(clients).
 */
export class SubscriptionRegistry {
  constructor() {
    /** @type {Map<string, Set<object>>} */
    this.rooms = new Map();
    /** @type {Map<object, Set<string>>} */
    this.sockets = new Map();
  }

  /**
   * @param {object} socket
   * @param {string} room
   * @returns {boolean} False when the socket is already at its subscription cap.
   */
  subscribe(socket, room) {
    const owned = this.sockets.get(socket) ?? new Set();
    if (!owned.has(room) && owned.size >= MAX_SUBSCRIPTIONS_PER_CLIENT) return false;

    owned.add(room);
    this.sockets.set(socket, owned);

    const members = this.rooms.get(room) ?? new Set();
    members.add(socket);
    this.rooms.set(room, members);
    return true;
  }

  /**
   * @param {object} socket
   * @param {string} room
   * @returns {boolean} True when the socket had been subscribed.
   */
  unsubscribe(socket, room) {
    const owned = this.sockets.get(socket);
    if (!owned?.delete(room)) return false;
    if (owned.size === 0) this.sockets.delete(socket);

    const members = this.rooms.get(room);
    if (members) {
      members.delete(socket);
      if (members.size === 0) this.rooms.delete(room);
    }
    return true;
  }

  /** Drop every subscription held by a socket. */
  remove(socket) {
    const owned = this.sockets.get(socket);
    if (!owned) return;
    for (const room of owned) {
      const members = this.rooms.get(room);
      if (members) {
        members.delete(socket);
        if (members.size === 0) this.rooms.delete(room);
      }
    }
    this.sockets.delete(socket);
  }

  /** @returns {string[]} Rooms this socket is subscribed to. */
  roomsFor(socket) {
    return [...(this.sockets.get(socket) ?? [])];
  }

  /** @returns {Set<object>} Sockets subscribed to a room. */
  membersOf(room) {
    return this.rooms.get(room) ?? new Set();
  }

  /** @returns {number} Number of distinct rooms with at least one member. */
  get roomCount() {
    return this.rooms.size;
  }
}

/**
 * Authenticate an upgrade request.
 *
 * The API key may arrive as `?token=` (browsers cannot set headers on a
 * WebSocket handshake), as `x-api-key`, or as an `Authorization: Bearer`
 * header. Scoped keys are validated through ApiKeyService when one is
 * configured; otherwise the admin key is accepted.
 *
 * @returns {Promise<{ok: true, auth: object}|{ok: false, reason: string}>}
 */
export async function authenticateUpgrade(req, url, { config, apiKeyService }) {
  const header = req.headers['x-api-key'] || req.headers.authorization;
  const headerToken = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : '';
  const token = headerToken || url.searchParams.get('token') || '';

  if (!token) return { ok: false, reason: 'missing_api_key' };

  if (apiKeyService) {
    const record = await apiKeyService.validateKey(token);
    if (record) {
      const scopes = record.scopes ?? ['*'];
      if (!scopes.includes('*') && !scopes.includes('credentials:read')) {
        return { ok: false, reason: 'insufficient_scope' };
      }
      return {
        ok: true,
        auth: { keyId: record.id, tier: record.tier ?? 'free', scopes },
      };
    }
  }

  // Fall back to the single admin key. Its value may carry scope/tier
  // suffixes in the same "key:tier:scopes" form the HTTP layer accepts.
  const keyPart = token.split(':')[0];
  if (config.adminApiKey && keyPart === config.adminApiKey) {
    return { ok: true, auth: { keyId: 'admin', tier: 'enterprise', scopes: ['*'] } };
  }

  return { ok: false, reason: 'invalid_api_key' };
}

/**
 * Decide which rooms an event should be delivered to.
 *
 * @param {object} event - `{type, credential?, did?, subject?}`
 * @returns {string[]}
 */
export function roomsForEvent(event) {
  const rooms = new Set([GLOBAL_ROOM]);
  const subject =
    event?.subject ??
    event?.did ??
    event?.credential?.subject ??
    event?.credential?.did;
  if (subject) rooms.add(didRoom(subject));
  return [...rooms];
}

/**
 * Real-time hub: owns the ws server, the room registry and the event poller.
 */
export class WebSocketHub {
  /**
   * @param {object} deps
   * @param {object} deps.config
   * @param {object} [deps.soroban]        - Event source; polling is skipped without one
   * @param {object} [deps.apiKeyService]
   * @param {object} [deps.rateLimit]      - `{limit, windowMs}` overrides
   * @param {number} [deps.heartbeatIntervalMs]
   */
  constructor({ config, soroban, apiKeyService, rateLimit = {}, heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS }) {
    this.config = config;
    this.soroban = soroban;
    this.apiKeyService = apiKeyService;
    this.rateLimit = {
      limit: rateLimit.limit ?? config?.wsMessageLimit ?? DEFAULT_MESSAGE_LIMIT,
      windowMs: rateLimit.windowMs ?? config?.wsMessageWindowMs ?? DEFAULT_MESSAGE_WINDOW_MS,
    };
    this.heartbeatIntervalMs = heartbeatIntervalMs;

    this.registry = new SubscriptionRegistry();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

    this._heartbeatTimer = null;
    this._pollTimer = null;
    this._polling = false;
    this._nextLedger = 0;
    this._closed = false;
    this._analyticsUnsubscribe = null;
    this._attestationSubjects = new Map();
  }

  /**
   * Subscribe to an analytics store so summary changes are pushed to clients.
   *
   * The store may expose either `onChange(listener)` (returning an unsubscribe
   * function) or an EventEmitter-style `on('change', listener)`.
   *
   * @param {object} store
   * @returns {this}
   */
  attachAnalytics(store) {
    if (!store) return this;
    const listener = (summary) => {
      try {
        this.emitAnalyticsSummary(summary);
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to broadcast analytics summary');
      }
    };

    if (typeof store.onChange === 'function') {
      const off = store.onChange(listener);
      this._analyticsUnsubscribe = typeof off === 'function' ? off : null;
    } else if (typeof store.on === 'function') {
      store.on('change', listener);
      this._analyticsUnsubscribe = () => store.off?.('change', listener);
    }
    return this;
  }

  /** Number of live connections. */
  get clientCount() {
    return this.wss.clients.size;
  }

  /**
   * Attach to an http.Server's `upgrade` event and start the timers.
   * @param {import('node:http').Server} server
   */
  attach(server) {
    this._onUpgrade = (req, socket, head) => {
      this._handleUpgrade(req, socket, head).catch((error) => {
        logger.error({ error: error.message }, 'WebSocket upgrade failed');
        this._rejectUpgrade(socket, 500, 'internal_error');
      });
    };
    server.on('upgrade', this._onUpgrade);
    this._server = server;

    this._startHeartbeat();
    this._startPolling();
    return this;
  }

  async _handleUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== (this.config?.wsPath ?? '/ws')) {
      // Another upgrade handler may own this path; leave the socket alone
      // rather than destroying a connection that is not ours.
      return;
    }

    const result = await authenticateUpgrade(req, url, {
      config: this.config,
      apiKeyService: this.apiKeyService,
    });

    if (!result.ok) {
      const status = result.reason === 'insufficient_scope' ? 403 : 401;
      return this._rejectUpgrade(socket, status, result.reason);
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this._onConnection(ws, result.auth, url);
    });
  }

  _rejectUpgrade(socket, statusCode, reason) {
    const statusText = { 401: 'Unauthorized', 403: 'Forbidden', 500: 'Internal Server Error' }[statusCode] ?? 'Bad Request';
    const body = JSON.stringify({ error: reason });
    socket.write(
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        'Content-Type: application/json\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        'Connection: close\r\n\r\n' +
        body,
    );
    socket.destroy();
  }

  _onConnection(ws, auth, url) {
    ws.auth = auth;
    ws.isAlive = true;
    ws.rateLimiter = new MessageRateLimiter(this.rateLimit);

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => this.registry.remove(ws));
    ws.on('error', (error) => {
      logger.warn({ error: error.message, keyId: auth.keyId }, 'WebSocket connection error');
      this.registry.remove(ws);
    });
    ws.on('message', (raw) => this._onMessage(ws, raw));

    // A `did` query parameter subscribes on connect, so a reconnecting client
    // can restore its subscription in the handshake rather than waiting for a
    // round trip.
    for (const value of url.searchParams.getAll('did')) {
      if (value) this.registry.subscribe(ws, didRoom(value));
    }

    this._send(ws, {
      type: 'connected',
      subscriptions: this.registry.roomsFor(ws),
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      rateLimit: this.rateLimit,
      ts: new Date().toISOString(),
    });
  }

  _onMessage(ws, raw) {
    const verdict = ws.rateLimiter.consume();
    if (!verdict.allowed) {
      this._send(ws, {
        type: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Message rate limit exceeded (${this.rateLimit.limit} per ${this.rateLimit.windowMs}ms).`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
      return ws.close(CLOSE_RATE_LIMITED, 'rate_limit_exceeded');
    }

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return this._send(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Message must be JSON.',
      });
    }

    switch (message?.type) {
      case 'ping':
        return this._send(ws, { type: 'pong', ts: new Date().toISOString() });

      case 'subscribe': {
        const rooms = this._roomsFromMessage(message);
        if (rooms.length === 0) {
          return this._send(ws, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'subscribe requires a did, a dids array, or all: true.',
          });
        }
        const accepted = [];
        for (const room of rooms) {
          if (this.registry.subscribe(ws, room)) accepted.push(room);
        }
        if (accepted.length < rooms.length) {
          this._send(ws, {
            type: 'error',
            code: 'SUBSCRIPTION_LIMIT',
            message: `A connection may hold at most ${MAX_SUBSCRIPTIONS_PER_CLIENT} subscriptions.`,
          });
        }
        return this._send(ws, {
          type: 'subscribed',
          rooms: accepted,
          subscriptions: this.registry.roomsFor(ws),
        });
      }

      case 'unsubscribe': {
        const rooms = this._roomsFromMessage(message);
        const removed = rooms.filter((room) => this.registry.unsubscribe(ws, room));
        return this._send(ws, {
          type: 'unsubscribed',
          rooms: removed,
          subscriptions: this.registry.roomsFor(ws),
        });
      }

      default:
        return this._send(ws, {
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unsupported message type: ${String(message?.type)}`,
        });
    }
  }

  /**
   * Resolve the rooms named by a subscribe/unsubscribe message.
   * @returns {string[]}
   */
  _roomsFromMessage(message) {
    const rooms = new Set();
    if (message.all === true) rooms.add(GLOBAL_ROOM);
    if (message.analytics === true) rooms.add(ANALYTICS_ROOM);
    if (typeof message.did === 'string' && message.did.trim()) rooms.add(didRoom(message.did));
    if (Array.isArray(message.dids)) {
      for (const value of message.dids) {
        if (typeof value === 'string' && value.trim()) rooms.add(didRoom(value));
      }
    }
    return [...rooms];
  }

  _send(ws, payload) {
    if (ws.readyState !== ws.OPEN) return false;
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (error) {
      logger.error({ error: error.message, type: payload?.type }, 'Failed to serialize WebSocket payload');
      return false;
    }
    ws.send(serialized);
    return true;
  }

  /**
   * Deliver an event to every connection subscribed to one of its rooms.
   *
   * A socket subscribed to both the global room and a DID room receives the
   * event once, not twice.
   *
   * @param {object} event
   * @returns {number} Number of connections the event reached.
   */
  broadcast(event) {
    const rooms = roomsForEvent(event);
    const recipients = new Set();
    for (const room of rooms) {
      for (const socket of this.registry.membersOf(room)) recipients.add(socket);
    }

    const payload = { ...event, ts: event.ts ?? new Date().toISOString() };
    let delivered = 0;
    for (const socket of recipients) {
      if (this._send(socket, payload)) delivered += 1;
    }
    return delivered;
  }

  /** Announce a credential status change. */
  emitCredentialEvent(status, credential) {
    return this.broadcast({
      type: 'credential.status',
      status,
      credential,
      subject: credential?.subject ?? credential?.did,
    });
  }

  /** Announce a DID update. */
  emitDidEvent(action, did, details = {}) {
    return this.broadcast({ type: 'did.updated', action, did, ...details });
  }

  /** Announce an attestation issue or revocation. */
  emitAttestationEvent(action, attestation = {}, details = {}) {
    const normalizedAction = normalizeAttestationAction(action);
    const payload = attestation && typeof attestation === 'object' ? attestation : { id: attestation };
    const subject = payload.subject ?? payload.did ?? details.subject ?? details.did;
    if (payload.id && subject) this._rememberAttestationSubject(payload.id, subject);
    return this.broadcast({
      type: `attestation.${normalizedAction}`,
      eventVersion: 1,
      action: normalizedAction,
      attestation: payload,
      payload,
      subject,
      ...details,
    });
  }

  _rememberAttestationSubject(id, subject) {
    const key = stableEventKey(id);
    const value = scalarString(subject);
    if (!key || !value) return;
    // Refresh insertion order and keep this best-effort cache bounded.
    this._attestationSubjects.delete(key);
    this._attestationSubjects.set(key, value);
    while (this._attestationSubjects.size > MAX_ATTESTATION_SUBJECTS) {
      this._attestationSubjects.delete(this._attestationSubjects.keys().next().value);
    }
  }

  /**
   * Push an analytics summary to clients subscribed to the analytics room.
   *
   * The summary is delivered only to `ANALYTICS_ROOM` members (not the global
   * room) so clients that only care about credential events are not woken for
   * every dashboard refresh.
   *
   * @param {object} summary - Analytics summary payload from the analytics store
   * @returns {number} Number of connections the update reached.
   */
  emitAnalyticsSummary(summary) {
    const payload = {
      type: 'analytics.summary',
      summary,
      ts: new Date().toISOString(),
    };
    let delivered = 0;
    for (const socket of this.registry.membersOf(ANALYTICS_ROOM)) {
      if (this._send(socket, payload)) delivered += 1;
    }
    return delivered;
  }

  _startHeartbeat() {
    if (this.heartbeatIntervalMs <= 0) return;
    this._heartbeatTimer = setInterval(() => {
      for (const ws of this.wss.clients) {
        // A client that missed the previous ping is presumed gone. Terminating
        // rather than closing avoids waiting on a peer that will never answer.
        if (ws.isAlive === false) {
          this.registry.remove(ws);
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, this.heartbeatIntervalMs);
    this._heartbeatTimer.unref?.();
  }

  _startPolling() {
    if (!this.soroban?.getEvents) return;
    const intervalMs = this.config?.eventPollIntervalMs > 0 ? this.config.eventPollIntervalMs : 5000;
    this._pollTimer = setInterval(() => this.pollOnce(), intervalMs);
    this._pollTimer.unref?.();
  }

  /**
   * Poll the chain once and broadcast anything new.
   *
   * Overlapping polls are skipped, and a failure is logged rather than thrown,
   * so one bad response cannot stop the loop for every subscriber.
   *
   * @returns {Promise<number>} Events broadcast.
   */
  async pollOnce() {
    if (this._polling || this._closed) return 0;
    this._polling = true;
    let broadcastCount = 0;
    try {
      const rawEvents = await this.soroban.getEvents(this._nextLedger);
      for (const raw of rawEvents ?? []) {
        const event = normalizeContractEvent(raw);
        if (!event) continue;
        if (event.ledger >= this._nextLedger) this._nextLedger = event.ledger + 1;
        const subject = subjectFromEvent(event, this._attestationSubjects);
        const typedEvent = typedEventFromContractEvent(event, subject);
        // Retain the generic envelope for existing clients. Typed messages are
        // additional, separately named views over the same normalized event.
        this.broadcast({ type: 'contract.event', event, subject });
        if (typedEvent) this.broadcast({ ...typedEvent, eventId: event.id, ledger: event.ledger, txHash: event.txHash });
        broadcastCount += 1;
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to poll contract events for WebSocket clients');
    } finally {
      this._polling = false;
    }
    return broadcastCount;
  }

  /** Stop the timers, close every connection and detach from the server. */
  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._analyticsUnsubscribe) {
      try {
        this._analyticsUnsubscribe();
      } catch (error) {
        logger.warn({ error: error.message }, 'Failed to detach analytics listener');
      }
      this._analyticsUnsubscribe = null;
    }
    if (this._server && this._onUpgrade) this._server.off('upgrade', this._onUpgrade);
    for (const ws of this.wss.clients) ws.close(1001, 'server_shutdown');
    await new Promise((resolve) => this.wss.close(resolve));
  }
}

/**
 * Best-effort subject extraction from a normalized contract event, so an
 * on-chain event still reaches the DID room it concerns.
 *
 * @param {object} event
 * @returns {string|undefined}
 */
function subjectFromEvent(event, attestationSubjects = new Map()) {
  const value = decodeSorobanValue(event?.value);
  const topic = decodeEventTopic(event?.topic);
  const action = contractEventAction(event);
  if (topic[0] === 'CRED' && action === 'revoked') {
    const id = Array.isArray(value)
      ? (isVersionedTuple(value) ? value[1] : value[0])
      : value?.id ?? value?.credentialId ?? value;
    const key = stableEventKey(id);
    // Legacy revoke tuples carry the issuer, not the subject. Never route that
    // issuer as the DID subject when no matching issue event was observed.
    return key ? attestationSubjects.get(key) : undefined;
  }
  const tupleSubject = Array.isArray(value)
    ? (topic[0] === 'IDENTITY'
      ? (['did_crtd', 'did_upd'].includes(topic[1])
        ? (isVersionedTuple(value) ? value[2] : value[1])
        : (isVersionedTuple(value) ? value[1] : value[0]))
      : ((['ATTEST', 'ATISSUE', 'ATREVOKE'].includes(topic[0]) || (topic[0] === 'CRED' && topic[1] === 'issued')) && isVersionedTuple(value)
        ? value[2]
        : value[1]))
    : undefined;
  const candidates = [
    value?.subject, value?.did, value?.controller, value?.address,
    tupleSubject,
    ...topic.slice(1),
  ];
  for (const candidate of candidates) {
    const subject = stellarSubject(candidate);
    if (subject) {
      const action = contractEventAction(event);
      const id = Array.isArray(value)
        ? (isVersionedTuple(value) ? value[1] : value[0])
        : value?.id ?? value?.attestationId;
      if (action === 'issued' && id) rememberSubject(attestationSubjects, id, subject);
      return subject;
    }
  }

  // ATREVOKE currently carries only the attestation ID. If this hub observed
  // its issue event earlier, use that association to route the revocation.
  if (contractEventAction(event) === 'revoked') {
    const id = Array.isArray(value)
      ? (isVersionedTuple(value) ? value[1] : value[0])
      : value?.id ?? value?.attestationId ?? value;
    const key = stableEventKey(id);
    if (key && attestationSubjects.has(key)) return attestationSubjects.get(key);
  }
  return undefined;
}

function typedEventFromContractEvent(event, subject) {
  const [contract, topicAction] = decodeEventTopic(event?.topic);
  const action = contractEventAction(event);
  const value = decodeSorobanValue(event?.value);
  if (contract === 'IDENTITY' && ['created', 'updated', 'deactivated'].includes(action)) {
    const payload = identityPayload(action, value, topicAction);
    return {
      type: `identity.${action}`,
      eventVersion: 1,
      action,
      did: subject,
      subject,
      payload,
    };
  }
  if (['ATTEST', 'ATISSUE', 'ATREVOKE'].includes(contract) || ['ATISSUE', 'ATREVOKE'].includes(topicAction)) {
    if (!['issued', 'revoked'].includes(action)) return null;
    return {
      type: `attestation.${action}`,
      eventVersion: 1,
      action,
      subject,
      payload: attestationPayload(action, value, subject),
    };
  }
  return null;
}

function contractEventAction(event) {
  const topic = decodeEventTopic(event?.topic);
  const contract = topic[0];
  const action = topic[1];
  if (contract === 'IDENTITY') {
    if (action === 'deact' || action === 'deactivated') return 'deactivated';
    if (action === 'did_crtd') return 'created';
    if (action === 'did_upd') return 'updated';
    return ['created', 'updated'].includes(action) ? action : undefined;
  }
  if (['ATISSUE', 'issued'].includes(action) || contract === 'ATISSUE') return 'issued';
  if (['ATREVOKE', 'revoked'].includes(action) || contract === 'ATREVOKE') return 'revoked';
  if (contract === 'CRED' && ['issued', 'revoked'].includes(action)) return action;
  return undefined;
}

function identityPayload(action, value, topicAction) {
  if (Array.isArray(value)) {
    if (['did_crtd', 'did_upd'].includes(topicAction)) {
      const offset = isVersionedTuple(value) ? 1 : 0;
      return {
        controller: value[offset],
        did: value[offset + 1],
        metadataHash: value[offset + 2],
        timestamp: value[offset + 3],
      };
    }
    const offset = isVersionedTuple(value) ? 1 : 0;
    return {
      controller: value[offset],
      ...(action !== 'updated' ? { timestamp: value[offset + 1] } : { metadataHash: value[offset + 1] }),
    };
  }
  if (value && typeof value === 'object') return value;
  return { controller: scalarString(value) };
}

function attestationPayload(action, value, subject) {
  if (Array.isArray(value)) {
    if (isVersionedTuple(value)) {
      const [, id, tupleSubject, issuer, claims, expiresAt] = value;
      if (action === 'issued') {
        return {
            id,
            ...(stellarSubject(tupleSubject) ? { subject: stellarSubject(tupleSubject) } : {}),
            issuer,
            claims,
            expiresAt,
            issuedAtLedger: value[6],
            revoked: value[7],
        };
      }
      return {
        id,
        ...(stellarSubject(tupleSubject) ? { subject: stellarSubject(tupleSubject) } : subject ? { subject } : {}),
        issuer,
        claims,
        expiresAt,
        revoked: value[6],
        revokedAtLedger: value[7],
        revokedBy: value[8],
      };
    }
    if (action === 'issued') {
      const [id, tupleSubject, claim, issuer, expiresAt] = value;
      return {
        id,
        ...(stellarSubject(tupleSubject) ? { subject: stellarSubject(tupleSubject) } : {}),
        ...(claim !== undefined ? { claim } : {}),
        ...(issuer !== undefined ? { issuer } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };
    }
    return { id: value[0], ...(subject ? { subject } : {}) };
  }
  if (value && typeof value === 'object') return { ...value, ...(subject && !value.subject && !value.did ? { subject } : {}) };
  return { id: value, ...(subject ? { subject } : {}) };
}

function isVersionedTuple(value) {
  return Array.isArray(value) && value[0] === 1;
}

function decodeSorobanValue(value) {
  if (Array.isArray(value)) return value.map(decodeSorobanValue);
  if (value && typeof value === 'object') {
    // Common decoded-XDR wrappers, in addition to the plain decoded form used
    // by normalizeContractEvent. Unknown object fields are retained intact.
    if (Array.isArray(value.vec)) return value.vec.map(decodeSorobanValue);
    if (Array.isArray(value.tuple)) return value.tuple.map(decodeSorobanValue);
    if (Object.keys(value).length === 1 && Object.hasOwn(value, 'value')) return decodeSorobanValue(value.value);
    if (Object.hasOwn(value, 'address')) return decodeSorobanValue(value.address);
    if (Object.hasOwn(value, 'str')) return decodeSorobanValue(value.str);
    if (Object.hasOwn(value, 'symbol')) return decodeSorobanValue(value.symbol);
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = decodeSorobanValue(entry);
    return result;
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return decodeSorobanValue(JSON.parse(value)); } catch { /* not JSON; keep the XDR string */ }
  }
  if (typeof value === 'string') {
    const decoded = decodeSorobanScVal(value);
    if (decoded !== undefined) return normalizeSorobanNative(decoded);
  }
  return value;
}

function decodeEventTopic(topic) {
  return (Array.isArray(topic) ? topic : []).map((value) => {
    const decoded = typeof value === 'string' ? decodeSorobanScVal(value) : undefined;
    return scalarString(decoded === undefined ? value : normalizeSorobanNative(decoded));
  });
}

function decodeSorobanScVal(encoded) {
  try {
    return scValToNative(xdr.ScVal.fromXDR(encoded, 'base64'));
  } catch {
    return undefined;
  }
}

function normalizeSorobanNative(value) {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(normalizeSorobanNative);
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), normalizeSorobanNative(entry)]),
    );
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = normalizeSorobanNative(entry);
    return result;
  }
  return value;
}

function normalizeAttestationAction(action) {
  const value = String(action ?? '').toLowerCase();
  return ['revoke', 'revoked', 'revoke_attestation'].includes(value) ? 'revoked' : 'issued';
}

function rememberSubject(subjects, id, subject) {
  const key = stableEventKey(id);
  if (!key) return;
  subjects.delete(key);
  subjects.set(key, subject);
  while (subjects.size > MAX_ATTESTATION_SUBJECTS) subjects.delete(subjects.keys().next().value);
}

function stableEventKey(value) {
  const scalar = scalarString(value);
  if (scalar !== undefined) return scalar;
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return undefined; }
  }
  return undefined;
}

function scalarString(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

function stellarSubject(value) {
  const text = scalarString(value);
  if (text && /^(did:stellar:)?G[A-Z2-7]{55}$/.test(text)) return text;
  if (value && typeof value === 'object') {
    for (const candidate of [value.address, value.value, value.did, value.subject]) {
      const subject = stellarSubject(candidate);
      if (subject) return subject;
    }
  }
  return undefined;
}

/**
 * Create a hub and attach it to an http server.
 *
 * @param {object} deps
 * @param {import('node:http').Server} deps.server
 * @returns {WebSocketHub}
 */
export function createWebSocketServer({ server, analytics, ...deps }) {
  const hub = new WebSocketHub(deps).attach(server);
  if (analytics) hub.attachAnalytics(analytics);
  return hub;
}
