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
    /// Escrow was deposited by a depositor
    EscrowDeposited,
    /// Escrow funds were released to the beneficiary
    EscrowReleased,
    /// Escrow was disputed by a party
    EscrowDisputed,
    /// Escrow dispute was resolved
    EscrowResolved,
    /// Escrow funds were refunded to the depositor
    EscrowRefunded,
    /// An oracle request was submitted for off-chain data
    OracleRequested,
    /// An oracle responded with off-chain data
    OracleResponded,
    /// A fallback oracle was used after primary failure
    OracleFallbackUsed,
    /// A credential template was registered
    TemplateRegistered,
    /// A new version of a credential template was published
    TemplateVersionPublished,
    /// A credential template was purchased from the marketplace
    TemplatePurchased,
    /// A threshold signer set was updated
    SignerSetUpdated,
    /// A threshold signature operation was completed
    ThresholdSigned,
    /// A DID method was registered with the resolver
    DidMethodRegistered,
    /// A DID was resolved through the resolver
    DidResolved,
    /// DID resolution result was cached
    DidResolutionCached,
    /// Custom DID resolver plugin was registered
    DidResolverPluginRegistered,
    /// Multiple credentials were revoked in a batch
    CredentialRevokedBatch,
    /// A credential revocation was reversed
    RevocationReversed,
    /// A revocation proof was generated
    RevocationProofGenerated,
    /// Stake was deposited by a holder
    StakeDeposited,
    /// Stake was withdrawn after cooldown
    StakeWithdrawn,
    /// Stake was slashed for fraud
    StakeSlashed,
    /// Staking rewards were distributed
    RewardsDistributed,
    /// Stake delegation was created
    DelegationCreated,
    /// A verifiable presentation was created
    PresentationCreated,
    /// A verifiable presentation was verified
    PresentationVerified,
    /// A presentation template was registered
    PresentationTemplateRegistered,
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

/// Escrow-related events emitted by the credential escrow contract.
#[contracttype]
#[derive(Clone, Debug)]
pub enum EscrowEvent {
    /// Funds were deposited into escrow.
    Deposited {
        escrow_id: BytesN<32>,
        depositor: Address,
        beneficiary: Address,
        amount: i128,
        /// Release condition: time, payment, or approval
        condition: u32,
        /// Deadline for time-based conditions (0 if not applicable)
        release_at: u64,
        deposited_at: u64,
    },
    /// Escrowed funds were released to the beneficiary.
    Released {
        escrow_id: BytesN<32>,
        beneficiary: Address,
        amount: i128,
        released_at: u64,
    },
    /// An escrow was disputed by a party.
    Disputed {
        escrow_id: BytesN<32>,
        disputer: Address,
        reason: String,
        disputed_at: u64,
    },
    /// A dispute was resolved by the arbiter.
    Resolved {
        escrow_id: BytesN<32>,
        arbiter: Address,
        /// Whether funds were released to the beneficiary (true) or refunded (false)
        release_to_beneficiary: bool,
        resolved_at: u64,
    },
    /// Escrowed funds were refunded to the depositor after failed conditions.
    Refunded {
        escrow_id: BytesN<32>,
        depositor: Address,
        amount: i128,
        reason: u32,
        refunded_at: u64,
    },
}

/// Oracle-related events emitted by oracle integration contracts.
#[contracttype]
#[derive(Clone, Debug)]
pub enum OracleEvent {
    /// An off-chain data request was submitted to an oracle.
    Requested {
        request_id: BytesN<32>,
        requester: Address,
        /// Identifier of the data feed schema being queried
        feed_id: BytesN<32>,
        /// Oracle contract address handling the request
        oracle: Address,
        requested_at: u64,
    },
    /// An oracle responded with off-chain data.
    Responded {
        request_id: BytesN<32>,
        oracle: Address,
        /// Hash of the returned data payload for verification
        data_hash: BytesN<32>,
        /// Ledger timestamp at which the oracle observed the data
        observed_at: u64,
        responded_at: u64,
    },
    /// A fallback oracle was used because the primary oracle failed.
    FallbackUsed {
        request_id: BytesN<32>,
        /// Primary oracle that failed
        primary: Address,
        /// Fallback oracle that served the request
        fallback: Address,
        used_at: u64,
    },
}

/// Credential template events emitted by template registry contracts.
#[contracttype]
#[derive(Clone, Debug)]
pub enum TemplateEvent {
    /// A new credential template was registered.
    Registered {
        template_id: BytesN<32>,
        owner: Address,
        /// Parent template this one inherits from (zero hash if none)
        parent_id: BytesN<32>,
        registered_at: u64,
    },
    /// A new version of a credential template was published.
    VersionPublished {
        template_id: BytesN<32>,
        version: u32,
        /// Hash of the template schema for this version
        schema_hash: BytesN<32>,
        published_at: u64,
    },
    /// A credential template was purchased from the marketplace.
    Purchased {
        template_id: BytesN<32>,
        buyer: Address,
        /// Usage fee paid to the template owner
        fee: i128,
        purchased_at: u64,
    },
}

/// Threshold signature events emitted by multi-signature contracts.
#[contracttype]
#[derive(Clone, Debug)]
pub enum ThresholdEvent {
    /// The signer set or weights were updated.
    SignerSetUpdated {
        /// Hash identifying the signer set configuration
        set_id: BytesN<32>,
        /// New threshold required for approvals
        threshold: u32,
        updated_at: u64,
    },
    /// A threshold signature operation was completed.
    Signed {
        /// Identifier of the signed operation
        operation_id: BytesN<32>,
        /// Number of signers that contributed
        signer_count: u32,
        /// Aggregated signature hash
        signature_hash: BytesN<32>,
        signed_at: u64,
    },
}

/// DID resolver events emitted by the decentralized identifier resolver.
#[contracttype]
#[derive(Clone, Debug)]
pub enum DidResolverEvent {
    /// A new DID method was registered with the resolver.
    MethodRegistered {
        /// Method name (e.g. "stellar", "key")
        method: String,
        /// Resolver contract implementing the method
        resolver: Address,
        registered_at: u64,
    },
    /// A DID was resolved through the resolver.
    Resolved {
        did: String,
        /// Hash of the resolved DID document
        document_hash: BytesN<32>,
        resolved_at: u64,
    },
}

/// DID resolver events emitted by the DID resolver contract.
#[contracttype]
#[derive(Clone, Debug)]
pub enum DidResolutionEvent {
    /// A DID was resolved to a document hash.
    Resolved {
        did: String,
        /// Numeric identifier of the DID method (e.g. stellar, ethr, web).
        method: u32,
        document_hash: BytesN<32>,
        resolved_at: u64,
    },
    /// A resolution result was written to the cache.
    ResolutionCached {
        did: String,
        document_hash: BytesN<32>,
        expires_at: u64,
        cached_at: u64,
    },
    /// A custom resolver plugin was registered.
    PluginRegistered {
        /// Numeric identifier of the DID method handled by the plugin.
        method: u32,
        plugin: Address,
        registered_at: u64,
    },
}

/// Credential revocation events emitted by the revocation list contract.
#[contracttype]
#[derive(Clone, Debug)]
pub enum RevocationEvent {
    /// A batch of credentials was revoked.
    RevokedBatch {
        issuer: Address,
        /// Number of credentials revoked in this batch.
        count: u32,
        reason: u32,
        revoked_at: u64,
    },
    /// A credential revocation was reversed.
    Reversed {
        credential_id: BytesN<32>,
        issuer: Address,
        reversed_at: u64,
    },
    /// A revocation proof was generated.
    ProofGenerated {
        credential_id: BytesN<32>,
        proof_hash: BytesN<32>,
        generated_at: u64,
    },
}

/// Staking events emitted by the reputation staking contract.
#[contracttype]
#[derive(Clone, Debug)]
pub enum StakingEvent {
    /// A holder deposited stake.
    Deposited {
        staker: Address,
        amount: i128,
        deposited_at: u64,
    },
    /// A holder withdrew stake after the cooldown period.
    Withdrawn {
        staker: Address,
        amount: i128,
        withdrawn_at: u64,
    },
    /// A stake was slashed for fraud.
    Slashed {
        staker: Address,
        amount: i128,
        reason: u32,
        slashed_at: u64,
    },
    /// Staking rewards were distributed.
    RewardsDistributed {
        staker: Address,
        amount: i128,
        distributed_at: u64,
    },
    /// A stake delegation was created.
    DelegationCreated {
        delegator: Address,
        delegatee: Address,
        amount: i128,
        created_at: u64,
    },
}

/// Verifiable presentation events emitted by the presentation contract.
#[contracttype]
#[derive(Clone, Debug)]
pub enum PresentationEvent {
    /// A verifiable presentation was created.
    Created {
        presentation_id: BytesN<32>,
        holder: Address,
        /// Number of credentials bundled in the presentation.
        credential_count: u32,
        created_at: u64,
    },
    /// A verifiable presentation was verified.
    Verified {
        presentation_id: BytesN<32>,
        verifier: Address,
        verified_at: u64,
    },
    /// A presentation template was registered.
    TemplateRegistered {
        template_id: BytesN<32>,
        issuer: Address,
        registered_at: u64,
    },
}

/// Top-level event payload that wraps all event types.
#[contracttype]
#[derive(Clone, Debug)]
pub enum EventPayload {
    Credential(CredentialEvent),
    Did(DidEvent),
    Reputation(ReputationEvent),
    Escrow(EscrowEvent),
    Oracle(OracleEvent),
    Template(TemplateEvent),
    Threshold(ThresholdEvent),
    DidResolver(DidResolverEvent),
    DidResolution(DidResolutionEvent),
    Revocation(RevocationEvent),
    Staking(StakingEvent),
    Presentation(PresentationEvent),
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
            EventPayload::Escrow(escrow_event) => {
                let topic = match escrow_event {
                    EscrowEvent::Deposited { .. } => symbol_short!("esc_dep"),
                    EscrowEvent::Released { .. } => symbol_short!("esc_rel"),
                    EscrowEvent::Disputed { .. } => symbol_short!("esc_disp"),
                    EscrowEvent::Resolved { .. } => symbol_short!("esc_res"),
                    EscrowEvent::Refunded { .. } => symbol_short!("esc_ref"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Oracle(oracle_event) => {
                let topic = match oracle_event {
                    OracleEvent::Requested { .. } => symbol_short!("orc_req"),
                    OracleEvent::Responded { .. } => symbol_short!("orc_resp"),
                    OracleEvent::FallbackUsed { .. } => symbol_short!("orc_fb"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Template(template_event) => {
                let topic = match template_event {
                    TemplateEvent::Registered { .. } => symbol_short!("tpl_reg"),
                    TemplateEvent::VersionPublished { .. } => symbol_short!("tpl_ver"),
                    TemplateEvent::Purchased { .. } => symbol_short!("tpl_buy"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Threshold(threshold_event) => {
                let topic = match threshold_event {
                    ThresholdEvent::SignerSetUpdated { .. } => symbol_short!("thr_set"),
                    ThresholdEvent::Signed { .. } => symbol_short!("thr_sign"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::DidResolver(resolver_event) => {
                let topic = match resolver_event {
                    DidResolverEvent::MethodRegistered { .. } => symbol_short!("did_mreg"),
                    DidResolverEvent::Resolved { .. } => symbol_short!("did_res"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::DidResolution(resolver_event) => {
                let topic = match resolver_event {
                    DidResolutionEvent::Resolved { .. } => symbol_short!("did_res"),
                    DidResolutionEvent::ResolutionCached { .. } => symbol_short!("did_cache"),
                    DidResolutionEvent::PluginRegistered { .. } => symbol_short!("did_plug"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Revocation(rev_event) => {
                let topic = match rev_event {
                    RevocationEvent::RevokedBatch { .. } => symbol_short!("rev_batch"),
                    RevocationEvent::Reversed { .. } => symbol_short!("rev_rev"),
                    RevocationEvent::ProofGenerated { .. } => symbol_short!("rev_proof"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Staking(stake_event) => {
                let topic = match stake_event {
                    StakingEvent::Deposited { .. } => symbol_short!("stk_dep"),
                    StakingEvent::Withdrawn { .. } => symbol_short!("stk_wd"),
                    StakingEvent::Slashed { .. } => symbol_short!("stk_slash"),
                    StakingEvent::RewardsDistributed { .. } => symbol_short!("stk_rew"),
                    StakingEvent::DelegationCreated { .. } => symbol_short!("stk_del"),
                };
                env.events().publish((topic, emitter, timestamp), payload);
            }
            EventPayload::Presentation(pres_event) => {
                let topic = match pres_event {
                    PresentationEvent::Created { .. } => symbol_short!("pres_crt"),
                    PresentationEvent::Verified { .. } => symbol_short!("pres_vrf"),
                    PresentationEvent::TemplateRegistered { .. } => symbol_short!("pres_tpl"),
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
            EventPayload::Escrow(escrow) => match escrow {
                EscrowEvent::Deposited { .. } => EventType::EscrowDeposited,
                EscrowEvent::Released { .. } => EventType::EscrowReleased,
                EscrowEvent::Disputed { .. } => EventType::EscrowDisputed,
                EscrowEvent::Resolved { .. } => EventType::EscrowResolved,
                EscrowEvent::Refunded { .. } => EventType::EscrowRefunded,
            },
            EventPayload::Oracle(oracle) => match oracle {
                OracleEvent::Requested { .. } => EventType::OracleRequested,
                OracleEvent::Responded { .. } => EventType::OracleResponded,
                OracleEvent::FallbackUsed { .. } => EventType::OracleFallbackUsed,
            },
            EventPayload::Template(template) => match template {
                TemplateEvent::Registered { .. } => EventType::TemplateRegistered,
                TemplateEvent::VersionPublished { .. } => EventType::TemplateVersionPublished,
                TemplateEvent::Purchased { .. } => EventType::TemplatePurchased,
            },
            EventPayload::Threshold(threshold) => match threshold {
                ThresholdEvent::SignerSetUpdated { .. } => EventType::SignerSetUpdated,
                ThresholdEvent::Signed { .. } => EventType::ThresholdSigned,
            },
            EventPayload::DidResolver(resolver) => match resolver {
                DidResolverEvent::MethodRegistered { .. } => EventType::DidMethodRegistered,
                DidResolverEvent::Resolved { .. } => EventType::DidResolved,
            },
            EventPayload::DidResolution(resolver) => match resolver {
                DidResolutionEvent::Resolved { .. } => EventType::DidResolved,
                DidResolutionEvent::ResolutionCached { .. } => EventType::DidResolutionCached,
                DidResolutionEvent::PluginRegistered { .. } => EventType::DidResolverPluginRegistered,
            },
            EventPayload::Revocation(revocation) => match revocation {
                RevocationEvent::RevokedBatch { .. } => EventType::CredentialRevokedBatch,
                RevocationEvent::Reversed { .. } => EventType::RevocationReversed,
                RevocationEvent::ProofGenerated { .. } => EventType::RevocationProofGenerated,
            },
            EventPayload::Staking(staking) => match staking {
                StakingEvent::Deposited { .. } => EventType::StakeDeposited,
                StakingEvent::Withdrawn { .. } => EventType::StakeWithdrawn,
                StakingEvent::Slashed { .. } => EventType::StakeSlashed,
                StakingEvent::RewardsDistributed { .. } => EventType::RewardsDistributed,
                StakingEvent::DelegationCreated { .. } => EventType::DelegationCreated,
            },
            EventPayload::Presentation(presentation) => match presentation {
                PresentationEvent::Created { .. } => EventType::PresentationCreated,
                PresentationEvent::Verified { .. } => EventType::PresentationVerified,
                PresentationEvent::TemplateRegistered { .. } => {
                    EventType::PresentationTemplateRegistered
                }
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

    #[test]
    fn test_escrow_event_type_from_payload() {
        let env = Env::default();
        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let escrow_id = BytesN::from_array(&env, &[1u8; 32]);

        let deposited_event = EventPayload::Escrow(EscrowEvent::Deposited {
            escrow_id: escrow_id.clone(),
            depositor: depositor.clone(),
            beneficiary: beneficiary.clone(),
            amount: 1000,
            condition: 1,
            release_at: 99999,
            deposited_at: 12345,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&deposited_event),
            EventType::EscrowDeposited
        );

        let released_event = EventPayload::Escrow(EscrowEvent::Released {
            escrow_id: escrow_id.clone(),
            beneficiary: beneficiary.clone(),
            amount: 1000,
            released_at: 12346,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&released_event),
            EventType::EscrowReleased
        );

        let disputed_event = EventPayload::Escrow(EscrowEvent::Disputed {
            escrow_id: escrow_id.clone(),
            disputer: depositor.clone(),
            reason: String::from_str(&env, "not delivered"),
            disputed_at: 12347,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&disputed_event),
            EventType::EscrowDisputed
        );

        let resolved_event = EventPayload::Escrow(EscrowEvent::Resolved {
            escrow_id: escrow_id.clone(),
            arbiter: beneficiary.clone(),
            release_to_beneficiary: true,
            resolved_at: 12348,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&resolved_event),
            EventType::EscrowResolved
        );

        let refunded_event = EventPayload::Escrow(EscrowEvent::Refunded {
            escrow_id: escrow_id.clone(),
            depositor: depositor.clone(),
            amount: 1000,
            reason: 2,
            refunded_at: 12349,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&refunded_event),
            EventType::EscrowRefunded
        );
    }

    #[test]
    fn test_did_resolution_event_type_from_payload() {
        let env = Env::default();
        let did = String::from_str(&env, "did:stellar:GABC");
        let doc_hash = BytesN::from_array(&env, &[2u8; 32]);
        let plugin = Address::generate(&env);

        let resolved = EventPayload::DidResolution(DidResolutionEvent::Resolved {
            did: did.clone(),
            method: 0,
            document_hash: doc_hash.clone(),
            resolved_at: 1,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&resolved),
            EventType::DidResolved
        );

        let cached = EventPayload::DidResolution(DidResolutionEvent::ResolutionCached {
            did: did.clone(),
            document_hash: doc_hash.clone(),
            expires_at: 100,
            cached_at: 2,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&cached),
            EventType::DidResolutionCached
        );

        let registered = EventPayload::DidResolution(DidResolutionEvent::PluginRegistered {
            method: 1,
            plugin,
            registered_at: 3,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&registered),
            EventType::DidResolverPluginRegistered
        );
    }

    #[test]
    fn test_revocation_event_type_from_payload() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[3u8; 32]);
        let proof_hash = BytesN::from_array(&env, &[4u8; 32]);

        let batch = EventPayload::Revocation(RevocationEvent::RevokedBatch {
            issuer: issuer.clone(),
            count: 10,
            reason: 1,
            revoked_at: 1,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&batch),
            EventType::CredentialRevokedBatch
        );

        let reversed = EventPayload::Revocation(RevocationEvent::Reversed {
            credential_id: cred_id.clone(),
            issuer: issuer.clone(),
            reversed_at: 2,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&reversed),
            EventType::RevocationReversed
        );

        let proof = EventPayload::Revocation(RevocationEvent::ProofGenerated {
            credential_id: cred_id,
            proof_hash,
            generated_at: 3,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&proof),
            EventType::RevocationProofGenerated
        );
    }

    #[test]
    fn test_staking_event_type_from_payload() {
        let env = Env::default();
        let staker = Address::generate(&env);
        let delegatee = Address::generate(&env);

        let deposited = EventPayload::Staking(StakingEvent::Deposited {
            staker: staker.clone(),
            amount: 100,
            deposited_at: 1,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&deposited),
            EventType::StakeDeposited
        );

        let withdrawn = EventPayload::Staking(StakingEvent::Withdrawn {
            staker: staker.clone(),
            amount: 100,
            withdrawn_at: 2,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&withdrawn),
            EventType::StakeWithdrawn
        );

        let slashed = EventPayload::Staking(StakingEvent::Slashed {
            staker: staker.clone(),
            amount: 50,
            reason: 1,
            slashed_at: 3,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&slashed),
            EventType::StakeSlashed
        );

        let rewards = EventPayload::Staking(StakingEvent::RewardsDistributed {
            staker: staker.clone(),
            amount: 5,
            distributed_at: 4,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&rewards),
            EventType::RewardsDistributed
        );

        let delegation = EventPayload::Staking(StakingEvent::DelegationCreated {
            delegator: staker,
            delegatee,
            amount: 25,
            created_at: 5,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&delegation),
            EventType::DelegationCreated
        );
    }

    #[test]
    fn test_presentation_event_type_from_payload() {
        let env = Env::default();
        let holder = Address::generate(&env);
        let verifier = Address::generate(&env);
        let issuer = Address::generate(&env);
        let pres_id = BytesN::from_array(&env, &[5u8; 32]);
        let template_id = BytesN::from_array(&env, &[6u8; 32]);

        let created = EventPayload::Presentation(PresentationEvent::Created {
            presentation_id: pres_id.clone(),
            holder,
            credential_count: 2,
            created_at: 1,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&created),
            EventType::PresentationCreated
        );

        let verified = EventPayload::Presentation(PresentationEvent::Verified {
            presentation_id: pres_id,
            verifier,
            verified_at: 2,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&verified),
            EventType::PresentationVerified
        );

        let template = EventPayload::Presentation(PresentationEvent::TemplateRegistered {
            template_id,
            issuer,
            registered_at: 3,
        });
        assert_eq!(
            EventEmitter::event_type_from_payload(&template),
            EventType::PresentationTemplateRegistered
        );
    }
}
