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
const PRESENTATION: Symbol = symbol_short!("PRESENT");
const PRES_NONCE: Symbol = symbol_short!("PRSNONCE");
const PRES_TEMPLATE: Symbol = symbol_short!("PRSTMPL");
const TEMPLATE_NONCE: Symbol = symbol_short!("TPLNONCE");

/// Maximum number of credentials allowed in a single bundle.
pub const MAX_BUNDLE_SIZE: u32 = 50;

/// Maximum number of credentials allowed in a single verifiable presentation.
pub const MAX_PRESENTATION_SIZE: u32 = 50;

/// Maximum length (in bytes) of a presentation challenge.
pub const MAX_CHALLENGE_LEN: u32 = 256;

/// Maximum length (in bytes) of a presentation domain.
pub const MAX_DOMAIN_LEN: u32 = 256;

/// Maximum length (in bytes) of a presentation template name.
pub const MAX_TEMPLATE_NAME_LEN: u32 = 64;

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

fn presentation_key(presentation_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (PRESENTATION, presentation_id.clone())
}

fn template_key(template_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (PRES_TEMPLATE, template_id.clone())
}

fn derive_presentation_id(env: &Env, holder: &Address, nonce: u64) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.extend_from_array(b"CRED_PRESENT_V1");
    data.append(&holder.clone().to_xdr(env));
    data.extend_from_array(&nonce.to_be_bytes());
    env.crypto().sha256(&data).into()
}

fn derive_template_id(env: &Env, owner: &Address, nonce: u64) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.extend_from_array(b"CRED_PRES_TMPL_V1");
    data.append(&owner.clone().to_xdr(env));
    data.extend_from_array(&nonce.to_be_bytes());
    env.crypto().sha256(&data).into()
}

/// Supported proof formats for a verifiable presentation (#1123).
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresentationProofType {
    /// JWT-based proof (`EdDSA` over the presentation payload).
    Jwt = 0,
    /// Linked-Data proof (`Ed25519Signature2020` over the presentation payload).
    LdProof = 1,
}

/// A cryptographic proof attached to a presentation (#1123).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PresentationProof {
    /// Proof format used.
    pub proof_type: PresentationProofType,
    /// Public key (32-byte Ed25519) used to verify the proof.
    pub verification_method: BytesN<32>,
    /// Signature over the canonical presentation payload.
    pub signature: BytesN<64>,
    /// Optional proof purpose (e.g. `assertionMethod`), empty if unspecified.
    pub purpose: Bytes,
}

/// A field-level selective disclosure filter for a credential in a presentation (#1123).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FieldFilter {
    /// Credential this filter applies to.
    pub credential_id: BytesN<32>,
    /// Field names that are disclosed. If empty, all fields are disclosed.
    pub disclosed_fields: Vec<Symbol>,
}

/// A W3C Verifiable Presentation bundling credentials with selective disclosure (#1123).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerifiablePresentation {
    /// Unique deterministic 32-byte presentation identifier.
    pub id: BytesN<32>,
    /// Holder/subject that created and signed the presentation.
    pub holder: Address,
    /// Credential IDs included in the presentation (the disclosed subset).
    pub credential_ids: Vec<BytesN<32>>,
    /// Per-credential field-level disclosure filters.
    pub field_filters: Vec<FieldFilter>,
    /// Anti-replay challenge supplied by the verifier.
    pub challenge: Bytes,
    /// Optional domain binding the presentation to a verifier.
    pub domain: Bytes,
    /// Timestamp when the presentation was created.
    pub created_at: u64,
    /// Timestamp after which the presentation is no longer valid (`0` = no expiry).
    pub expires_at: u64,
    /// Proof attached to the presentation.
    pub proof: PresentationProof,
    /// Optional template this presentation was instantiated from.
    pub template_id: Option<BytesN<32>>,
}

/// Result of verifying a verifiable presentation (#1123).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PresentationVerificationResult {
    /// The presentation ID that was verified.
    pub presentation_id: BytesN<32>,
    /// `true` if the proof, challenge, expiry and all credentials are valid.
    pub valid: bool,
    /// Number of valid credentials in the presentation.
    pub valid_count: u32,
    /// Total number of credentials in the presentation.
    pub total_count: u32,
    /// Effective presentation expiry timestamp (`0` if none).
    pub expires_at: u64,
    /// Per-credential verification breakdown.
    pub results: Vec<BatchVerifyResult>,
}

/// A reusable presentation template describing a presentation shape (#1123).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PresentationTemplate {
    /// Unique deterministic 32-byte template identifier.
    pub id: BytesN<32>,
    /// Owner/creator of the template.
    pub owner: Address,
    /// Human-readable template name.
    pub name: Bytes,
    /// Credential IDs the template expects to be presented.
    pub credential_ids: Vec<BytesN<32>>,
    /// Default field-level disclosure filters for the template.
    pub field_filters: Vec<FieldFilter>,
    /// Default proof format for presentations created from this template.
    pub proof_type: PresentationProofType,
    /// Default validity duration in seconds (`0` = no expiry).
    pub default_ttl: u64,
    /// Timestamp when the template was created.
    pub created_at: u64,
}

/// Computes the canonical payload that a presentation proof signs over (#1123).
fn presentation_payload(env: &Env, presentation: &VerifiablePresentation) -> Bytes {
    let mut data = Bytes::new(env);
    data.extend_from_array(b"CRED_PRESENTATION_V1");
    data.append(&presentation.id.clone().to_xdr(env));
    data.append(&presentation.holder.clone().to_xdr(env));
    for id in presentation.credential_ids.iter() {
        data.append(&id.clone().to_xdr(env));
    }
    data.append(&presentation.challenge);
    data.append(&presentation.domain);
    data.extend_from_array(&presentation.created_at.to_be_bytes());
    data.extend_from_array(&presentation.expires_at.to_be_bytes());
    data.extend_from_array(&[presentation.proof.proof_type as u8]);
    data
}

/// Verifies the presentation proof signature against the canonical payload (#1123).
fn verify_presentation_proof(
    env: &Env,
    presentation: &VerifiablePresentation,
) -> Result<(), ContractError> {
    let payload = presentation_payload(env, presentation);
    let message = env.crypto().sha256(&payload);
    env.crypto().ed25519_verify(
        &presentation.proof.verification_method,
        &message.into(),
        &presentation.proof.signature,
    );
    Ok(())
}

/// Validates a presentation's challenge and domain against the expected verifier values (#1123).
fn verify_challenge(
    presentation: &VerifiablePresentation,
    expected_challenge: &Bytes,
    expected_domain: &Bytes,
) -> Result<(), ContractError> {
    if presentation.challenge != *expected_challenge {
        return Err(ContractError::PresentationChallengeMismatch);
    }
    if !expected_domain.is_empty() && presentation.domain != *expected_domain {
        return Err(ContractError::PresentationDomainMismatch);
    }
    Ok(())
}

/// Create a new verifiable presentation from a subset of a bundle's credentials (#1123).
///
/// Supports selective disclosure by allowing the holder to present only a subset of
/// the bundle's credentials and, per credential, only a subset of fields.
pub fn create_presentation(
    env: &Env,
    holder: Address,
    bundle_id: BytesN<32>,
    disclosed_ids: Vec<BytesN<32>>,
    field_filters: Vec<FieldFilter>,
    challenge: Bytes,
    domain: Bytes,
    expires_at: u64,
    proof_type: PresentationProofType,
    verification_method: BytesN<32>,
    signature: BytesN<64>,
) -> Result<BytesN<32>, ContractError> {
    holder.require_auth();
    CredentialManager::require_not_paused(env)?;

    if challenge.len() > MAX_CHALLENGE_LEN {
        return Err(ContractError::PresentationChallengeTooLong);
    }
    if domain.len() > MAX_DOMAIN_LEN {
        return Err(ContractError::PresentationDomainTooLong);
    }

    let bundle = get_bundle(env, bundle_id)?;
    if bundle.owner != holder {
        return Err(ContractError::Unauthorized);
    }

    let disclosed = if disclosed_ids.is_empty() {
        bundle.credential_ids.clone()
    } else {
        disclosed_ids
    };

    if disclosed.is_empty() {
        return Err(ContractError::EmptyPresentation);
    }
    if disclosed.len() > MAX_PRESENTATION_SIZE {
        return Err(ContractError::PresentationTooLarge);
    }

    // Every disclosed credential must belong to the bundle.
    for id in disclosed.iter() {
        if !bundle.credential_ids.contains(&id) {
            return Err(ContractError::CredentialNotFound);
        }
    }

    // Field filters must reference disclosed credentials.
    for filter in field_filters.iter() {
        if !disclosed.contains(&filter.credential_id) {
            return Err(ContractError::CredentialNotFound);
        }
    }

    let now = env.ledger().timestamp();
    if expires_at > 0 && expires_at <= now {
        return Err(ContractError::PresentationExpired);
    }
    // Presentation cannot outlive the bundle's effective expiry.
    let effective_expiry = if bundle.expires_at > 0
        && (expires_at == 0 || bundle.expires_at < expires_at)
    {
        bundle.expires_at
    } else {
        expires_at
    };

    let nonce_key = (PRES_NONCE, holder.clone());
    let nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0) + 1;
    env.storage().persistent().set(&nonce_key, &nonce);
    env.storage()
        .persistent()
        .extend_ttl(&nonce_key, TTL_MAX, TTL_MAX);

    let presentation_id = derive_presentation_id(env, &holder, nonce);
    let presentation = VerifiablePresentation {
        id: presentation_id.clone(),
        holder: holder.clone(),
        credential_ids: disclosed.clone(),
        field_filters,
        challenge,
        domain,
        created_at: now,
        expires_at: effective_expiry,
        proof: PresentationProof {
            proof_type,
            verification_method,
            signature,
            purpose: Bytes::new(env),
        },
        template_id: None,
    };

    // Verify the proof before persisting so invalid presentations are rejected.
    verify_presentation_proof(env, &presentation)?;

    let key = presentation_key(&presentation_id);
    env.storage().persistent().set(&key, &presentation);
    let ttl = CredentialManager::ttl_for_credential(env, effective_expiry);
    env.storage().persistent().extend_ttl(&key, ttl, ttl);

    env.events().publish(
        (PRESENTATION, symbol_short!("created")),
        (
            EVENT_VERSION,
            presentation_id.clone(),
            holder,
            disclosed.len(),
            effective_expiry,
        ),
    );

    Ok(presentation_id)
}

/// Verify a stored verifiable presentation (#1123).
///
/// Checks the proof signature, the challenge/domain binding, the presentation expiry,
/// and every disclosed credential.
pub fn verify_presentation(
    env: &Env,
    presentation_id: BytesN<32>,
    expected_challenge: Bytes,
    expected_domain: Bytes,
) -> Result<PresentationVerificationResult, ContractError> {
    let key = presentation_key(&presentation_id);
    let presentation: VerifiablePresentation = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::PresentationNotFound)?;

    let now = env.ledger().timestamp();
    if presentation.expires_at > 0 && now > presentation.expires_at {
        env.events().publish(
            (PRESENTATION, symbol_short!("verified")),
            (
                EVENT_VERSION,
                presentation_id,
                false,
                0u32,
                presentation.credential_ids.len(),
            ),
        );
        return Err(ContractError::PresentationExpired);
    }

    verify_challenge(&presentation, &expected_challenge, &expected_domain)?;
    verify_presentation_proof(env, &presentation)?;

    let results = batch::verify_batch(env, presentation.credential_ids.clone(), false)?;
    let mut valid_count: u32 = 0;
    for res in results.iter() {
        if res.valid {
            valid_count += 1;
        }
    }

    let total_count = presentation.credential_ids.len();
    let valid = valid_count == total_count;

    env.events().publish(
        (PRESENTATION, symbol_short!("verified")),
        (
            EVENT_VERSION,
            presentation_id.clone(),
            valid,
            valid_count,
            total_count,
        ),
    );

    Ok(PresentationVerificationResult {
        presentation_id,
        valid,
        valid_count,
        total_count,
        expires_at: presentation.expires_at,
        results,
    })
}

/// Query a stored verifiable presentation (#1123).
pub fn get_presentation(
    env: &Env,
    presentation_id: BytesN<32>,
) -> Result<VerifiablePresentation, ContractError> {
    let key = presentation_key(&presentation_id);
    let presentation: VerifiablePresentation = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::PresentationNotFound)?;
    let ttl = CredentialManager::ttl_for_credential(env, presentation.expires_at);
    env.storage().persistent().extend_ttl(&key, ttl, ttl);
    Ok(presentation)
}

/// Register a reusable presentation template (#1123).
pub fn create_presentation_template(
    env: &Env,
    owner: Address,
    name: Bytes,
    credential_ids: Vec<BytesN<32>>,
    field_filters: Vec<FieldFilter>,
    proof_type: PresentationProofType,
    default_ttl: u64,
) -> Result<BytesN<32>, ContractError> {
    owner.require_auth();
    CredentialManager::require_not_paused(env)?;

    if name.is_empty() || name.len() > MAX_TEMPLATE_NAME_LEN {
        return Err(ContractError::InvalidTemplateName);
    }
    if credential_ids.is_empty() {
        return Err(ContractError::EmptyPresentation);
    }
    if credential_ids.len() > MAX_PRESENTATION_SIZE {
        return Err(ContractError::PresentationTooLarge);
    }

    let nonce_key = (TEMPLATE_NONCE, owner.clone());
    let nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0) + 1;
    env.storage().persistent().set(&nonce_key, &nonce);
    env.storage()
        .persistent()
        .extend_ttl(&nonce_key, TTL_MAX, TTL_MAX);

    let template_id = derive_template_id(env, &owner, nonce);
    let template = PresentationTemplate {
        id: template_id.clone(),
        owner: owner.clone(),
        name,
        credential_ids,
        field_filters,
        proof_type,
        default_ttl,
        created_at: env.ledger().timestamp(),
    };

    let key = template_key(&template_id);
    env.storage().persistent().set(&key, &template);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_MAX, TTL_MAX);

    env.events().publish(
        (PRESENTATION, symbol_short!("tmpl_new")),
        (EVENT_VERSION, template_id.clone(), owner),
    );

    Ok(template_id)
}

/// Query a registered presentation template (#1123).
pub fn get_presentation_template(
    env: &Env,
    template_id: BytesN<32>,
) -> Result<PresentationTemplate, ContractError> {
    let key = template_key(&template_id);
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::PresentationTemplateNotFound)
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
