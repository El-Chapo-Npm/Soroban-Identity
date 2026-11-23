//! Event emission for credential-manager contract
//!
//! This module integrates the shared-events system to emit events when
//! credentials are issued, revoked, or renewed. These events can be
//! subscribed to by other contracts (e.g., reputation contract) to
//! automatically react to credential lifecycle changes.

use shared_events::{CredentialEvent, EventEmitter, EventPayload, EventReceipt, EventType};
use soroban_sdk::{Address, BytesN, Env, String};

use crate::types::{RevocationReason, TransferRejectionReason};

/// Emit a credential issued event and notify all subscribers.
///
/// This is called when a new credential is issued to a subject.
/// The reputation contract can subscribe to this event to automatically
/// increase the subject's reputation score.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the issued credential
/// - `subject`: The address that received the credential
/// - `issuer`: The address that issued the credential
/// - `credential_type`: The type of credential (e.g., "Kyc", "Achievement")
/// - `issued_at`: Timestamp when the credential was issued
pub fn emit_credential_issued(
    env: &Env,
    credential_id: BytesN<32>,
    subject: Address,
    issuer: Address,
    credential_type: String,
    issued_at: u64,
) {
    let event = CredentialEvent::Issued {
        credential_id: credential_id.clone(),
        subject: subject.clone(),
        issuer: issuer.clone(),
        credential_type,
        issued_at,
    };

    let payload = EventPayload::Credential(event);
    
    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: In production, you would call notify_listeners here
    // to trigger cross-contract calls to subscribed contracts.
    // This requires implementing a callback mechanism where
    // listener contracts expose a handle_credential_issued() function.
    //
    // Example:
    // let subscribers = EventRegistry::get_subscribers(env, EventType::CredentialIssued);
    // for listener in subscribers.iter() {
    //     // Call listener.handle_credential_issued(...)
    // }
}

/// Emit a credential revoked event and notify all subscribers.
///
/// This is called when a credential is revoked by the issuer or subject.
/// The reputation contract can subscribe to this event to automatically
/// decrease the subject's reputation score or mark the credential as invalid.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the revoked credential
/// - `subject`: The address whose credential was revoked
/// - `issuer`: The address that originally issued the credential
/// - `reason`: The reason for revocation
/// - `revoked_at`: Timestamp when the credential was revoked
pub fn emit_credential_revoked(
    env: &Env,
    credential_id: BytesN<32>,
    subject: Address,
    issuer: Address,
    reason: RevocationReason,
    revoked_at: u64,
) {
    let event = CredentialEvent::Revoked {
        credential_id: credential_id.clone(),
        subject: subject.clone(),
        issuer: issuer.clone(),
        reason: reason as u32,
        revoked_at,
    };

    let payload = EventPayload::Credential(event);
    
    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: Notify subscribers (see comment in emit_credential_issued)
}

/// Emit a credential renewed event and notify all subscribers.
///
/// This is called when a credential is renewed with a new expiry date.
/// The reputation contract can subscribe to this event to track credential
/// maintenance and potentially adjust reputation scores based on renewal patterns.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the renewed credential
/// - `subject`: The address whose credential was renewed
/// - `issuer`: The address that issued/renewed the credential
/// - `old_expiry`: Previous expiry timestamp
/// - `new_expiry`: New expiry timestamp after renewal
/// - `renewed_at`: Timestamp when the renewal occurred
pub fn emit_credential_renewed(
    env: &Env,
    credential_id: BytesN<32>,
    subject: Address,
    issuer: Address,
    old_expiry: u64,
    new_expiry: u64,
    renewed_at: u64,
) {
    let event = CredentialEvent::Renewed {
        credential_id: credential_id.clone(),
        subject: subject.clone(),
        issuer: issuer.clone(),
        old_expiry,
        new_expiry,
        renewed_at,
    };

    let payload = EventPayload::Credential(event);
    
    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: Notify subscribers (see comment in emit_credential_issued)
}

/// Emit a credential transfer initiated event and notify all subscribers.
///
/// This is called when the current owner of a credential initiates a
/// transfer of ownership to another address. The transfer is not final
/// until the recipient accepts it.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the credential being transferred
/// - `from`: The current owner initiating the transfer
/// - `to`: The intended recipient of the credential
/// - `initiated_at`: Timestamp when the transfer was initiated
/// - `expires_at`: Timestamp after which the pending transfer expires
pub fn emit_transfer_initiated(
    env: &Env,
    credential_id: BytesN<32>,
    from: Address,
    to: Address,
    initiated_at: u64,
    expires_at: u64,
) {
    let event = CredentialEvent::TransferInitiated {
        credential_id: credential_id.clone(),
        from: from.clone(),
        to: to.clone(),
        initiated_at,
        expires_at,
    };

    let payload = EventPayload::Credential(event);

    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: Notify subscribers (see comment in emit_credential_issued)
}

/// Emit a credential transfer accepted event and notify all subscribers.
///
/// This is called when the intended recipient accepts a pending transfer,
/// completing the ownership change.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the transferred credential
/// - `from`: The previous owner of the credential
/// - `to`: The new owner of the credential
/// - `accepted_at`: Timestamp when the transfer was accepted
pub fn emit_transfer_accepted(
    env: &Env,
    credential_id: BytesN<32>,
    from: Address,
    to: Address,
    accepted_at: u64,
) {
    let event = CredentialEvent::TransferAccepted {
        credential_id: credential_id.clone(),
        from: from.clone(),
        to: to.clone(),
        accepted_at,
    };

    let payload = EventPayload::Credential(event);

    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: Notify subscribers (see comment in emit_credential_issued)
}

/// Emit a credential transfer rejected event and notify all subscribers.
///
/// This is called when the intended recipient rejects a pending transfer,
/// or when the transfer is cancelled/expired.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the credential
/// - `from`: The current owner who initiated the transfer
/// - `to`: The intended recipient who rejected the transfer
/// - `reason`: The reason the transfer was rejected
/// - `rejected_at`: Timestamp when the transfer was rejected
pub fn emit_transfer_rejected(
    env: &Env,
    credential_id: BytesN<32>,
    from: Address,
    to: Address,
    reason: TransferRejectionReason,
    rejected_at: u64,
) {
    let event = CredentialEvent::TransferRejected {
        credential_id: credential_id.clone(),
        from: from.clone(),
        to: to.clone(),
        reason: reason as u32,
        rejected_at,
    };

    let payload = EventPayload::Credential(event);

    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: Notify subscribers (see comment in emit_credential_issued)
}

/// Emit a credential transfer completed event and notify all subscribers.
///
/// This is called once a transfer has fully settled, including any fee
/// handling, so indexers can record the final ownership state.
///
/// # Parameters
/// - `credential_id`: The unique identifier of the transferred credential
/// - `from`: The previous owner of the credential
/// - `to`: The new owner of the credential
/// - `fee`: The transfer fee charged, if any
/// - `completed_at`: Timestamp when the transfer completed
pub fn emit_transfer_completed(
    env: &Env,
    credential_id: BytesN<32>,
    from: Address,
    to: Address,
    fee: i128,
    completed_at: u64,
) {
    let event = CredentialEvent::TransferCompleted {
        credential_id: credential_id.clone(),
        from: from.clone(),
        to: to.clone(),
        fee,
        completed_at,
    };

    let payload = EventPayload::Credential(event);

    // Emit to Soroban event stream for indexers
    EventEmitter::emit(env, payload);

    // TODO: Notify subscribers (see comment in emit_credential_issued)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{symbol_short, Env};

    #[test]
    fn test_emit_credential_issued() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let issuer = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[1u8; 32]);

        emit_credential_issued(
            &env,
            cred_id,
            subject,
            issuer,
            String::from_str(&env, "Kyc"),
            12345,
        );

        // Check that event was emitted (can be verified via env.events())
        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_credential_revoked() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let issuer = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[2u8; 32]);

        emit_credential_revoked(
            &env,
            cred_id,
            subject,
            issuer,
            RevocationReason::IssuerRevoked,
            12345,
        );

        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_merkle_root_updated() {
        let env = Env::default();
        let batch_id = BytesN::from_array(&env, &[4u8; 32]);
        let merkle_root = BytesN::from_array(&env, &[5u8; 32]);

        emit_merkle_root_updated(&env, batch_id, merkle_root, 42);

        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_credential_renewed() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let issuer = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[3u8; 32]);

        emit_credential_renewed(&env, cred_id, subject, issuer, 10000, 20000, 12345);

        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_transfer_initiated() {
        let env = Env::default();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[4u8; 32]);

        emit_transfer_initiated(&env, cred_id, from, to, 12345, 99999);

        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_transfer_accepted() {
        let env = Env::default();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[5u8; 32]);

        emit_transfer_accepted(&env, cred_id, from, to, 12345);

        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_transfer_rejected() {
        let env = Env::default();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[6u8; 32]);

        emit_transfer_rejected(
            &env,
            cred_id,
            from,
            to,
            TransferRejectionReason::RecipientRejected,
            12345,
        );

        let events = env.events().all();
        assert!(events.len() > 0);
    }

    #[test]
    fn test_emit_transfer_completed() {
        let env = Env::default();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[7u8; 32]);

        emit_transfer_completed(&env, cred_id, from, to, 100, 12345);

        let events = env.events().all();
        assert!(events.len() > 0);
    }
}
