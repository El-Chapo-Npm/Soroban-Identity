//! Temporary credential suspension (#856).
//!
//! A suspended credential fails every verification path, exactly like a
//! revoked one, but the issuer can lift the suspension again with
//! [`CredentialManager::reactivate_credential`]. Revocation stays permanent.
//!
//! Suspension state lives in its own storage entry, keyed by credential ID,
//! instead of a new field on [`Credential`]. Adding a field to the stored
//! `Credential` struct would make every credential already on-chain fail to
//! decode, so a side record keeps the change backwards compatible: an entry
//! exists exactly while the credential is suspended.

use soroban_sdk::{contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol};

use crate::{ContractError, Credential, CredentialManager, CredentialManagerClient};

/// Storage key prefix: `(SUSPENDED, credential_id) -> SuspensionRecord`.
pub(crate) const SUSPENDED: Symbol = symbol_short!("SUSPEND");

/// Why a credential was suspended. Stored as a `u32` on-chain.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SuspensionReason {
    /// No reason given.
    Unspecified = 0,
    /// The credential is on hold while the issuer investigates it.
    UnderInvestigation = 1,
    /// The subject's key may be compromised; pending confirmation.
    SuspectedKeyCompromise = 2,
    /// A condition of the credential (payment, renewal paperwork, ...) is
    /// temporarily unmet.
    ConditionUnmet = 3,
    /// The subject asked for the credential to be put on hold.
    SubjectRequest = 4,
    /// The issuer paused the credential for administrative reasons.
    Administrative = 5,
}

/// Suspension metadata, present only while a credential is suspended.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SuspensionRecord {
    pub credential_id: BytesN<32>,
    pub reason: SuspensionReason,
    pub suspended_by: Address,
    pub suspended_at: u64,
}

/// Lifecycle status of a credential, as reported by
/// [`CredentialManager::get_credential_status`].
///
/// When several apply, the most severe wins: `Revoked` over `Suspended` over
/// `NotYetActive` over `Expired`.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum CredentialStatus {
    Active = 0,
    Suspended = 1,
    Revoked = 2,
    Expired = 3,
    NotYetActive = 4,
}

fn suspension_key(credential_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (SUSPENDED, credential_id.clone())
}

/// Whether `credential_id` is currently suspended. Used by every verification
/// path in the contract.
pub(crate) fn is_suspended(env: &Env, credential_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&suspension_key(credential_id))
}

#[contractimpl]
impl CredentialManager {
    /// Temporarily suspend a credential. Only the original issuer may suspend.
    ///
    /// While suspended the credential fails [`Self::verify_credential`],
    /// batch and delegated verification, and invalidates every credential
    /// that lists it as a prerequisite. Emits a `suspended` event.
    ///
    /// # Errors
    /// - `CredentialNotFound`  — credential ID does not exist
    /// - `UnauthorizedIssuer`  — caller is not the original issuer
    /// - `CredentialRevoked`   — revoked credentials cannot be suspended
    /// - `CredentialSuspended` — the credential is already suspended
    /// - `ContractPaused`      — the contract is paused
    pub fn suspend_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        reason: SuspensionReason,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let cred = Self::load_issued_credential(&env, &issuer, &credential_id)?;
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        if is_suspended(&env, &credential_id) {
            return Err(ContractError::CredentialSuspended);
        }

        let suspended_at = env.ledger().timestamp();
        let key = suspension_key(&credential_id);
        env.storage().persistent().set(
            &key,
            &SuspensionRecord {
                credential_id: credential_id.clone(),
                reason,
                suspended_by: issuer.clone(),
                suspended_at,
            },
        );
        // Use the maximum TTL rather than the credential's: a later renewal
        // extends the credential, and the suspension must not be archived
        // before it.
        env.storage()
            .persistent()
            .extend_ttl(&key, crate::TTL_MAX, crate::TTL_MAX);

        env.events().publish(
            (crate::CRED, symbol_short!("suspended")),
            (
                crate::EVENT_VERSION,
                credential_id,
                issuer,
                reason,
                suspended_at,
            ),
        );
        Ok(())
    }

    /// Lift a suspension so the credential verifies again. Only the original
    /// issuer may reactivate. Emits an `unsuspend` event.
    ///
    /// Reactivation does not extend the expiry: a credential that expired
    /// while suspended is still expired afterwards.
    ///
    /// # Errors
    /// - `CredentialNotFound`     — credential ID does not exist
    /// - `UnauthorizedIssuer`     — caller is not the original issuer
    /// - `CredentialRevoked`      — the credential was revoked in the meantime
    /// - `CredentialNotSuspended` — the credential is not suspended
    /// - `ContractPaused`         — the contract is paused
    pub fn reactivate_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let cred = Self::load_issued_credential(&env, &issuer, &credential_id)?;
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        if !is_suspended(&env, &credential_id) {
            return Err(ContractError::CredentialNotSuspended);
        }

        env.storage()
            .persistent()
            .remove(&suspension_key(&credential_id));

        let reactivated_at = env.ledger().timestamp();
        env.events().publish(
            (crate::CRED, symbol_short!("unsuspend")),
            (crate::EVENT_VERSION, credential_id, issuer, reactivated_at),
        );
        Ok(())
    }

    /// The active suspension for `credential_id`, or `None` if it is not
    /// suspended.
    pub fn get_suspension(env: Env, credential_id: BytesN<32>) -> Option<SuspensionRecord> {
        env.storage()
            .persistent()
            .get(&suspension_key(&credential_id))
    }

    /// Whether `credential_id` is currently suspended.
    pub fn is_credential_suspended(env: Env, credential_id: BytesN<32>) -> bool {
        is_suspended(&env, &credential_id)
    }

    /// The lifecycle status of a credential. See [`CredentialStatus`] for how
    /// overlapping states are ranked.
    ///
    /// # Errors
    /// - `CredentialNotFound` — credential ID does not exist
    pub fn get_credential_status(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<CredentialStatus, ContractError> {
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&Self::cred_key(&credential_id))
            .ok_or(ContractError::CredentialNotFound)?;

        if cred.revoked {
            return Ok(CredentialStatus::Revoked);
        }
        if is_suspended(&env, &credential_id) {
            return Ok(CredentialStatus::Suspended);
        }
        let now = env.ledger().timestamp();
        if cred.activation_time != 0 && now < cred.activation_time {
            return Ok(CredentialStatus::NotYetActive);
        }
        // Same boundary as `verify_credential`: still valid at `expires_at`.
        if cred.expires_at > 0 && now > cred.expires_at {
            return Ok(CredentialStatus::Expired);
        }
        Ok(CredentialStatus::Active)
    }
}

impl CredentialManager {
    /// Load a credential and check that `issuer` issued it.
    fn load_issued_credential(
        env: &Env,
        issuer: &Address,
        credential_id: &BytesN<32>,
    ) -> Result<Credential, ContractError> {
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&Self::cred_key(credential_id))
            .ok_or(ContractError::CredentialNotFound)?;
        if &cred.issuer != issuer {
            return Err(ContractError::UnauthorizedIssuer);
        }
        Ok(cred)
    }
}

#[cfg(test)]
mod tests {
    use super::{CredentialStatus, SuspensionReason};
    use crate::{
        BatchVerifyResult, ContractError, CredentialManager, CredentialManagerClient,
        CredentialType, RevocationReason,
    };
    use soroban_sdk::{
        contract, contractimpl, symbol_short,
        testutils::{Address as _, Events as _, Ledger as _},
        vec, Address, Bytes, BytesN, Env, IntoVal, Map,
    };

    #[contract]
    struct MockIdentityRegistry;
    #[contractimpl]
    impl MockIdentityRegistry {
        pub fn has_active_did(_env: Env, _controller: Address) -> bool {
            true
        }
    }

    struct Setup {
        env: Env,
        issuer: Address,
        client: CredentialManagerClient<'static>,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_000);
        let registry_id = env.register_contract(None, MockIdentityRegistry);
        let client =
            CredentialManagerClient::new(&env, &env.register_contract(None, CredentialManager));
        client.initialize(&Address::generate(&env), &registry_id);
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);
        Setup {
            env,
            issuer,
            client,
        }
    }

    fn issue(s: &Setup, credential_type: CredentialType, expires_at: u64) -> BytesN<32> {
        s.client.issue_credential(
            &s.issuer,
            &Address::generate(&s.env),
            &credential_type,
            &Map::new(&s.env),
            &BytesN::from_array(&s.env, &[1u8; 32]),
            &Bytes::from_array(&s.env, &[0u8; 64]),
            &expires_at,
            &0u64,
            &None,
            &None,
        )
    }

    #[test]
    fn test_suspended_credential_fails_verification() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client.verify_credential(&id);

        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::UnderInvestigation);

        assert_eq!(
            s.client.try_verify_credential(&id),
            Err(Ok(ContractError::CredentialSuspended))
        );
        assert!(s.client.is_credential_suspended(&id));
        assert_eq!(
            s.client.get_credential_status(&id),
            CredentialStatus::Suspended
        );
    }

    #[test]
    fn test_suspension_records_reason_issuer_and_time() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        assert_eq!(s.client.get_suspension(&id), None);

        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::ConditionUnmet);

        let record = s.client.get_suspension(&id).unwrap();
        assert_eq!(record.credential_id, id);
        assert_eq!(record.reason, SuspensionReason::ConditionUnmet);
        assert_eq!(record.suspended_by, s.issuer);
        assert_eq!(record.suspended_at, 1_000);
    }

    #[test]
    fn test_reactivate_restores_verification() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified);

        s.client.reactivate_credential(&s.issuer, &id);

        s.client.verify_credential(&id);
        assert!(!s.client.is_credential_suspended(&id));
        assert_eq!(s.client.get_suspension(&id), None);
        assert_eq!(
            s.client.get_credential_status(&id),
            CredentialStatus::Active
        );
    }

    #[test]
    fn test_credential_can_be_suspended_again_after_reactivation() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified);
        s.client.reactivate_credential(&s.issuer, &id);

        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::SubjectRequest);

        assert_eq!(
            s.client.get_suspension(&id).unwrap().reason,
            SuspensionReason::SubjectRequest
        );
    }

    #[test]
    fn test_suspend_twice_rejected() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified);

        assert_eq!(
            s.client
                .try_suspend_credential(&s.issuer, &id, &SuspensionReason::Administrative),
            Err(Ok(ContractError::CredentialSuspended))
        );
        // The original record is untouched.
        assert_eq!(
            s.client.get_suspension(&id).unwrap().reason,
            SuspensionReason::Unspecified
        );
    }

    #[test]
    fn test_reactivate_unsuspended_rejected() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        assert_eq!(
            s.client.try_reactivate_credential(&s.issuer, &id),
            Err(Ok(ContractError::CredentialNotSuspended))
        );
    }

    #[test]
    fn test_only_issuer_can_suspend_or_reactivate() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        let other = Address::generate(&s.env);
        s.client.add_issuer(&other);

        assert_eq!(
            s.client
                .try_suspend_credential(&other, &id, &SuspensionReason::Unspecified),
            Err(Ok(ContractError::UnauthorizedIssuer))
        );

        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified);
        assert_eq!(
            s.client.try_reactivate_credential(&other, &id),
            Err(Ok(ContractError::UnauthorizedIssuer))
        );
        assert!(s.client.is_credential_suspended(&id));
    }

    #[test]
    fn test_unknown_credential_rejected() {
        let s = setup();
        let missing = BytesN::from_array(&s.env, &[9u8; 32]);
        assert_eq!(
            s.client
                .try_suspend_credential(&s.issuer, &missing, &SuspensionReason::Unspecified),
            Err(Ok(ContractError::CredentialNotFound))
        );
        assert_eq!(
            s.client.try_reactivate_credential(&s.issuer, &missing),
            Err(Ok(ContractError::CredentialNotFound))
        );
        assert_eq!(
            s.client.try_get_credential_status(&missing),
            Err(Ok(ContractError::CredentialNotFound))
        );
    }

    #[test]
    fn test_revoked_credential_cannot_be_suspended() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client
            .revoke_credential(&s.issuer, &id, &RevocationReason::Superseded);

        assert_eq!(
            s.client
                .try_suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified),
            Err(Ok(ContractError::CredentialRevoked))
        );
    }

    #[test]
    fn test_revocation_while_suspended_is_permanent() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::SuspectedKeyCompromise);

        // Suspension does not block revocation; revocation wins.
        s.client
            .revoke_credential(&s.issuer, &id, &RevocationReason::KeyCompromise);

        assert_eq!(
            s.client.get_credential_status(&id),
            CredentialStatus::Revoked
        );
        assert_eq!(
            s.client.try_reactivate_credential(&s.issuer, &id),
            Err(Ok(ContractError::CredentialRevoked))
        );
        assert_eq!(
            s.client.try_verify_credential(&id),
            Err(Ok(ContractError::CredentialRevoked))
        );
    }

    #[test]
    fn test_reactivation_does_not_revive_expired_credential() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 2_000);
        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified);

        s.env.ledger().with_mut(|li| li.timestamp = 2_001);
        s.client.reactivate_credential(&s.issuer, &id);

        assert_eq!(
            s.client.get_credential_status(&id),
            CredentialStatus::Expired
        );
        assert_eq!(
            s.client.try_verify_credential(&id),
            Err(Ok(ContractError::CredentialExpired))
        );
    }

    #[test]
    fn test_suspended_prerequisite_invalidates_dependant() {
        let s = setup();
        let parent = issue(&s, CredentialType::Kyc, 0);
        let child = issue(&s, CredentialType::Achievement, 0);
        s.client
            .set_prerequisites(&s.issuer, &child, &vec![&s.env, parent.clone()]);
        s.client.verify_credential(&child);

        s.client
            .suspend_credential(&s.issuer, &parent, &SuspensionReason::Unspecified);

        assert_eq!(
            s.client.try_verify_credential(&child),
            Err(Ok(ContractError::PrerequisiteNotMet))
        );
        assert!(!s.client.get_dependency_tree(&parent).valid);

        // Unlike revocation, suspension does not cascade: the dependant
        // becomes valid again as soon as the parent is reactivated.
        s.client.reactivate_credential(&s.issuer, &parent);
        s.client.verify_credential(&child);
        assert!(s.client.get_dependency_tree(&parent).valid);
    }

    #[test]
    fn test_batch_verification_reports_suspended_as_invalid() {
        let s = setup();
        let active = issue(&s, CredentialType::Kyc, 0);
        let suspended = issue(&s, CredentialType::Reputation, 0);
        s.client
            .suspend_credential(&s.issuer, &suspended, &SuspensionReason::Unspecified);

        let results =
            s.client
                .verify_credentials_batch(&vec![&s.env, active.clone(), suspended.clone()], &false);

        assert_eq!(
            results,
            vec![
                &s.env,
                BatchVerifyResult {
                    id: active,
                    valid: true,
                    reason: crate::BatchFailureReason::Valid,
                },
                BatchVerifyResult {
                    id: suspended,
                    valid: false,
                    reason: crate::BatchFailureReason::Suspended,
                },
            ]
        );
    }

    #[test]
    fn test_delegated_verification_fails_while_suspended() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        let subject = s.client.get_credential(&id).subject;
        let delegate = Address::generate(&s.env);
        s.client
            .delegate_verification(&subject, &delegate, &id, &5_000);
        s.client
            .verify_credential_as_delegate(&delegate, &subject, &id);

        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified);

        assert_eq!(
            s.client
                .try_verify_credential_as_delegate(&delegate, &subject, &id),
            Err(Ok(ContractError::CredentialSuspended))
        );
    }

    #[test]
    fn test_suspend_and_reactivate_rejected_while_paused() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);
        s.client.pause();

        assert_eq!(
            s.client
                .try_suspend_credential(&s.issuer, &id, &SuspensionReason::Unspecified),
            Err(Ok(ContractError::ContractPaused))
        );
        assert_eq!(
            s.client.try_reactivate_credential(&s.issuer, &id),
            Err(Ok(ContractError::ContractPaused))
        );
    }

    #[test]
    fn test_suspend_and_reactivate_emit_events() {
        let s = setup();
        let id = issue(&s, CredentialType::Kyc, 0);

        s.client
            .suspend_credential(&s.issuer, &id, &SuspensionReason::Administrative);
        let (_, topics, data) = s.env.events().all().last().unwrap();
        assert_eq!(
            topics,
            (crate::CRED, symbol_short!("suspended")).into_val(&s.env)
        );
        let data: (u32, BytesN<32>, Address, SuspensionReason, u64) = data.into_val(&s.env);
        assert_eq!(
            data,
            (
                crate::EVENT_VERSION,
                id.clone(),
                s.issuer.clone(),
                SuspensionReason::Administrative,
                1_000
            )
        );

        s.client.reactivate_credential(&s.issuer, &id);
        let (_, topics, data) = s.env.events().all().last().unwrap();
        assert_eq!(
            topics,
            (crate::CRED, symbol_short!("unsuspend")).into_val(&s.env)
        );
        let data: (u32, BytesN<32>, Address, u64) = data.into_val(&s.env);
        assert_eq!(data, (crate::EVENT_VERSION, id, s.issuer.clone(), 1_000));
    }
}
