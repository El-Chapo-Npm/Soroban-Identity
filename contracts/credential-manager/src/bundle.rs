//! Credential bundling functionality (#1058).
//!
//! Allows grouping multiple credentials into a single verifiable bundle:
//! - Create bundle structure
//! - Add credentials to bundle
//! - Verify entire bundle atomically
//! - Support partial bundle verification
//! - Add bundle expiry based on shortest credential
//! - Emit bundle events
//! - Query bundle contents

use crate::{batch, BatchFailureReason, BatchVerifyResult, ContractError, Credential, CredentialManager, EVENT_VERSION, TTL_MAX};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contracttype, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec};

const BUNDLE: Symbol = symbol_short!("BUNDLE");
const BUNDLE_NONCE: Symbol = symbol_short!("BNDNONCE");
const OWNER_BUNDLES: Symbol = symbol_short!("OWNBNDL");

/// Maximum number of credentials allowed in a single bundle.
pub const MAX_BUNDLE_SIZE: u32 = 50;

/// Represents a group of credentials bundled together into a single verifiable unit (#1058).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialBundle {
    /// Unique deterministic 32-byte bundle identifier.
    pub id: BytesN<32>,
    /// Owner/creator of the bundle (typically the subject or issuer).
    pub owner: Address,
    /// Ordered list of credential IDs included in this bundle.
    pub credential_ids: Vec<BytesN<32>>,
    /// Timestamp when the bundle was created.
    pub created_at: u64,
    /// Timestamp when the bundle was last updated.
    pub updated_at: u64,
    /// Effective bundle expiry timestamp derived from the shortest-lived credential
    /// (`0` if no credential in the bundle has an expiry).
    pub expires_at: u64,
}

/// Result of partial or full bundle verification (#1058).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BundleVerificationResult {
    /// The bundle ID that was verified.
    pub bundle_id: BytesN<32>,
    /// `true` if all credentials in the bundle are valid and the bundle itself is not expired.
    pub all_valid: bool,
    /// Number of valid credentials in the bundle.
    pub valid_count: u32,
    /// Total number of credentials in the bundle.
    pub total_count: u32,
    /// Effective bundle expiry timestamp (shortest credential expiry, or `0` if none).
    pub expires_at: u64,
    /// Per-credential verification breakdown.
    pub results: Vec<BatchVerifyResult>,
}

fn bundle_key(bundle_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (BUNDLE, bundle_id.clone())
}

fn owner_bundles_key(owner: &Address) -> (Symbol, Address) {
    (OWNER_BUNDLES, owner.clone())
}

fn derive_bundle_id(env: &Env, owner: &Address, nonce: u64) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.extend_from_array(b"CRED_BUNDLE_V1");
    data.append(&owner.clone().to_xdr(env));
    data.extend_from_array(&nonce.to_be_bytes());
    env.crypto().sha256(&data).into()
}

/// Computes the shortest non-zero `expires_at` across all credentials in `credential_ids`.
/// Also validates that each credential exists and is not already expired or revoked.
fn compute_shortest_expiry(
    env: &Env,
    credential_ids: &Vec<BytesN<32>>,
) -> Result<u64, ContractError> {
    let now = env.ledger().timestamp();
    let mut shortest_expiry: u64 = 0;

    for cred_id in credential_ids.iter() {
        let key = CredentialManager::cred_key(&cred_id);
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;

        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        if cred.expires_at > 0 {
            if now > cred.expires_at {
                return Err(ContractError::CredentialExpired);
            }
            if shortest_expiry == 0 || cred.expires_at < shortest_expiry {
                shortest_expiry = cred.expires_at;
            }
        }
    }

    Ok(shortest_expiry)
}

/// Create a new credential bundle containing `credential_ids` (#1058).
pub fn create_bundle(
    env: &Env,
    owner: Address,
    credential_ids: Vec<BytesN<32>>,
) -> Result<BytesN<32>, ContractError> {
    owner.require_auth();
    CredentialManager::require_not_paused(env)?;

    if credential_ids.is_empty() {
        return Err(ContractError::EmptyBundle);
    }
    if credential_ids.len() > MAX_BUNDLE_SIZE {
        return Err(ContractError::BatchTooLarge);
    }

    // Dedup check and shortest expiry calculation
    let mut unique_ids: Vec<BytesN<32>> = Vec::new(env);
    for id in credential_ids.iter() {
        if !unique_ids.contains(&id) {
            unique_ids.push_back(id);
        }
    }

    let expires_at = compute_shortest_expiry(env, &unique_ids)?;
    let now = env.ledger().timestamp();

    let nonce_key = (BUNDLE_NONCE, owner.clone());
    let nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0) + 1;
    env.storage().persistent().set(&nonce_key, &nonce);
    env.storage()
        .persistent()
        .extend_ttl(&nonce_key, TTL_MAX, TTL_MAX);

    let bundle_id = derive_bundle_id(env, &owner, nonce);
    let bundle = CredentialBundle {
        id: bundle_id.clone(),
        owner: owner.clone(),
        credential_ids: unique_ids.clone(),
        created_at: now,
        updated_at: now,
        expires_at,
    };

    let key = bundle_key(&bundle_id);
    env.storage().persistent().set(&key, &bundle);
    let ttl = CredentialManager::ttl_for_credential(env, expires_at);
    env.storage().persistent().extend_ttl(&key, ttl, ttl);

    let owner_key = owner_bundles_key(&owner);
    let mut owner_list: Vec<BytesN<32>> = env
        .storage()
        .persistent()
        .get(&owner_key)
        .unwrap_or_else(|| Vec::new(env));
    owner_list.push_back(bundle_id.clone());
    env.storage().persistent().set(&owner_key, &owner_list);
    env.storage()
        .persistent()
        .extend_ttl(&owner_key, TTL_MAX, TTL_MAX);

    env.events().publish(
        (BUNDLE, symbol_short!("created")),
        (
            EVENT_VERSION,
            bundle_id.clone(),
            owner,
            unique_ids.len(),
            expires_at,
        ),
    );

    Ok(bundle_id)
}

/// Add one or more credentials to an existing bundle and recalculate shortest expiry (#1058).
pub fn add_credentials_to_bundle(
    env: &Env,
    owner: Address,
    bundle_id: BytesN<32>,
    additional_ids: Vec<BytesN<32>>,
) -> Result<CredentialBundle, ContractError> {
    owner.require_auth();
    CredentialManager::require_not_paused(env)?;

    if additional_ids.is_empty() {
        return Err(ContractError::EmptyBundle);
    }

    let key = bundle_key(&bundle_id);
    let mut bundle: CredentialBundle = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::BundleNotFound)?;

    if bundle.owner != owner {
        return Err(ContractError::Unauthorized);
    }

    for id in additional_ids.iter() {
        if !bundle.credential_ids.contains(&id) {
            if bundle.credential_ids.len() >= MAX_BUNDLE_SIZE {
                return Err(ContractError::BatchTooLarge);
            }
            bundle.credential_ids.push_back(id);
        }
    }

    let expires_at = compute_shortest_expiry(env, &bundle.credential_ids)?;
    bundle.expires_at = expires_at;
    bundle.updated_at = env.ledger().timestamp();

    env.storage().persistent().set(&key, &bundle);
    let ttl = CredentialManager::ttl_for_credential(env, expires_at);
    env.storage().persistent().extend_ttl(&key, ttl, ttl);

    env.events().publish(
        (BUNDLE, symbol_short!("added")),
        (
            EVENT_VERSION,
            bundle_id,
            owner,
            bundle.credential_ids.len(),
            expires_at,
        ),
    );

    Ok(bundle)
}

/// Verify an entire bundle atomically (#1058).
/// Fails with an error if the bundle is expired or any credential in the bundle is invalid.
pub fn verify_bundle(env: &Env, bundle_id: BytesN<32>) -> Result<(), ContractError> {
    let key = bundle_key(&bundle_id);
    let bundle: CredentialBundle = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::BundleNotFound)?;

    let now = env.ledger().timestamp();
    if bundle.expires_at > 0 && now > bundle.expires_at {
        env.events().publish(
            (BUNDLE, symbol_short!("verified")),
            (EVENT_VERSION, bundle_id, false, 0u32, bundle.credential_ids.len()),
        );
        return Err(ContractError::CredentialExpired);
    }

    let batch_results = batch::verify_batch(env, bundle.credential_ids.clone(), true)?;
    for res in batch_results.iter() {
        if !res.valid {
            env.events().publish(
                (BUNDLE, symbol_short!("verified")),
                (EVENT_VERSION, bundle_id, false, 0u32, bundle.credential_ids.len()),
            );
            return Err(match res.reason {
                BatchFailureReason::NotFound => ContractError::CredentialNotFound,
                BatchFailureReason::Revoked => ContractError::CredentialRevoked,
                BatchFailureReason::Suspended => ContractError::CredentialSuspended,
                BatchFailureReason::Expired => ContractError::CredentialExpired,
                BatchFailureReason::NotYetActive => ContractError::CredentialNotYetActive,
                BatchFailureReason::PrerequisiteNotMet => ContractError::PrerequisiteNotMet,
                BatchFailureReason::DependencyDepthExceeded => {
                    ContractError::DependencyDepthExceeded
                }
                BatchFailureReason::Valid => unreachable!(),
            });
        }
    }

    let total = bundle.credential_ids.len();
    env.events().publish(
        (BUNDLE, symbol_short!("verified")),
        (EVENT_VERSION, bundle_id, true, total, total),
    );

    Ok(())
}

/// Verify a bundle partially (or a subset of credentials in the bundle) without aborting on individual failures (#1058).
/// If `subset_ids` is `None`, all credentials in the bundle are verified.
pub fn verify_bundle_partial(
    env: &Env,
    bundle_id: BytesN<32>,
    subset_ids: Option<Vec<BytesN<32>>>,
) -> Result<BundleVerificationResult, ContractError> {
    let key = bundle_key(&bundle_id);
    let bundle: CredentialBundle = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::BundleNotFound)?;

    let target_ids = match subset_ids {
        Some(sub) => {
            if sub.is_empty() {
                return Err(ContractError::EmptyBundle);
            }
            for id in sub.iter() {
                if !bundle.credential_ids.contains(&id) {
                    return Err(ContractError::CredentialNotFound);
                }
            }
            sub
        }
        None => bundle.credential_ids.clone(),
    };

    let results = batch::verify_batch(env, target_ids.clone(), false)?;
    let mut valid_count: u32 = 0;
    let mut shortest_active_expiry: u64 = 0;

    for res in results.iter() {
        if res.valid {
            valid_count += 1;
            if let Some(cred) = env
                .storage()
                .persistent()
                .get::<_, Credential>(&CredentialManager::cred_key(&res.id))
            {
                if cred.expires_at > 0
                    && (shortest_active_expiry == 0 || cred.expires_at < shortest_active_expiry)
                {
                    shortest_active_expiry = cred.expires_at;
                }
            }
        }
    }

    let total_count = target_ids.len();
    let now = env.ledger().timestamp();
    let effective_expiry = if shortest_active_expiry > 0 {
        shortest_active_expiry
    } else {
        bundle.expires_at
    };
    let bundle_not_expired = effective_expiry == 0 || now <= effective_expiry;
    let all_valid = valid_count == total_count && bundle_not_expired;

    env.events().publish(
        (BUNDLE, symbol_short!("part_vrf")),
        (
            EVENT_VERSION,
            bundle_id.clone(),
            all_valid,
            valid_count,
            total_count,
        ),
    );

    Ok(BundleVerificationResult {
        bundle_id,
        all_valid,
        valid_count,
        total_count,
        expires_at: effective_expiry,
        results,
    })
}

/// Query a bundle's metadata and credential IDs (#1058).
pub fn get_bundle(env: &Env, bundle_id: BytesN<32>) -> Result<CredentialBundle, ContractError> {
    let key = bundle_key(&bundle_id);
    let bundle: CredentialBundle = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::BundleNotFound)?;
    let ttl = CredentialManager::ttl_for_credential(env, bundle.expires_at);
    env.storage().persistent().extend_ttl(&key, ttl, ttl);
    Ok(bundle)
}

/// Query the full `Credential` objects contained inside a bundle (#1058).
pub fn get_bundle_credentials(
    env: &Env,
    bundle_id: BytesN<32>,
) -> Result<Vec<Credential>, ContractError> {
    let bundle = get_bundle(env, bundle_id)?;
    let mut creds: Vec<Credential> = Vec::new(env);
    for id in bundle.credential_ids.iter() {
        let key = CredentialManager::cred_key(&id);
        if let Some(cred) = env.storage().persistent().get::<_, Credential>(&key) {
            creds.push_back(cred);
        }
    }
    Ok(creds)
}

/// Query all bundle IDs created by `owner` (#1058).
pub fn get_owner_bundles(env: &Env, owner: Address) -> Vec<BytesN<32>> {
    let key = owner_bundles_key(&owner);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}
