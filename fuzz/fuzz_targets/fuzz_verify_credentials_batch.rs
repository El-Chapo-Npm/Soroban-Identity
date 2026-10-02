//! Fuzz target: `verify_credentials_batch` with arbitrary id sets and fail_fast flag.
//!
//! Exercises the batch verification path with arbitrary combinations of:
//! - credential ids that actually exist vs ids that have never been issued
//! - revoked credentials mixed with valid ones
//! - duplicate ids in the input (memoization path)
//! - batch sizes right at and over the MAX_VERIFY_BATCH cap (50)
//! - `fail_fast = true` vs `fail_fast = false`
//!
//! The goal is to surface panics, integer overflows in the memoization map,
//! or inconsistencies between the per-id `valid` flag and `reason` field that
//! deterministic unit tests might miss at the boundary.
//!
//! Run with cargo-fuzz:
//!   cargo fuzz run fuzz_verify_credentials_batch -- -max_total_time=60
#![no_main]

use arbitrary::Arbitrary;
use credential_manager::{CredentialManager, CredentialManagerClient};
use identity_registry::{IdentityRegistry, IdentityRegistryClient};
use soroban_sdk::{
    testutils::Address as _,
    Bytes, BytesN, Env, Map, Vec as SorobanVec,
};

/// One entry in the fuzz-generated id list.
#[derive(Arbitrary, Debug)]
enum IdSource {
    /// Use a real credential id issued to a fresh subject.
    Issued,
    /// Use a real credential id that has been revoked after issuance.
    Revoked,
    /// A random 32-byte array that was never issued.
    Unknown([u8; 32]),
    /// Repeat a previously-issued id (tests the memoization path).
    RepeatPrevious(u8),
}

/// Structured fuzz input for the batch verification target.
#[derive(Arbitrary, Debug)]
struct BatchVerifyInput {
    /// How many real credentials to pre-issue before running the batch.
    /// Capped at 20 to keep per-run cost bounded.
    num_issued: u8,
    /// The sequence of ids to put in the batch call.
    /// Capped at 55 entries (slightly over the 50-entry contract cap).
    id_sources: Vec<IdSource>,
    /// Which mode to call the batch in.
    fail_fast: bool,
}

libfuzzer_sys::fuzz_target!(|input: BatchVerifyInput| {
    let env = Env::default();
    env.mock_all_auths();

    // ── Set up identity-registry ───────────────────────────────────────────────
    let identity_contract = env.register_contract(None, IdentityRegistry);
    let identity_client = IdentityRegistryClient::new(&env, &identity_contract);
    let admin = soroban_sdk::Address::generate(&env);
    let _ = identity_client.try_initialize(&admin);

    // ── Set up credential-manager ──────────────────────────────────────────────
    let cred_contract = env.register_contract(None, CredentialManager);
    let cred_client = CredentialManagerClient::new(&env, &cred_contract);
    let _ = cred_client.try_initialize(&admin, &identity_contract);

    let issuer = soroban_sdk::Address::generate(&env);
    let _ = cred_client.try_add_issuer(&issuer);

    // ── Pre-issue credentials ──────────────────────────────────────────────────
    let num_issued = (input.num_issued % 20) as usize;
    let mut issued_ids: std::vec::Vec<BytesN<32>> = std::vec::Vec::with_capacity(num_issued);

    for i in 0..num_issued {
        let subject = soroban_sdk::Address::generate(&env);
        let mut hash = [0u8; 32];
        hash[0] = i as u8;
        let result = cred_client.try_issue_credential(
            &issuer,
            &subject,
            &credential_manager::CredentialType::Kyc,
            &Map::new(&env),
            &BytesN::from_array(&env, &hash),
            &Bytes::from_array(&env, &[0u8; 64]),
            &0u64,
            &0u64,
            &None,
            &None,
        );
        if let Ok(Ok(id)) = result {
            issued_ids.push(id);
        }
    }

    // Revoke some of the issued credentials (odd indices).
    for (idx, id) in issued_ids.iter().enumerate() {
        if idx % 2 == 1 {
            let _ = cred_client.try_revoke_credential(&issuer, id);
        }
    }

    // ── Build the id batch ─────────────────────────────────────────────────────
    let mut ids: SorobanVec<BytesN<32>> = SorobanVec::new(&env);
    let sources = if input.id_sources.len() > 55 {
        &input.id_sources[..55]
    } else {
        &input.id_sources
    };

    for source in sources {
        let id = match source {
            IdSource::Issued => {
                if issued_ids.is_empty() {
                    BytesN::from_array(&env, &[0u8; 32])
                } else {
                    // Pick among even-indexed (non-revoked) ids.
                    let idx = (issued_ids.len() / 2).max(1) - 1;
                    let pick = idx.min(issued_ids.len() - 1);
                    issued_ids[pick].clone()
                }
            }
            IdSource::Revoked => {
                if issued_ids.len() >= 2 {
                    issued_ids[1].clone()
                } else {
                    BytesN::from_array(&env, &[0xddu8; 32])
                }
            }
            IdSource::Unknown(raw) => BytesN::from_array(&env, raw),
            IdSource::RepeatPrevious(pick) => {
                if issued_ids.is_empty() {
                    BytesN::from_array(&env, &[0u8; 32])
                } else {
                    let idx = (*pick as usize) % issued_ids.len();
                    issued_ids[idx].clone()
                }
            }
        };
        ids.push_back(id);
    }

    // ── Call verify_credentials_batch — must never panic ──────────────────────
    let result = cred_client.try_verify_credentials_batch(&ids, &input.fail_fast);

    // If the call succeeded, validate structural invariants in the results.
    if let Ok(Ok(results)) = result {
        for r in results.iter() {
            use credential_manager::BatchFailureReason;
            // `valid` must be the exact boolean mirror of `reason == Valid`.
            let expected_valid = r.reason == BatchFailureReason::Valid;
            assert_eq!(
                r.valid, expected_valid,
                "BatchVerifyResult.valid/reason mismatch for id {:?}",
                r.id
            );
        }
    }
});
