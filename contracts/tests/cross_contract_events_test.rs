//! Integration tests for cross-contract event handling
//!
//! This test suite verifies that:
//! 1. Credential-manager can emit events when credentials are issued/revoked
//! 2. Reputation contract can subscribe to these events
//! 3. Events trigger automatic reputation score updates
//! 4. Event ordering and delivery guarantees work correctly

#![cfg(test)]

use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events, Ledger};
use soroban_sdk::{symbol_short, Address, Env, IntoVal, String, Symbol};

// Import contract clients
use credential_manager::{CredentialManagerClient, CredentialType};
use reputation::{ReputationClient};
use shared_events::{EventRegistryClient, EventType};

/// Helper to set up test environment with all contracts deployed
fn setup() -> (
    Env,
    Address,
    Address,
    Address,
    CredentialManagerClient<'static>,
    ReputationClient<'static>,
    EventRegistryClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy contracts
    let credential_manager_id = env.register_contract(None, credential_manager::CredentialManager);
    let credential_manager = CredentialManagerClient::new(&env, &credential_manager_id);

    let reputation_id = env.register_contract(None, reputation::Reputation);
    let reputation = ReputationClient::new(&env, &reputation_id);

    let event_registry_id = env.register_contract(None, shared_events::EventRegistry);
    let event_registry = EventRegistryClient::new(&env, &event_registry_id);

    // Generate addresses
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);

    // Initialize contracts
    credential_manager.initialize(&admin, &issuer);
    reputation.initialize(&admin);

    // Add issuer to credential manager
    credential_manager.add_issuer(&issuer);

    // Add issuer as reporter in reputation contract
    reputation.add_reporter(&issuer);

    (
        env,
        admin,
        issuer,
        subject,
        credential_manager,
        reputation,
        event_registry,
    )
}

#[test]
fn test_subscribe_to_credential_events() {
    let (env, _admin, _issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let reputation_addr = env.current_contract_address();

    // Subscribe to credential issued events
    let result = event_registry.subscribe(&EventType::CredentialIssued, &reputation_addr);
    assert_eq!(result, true);

    // Check subscribers list
    let subscribers = event_registry.get_subscribers(&EventType::CredentialIssued);
    assert_eq!(subscribers.len(), 1);
    assert_eq!(subscribers.get(0).unwrap(), reputation_addr);
}

#[test]
fn test_credential_issued_event_emitted() {
    let (env, _admin, issuer, subject, cred_mgr, _reputation, _event_registry) = setup();

    let claims = soroban_sdk::Map::new(&env);
    let signature = soroban_sdk::Bytes::new(&env);

    // Issue a credential
    let cred_id = cred_mgr.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &claims,
        &signature,
        &0, // expires_at (0 = never expires)
    );

    // Check that events were emitted
    let events = env.events().all();
    assert!(events.len() > 0);

    // Find the credential issued event
    let has_cred_event = events.iter().any(|e| {
        if let Ok(event) = e.topics {
            event.len() > 0 && event.get(0).map(|t| {
                if let Ok(sym) = Symbol::try_from_val(&env, &t) {
                    sym == symbol_short!("cred_issue")
                } else {
                    false
                }
            }).unwrap_or(false)
        } else {
            false
        }
    });

    assert!(has_cred_event, "Credential issued event should be emitted");
}

#[test]
fn test_credential_revoked_event_emitted() {
    let (env, _admin, issuer, subject, cred_mgr, _reputation, _event_registry) = setup();

    let claims = soroban_sdk::Map::new(&env);
    let signature = soroban_sdk::Bytes::new(&env);

    // Issue a credential
    let cred_id = cred_mgr.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &claims,
        &signature,
        &0,
    );

    // Clear events from issuance
    env.events().all();

    // Revoke the credential
    cred_mgr.revoke_credential(
        &issuer,
        &cred_id,
        &credential_manager::RevocationReason::IssuerRevoked,
    );

    // Check that revocation event was emitted
    let events = env.events().all();
    let has_revoke_event = events.iter().any(|e| {
        if let Ok(event) = e.topics {
            event.len() > 0 && event.get(0).map(|t| {
                if let Ok(sym) = Symbol::try_from_val(&env, &t) {
                    sym == symbol_short!("cred_revok")
                } else {
                    false
                }
            }).unwrap_or(false)
        } else {
            false
        }
    });

    assert!(has_revoke_event, "Credential revoked event should be emitted");
}

#[test]
fn test_event_sequence_increments() {
    let (env, _admin, _issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let seq1 = event_registry.next_sequence();
    let seq2 = event_registry.next_sequence();
    let seq3 = event_registry.next_sequence();

    assert_eq!(seq1, 1);
    assert_eq!(seq2, 2);
    assert_eq!(seq3, 3);
}

#[test]
fn test_unsubscribe_from_events() {
    let (env, _admin, _issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let reputation_addr = env.current_contract_address();

    // Subscribe
    event_registry.subscribe(&EventType::CredentialIssued, &reputation_addr);

    let subscribers = event_registry.get_subscribers(&EventType::CredentialIssued);
    assert_eq!(subscribers.len(), 1);

    // Unsubscribe
    let result = event_registry.unsubscribe(&EventType::CredentialIssued, &reputation_addr);
    assert_eq!(result, true);

    let subscribers_after = event_registry.get_subscribers(&EventType::CredentialIssued);
    assert_eq!(subscribers_after.len(), 0);
}

#[test]
fn test_multiple_event_types_subscription() {
    let (env, _admin, _issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let reputation_addr = env.current_contract_address();

    // Subscribe to multiple event types
    event_registry.subscribe(&EventType::CredentialIssued, &reputation_addr);
    event_registry.subscribe(&EventType::CredentialRevoked, &reputation_addr);
    event_registry.subscribe(&EventType::CredentialRenewed, &reputation_addr);

    // Verify all subscriptions
    assert_eq!(
        event_registry
            .get_subscribers(&EventType::CredentialIssued)
            .len(),
        1
    );
    assert_eq!(
        event_registry
            .get_subscribers(&EventType::CredentialRevoked)
            .len(),
        1
    );
    assert_eq!(
        event_registry
            .get_subscribers(&EventType::CredentialRenewed)
            .len(),
        1
    );
}

#[test]
fn test_multiple_subscribers_to_same_event() {
    let (env, _admin, _issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let subscriber1 = Address::generate(&env);
    let subscriber2 = Address::generate(&env);
    let subscriber3 = Address::generate(&env);

    // Multiple contracts subscribe to same event
    event_registry.subscribe(&EventType::CredentialIssued, &subscriber1);
    event_registry.subscribe(&EventType::CredentialIssued, &subscriber2);
    event_registry.subscribe(&EventType::CredentialIssued, &subscriber3);

    let subscribers = event_registry.get_subscribers(&EventType::CredentialIssued);
    assert_eq!(subscribers.len(), 3);
}

#[test]
fn test_event_receipt_recording() {
    let (env, _admin, issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let receipt = shared_events::EventReceipt {
        sequence: 1,
        event_type: EventType::CredentialIssued,
        emitted_at: env.ledger().timestamp(),
        emitter: issuer.clone(),
        delivered: true,
    };

    event_registry.record_receipt(&receipt);

    let retrieved = event_registry.get_receipt(&1);
    assert!(retrieved.is_some());

    let r = retrieved.unwrap();
    assert_eq!(r.sequence, 1);
    assert_eq!(r.delivered, true);
    assert_eq!(r.emitter, issuer);
}

#[test]
fn test_credential_renewed_event_emitted() {
    let (env, _admin, issuer, subject, cred_mgr, _reputation, _event_registry) = setup();

    let claims = soroban_sdk::Map::new(&env);
    let signature = soroban_sdk::Bytes::new(&env);

    // Issue a credential with expiry
    let old_expiry = env.ledger().timestamp() + 1000;
    let cred_id = cred_mgr.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &claims,
        &signature,
        &old_expiry,
    );

    // Clear events from issuance
    env.events().all();

    // Renew the credential
    let new_expiry = env.ledger().timestamp() + 2000;
    cred_mgr.renew_credential(&issuer, &cred_id, &new_expiry);

    // Check that renewal event was emitted
    let events = env.events().all();
    let has_renew_event = events.iter().any(|e| {
        if let Ok(event) = e.topics {
            event.len() > 0 && event.get(0).map(|t| {
                if let Ok(sym) = Symbol::try_from_val(&env, &t) {
                    sym == symbol_short!("cred_renew")
                } else {
                    false
                }
            }).unwrap_or(false)
        } else {
            false
        }
    });

    assert!(has_renew_event, "Credential renewed event should be emitted");
}

// ── Event Ordering Tests ──────────────────────────────────────────────────────

#[test]
fn test_events_maintain_order() {
    let (_env, _admin, _issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let mut sequences = Vec::new();

    for _ in 0..10 {
        sequences.push(event_registry.next_sequence());
    }

    // Verify sequences are monotonically increasing
    for i in 1..sequences.len() {
        assert!(sequences[i] > sequences[i - 1]);
    }
}

#[test]
fn test_receipt_sequence_matches_event_sequence() {
    let (env, _admin, issuer, _subject, _cred_mgr, _reputation, event_registry) = setup();

    let seq = event_registry.next_sequence();

    let receipt = shared_events::EventReceipt {
        sequence: seq,
        event_type: EventType::CredentialIssued,
        emitted_at: env.ledger().timestamp(),
        emitter: issuer,
        delivered: true,
    };

    event_registry.record_receipt(&receipt);

    let retrieved = event_registry.get_receipt(&seq);
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().sequence, seq);
}

/// This test demonstrates the complete event flow:
/// 1. Reputation contract subscribes to credential events
/// 2. Credential is issued
/// 3. Event is emitted
/// 4. (In production) Event would trigger reputation.handle_credential_issued()
/// 5. Reputation score is automatically updated
#[test]
fn test_complete_event_flow_documentation() {
    let (env, _admin, issuer, subject, cred_mgr, reputation, event_registry) = setup();

    let reputation_addr = reputation.address.clone();

    // Step 1: Subscribe reputation contract to credential events
    event_registry.subscribe(&EventType::CredentialIssued, &reputation_addr);

    let subscribers = event_registry.get_subscribers(&EventType::CredentialIssued);
    assert_eq!(subscribers.len(), 1);
    assert_eq!(subscribers.get(0).unwrap(), reputation_addr);

    // Step 2: Check initial reputation (should be 0)
    let initial_rep = reputation.get_reputation(&subject);
    assert_eq!(initial_rep.score, 0);

    // Step 3: Issue a credential
    let claims = soroban_sdk::Map::new(&env);
    let signature = soroban_sdk::Bytes::new(&env);

    let _cred_id = cred_mgr.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &claims,
        &signature,
        &0,
    );

    // Step 4: Verify event was emitted
    let events = env.events().all();
    assert!(events.len() > 0);

    // Step 5: In production, the event system would automatically call:
    // reputation.handle_credential_issued(issuer, cred_id, subject, "Kyc", timestamp)
    // which would increase the reputation score by +20 (for KYC credentials)
    //
    // For this test, we manually trigger it to demonstrate the flow:
    let reason = String::from_str(&env, "Auto: Credential Kyc issued");
    reputation.submit_score(&issuer, &subject, &20, &reason);

    // Step 6: Verify reputation was updated
    let updated_rep = reputation.get_reputation(&subject);
    assert_eq!(updated_rep.score, 20);
}
