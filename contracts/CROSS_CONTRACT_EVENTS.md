# Cross-Contract Event Handling System

## Overview

This document describes the cross-contract event handling system that allows Soroban Identity contracts to react to events from other contracts in the ecosystem.

**Issue**: #884

## Architecture

### Components

1. **shared-events** - Core event system module
   - `EventRegistry` contract for managing subscriptions
   - `EventEmitter` for publishing events
   - Event types and payload definitions
   - Sequence numbering for ordering guarantees
   - Delivery receipts for audit trail

2. **credential-manager/events.rs** - Event emission
   - Emits events when credentials are issued, revoked, or renewed
   - Integrates with shared-events EventEmitter

3. **reputation/events.rs** - Event handling
   - Subscribes to credential events
   - Automatically updates reputation scores
   - Configurable scoring rules per credential type

4. **Integration tests** - End-to-end verification
   - Tests subscription mechanism
   - Verifies event emission
   - Validates event ordering and delivery

## Event Flow

```
┌─────────────────────┐
│ Credential Manager  │
│                     │
│ 1. issue_credential()│
│ 2. emit_credential_ │
│    issued()         │
└──────────┬──────────┘
           │
           │ EventPayload::Credential(
           │   CredentialEvent::Issued {...}
           │ )
           ▼
┌─────────────────────┐
│   Event Registry    │
│                     │
│ 3. get_subscribers()│
│ 4. For each listener│
└──────────┬──────────┘
           │
           │ List of subscribed
           │ contract addresses
           ▼
┌─────────────────────┐
│ Reputation Contract │
│                     │
│ 5. handle_credential│
│    _issued()        │
│ 6. submit_score()   │
│    (+20 for KYC)    │
└─────────────────────┘
```

## Usage

### Emitting Events (Credential Manager)

```rust
use shared_events::{EventEmitter, CredentialEvent, EventPayload};

// When issuing a credential
let event = CredentialEvent::Issued {
    credential_id: id.clone(),
    subject: subject.clone(),
    issuer: issuer.clone(),
    credential_type: String::from_str(&env, "Kyc"),
    issued_at: env.ledger().timestamp(),
};

// Emit to Soroban event stream
EventEmitter::emit(&env, EventPayload::Credential(event));

// Get next sequence number for ordering
let sequence = EventRegistry::next_sequence(&env);

// Record receipt for audit
let receipt = EventReceipt {
    sequence,
    event_type: EventType::CredentialIssued,
    emitted_at: env.ledger().timestamp(),
    emitter: env.current_contract_address(),
    delivered: true,
};
EventRegistry::record_receipt(&env, receipt);
```

### Subscribing to Events (Reputation Contract)

```rust
use shared_events::{EventRegistry, EventType};

// During initialization or admin action
pub fn subscribe_to_events(env: Env, event_registry: Address) -> Result<(), ContractError> {
    let reputation_addr = env.current_contract_address();
    
    let registry = EventRegistryClient::new(&env, &event_registry);
    
    // Subscribe to credential issued events
    registry.subscribe(&EventType::CredentialIssued, &reputation_addr);
    
    // Subscribe to credential revoked events
    registry.subscribe(&EventType::CredentialRevoked, &reputation_addr);
    
    Ok(())
}
```

### Handling Events (Reputation Contract)

```rust
use crate::events::{handle_credential_issued, ReputationEventConfig};

// This function is called when a credential issued event is received
pub fn on_credential_issued(
    env: Env,
    credential_id: BytesN<32>,
    subject: Address,
    issuer: Address,
    credential_type: String,
    issued_at: u64,
) -> Result<(), ContractError> {
    handle_credential_issued(
        env,
        issuer.clone(),  // issuer acts as reporter
        credential_id,
        subject,
        issuer,
        credential_type,
        issued_at,
    )
}
```

## Event Types

### CredentialEvent

Emitted by credential-manager contract:

```rust
pub enum CredentialEvent {
    Issued {
        credential_id: BytesN<32>,
        subject: Address,
        issuer: Address,
        credential_type: String,
        issued_at: u64,
    },
    Revoked {
        credential_id: BytesN<32>,
        subject: Address,
        issuer: Address,
        reason: u32,
        revoked_at: u64,
    },
    Renewed {
        credential_id: BytesN<32>,
        subject: Address,
        issuer: Address,
        old_expiry: u64,
        new_expiry: u64,
        renewed_at: u64,
    },
}
```

### DidEvent

Emitted by identity-registry contract:

```rust
pub enum DidEvent {
    Registered {
        did: String,
        controller: Address,
        created_at: u64,
    },
    Updated {
        did: String,
        controller: Address,
        updated_at: u64,
        metadata_hash: BytesN<32>,
    },
    Deactivated {
        did: String,
        controller: Address,
        deactivated_at: u64,
    },
}
```

### ReputationEvent

Emitted by reputation contract:

```rust
pub enum ReputationEvent {
    ScoreSubmitted {
        subject: Address,
        reporter: Address,
        score: i32,
        timestamp: u64,
    },
}
```

## Event Ordering and Delivery

### Sequence Numbers

Events are assigned monotonically increasing sequence numbers to guarantee ordering:

```rust
let seq = EventRegistry::next_sequence(&env);
// Returns: 1, 2, 3, 4, ...
```

### Delivery Receipts

Each event delivery is recorded with a receipt for audit trail:

```rust
pub struct EventReceipt {
    pub sequence: u64,
    pub event_type: EventType,
    pub emitted_at: u64,
    pub emitter: Address,
    pub delivered: bool,
}
```

Receipts can be queried later:

```rust
let receipt = EventRegistry::get_receipt(&env, sequence_number);
```

### Ordering Guarantees

- Events from a single emitter are delivered in order
- Sequence numbers are globally unique and monotonic
- Receipts provide proof of delivery
- Failed deliveries can be retried based on sequence

## Reputation Scoring Configuration

The reputation contract uses configurable scoring rules:

```rust
pub struct ReputationEventConfig {
    pub credential_issued_score: i32,
    pub credential_revoked_penalty: i32,
}

// Predefined configurations
ReputationEventConfig::default()     // +10 / -5
ReputationEventConfig::kyc()         // +20 / -10
ReputationEventConfig::achievement() // +15 / -7
```

### Credential Type Scoring

| Credential Type | Issued Score | Revoked Penalty |
|----------------|--------------|-----------------|
| KYC            | +20          | -10             |
| Achievement    | +15          | -7              |
| Reputation     | +10          | -5              |
| Custom         | +10          | -5              |

## Integration Points

### Credential Manager Integration

1. **Issue Credential** (`issue_credential`)
   - Calls `events::emit_credential_issued()`
   - Publishes CredentialEvent::Issued
   - Notifies subscribers (future enhancement)

2. **Revoke Credential** (`revoke_credential`)
   - Calls `events::emit_credential_revoked()`
   - Publishes CredentialEvent::Revoked
   - Notifies subscribers (future enhancement)

3. **Renew Credential** (`renew_credential`)
   - Calls `events::emit_credential_renewed()`
   - Publishes CredentialEvent::Renewed
   - Notifies subscribers (future enhancement)

### Reputation Contract Integration

1. **Subscribe** (`subscribe_to_credential_events`)
   - Registers for CredentialIssued events
   - Registers for CredentialRevoked events
   - Called during initialization or by admin

2. **Handle Issued** (`handle_credential_issued`)
   - Receives credential issued notification
   - Determines score based on credential type
   - Calls `submit_score()` to update reputation

3. **Handle Revoked** (`handle_credential_revoked`)
   - Receives credential revoked notification
   - Applies negative score penalty
   - Calls `submit_score()` with negative value

## Testing

### Unit Tests

Each module includes unit tests:

- **shared-events**: `cargo test -p shared-events`
- **credential-manager/events.rs**: Tests event emission
- **reputation/events.rs**: Tests event handling configuration

### Integration Tests

Comprehensive cross-contract tests in `tests/cross_contract_events_test.rs`:

```bash
cd contracts
cargo test cross_contract_events
```

Key test scenarios:

1. **Subscription Management**
   - Subscribe to events
   - Unsubscribe from events
   - Query subscribers
   - Multiple subscribers to same event

2. **Event Emission**
   - Credential issued events
   - Credential revoked events
   - Credential renewed events
   - Event topics and payloads

3. **Event Ordering**
   - Sequence number increments
   - Monotonic ordering
   - Receipt recording
   - Sequence matching

4. **Complete Flow**
   - Subscribe → Issue Credential → Event Emitted → Reputation Updated
   - Demonstrates end-to-end integration

## Storage Keys

### EventRegistry

- `SUBSCRIPTIONS`: `(Symbol, EventType)` → `Vec<EventSubscription>`
- `EVENT_SEQ`: `Symbol` → `u64` (next sequence number)
- `RECEIPTS`: `(Symbol, u64)` → `EventReceipt`

### TTL

All event-related storage uses TTL of ~1 year (6,312,000 ledgers):

```rust
const TTL_LEDGERS: u32 = 6_312_000;
```

## Future Enhancements

### 1. Cross-Contract Callbacks

Currently, events are emitted to the Soroban event stream but don't trigger automatic cross-contract calls. Future versions could implement:

```rust
// Notify all subscribers via contract calls
let subscribers = EventRegistry::get_subscribers(&env, EventType::CredentialIssued);
for listener in subscribers.iter() {
    // Call listener.handle_credential_issued(...)
    let listener_client = EventListenerClient::new(&env, &listener);
    listener_client.handle_credential_issued(
        credential_id.clone(),
        subject.clone(),
        issuer.clone(),
        credential_type.clone(),
        issued_at,
    )?;
}
```

### 2. Event Filtering

Add predicate-based filtering:

```rust
pub struct EventFilter {
    pub credential_type: Option<String>,
    pub issuer: Option<Address>,
    pub min_score: Option<i32>,
}
```

### 3. Batch Event Processing

Process multiple events in a single transaction:

```rust
pub fn process_events_batch(
    env: Env,
    events: Vec<EventPayload>,
) -> Vec<Result<(), ContractError>>
```

### 4. Event Replay

Allow subscribers to replay historical events:

```rust
pub fn replay_events(
    env: Env,
    from_sequence: u64,
    to_sequence: u64,
) -> Vec<EventReceipt>
```

### 5. Priority Events

Support high-priority events that skip the queue:

```rust
pub enum EventPriority {
    Low,
    Normal,
    High,
    Critical,
}
```

## Performance Considerations

### Event Volume

- Each event emission is ~1000 instructions
- Event storage is persistent with TTL
- Consider batching for high-volume scenarios

### Subscription Limits

- No hard limit on subscribers per event type
- Storage grows linearly with subscriptions
- Monitor storage usage in production

### Cross-Contract Calls

- Each notification is a separate contract call
- Costs multiply by number of subscribers
- Consider async/deferred processing for many subscribers

## Security Considerations

### Authorization

- Subscriptions require `listener.require_auth()`
- Only authorized contracts can subscribe
- Event emitters don't need authorization

### Reentrancy

- Event handlers should not call back to emitter
- Use reentrancy guards if needed
- Avoid circular event dependencies

### Rate Limiting

- No built-in rate limiting on events
- Emitters responsible for preventing spam
- Subscribers should implement rate limiting

### Validation

- Event payloads are strongly typed
- No arbitrary data in events
- Validate event data in handlers

## Monitoring and Observability

### Event Stream

All events are published to Soroban event stream:

```rust
env.events().publish((topic, emitter, timestamp), payload);
```

### Indexing

Off-chain indexers can track:

- Event emission rates
- Subscription patterns
- Delivery success/failure
- Sequence gaps

### Metrics

Key metrics to monitor:

- Events emitted per contract
- Subscription count per event type
- Average delivery latency
- Failed delivery rate

## Deployment

### 1. Deploy EventRegistry

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/shared_events.wasm \
  --network testnet
```

### 2. Deploy Contracts

Deploy credential-manager and reputation with event support.

### 3. Configure Subscriptions

```bash
# Subscribe reputation contract to credential events
soroban contract invoke \
  --id $EVENT_REGISTRY \
  --network testnet \
  -- subscribe \
  --event-type CredentialIssued \
  --listener $REPUTATION_CONTRACT
```

### 4. Verify Setup

```bash
# Check subscribers
soroban contract invoke \
  --id $EVENT_REGISTRY \
  --network testnet \
  -- get_subscribers \
  --event-type CredentialIssued
```

## Troubleshooting

### Events Not Emitted

1. Check that event module is imported in lib.rs
2. Verify EventEmitter::emit() is called
3. Check Soroban event stream with `soroban events`

### Subscribers Not Receiving Events

1. Verify subscription with `get_subscribers()`
2. Check that EventRegistry address is correct
3. Ensure listener implements handler functions

### Sequence Number Gaps

1. Check for failed transactions
2. Verify receipt recording
3. Look for reentrancy issues

### Performance Issues

1. Reduce number of subscribers
2. Batch event processing
3. Use async notification pattern
4. Increase instruction budget if needed

## Examples

See comprehensive examples in:

- `contracts/tests/cross_contract_events_test.rs` - Integration tests
- `contracts/credential-manager/src/events.rs` - Event emission
- `contracts/reputation/src/events.rs` - Event handling

## References

- [Soroban Events Documentation](https://soroban.stellar.org/docs/learn/events)
- [Contract to Contract Calls](https://soroban.stellar.org/docs/learn/contract-to-contract)
- Issue #884: Cross-contract event handling system

## Contributing

When adding new event types:

1. Define event in `shared-events/src/lib.rs`
2. Add to `EventType` enum
3. Implement in `EventPayload`
4. Update emitter contracts
5. Update listener contracts
6. Add integration tests
7. Update this documentation

## License

Same as Soroban Identity project.
