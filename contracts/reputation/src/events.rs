//! Event handling for reputation contract
//!
//! This module implements the event listener pattern to react to events
//! from other contracts in the ecosystem. When credentials are issued or
//! revoked in the credential-manager contract, the reputation contract
//! can automatically update reputation scores.

use shared_events::{CredentialEvent, EventPayload, EventRegistry, EventType};
use soroban_sdk::{Address, BytesN, Env, String};

use crate::{ContractError, Reputation};

/// Configuration for automatic reputation adjustments based on credential events.
pub struct ReputationEventConfig {
    /// Score to add when a credential is issued (e.g., +10 for KYC credential)
    pub credential_issued_score: i32,
    /// Score to subtract when a credential is revoked (e.g., -5 for revocation)
    pub credential_revoked_penalty: i32,
}

impl ReputationEventConfig {
    /// Default configuration for credential event scoring.
    pub const fn default() -> Self {
        Self {
            credential_issued_score: 10,
            credential_revoked_penalty: -5,
        }
    }

    /// KYC credentials get higher reputation boost.
    pub const fn kyc() -> Self {
        Self {
            credential_issued_score: 20,
            credential_revoked_penalty: -10,
        }
    }

    /// Achievement credentials get moderate reputation boost.
    pub const fn achievement() -> Self {
        Self {
            credential_issued_score: 15,
            credential_revoked_penalty: -7,
        }
    }
}

/// Handle a credential issued event by automatically updating the subject's reputation.
///
/// This function is called when the reputation contract receives a notification
/// that a credential has been issued to a subject. It automatically increases
/// the subject's reputation score based on the credential type.
///
/// # Parameters
/// - `env`: The Soroban environment
/// - `reporter`: The address reporting the score (typically the credential issuer)
/// - `credential_id`: The ID of the issued credential
/// - `subject`: The address that received the credential
/// - `issuer`: The address that issued the credential
/// - `credential_type`: The type of credential (e.g., "Kyc", "Achievement")
/// - `issued_at`: Timestamp when credential was issued
///
/// # Returns
/// - `Ok(())` if reputation was successfully updated
/// - `Err(ContractError)` if update failed (e.g., reporter not authorized)
pub fn handle_credential_issued(
    env: Env,
    reporter: Address,
    credential_id: BytesN<32>,
    subject: Address,
    issuer: Address,
    credential_type: String,
    issued_at: u64,
) -> Result<(), ContractError> {
    // Determine score based on credential type
    let config = if credential_type == String::from_str(&env, "Kyc") {
        ReputationEventConfig::kyc()
    } else if credential_type == String::from_str(&env, "Achievement") {
        ReputationEventConfig::achievement()
    } else {
        ReputationEventConfig::default()
    };

    // Build reason string for audit trail
    let reason = String::from_str(
        &env,
        &format!(
            "Auto: Credential {} issued",
            credential_type.to_string()
        ),
    );

    // Submit score automatically
    // Note: In production, you might want additional authorization checks
    // to ensure the reporter is the credential issuer
    Reputation::submit_score(
        env.clone(),
        reporter,
        subject.clone(),
        config.credential_issued_score,
        reason,
    )?;

    // Emit event for this reputation update
    env.events().publish(
        (
            soroban_sdk::symbol_short!("rep_auto"),
            subject,
            credential_id,
        ),
        config.credential_issued_score,
    );

    Ok(())
}

/// Handle a credential revoked event by penalizing the subject's reputation.
///
/// This function is called when the reputation contract receives a notification
/// that a credential has been revoked. It automatically decreases the subject's
/// reputation score.
///
/// # Parameters
/// - `env`: The Soroban environment
/// - `reporter`: The address reporting the penalty (typically the credential issuer)
/// - `credential_id`: The ID of the revoked credential
/// - `subject`: The address whose credential was revoked
/// - `reason_code`: The revocation reason code
/// - `revoked_at`: Timestamp when credential was revoked
///
/// # Returns
/// - `Ok(())` if reputation was successfully penalized
/// - `Err(ContractError)` if update failed
pub fn handle_credential_revoked(
    env: Env,
    reporter: Address,
    credential_id: BytesN<32>,
    subject: Address,
    reason_code: u32,
    revoked_at: u64,
) -> Result<(), ContractError> {
    let config = ReputationEventConfig::default();

    // Build reason string including revocation reason
    let reason = String::from_str(
        &env,
        &format!("Auto: Credential revoked (reason: {})", reason_code),
    );

    // Submit negative score
    Reputation::submit_score(
        env.clone(),
        reporter,
        subject.clone(),
        config.credential_revoked_penalty,
        reason,
    )?;

    // Emit event for this reputation penalty
    env.events().publish(
        (
            soroban_sdk::symbol_short!("rep_penalty"),
            subject,
            credential_id,
        ),
        config.credential_revoked_penalty,
    );

    Ok(())
}

/// Subscribe the reputation contract to receive credential events.
///
/// This should be called during reputation contract initialization or
/// by an admin to enable automatic reputation updates based on credentials.
///
/// # Parameters
/// - `env`: The Soroban environment
/// - `event_registry`: Address of the EventRegistry contract
///
/// # Returns
/// - `Ok(())` if subscription was successful
/// - `Err(ContractError)` if subscription failed
pub fn subscribe_to_credential_events(
    env: &Env,
    event_registry: Address,
) -> Result<(), ContractError> {
    let reputation_contract = env.current_contract_address();

    // Subscribe to credential issued events
    let registry_client = shared_events::EventRegistryClient::new(env, &event_registry);
    
    let subscribed_issued = registry_client.subscribe(
        &EventType::CredentialIssued,
        &reputation_contract,
    );

    // Subscribe to credential revoked events
    let subscribed_revoked = registry_client.subscribe(
        &EventType::CredentialRevoked,
        &reputation_contract,
    );

    if !subscribed_issued || !subscribed_revoked {
        // Already subscribed is not an error
        return Ok(());
    }

    env.events().publish(
        (soroban_sdk::symbol_short!("sub_cred"),),
        (reputation_contract,),
    );

    Ok(())
}

/// Unsubscribe the reputation contract from credential events.
///
/// This can be called by an admin to disable automatic reputation updates.
///
/// # Parameters
/// - `env`: The Soroban environment
/// - `event_registry`: Address of the EventRegistry contract
pub fn unsubscribe_from_credential_events(
    env: &Env,
    event_registry: Address,
) -> Result<(), ContractError> {
    let reputation_contract = env.current_contract_address();

    let registry_client = shared_events::EventRegistryClient::new(env, &event_registry);
    
    registry_client.unsubscribe(
        &EventType::CredentialIssued,
        &reputation_contract,
    );

    registry_client.unsubscribe(
        &EventType::CredentialRevoked,
        &reputation_contract,
    );

    env.events().publish(
        (soroban_sdk::symbol_short!("unsub_cred"),),
        (reputation_contract,),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::{symbol_short, Env};

    #[test]
    fn test_reputation_event_config() {
        let default = ReputationEventConfig::default();
        assert_eq!(default.credential_issued_score, 10);
        assert_eq!(default.credential_revoked_penalty, -5);

        let kyc = ReputationEventConfig::kyc();
        assert_eq!(kyc.credential_issued_score, 20);
        assert_eq!(kyc.credential_revoked_penalty, -10);

        let achievement = ReputationEventConfig::achievement();
        assert_eq!(achievement.credential_issued_score, 15);
        assert_eq!(achievement.credential_revoked_penalty, -7);
    }

    // Note: Full integration tests for handle_credential_issued and
    // handle_credential_revoked require a running reputation contract
    // instance and are better placed in integration tests.
}
