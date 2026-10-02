//! Batch credential verification (#819).
//!
//! Verifiers frequently need to check several credentials at once — e.g. a
//! KYC credential and an accreditation credential issued to the same subject
//! — and doing that as `N` separate `verify_credential` calls costs `N`
//! separate transactions worth of overhead. `verify_batch` checks up to
//! [`MAX_VERIFY_BATCH`] credential ids in one call and returns one detailed
//! result per id instead of just erroring out on the first bad one.
//!
//! The actual per-credential validity rules (revocation, expiry, activation
//! time, prerequisite chain) intentionally mirror [`crate::CredentialManager::verify_credential`]
//! exactly — this module does not re-decide what "valid" means, it just
//! evaluates that same definition efficiently across many ids at once, via
//! the storage-level helpers already defined on `CredentialManager`.
//!
//! ## Gas optimization: shared lookups
//! A batch commonly contains ids that share structure: the same id can
//! appear twice in the input, or two different top-level ids can share a
//! prerequisite credential in their dependency chain (issue #732). This
//! module keeps a `memo` map for the lifetime of one `verify_batch` call so
//! any credential id — top-level or a prerequisite reached while walking
//! another id's chain — is only ever read from persistent storage once.
//!
//! ## On "parallel verification"
//! The DoD for #819 asks for "parallel verification where possible". A
//! Soroban contract invocation runs as a single WASM execution with no
//! thread pool to hand work to — there is no host API to fan reads out
//! concurrently, so literal parallel execution is not available here. The
//! memoization above is this module's stand-in: it gets the practical
//! benefit parallelism would target (not redoing the same lookup) within
//! the constraints of a single-threaded deterministic VM.

use crate::{ContractError, Credential, CredentialManager};
use soroban_sdk::{contracttype, symbol_short, BytesN, Env, Map, Vec};

/// Maximum number of credential ids accepted in a single [`verify_batch`] call.
pub const MAX_VERIFY_BATCH: u32 = 50;

/// Maximum prerequisite-chain depth walked while resolving one id, mirroring
/// [`crate::CredentialManager::verify_credential`]'s own limit (#732).
const MAX_DEP_DEPTH: u32 = 5;

/// Why a single credential in a batch failed verification. Mirrors the
/// specific [`ContractError`] variants `verify_credential` would return, but
/// as a plain, always-present value so a batch never has to short-circuit
/// the *whole* call just because one entry is bad.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq, Copy)]
pub enum BatchFailureReason {
    /// The credential passed every check.
    Valid,
    /// No credential with this id exists.
    NotFound,
    /// The credential (or one of its prerequisites) has been revoked, or its
    /// time-locked activation was cancelled (#731).
    Revoked,
    /// The credential is temporarily suspended.
    Suspended,
    /// The credential has passed its `expires_at`.
    Expired,
    /// The credential's `activation_time` has not yet been reached (#731).
    NotYetActive,
    /// A credential in the prerequisite chain (#732) is not itself valid.
    PrerequisiteNotMet,
    /// The prerequisite chain is deeper than `MAX_DEP_DEPTH`.
    DependencyDepthExceeded,
}

/// One entry in a [`verify_batch`] response.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchVerifyResult {
    /// The credential id that was checked.
    pub id: BytesN<32>,
    /// `true` exactly when `reason` is [`BatchFailureReason::Valid`].
    pub valid: bool,
    /// The specific reason this credential failed, or `Valid` if it didn't.
    pub reason: BatchFailureReason,
}

/// Verify every id in `ids` (capped at [`MAX_VERIFY_BATCH`]), returning one
/// [`BatchVerifyResult`] per id.
///
/// When `fail_fast` is `true`, evaluation stops as soon as the first invalid
/// credential is found and the returned vector holds only the results
/// computed up to and including that failure — the fail-fast mode this
/// issue asks for trades a complete report for skipping the remaining work.
/// When `false`, every id is evaluated and reported regardless of earlier
/// failures.
///
/// Returns [`ContractError::BatchTooLarge`] if `ids.len() > MAX_VERIFY_BATCH`.
/// This function does not require any auth — verification is read-only.
pub fn verify_batch(
    env: &Env,
    ids: Vec<BytesN<32>>,
    fail_fast: bool,
) -> Result<Vec<BatchVerifyResult>, ContractError> {
    if ids.len() > MAX_VERIFY_BATCH {
        return Err(ContractError::BatchTooLarge);
    }

    let mut memo: Map<BytesN<32>, BatchFailureReason> = Map::new(env);
    let mut results: Vec<BatchVerifyResult> = Vec::new(env);
    let mut valid_count: u32 = 0;

    for id in ids.iter() {
        let reason = check_one(env, &id, 0, &mut memo);
        let valid = reason == BatchFailureReason::Valid;
        if valid {
            valid_count += 1;
        }
        results.push_back(BatchVerifyResult {
            id,
            valid,
            reason,
        });
        if fail_fast && !valid {
            break;
        }
    }

    env.events().publish(
        (symbol_short!("CRED"), symbol_short!("batchvrf")),
        (crate::EVENT_VERSION, results.len() as u32, valid_count, fail_fast),
    );

    Ok(results)
}

/// Resolve one credential id to a [`BatchFailureReason`], consulting and
/// populating `memo` so repeated ids (duplicates in the input, or shared
/// prerequisites across different top-level ids) are only read from storage
/// once per `verify_batch` call.
fn check_one(
    env: &Env,
    id: &BytesN<32>,
    depth: u32,
    memo: &mut Map<BytesN<32>, BatchFailureReason>,
) -> BatchFailureReason {
    if let Some(cached) = memo.get(id.clone()) {
        return cached;
    }

    if depth >= MAX_DEP_DEPTH {
        let reason = BatchFailureReason::DependencyDepthExceeded;
        memo.set(id.clone(), reason);
        return reason;
    }

    let key = CredentialManager::cred_key(id);
    let reason = match env.storage().persistent().get::<_, Credential>(&key) {
        None => BatchFailureReason::NotFound,
        Some(cred) => {
            if cred.revoked || cred.activation_cancelled {
                BatchFailureReason::Revoked
            } else if crate::suspension::is_suspended(env, id) {
                BatchFailureReason::Suspended
            } else {
                let now = env.ledger().timestamp();
                if cred.activation_time != 0 && now < cred.activation_time {
                    BatchFailureReason::NotYetActive
                } else if cred.expires_at > 0 && now > cred.expires_at {
                    BatchFailureReason::Expired
                } else {
                    let mut outcome = BatchFailureReason::Valid;
                    for prereq_id in CredentialManager::fetch_prereqs(env, id).iter() {
                        if check_one(env, &prereq_id, depth + 1, memo) != BatchFailureReason::Valid {
                            outcome = BatchFailureReason::PrerequisiteNotMet;
                            break;
                        }
                    }
                    outcome
                }
            }
        }
    };

    memo.set(id.clone(), reason);
    reason
}
