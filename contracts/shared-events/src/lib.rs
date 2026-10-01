#![no_std]

//! Cross-Contract Event System for Soroban Identity
//!
//! This module provides a standardized event emission and subscription mechanism
//! that allows contracts to react to events from other contracts in the ecosystem.
//!
//! ## Architecture
//!
//! The event system uses Soroban's native event publishing combined with a
//! subscription registry pattern:
//!
//! 1. **Event Emission**: Contracts emit typed events using `env.events().publish()`
//! 2. **Event Topics**: Events are tagged with topics for filtering and routing
//! 3. **Subscription Storage**: Contracts register listeners for specific event types
//! 4. **Event Delivery**: Events are delivered via contract-to-contract calls
//!
//! ## Event Flow
//!
//! ```text
//! CredentialManager                    Reputation Contract
//!      |                                      |
//!      | 1. issue_credential()                |
//!      |-----> emit(CredentialIssued)         |
//!      |                                      |
//!      | 2. notify_listeners()                |
//!      |------------------------------------->|
//!      |                                      |
//!      |                              3. handle_credential_issued()
//!      |                                      |---> update reputation score
//!      |                                      |
//!      | 4. event_callback() success          |
//!      |<-------------------------------------|
//! ```
//!
//! ## Usage Example
//!
//! ### Emitting Events
//!
//! ```rust,ignore
//! use shared_events::{EventEmitter, CredentialEvent, EventPayload};
//!
//! // In credential-manager
//! let event = CredentialEvent::Issued {
//!     credential_id: id.clone(),
//!     subject: subject.clone(),
//!     issuer: issuer.clone(),
//!     credential_type: cred_type,
//!     issued_at: env.ledger().timestamp(),
//! };
//!
//! EventEmitter::emit(&env, EventPayload::Credential(event));
//! EventEmitter::notify_listeners(&env, &event, sequence_number);
//! ```
//!
//! ### Subscribing to Events
//!
//! ```rust,ignore
//! use shared_events::{EventRegistry, EventType};
//!
//! // In reputation contract initialization
//! EventRegistry::subscribe(
//!     &env,
//!     EventType::CredentialIssued,
//!     &env.current_contract_address(),
//! )?;
//! ```
//!
//! ### Handling Events
//!
//! ```rust,ignore
//! // Implement EventListener trait
//! impl EventListener for Reputation {
//!     fn handle_credential_issued(
//!         env: Env,
//!         credential_id: BytesN<32>,
//!         subject: Address,
//!         // ... other params
//!     ) -> Result<(), ContractError> {
//!         // Update reputation score automatically
//!         Self::submit_score(env, reporter, subject, 10, "Credential issued")?;
//!         Ok(())
//!     }
//! }
//! ```

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Symbol, Vec,
};

// ── Event Types ───────────────────────────────────────────────────────────────

/// Event types that can be subscribed to across contracts.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EventType {
    /// Credential was issued to a subject
    CredentialIssued,
    /// Credential was revoked by issuer or subject
    CredentialRevoked,
    /// Credential was renewed with new expiry
    CredentialRenewed,
    /// DID was registered in identity registry
    DidRegistered,
    /// DID was updated (metadata changed)
    DidUpdated,
    /// DID was deactivated
    DidDeactivated,
    /// Reputation score was submitted
    ReputationScoreSubmitted,
    /// Custom event for extensibility
    Custom(String),
}

/// Credential-related events emitted by credential-manager contract.
#[contracttype]
#[derive(Clone, Debug)]
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

/// DID-related events emitted by identity-registry contract.
#[contracttype]
#[derive(Clone, Debug)]
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

/// Reputation-related events emitted by reputation contract.
#[contracttype]
#[derive(Clone, Debug)]
pub enum ReputationEvent {
    ScoreSubmitted {
        subject: Address,
        reporter: Address,
        score: i32,
        timestamp: u64,
    },
}

/// Top-level event payload that wraps all event types.
#[contracttype]
#[derive(Clone, Debug)]
pub enum EventPayload {
    Credential(CredentialEvent),
    Did(DidEvent),
    Reputation(ReputationEvent),
    Custom(String),
}

/// Event subscription record stored for each contract listening to events.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EventSubscription {
    /// The contract address that wants to receive events
    pub listener: Address,
    /// The type of event to listen for
    pub event_type: EventType,
    /// When this subscription was registered
    pub registered_at: u64,
    /// Whether this subscription is active
    pub active: bool,
}

/// Event delivery receipt with sequence number for ordering guarantees.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EventReceipt {
    /// Monotonically increasing sequence number for event ordering
    pub sequence: u64,
    /// The event type
    pub event_type: EventType,
    /// Timestamp when event was emitted
    pub emitted_at: u64,
    /// Contract that emitted the event
    pub emitter: Address,
    /// Whether delivery succeeded
    pub delivered: bool,
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

const SUBSCRIPTIONS: Symbol = symbol_short!("SUBS");
const EVENT_SEQ: Symbol = symbol_short!("EVTSEQ");
const RECEIPTS: Symbol = symbol_short!("RCPTS");

/// TTL for event subscriptions and receipts (~1 year).
const TTL_LEDGERS: u32 = 6_312_000;

// ── Event Registry ────────────────────────────────────────────────────────────

/// Registry for managing event subscriptions across contracts.
#[contract]
pub struct EventRegistry;

#[contractimpl]
impl EventRegistry {
    /// Subscribe a contract to receive events of a specific type.
    ///
    /// # Parameters
    /// - `event_type`: The type of event to subscribe to
    /// - `listener`: The contract address that will handle the events
    ///
    /// # Returns
    /// `true` if subscription was created, `false` if already subscribed
    pub fn subscribe(env: Env, event_type: EventType, listener: Address) -> bool {
        listener.require_auth();

        let key = (SUBSCRIPTIONS.clone(), event_type.clone());
        let mut subs: Vec<EventSubscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        // Check if already subscribed
        for sub in subs.iter() {
            if sub.listener == listener && sub.active {
                return false;
            }
        }

        let subscription = EventSubscription {
            listener: listener.clone(),
            event_type: event_type.clone(),
            registered_at: env.ledger().timestamp(),
            active: true,
        };

        subs.push_back(subscription);
        env.storage().persistent().set(&key, &subs);
        env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);

        // Emit subscription event
        env.events().publish(
            (symbol_short!("subscribe"), event_type.clone()),
            (listener.clone(),),
        );

        true
    }

    /// Unsubscribe a contract from receiving events.
    ///
    /// # Parameters
    /// - `event_type`: The type of event to unsubscribe from
    /// - `listener`: The contract address to unsubscribe
    pub fn unsubscribe(env: Env, event_type: EventType, listener: Address) -> bool {
        listener.require_auth();

        let key = (SUBSCRIPTIONS.clone(), event_type.clone());
        let mut subs: Vec<EventSubscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        let mut found = false;
        let mut updated_subs = Vec::new(&env);

        for sub in subs.iter() {
            if sub.listener == listener && sub.active {
                // Deactivate subscription
                let mut deactivated = sub.clone();
                deactivated.active = false;
                updated_subs.push_back(deactivated);
                found = true;
            } else {
                updated_subs.push_back(sub);
            }
        }

        if found {
            env.storage().persistent().set(&key, &updated_subs);
            env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);

            env.events().publish(
                (symbol_short!("unsub"), event_type.clone()),
                (listener.clone(),),
            );
        }

        found
    }

    /// Get all active subscriptions for a specific event type.
    pub fn get_subscribers(env: Env, event_type: EventType) -> Vec<Address> {
        let key = (SUBSCRIPTIONS.clone(), event_type);
        let subs: Vec<EventSubscription> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        let mut listeners = Vec::new(&env);
        for sub in subs.iter() {
            if sub.active {
                listeners.push_back(sub.listener.clone());
            }
        }

        listeners
    }

    /// Get the next event sequence number (monotonically increasing).
    pub fn next_sequence(env: Env) -> u64 {
        let mut seq: u64 = env
            .storage()
            .persistent()
            .get(&EVENT_SEQ)
            .unwrap_or(0);
        seq += 1;
        env.storage().persistent().set(&EVENT_SEQ, &seq);
        env.storage()
            .persistent()
            .extend_ttl(&EVENT_SEQ, TTL_LEDGERS, TTL_LEDGERS);
        seq
    }

    /// Record an event delivery receipt for audit trail.
    pub fn record_receipt(env: Env, receipt: EventReceipt) {
        let key = (RECEIPTS.clone(), receipt.sequence);
        env.storage().persistent().set(&key, &receipt);
        env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
    }

    /// Get event receipt by sequence number.
    pub fn get_receipt(env: Env, sequence: u64) -> Option<EventReceipt> {
        let key = (RECEIPTS.clone(), sequence);
        env.storage().persistent().get(&key)
    }
}

// ── Event Emitter ─────────────────────────────────────────────────────────────

/// Utility for emitting events with proper topics and notification.
pub struct EventEmitter;

impl EventEmitter {
    /// Emit an event to the Soroban event stream with proper topics.
    ///
    /// This publishes the event so it can be indexed by off-chain listeners
    /// and provides the foundation for cross-contract event handling.
    pub fn emit(env: &Env, payload: EventPayload) {
        let timestamp = env.ledger().timestamp();
        let emitter = env.current_contract_address();

        match &payload {
            EventPayload::Credential(cred_event) => {
                let topic = match cred_event {
                    CredentialEvent::Issued { .. } => symbol_short!("cred_issue"),
                    CredentialEvent::Revoked { .. } => symbol_short!("cred_revok"),
                    CredentialEvent::Renewed { .. } => symbol_short!("cred_renew"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Did(did_event) => {
                let topic = match did_event {
                    DidEvent::Registered { .. } => symbol_short!("did_reg"),
                    DidEvent::Updated { .. } => symbol_short!("did_update"),
                    DidEvent::Deactivated { .. } => symbol_short!("did_deact"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Reputation(rep_event) => {
                let topic = match rep_event {
                    ReputationEvent::ScoreSubmitted { .. } => symbol_short!("rep_score"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Custom(msg) => {
                env.events()
                    .publish((symbol_short!("custom"), emitter, timestamp), msg.clone());
            }
        }
    }

    /// Get the EventType from a payload.
    pub fn event_type_from_payload(payload: &EventPayload) -> EventType {
        match payload {
            EventPayload::Credential(cred) => match cred {
                CredentialEvent::Issued { .. } => EventType::CredentialIssued,
                CredentialEvent::Revoked { .. } => EventType::CredentialRevoked,
                CredentialEvent::Renewed { .. } => EventType::CredentialRenewed,
            },
            EventPayload::Did(did) => match did {
                DidEvent::Registered { .. } => EventType::DidRegistered,
                DidEvent::Updated { .. } => EventType::DidUpdated,
                DidEvent::Deactivated { .. } => EventType::DidDeactivated,
            },
            EventPayload::Reputation(rep) => match rep {
                ReputationEvent::ScoreSubmitted { .. } => EventType::ReputationScoreSubmitted,
            },
            EventPayload::Custom(msg) => EventType::Custom(msg.clone()),
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{symbol_short, Address, Env};

    #[test]
    fn test_subscribe_and_get_subscribers() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, EventRegistry);
        let client = EventRegistryClient::new(&env, &contract_id);

        let listener1 = Address::generate(&env);
        let listener2 = Address::generate(&env);

        // Subscribe two listeners
        let result1 = client.subscribe(&EventType::CredentialIssued, &listener1);
        assert_eq!(result1, true);

        let result2 = client.subscribe(&EventType::CredentialIssued, &listener2);
        assert_eq!(result2, true);

        // Check subscribers
        let subscribers = client.get_subscribers(&EventType::CredentialIssued);
        assert_eq!(subscribers.len(), 2);
        assert!(subscribers.contains(&listener1));
        assert!(subscribers.contains(&listener2));
    }

    #[test]
    fn test_subscribe_duplicate_returns_false() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, EventRegistry);
        let client = EventRegistryClient::new(&env, &contract_id);

        let listener = Address::generate(&env);

        let result1 = client.subscribe(&EventType::CredentialIssued, &listener);
        assert_eq!(result1, true);

        let result2 = client.subscribe(&EventType::CredentialIssued, &listener);
        assert_eq!(result2, false);
    }

    #[test]
    fn test_unsubscribe_removes_listener() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, EventRegistry);
        let client = EventRegistryClient::new(&env, &contract_id);

        let listener = Address::generate(&env);

        client.subscribe(&EventType::CredentialRevoked, &listener);

        let subscribers = client.get_subscribers(&EventType::CredentialRevoked);
        assert_eq!(subscribers.len(), 1);

        let unsubbed = client.unsubscribe(&EventType::CredentialRevoked, &listener);
        assert_eq!(unsubbed, true);

        let subscribers_after = client.get_subscribers(&EventType::CredentialRevoked);
        assert_eq!(subscribers_after.len(), 0);
    }

    #[test]
    fn test_next_sequence_increments() {
        let env = Env::default();

        let contract_id = env.register_contract(None, EventRegistry);
        let client = EventRegistryClient::new(&env, &contract_id);

        let seq1 = client.next_sequence();
        let seq2 = client.next_sequence();
        let seq3 = client.next_sequence();

        assert_eq!(seq1, 1);
        assert_eq!(seq2, 2);
        assert_eq!(seq3, 3);
    }

    #[test]
    fn test_record_and_get_receipt() {
        let env = Env::default();

        let contract_id = env.register_contract(None, EventRegistry);
        let client = EventRegistryClient::new(&env, &contract_id);

        let emitter = Address::generate(&env);
        let receipt = EventReceipt {
            sequence: 1,
            event_type: EventType::CredentialIssued,
            emitted_at: env.ledger().timestamp(),
            emitter: emitter.clone(),
            delivered: true,
        };

        client.record_receipt(&receipt);

        let retrieved = client.get_receipt(&1);
        assert!(retrieved.is_some());
        let r = retrieved.unwrap();
        assert_eq!(r.sequence, 1);
        assert_eq!(r.delivered, true);
    }

    #[test]
    fn test_event_type_from_payload() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let issuer = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[0u8; 32]);

        let issued_event = EventPayload::Credential(CredentialEvent::Issued {
            credential_id: cred_id.clone(),
            subject: subject.clone(),
            issuer: issuer.clone(),
            credential_type: String::from_str(&env, "Kyc"),
            issued_at: 12345,
        });

        let event_type = EventEmitter::event_type_from_payload(&issued_event);
        assert_eq!(event_type, EventType::CredentialIssued);
    }
}
