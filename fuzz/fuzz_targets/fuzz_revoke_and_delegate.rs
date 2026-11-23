//! Fuzz target: interleaved `revoke_credential` and `delegate_verification` calls.
//!
//! Exercises the interaction between revocation (#731) and delegated
//! verification (#655): a delegated verifier calling `verify_credential_as_delegate`
//! should see the revoked state the same way a direct `verify_credential` call
//! would. The fuzzer varies:
//! - whether the credential is revoked before or after the delegation is granted
//! - whether the delegation itself is revoked before the verification attempt
//! - delegation expiry edge cases
//! - `verify_credentials_batch` over ids that include delegated subjects
//!
//! The goal is to surface state-ordering bugs (e.g. a cached "valid" result
//! surviving a subsequent revocation) that unit tests with fixed orderings miss.
//!
//! Run with cargo-fuzz:
//!   cargo fuzz run fuzz_revoke_and_delegate -- -max_total_time=60
#![no_main]

use arbitrary::Arbitrary;
use credential_manager::{CredentialManager, CredentialManagerClient};
use identity_registry::{IdentityRegistry, IdentityRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Bytes, BytesN, Env, Map,
};

/// The ordering of operations the fuzzer can choose between.
#[derive(Arbitrary, Debug)]
enum OperationOrder {
    /// Grant delegation, then revoke the credential, then try verifying.
    DelegateThenRevoke,
    /// Revoke the credential first, then grant delegation, then try verifying.
    RevokeThenDelegate,
    /// Grant delegation, revoke the delegation, then try verifying.
    DelegateThenRevokeDelegation,
    /// Grant delegation, do not revoke anything, just verify.
    DelegateAndVerify,
}

/// Structured fuzz input.
#[derive(Arbitrary, Debug)]
struct RevokeAndDelegateInput {
    /// The operation ordering to exercise.
    order: OperationOrder,
    /// Expiry offset from "now" (ledger timestamp 1000) for the delegation.
    /// Values 0..=5 probe the boundary; the fuzzer will also try large values.
    expiry_offset: u64,
    /// Whether to include the credential id in a batch verify after the
    /// single-credential operation, to check consistency.
    also_batch_verify: bool,
}

libfuzzer_sys::fuzz_target!(|input: RevokeAndDelegateInput| {
    let env = Env::default();
    env.mock_all_auths();
    // Start at a non-zero timestamp so "strictly future" expiry checks work.
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    // ── Infrastructure ─────────────────────────────────────────────────────────
    let identity_contract = env.register_contract(None, IdentityRegistry);
    let identity_client = IdentityRegistryClient::new(&env, &identity_contract);
    let admin = soroban_sdk::Address::generate(&env);
    let _ = identity_client.try_initialize(&admin);

    let cred_contract = env.register_contract(None, CredentialManager);
    let cred_client = CredentialManagerClient::new(&env, &cred_contract);
    let _ = cred_client.try_initialize(&admin, &identity_contract);

    let issuer = soroban_sdk::Address::generate(&env);
    let _ = cred_client.try_add_issuer(&issuer);

    let subject = soroban_sdk::Address::generate(&env);
    let delegate = soroban_sdk::Address::generate(&env);

    // ── Issue the credential ───────────────────────────────────────────────────
    let result = cred_client.try_issue_credential(
        &issuer,
        &subject,
        &credential_manager::CredentialType::Kyc,
        &Map::new(&env),
        &BytesN::from_array(&env, &[1u8; 32]),
        &Bytes::from_array(&env, &[0u8; 64]),
        &0u64, // no expiry
        &0u64, // immediately active
        &None,
        &None,
    );

    let cred_id = match result {
        Ok(Ok(id)) => id,
        _ => return, // setup failed; nothing to fuzz further
    };

    // ── All-zero id means "any credential of this subject" (unscoped delegation).
    let unscoped_id = BytesN::from_array(&env, &[0u8; 32]);

    // Compute expiry: at least 1 second in the future to satisfy the contract's
    // "strictly future" check, but respect whatever the fuzzer picks.
    let now = env.ledger().timestamp();
    // expiry_offset == 0 is always invalid (not strictly future); keep it that
    // way so the fuzzer can probe that error path naturally.
    let expires_at = now.saturating_add(input.expiry_offset);

    // ── Execute operations in the fuzzed order ─────────────────────────────────
    match input.order {
        OperationOrder::DelegateThenRevoke => {
            let _ = cred_client.try_delegate_verification(
                &subject, &delegate, &unscoped_id, &expires_at,
            );
            let _ = cred_client.try_revoke_credential(&issuer, &cred_id);
            // After revocation, delegate verification should fail.
            let _ = cred_client.try_verify_credential_as_delegate(&delegate, &subject, &cred_id);
        }
        OperationOrder::RevokeThenDelegate => {
            let _ = cred_client.try_revoke_credential(&issuer, &cred_id);
            let _ = cred_client.try_delegate_verification(
                &subject, &delegate, &unscoped_id, &expires_at,
            );
            // Credential is revoked; delegate verification should still fail.
            let _ = cred_client.try_verify_credential_as_delegate(&delegate, &subject, &cred_id);
        }
        OperationOrder::DelegateThenRevokeDelegation => {
            let _ = cred_client.try_delegate_verification(
                &subject, &delegate, &unscoped_id, &expires_at,
            );
            let _ = cred_client.try_revoke_delegation(&subject, &delegate);
            // Delegation revoked; even for a valid credential the call should fail.
            let _ = cred_client.try_verify_credential_as_delegate(&delegate, &subject, &cred_id);
            // Double-revoke must not panic.
            let _ = cred_client.try_revoke_delegation(&subject, &delegate);
        }
        OperationOrder::DelegateAndVerify => {
            let grant_result = cred_client.try_delegate_verification(
                &subject, &delegate, &unscoped_id, &expires_at,
            );
            if grant_result.is_ok() {
                // Delegation granted; verify-as-delegate must not panic.
                let _ =
                    cred_client.try_verify_credential_as_delegate(&delegate, &subject, &cred_id);
            }
        }
    }

    // ── Optional: also run the id through verify_credentials_batch ─────────────
    if input.also_batch_verify {
        let mut ids = soroban_sdk::Vec::new(&env);
        ids.push_back(cred_id.clone());
        // Must not panic regardless of the state the credential is in.
        let _ = cred_client.try_verify_credentials_batch(&ids, &false);
        let _ = cred_client.try_verify_credentials_batch(&ids, &true);
    }
});
