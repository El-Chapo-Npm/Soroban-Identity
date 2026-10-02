use credential_manager::{
    ContractError as CredentialError, CredentialManager, CredentialManagerClient, CredentialType,
    RevocationReason,
};
use identity_registry::{ContractError as IdentityError, IdentityRegistry, IdentityRegistryClient};
use reputation::{ContractError as ReputationError, Reputation, ReputationClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Bytes, BytesN, Env, Map, String,
};

fn register_clients(
    env: &Env,
) -> (
    IdentityRegistryClient<'_>,
    CredentialManagerClient<'_>,
    ReputationClient<'_>,
) {
    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let reputation_id = env.register_contract(None, Reputation);

    (
        IdentityRegistryClient::new(env, &identity_id),
        CredentialManagerClient::new(env, &credential_id),
        ReputationClient::new(env, &reputation_id),
    )
}

#[test]
fn did_and_credential_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (identity, credentials, reputation) = register_clients(&env);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);

    identity.initialize(&admin);
    credentials.initialize(&admin, &identity.address);
    reputation.initialize(&admin);

    // Create a DID before issuing credentials so the subject has an on-chain identity.
    let metadata = Map::new(&env);
    let did = identity.create_did(&subject, &metadata);
    let mut did_bytes = [0u8; 68];
    did.copy_into_slice(&mut did_bytes);
    assert_eq!(&did_bytes[..12], b"did:stellar:");

    let document = identity.resolve_did(&subject);
    assert!(document.active);
    assert_eq!(document.controller, subject);

    // Issue a KYC credential to the DID controller and verify it is usable.
    credentials.add_issuer(&issuer);
    let claims = Map::new(&env);
    let claims_hash = BytesN::from_array(&env, &[7u8; 32]);
    let signature = Bytes::from_array(&env, &[1u8; 64]);
    let credential_id = credentials.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &claims,
        &claims_hash,
        &signature,
        &0u64,
            &0u64,
            &None,
            &None,
        );

    credentials.verify_credential(&credential_id);
    let credential = credentials.get_credential(&credential_id);
    assert_eq!(credential.subject, subject);
    assert_eq!(credential.issuer, issuer);

    // Revocation must immediately make the same credential fail verification.
    credentials.revoke_credential(&issuer, &credential_id, &RevocationReason::KeyCompromise);
    assert!(credentials.try_verify_credential(&credential_id).is_err());
}

#[test]
fn reputation_lifecycle_and_sybil_gate() {
    let env = Env::default();
    env.mock_all_auths();

    let (_identity, _credentials, reputation) = register_clients(&env);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);

    reputation.initialize(&admin);
    reputation.add_reporter(&reporter);

    // A positive score from a trusted reporter should satisfy the sybil gate.
    let reason = String::from_str(&env, "completed onboarding");
    reputation.submit_score(&reporter, &subject, &75, &reason);
    let record = reputation.get_reputation(&subject);
    assert_eq!(record.score, 75);
    assert_eq!(record.reporter_count, 1);
    assert!(reputation.passes_sybil_check(&subject, &50, &1));

    // Advance beyond the per-reporter rate limit, then submit a penalty.
    env.ledger().with_mut(|li| li.sequence_number += 101);
    let penalty = String::from_str(&env, "fraud report");
    reputation.submit_score(&reporter, &subject, &-75, &penalty);

    let record = reputation.get_reputation(&subject);
    assert_eq!(record.score, 0);
    assert!(!reputation.passes_sybil_check(&subject, &50, &1));
}
#[test]
fn contracts_expose_ping_version() {
    let env = Env::default();
    let (identity, credentials, reputation) = register_clients(&env);

    assert_eq!(identity.ping(), 1);
    assert_eq!(credentials.ping(), 1);
    assert_eq!(reputation.ping(), 1);
}

/// End-to-end cross-contract lifecycle test (#400):
/// Deploys all three contracts in one Env, registers a DID, issues a credential
/// for that DID, submits a reputation score, and asserts final state across all
/// three contracts is consistent.
#[test]
fn cross_contract_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let reputation_id = env.register_contract(None, Reputation);

    let identity = IdentityRegistryClient::new(&env, &identity_id);
    let credentials = CredentialManagerClient::new(&env, &credential_id);
    let reputation = ReputationClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);

    // Initialize all three contracts
    identity.initialize(&admin);
    credentials.initialize(&admin, &identity_id);
    reputation.initialize(&admin);

    // 1. Register DID in identity-registry
    let did = identity.create_did(&subject, &Map::new(&env));
    assert!(identity.has_active_did(&subject));
    let doc = identity.resolve_did(&subject);
    assert!(doc.active);
    assert_eq!(doc.controller, subject);
    let mut did_bytes = [0u8; 68];
    did.copy_into_slice(&mut did_bytes);
    assert_eq!(&did_bytes[..12], b"did:stellar:");

    // 2. Issue a credential for that DID subject in credential-manager
    credentials.add_issuer(&issuer);
    let cred_id = credentials.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &Map::new(&env),
        &BytesN::from_array(&env, &[0u8; 32]),
        &Bytes::from_array(&env, &[1u8; 64]),
        &0u64,
            &0u64,
            &None,
            &None,
        );
    credentials.verify_credential(&cred_id);
    let cred = credentials.get_credential(&cred_id);
    assert_eq!(cred.subject, subject);

    // 3. Submit a reputation score for the same subject in reputation
    reputation.add_reporter(&reporter);
    let reason = String::from_str(&env, "kyc verified");
    reputation.submit_score(&reporter, &subject, &60, &reason);

    // Assert final state across all three contracts is consistent
    assert!(identity.has_active_did(&subject));          // DID still active
    credentials.verify_credential(&cred_id);    // credential still valid
    let rec = reputation.get_reputation(&subject);
    assert!(rec.score > 0);                              // reputation score is non-zero
    assert_eq!(rec.reporter_count, 1);
    assert!(reputation.passes_sybil_check(&subject, &50, &1));
}

// ── TEST-12: cross-contract integration coverage ────────────────────────────
//
// End-to-end tests covering interactions between identity-registry,
// credential-manager, and reputation: full credential lifecycle, cross-contract
// authorization, reputation integration with credentials, and error propagation.

/// Full credential lifecycle across all three contracts: a DID is registered,
/// a credential is issued against it, reputation is accrued, the credential is
/// revoked, and every contract reflects the terminal state consistently.
#[test]
fn full_credential_lifecycle_across_contracts() {
    let env = Env::default();
    env.mock_all_auths();

    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let reputation_id = env.register_contract(None, Reputation);

    let identity = IdentityRegistryClient::new(&env, &identity_id);
    let credentials = CredentialManagerClient::new(&env, &credential_id);
    let reputation = ReputationClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);

    identity.initialize(&admin);
    credentials.initialize(&admin, &identity_id);
    reputation.initialize(&admin);

    // Issue: subject must have an active DID before a credential can be issued.
    identity.create_did(&subject, &Map::new(&env));
    assert!(identity.has_active_did(&subject));

    credentials.add_issuer(&issuer);
    let cred_id = credentials.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &Map::new(&env),
        &BytesN::from_array(&env, &[3u8; 32]),
        &Bytes::from_array(&env, &[2u8; 64]),
        &0u64,
            &0u64,
            &None,
            &None,
        );
    credentials.verify_credential(&cred_id);

    // Reputation accrues while the credential is valid.
    reputation.add_reporter(&reporter);
    let reason = String::from_str(&env, "credential issued");
    reputation.submit_score(&reporter, &subject, &40, &reason);
    assert!(reputation.get_reputation(&subject).score > 0);

    // Revoke: credential verification must fail immediately.
    credentials.revoke_credential(&issuer, &cred_id, &RevocationReason::Superseded);
    assert!(credentials.try_verify_credential(&cred_id).is_err());

    // Terminal state is consistent across all three contracts.
    assert!(identity.has_active_did(&subject));
    assert!(credentials.try_verify_credential(&cred_id).is_err());
    assert_eq!(reputation.get_reputation(&subject).reporter_count, 1);
}

/// Cross-contract authorization: only registered issuers may issue, and only
/// the original issuer may revoke. Unauthorized actors are rejected and the
/// credential state is left untouched.
#[test]
fn cross_contract_authorization_checks() {
    let env = Env::default();
    env.mock_all_auths();

    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let reputation_id = env.register_contract(None, Reputation);

    let identity = IdentityRegistryClient::new(&env, &identity_id);
    let credentials = CredentialManagerClient::new(&env, &credential_id);
    let reputation = ReputationClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let rogue = Address::generate(&env);
    let subject = Address::generate(&env);

    identity.initialize(&admin);
    credentials.initialize(&admin, &identity_id);
    reputation.initialize(&admin);

    identity.create_did(&subject, &Map::new(&env));
    credentials.add_issuer(&issuer);

    // An unregistered issuer cannot issue a credential.
    assert!(credentials
        .try_issue_credential(
            &rogue,
            &subject,
            &CredentialType::Kyc,
            &Map::new(&env),
            &BytesN::from_array(&env, &[4u8; 32]),
            &Bytes::from_array(&env, &[3u8; 64]),
            &0u64,
            &0u64,
            &None,
            &None,
        )
        .is_err());

    // The registered issuer can issue, but a different actor cannot revoke.
    let cred_id = credentials.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &Map::new(&env),
        &BytesN::from_array(&env, &[5u8; 32]),
        &Bytes::from_array(&env, &[4u8; 64]),
        &0u64,
            &0u64,
            &None,
            &None,
        );
    assert!(credentials
        .try_revoke_credential(&rogue, &cred_id, &RevocationReason::Unspecified)
        .is_err());
    credentials.verify_credential(&cred_id);

    // Only the original issuer can revoke successfully.
    credentials.revoke_credential(&issuer, &cred_id, &RevocationReason::Superseded);
    assert!(credentials.try_verify_credential(&cred_id).is_err());
}

/// Reputation integration with credentials: reputation reads/writes are tied to
/// the credential lifecycle, and the sybil gate reflects the accrued score.
#[test]
fn reputation_integration_with_credentials() {
    let env = Env::default();
    env.mock_all_auths();

    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let reputation_id = env.register_contract(None, Reputation);

    let identity = IdentityRegistryClient::new(&env, &identity_id);
    let credentials = CredentialManagerClient::new(&env, &credential_id);
    let reputation = ReputationClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);

    identity.initialize(&admin);
    credentials.initialize(&admin, &identity_id);
    reputation.initialize(&admin);

    identity.create_did(&subject, &Map::new(&env));
    credentials.add_issuer(&issuer);
    reputation.add_reporter(&reporter);

    // Before any credential, the subject fails the sybil gate.
    assert!(!reputation.passes_sybil_check(&subject, &50, &1));

    // Issuing a credential is paired with a reputation score from the reporter.
    let cred_id = credentials.issue_credential(
        &issuer,
        &subject,
        &CredentialType::Kyc,
        &Map::new(&env),
        &BytesN::from_array(&env, &[6u8; 32]),
        &Bytes::from_array(&env, &[5u8; 64]),
        &0u64,
            &0u64,
            &None,
            &None,
        );
    credentials.verify_credential(&cred_id);

    let reason = String::from_str(&env, "credential-backed reputation");
    reputation.submit_score(&reporter, &subject, &80, &reason);
    let record = reputation.get_reputation(&subject);
    assert_eq!(record.score, 80);
    assert_eq!(record.reporter_count, 1);
    assert!(reputation.passes_sybil_check(&subject, &50, &1));

    // Revoking the credential does not silently erase reputation history.
    credentials.revoke_credential(&issuer, &cred_id, &RevocationReason::Superseded);
    assert!(credentials.try_verify_credential(&cred_id).is_err());
    assert_eq!(reputation.get_reputation(&subject).score, 80);
}

/// Edge cases and error propagation: duplicate DIDs, duplicate issuers, and
/// operations on unknown credentials surface the expected contract errors
/// without corrupting cross-contract state.
#[test]
fn edge_cases_and_error_propagation() {
    let env = Env::default();
    env.mock_all_auths();

    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let reputation_id = env.register_contract(None, Reputation);

    let identity = IdentityRegistryClient::new(&env, &identity_id);
    let credentials = CredentialManagerClient::new(&env, &credential_id);
    let reputation = ReputationClient::new(&env, &reputation_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);

    identity.initialize(&admin);
    credentials.initialize(&admin, &identity_id);
    reputation.initialize(&admin);

    // Duplicate DID creation propagates DidAlreadyExists.
    identity.create_did(&subject, &Map::new(&env));
    assert_eq!(
        identity.try_create_did(&subject, &Map::new(&env)),
        Err(Ok(IdentityError::DidAlreadyExists))
    );

    // Registering the same issuer twice is idempotent.
    credentials.add_issuer(&issuer);
    credentials.add_issuer(&issuer);
    assert_eq!(credentials.get_issuers().len(), 1);

    // Verifying an unknown credential id fails rather than panicking.
    let unknown = BytesN::from_array(&env, &[9u8; 32]);
    assert!(credentials.try_verify_credential(&unknown).is_err());

    // The DID remains active and reputation is untouched by the failed calls.
    assert!(identity.has_active_did(&subject));
    assert_eq!(reputation.get_reputation(&subject).reporter_count, 0);
}

// ── SC-10: negative-path coverage ───────────────────────────────────────────
//
// Each test below drives one `ContractError` variant (or an explicit panic
// path) called out in issue #546, across all three contracts.

// -- identity-registry ------------------------------------------------------

#[test]
fn create_did_twice_returns_did_already_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let (identity, _credentials, _reputation) = register_clients(&env);
    let admin = Address::generate(&env);
    let subject = Address::generate(&env);
    identity.initialize(&admin);

    identity.create_did(&subject, &Map::new(&env));
    assert_eq!(
        identity.try_create_did(&subject, &Map::new(&env)),
        Err(Ok(IdentityError::DidAlreadyExists))
    );
}

#[test]
fn update_did_with_empty_metadata_returns_empty_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (identity, _credentials, _reputation) = register_clients(&env);
    let admin = Address::generate(&env);
    let subject = Address::generate(&env);
    identity.initialize(&admin);
    identity.create_did(&subject, &Map::new(&env));

    assert_eq!(
        identity.try_update_did(&subject, &Map::new(&env)),
        Err(Ok(IdentityError::EmptyMetadata))
    );
}
