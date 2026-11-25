# Contract Event Schema

This document defines the normalized event payload served by `GET /events` and the related WebSocket messages in the server package.

## SSE message shape

Each `contract-event` message includes:

- `id` (string): unique event identifier for stream clients
- `type` (string): Soroban event type (`contract`)
- `contractId` (string): emitting contract address
- `topic` (string[]): normalized event topic segments
- `value` (unknown): decoded event payload
- `ledger` (number): ledger sequence that emitted the event
- `txHash` (string): transaction hash
- `timestamp` (string): server timestamp (ISO 8601)

## identity-registry events

| Topic | Payload |
| --- | --- |
| `IDENTITY,created` | `[eventVersion: 1, controller: string, timestamp: number]` |
| `IDENTITY,updated` | `[eventVersion: 1, controller: string, metadataHash: string]` |
| `IDENTITY,deact` | `[eventVersion: 1, controller: string, timestamp: number]` |
| `IDENTITY,did_crtd` | `[eventVersion: 1, owner: string, did: string, metadataHash: bytes, timestamp: number]` |
| `IDENTITY,did_upd` | `[eventVersion: 1, owner: string, did: string, metadataHash: bytes, timestamp: number]` |
| `admin,xfer` | `[oldAdmin: string, newAdmin: string]` |

The stable identity topics are the two-segment normalized topics
`['IDENTITY', 'created']`, `['IDENTITY', 'updated']`, and
`['IDENTITY', 'deact']`. The WebSocket API maps `deact` to the stable typed
action `identity.deactivated`. Payload tuples begin with `eventVersion: 1`;
consumers should use the controller or DID fields as the subject for routing.

## credential-manager events

| Topic | Payload |
| --- | --- |
| `CRED,issued` | `[eventVersion: 1, id: bytes, subject: address, issuer: address, credentialType: string, expiresAt: number]` |
| `CRED,revoked` | `[eventVersion: 1, id: bytes, issuer: address, revokedAt: number, reason: number]` |
| `CRED,suspended` | `[id: string, issuer: string, reason: number, suspendedAt: number]` — credential temporarily suspended; see `SuspensionReason` |
| `CRED,unsuspend` | `[id: string, issuer: string, reactivatedAt: number]` — suspension lifted by `reactivate_credential` |
| `CRED,evicted` | `[issuer: string, evictedId: string]` — emitted when the per-issuer credential ring buffer (`MAX_ISSUER_CREDS`) is full and the oldest entry is dropped to make room for a new one |

### Attestation lifecycle events

The credential manager emits a stable namespace/action topic pair:

| Topic | Payload |
| --- | --- |
| `ATTEST,ATISSUE` | `[eventVersion: 1, id: bytes, subject: address, issuer: address, claims: map<string,string>, expiry: number, issuedAtLedger: number, revoked: false]` |
| `ATTEST,ATREVOKE` | `[eventVersion: 1, id: bytes, subject: address, issuer: address, claims: map<string,string>, expiry: number, revoked: true, revokedAtLedger: number, revokedBy: address]` |

Both events carry a version-1 payload and the subject, so the WebSocket hub can
route them directly to the corresponding DID room. Older one-field event
payloads remain accepted by the hub; those can be routed only after it has
observed an issue event that associates the attestation ID with a subject.
Soroban/XDR values are decoded on a best-effort basis. Consumers should treat
byte identifiers as opaque values and not assume they are UTF-8 strings.

### credential transfer events

Credential ownership transfers are a two-step, consent-based flow: the current
owner initiates a transfer to a recipient, and the recipient accepts or rejects
it. Off-chain consumers can index ownership changes by following the events
below in ledger order.

| Topic | Payload |
| --- | --- |
| `CRED,xfer_init` | `[id: string, from: string, to: string, initiatedAt: number, expiresAt: number]` — emitted by `initiate_transfer`; `expiresAt` is the ledger timestamp after which the pending transfer can no longer be accepted |
| `CRED,xfer_accept` | `[id: string, from: string, to: string, acceptedAt: number]` — emitted by `accept_transfer`; ownership of `id` moves from `from` to `to` |
| `CRED,xfer_reject` | `[id: string, from: string, to: string, rejectedAt: number]` — emitted by `reject_transfer`; the pending transfer is cancelled and ownership remains with `from` |
| `CRED,xfer_done` | `[id: string, from: string, to: string, completedAt: number, fee: number]` — emitted once the transfer is finalized and any transfer fee has been settled; `fee` is the amount charged for the transfer (0 when the credential type is fee-exempt) |

Notes for indexers:

- A transfer is only `completed` after a matching `xfer_accept`; `xfer_init`
  alone does not change ownership.
- `xfer_reject` and expiry both leave ownership unchanged, so consumers should
  treat only `xfer_accept`/`xfer_done` as ownership-changing events.
- Transfer restrictions are enforced per credential type: credentials whose
  type disallows transfers never emit `xfer_init`, and the call reverts instead.
- The `from`/`to` fields are always the addresses recorded at initiation time;
  they are not re-resolved at acceptance.

## reputation events

| Topic | Payload |
| --- | --- |
| `SCORE,updated` | `[subject: string, reporter: string, delta: number, score: number]` |
| `SUBDECAY,updated` | `[eventVersion: number, admin: string, subject: string, parameters: DecayParameters]` — subject-specific decay parameters changed |

## credential-escrow events

Escrow lifecycle events are emitted by the credential escrow contract. Indexers can
track escrow state transitions by following the `ESCROW` topic prefix; clients can
subscribe to a specific escrow by filtering on the escrow `id` in the payload.

| Topic | Payload |
| --- | --- |
| `ESCROW,created` | `[id: string, depositor: string, beneficiary: string, amount: number, condition: number, deadline: number]` — escrow funded and awaiting condition verification; `condition` is a `ConditionType` discriminant |
| `ESCROW,released` | `[id: string, beneficiary: string, amount: number, releasedAt: number]` — all release conditions verified and funds transferred to the beneficiary |
| `ESCROW,refunded` | `[id: string, depositor: string, amount: number, refundedAt: number]` — conditions failed or expired and funds returned to the depositor |
| `ESCROW,disputed` | `[id: string, challenger: string, reason: number, disputedAt: number]` — a party opened a dispute, freezing release until resolution; `reason` is a `DisputeReason` discriminant |
| `ESCROW,resolved` | `[id: string, resolver: string, outcome: number, resolvedAt: number]` — dispute resolved by the arbiter; `outcome` is a `DisputeOutcome` discriminant (`0` = release, `1` = refund) |
| `ESCROW,cancelled` | `[id: string, depositor: string, cancelledAt: number]` — escrow cancelled before any condition was met |

### Escrow status queries

The current escrow state is not carried in events; clients should query it via
`get_escrow(id)` which returns the escrow record including its `EscrowStatus`
(`Pending`, `Released`, `Refunded`, `Disputed`, `Resolved`, or `Cancelled`).

> The payload arrays are decoded from contract event values and reflect the contract tuple order.

## WebSocket event messages

WebSocket clients retain the generic `contract.event` message for every
polled event. It has the normalized contract event in `event` and, when
available, its identity/attestation address in `subject`. Recognized identity
and attestation topics additionally produce one typed message, so existing
clients can continue to consume the generic envelope while newer clients can
subscribe to explicit event types:

| Contract topic | Typed WebSocket `type` | Typed payload |
| --- | --- | --- |
| `IDENTITY,created` | `identity.created` | `{ controller, timestamp }` |
| `IDENTITY,updated` | `identity.updated` | `{ controller, metadataHash }` |
| `IDENTITY,deact` / `IDENTITY,deactivated` | `identity.deactivated` | `{ controller, timestamp }` |
| `ATTEST,ATISSUE` | `attestation.issued` | `{ id, subject?, claim?, issuer?, expiresAt? }` |
| `ATTEST,ATREVOKE` | `attestation.revoked` | `{ id, subject? }` |

Every typed message includes `eventVersion: 1`, `action`, `payload`, and the
source event's `eventId`, `ledger`, and `txHash`. Identity messages also expose
`did` and `subject`; attestation messages expose `subject` when recoverable.
These version-1 payload property names are the stable client-facing shape;
the nested generic `contract.event.event.value` remains the original normalized
payload (and thus preserves the contract tuple order). Typed messages are
routed to the global room and, where a subject is available, the matching DID
room. A socket subscribed to both receives each message once. The
`emitAttestationEvent(action, attestation, details)` server API emits the same
`attestation.issued` / `attestation.revoked` type family with `eventVersion: 1`.
