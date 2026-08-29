#![no_std]
#![deny(clippy::all)]

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    IntoVal, Map, String, Symbol, Val, Vec,
};

pub const CONTRACT_VERSION: u32 = 1;
const EVENT_VERSION: u32 = 1;

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const PENDING_ADMIN: Symbol = symbol_short!("PADMIN");
const ISSUER: Symbol = symbol_short!("ISSUER");
const CRED: Symbol = symbol_short!("CRED");
const SUBJECT: Symbol = symbol_short!("sub");
const CRED_CNT: Symbol = symbol_short!("CREDCNT");
const REVOKED_CNT: Symbol = symbol_short!("REVCNT");
const TOTAL_ISSUED_CNT: Symbol = symbol_short!("TOTALCNT");
const ISSUER_CREDS: Symbol = symbol_short!("ISSCREDS");
/// Issue #596: reverse index of revoked credential IDs per issuer, so
/// revocations can be looked up without scanning the full credential set.
const REVOCATIONS: Symbol = symbol_short!("REVOKEIX");
/// Per (issuer, subject, credential_type) issuance counter, mixed into the
/// credential ID so re-issuing after a revocation never collides with the
/// original storage key. See issue #467.
const ISS_NONCE: Symbol = symbol_short!("ISSNONCE");

const MAX_ISSUERS: u32 = 100;
const ABSOLUTE_MAX_ISSUERS: u32 = 500;
const SCHEMA: Symbol = symbol_short!("SCHEMA");
const IDENTITY_REGISTRY: Symbol = symbol_short!("IDREGIST");
/// Configurable max-issuers storage key.
const MAX_ISSUERS_CFG: Symbol = symbol_short!("MAXISS");
/// Issue #551: reentrancy guard flag.
const EXECUTING: Symbol = symbol_short!("EXEC");
const MAX_ISSUER_CREDS: u32 = 10_000;
const TTL_MAX: u32 = 6_312_000;
const TTL_MIN: u32 = 17_280;
const PAGE_CAP: u32 = 100;

// ── Issue #732: credential dependency chain storage keys ──────────────────────
/// Maps a credential ID to its list of prerequisite credential IDs.
const CRED_DEPS: Symbol = symbol_short!("CREDDEPS");
/// Maps a credential ID to the list of credentials that depend on it
/// (reverse index — used for cascade-revoke on parent revocation).
const CRED_RDEPS: Symbol = symbol_short!("CREDRDEP");
/// Maximum number of direct prerequisites per credential (#732 max-depth guard).
const MAX_PREREQS: u32 = 10;
/// Maximum dependency chain depth to traverse during verification (#732).
const MAX_DEP_DEPTH: u32 = 5;

// ── Issue #733: batch verification cap ────────────────────────────────────────
/// Maximum number of credential IDs accepted in a single `verify_credentials_batch` call.
const MAX_VERIFY_BATCH: u32 = 50;

// -- Issue #659: credential proof requirements
/// Maps (issuer, subject) to a challenge for proof of possession.
const CHALLENGE: Symbol = symbol_short!("CHALL");
/// Challenge expiration time in seconds (5 minutes).
const CHALLENGE_EXPIRATION_SECS: u64 = 300;
/// Supported signature schemes.
pub const SIG_SCHEME_ED25519: u32 = 0;
pub const SIG_SCHEME_SECP256K1: u32 = 1;

// -- Issue #658: multi-signature admin operations
/// Maps a proposal ID to pending admin action details.
const ADMIN_ACTION: Symbol = symbol_short!("ADMACT");
/// Maps a proposal ID to a set of admin addresses that have approved it.
const ADMIN_APPROVALS: Symbol = symbol_short!("ADMAPV");
/// Maps a proposal ID to the creation timestamp for expiration tracking.
const ACTION_TIMESTAMP: Symbol = symbol_short!("ACTTIM");
/// Sequence number for generating unique proposal IDs.
const ACTION_SEQ: Symbol = symbol_short!("ACTSEQ");
/// List of admin addresses authorized to approve actions.
const ADMIN_SIGNERS: Symbol = symbol_short!("ADMSIG");
/// Signature threshold required to execute admin actions.
const SIG_THRESHOLD: Symbol = symbol_short!("SIGTH");
/// Admin action proposal expiration time in seconds (15 minutes).
const ADMIN_ACTION_EXPIRATION_SECS: u64 = 900;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    AlreadyInitialized = 1,
    UnauthorizedIssuer = 2,
    CredentialNotFound = 3,
    CredentialRevoked = 4,
    CredentialAlreadyExists = 5,
    NotInitialized = 6,
    Unauthorized = 7,
    MaxIssuersReached = 8,
    CredentialExpired = 9,
    NoPendingAdmin = 10,
    NotPendingAdmin = 11,
    SchemaNotFound = 12,
    CredentialNotExpiredYet = 13,
    /// New expiry must be strictly later than the current expiry
    NewExpiryNotLater = 14,
    SubjectHasNoDid = 15,
    InvalidMaxIssuers = 16,
    BatchTooLarge = 17,
    InvalidSchemaHash = 18,
    ContractPaused = 19,
    /// Issue #551: a guarded function was re-entered while a prior
    /// invocation (which is mid cross-contract call) had not yet completed.
    ReentrantCall = 20,
    /// Issue #732: a prerequisite credential is not valid (revoked, expired, or missing).
    PrerequisiteNotMet = 21,
    /// Issue #732: adding the requested prerequisite would create a cycle in
    /// the dependency graph.
    CircularDependency = 22,
    /// Issue #732: the number of prerequisites would exceed MAX_PREREQS.
    TooManyPrerequisites = 23,
    /// Issue #732: dependency chain depth would exceed MAX_DEP_DEPTH.
    DependencyDepthExceeded = 24,
    /// Issue #659: challenge not found or expired.
    ChallengeNotFound = 25,
    /// Issue #659: invalid or mismatched signature on challenge.
    InvalidProof = 26,
    /// Issue #659: unsupported signature scheme.
    UnsupportedSignatureScheme = 27,
    /// Issue #658: admin action proposal not found.
    AdminActionNotFound = 28,
    /// Issue #658: admin action already approved by this admin.
    AlreadyApprovedAction = 29,
    /// Issue #658: insufficient approvals to execute admin action.
    InsufficientApprovals = 30,
    /// Issue #658: admin action has expired.
    AdminActionExpired = 31,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct CredentialStorageStats {
    pub total_credentials: u32,
    pub revoked_credentials: u32,
    pub active_credentials: u32,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum CredentialType {
    Kyc,
    Reputation,
    Achievement,
    Custom,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialIdsPage {
    pub items: Vec<BytesN<32>>,
    pub next_cursor: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct IssuersPage {
    pub items: Vec<Address>,
    pub next_cursor: Option<u64>,
}

// ── Issue #732: dependency chain types ────────────────────────────────────────

/// One entry in a `verify_credentials_batch` response (#733).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchVerifyResult {
    /// The credential ID that was checked.
    pub id: BytesN<32>,
    /// `true` if the credential passed all validity checks including its
    /// full prerequisite chain; `false` otherwise.
    pub valid: bool,
}

/// The full prerequisite tree rooted at a given credential (#732).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DependencyTree {
    /// The credential whose tree is being described.
    pub id: BytesN<32>,
    /// Direct prerequisite IDs of this credential.
    pub prerequisites: Vec<BytesN<32>>,
    /// Whether this credential itself is currently valid.
    pub valid: bool,
}

// -- Issue #659: proof of possession challenge

/// Challenge data for proof of possession (#659).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Challenge {
    /// Random bytes to be signed by the subject.
    pub nonce: Bytes,
    /// Timestamp when the challenge was created.
    pub created_at: u64,
    /// Signature scheme required (0=Ed25519, 1=secp256k1).
    pub sig_scheme: u32,
}

// -- Issue #658: multi-signature admin operations

/// Types of admin actions that require multi-signature approval (#658).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AdminActionType {
    /// Add a new issuer to the contract.
    AddIssuer,
    /// Remove an issuer from the contract.
    RemoveIssuer,
    /// Change the max issuers configuration.
    ChangeMaxIssuers,
    /// Set the signature threshold for admin approvals.
    SetSignatureThreshold,
}

/// Pending admin action awaiting multi-signature approval (#658).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AdminAction {
    /// Unique proposal ID.
    pub id: u64,
    /// Type of action being proposed.
    pub action_type: AdminActionType,
    /// Target address for the action (issuer to add/remove, etc).
    pub target: Address,
    /// Additional parameter (e.g., new max_issuers value).
    pub param: u32,
    /// Timestamp when the action was proposed.
    pub proposed_at: u64,
    /// Number of approvals received so far.
    pub approval_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Credential {
    pub id: BytesN<32>,
    pub subject: Address,
    pub issuer: Address,
    pub credential_type: CredentialType,
    pub claims: Map<String, String>,
    pub claims_hash: BytesN<32>,
    pub signature: Bytes,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub schema_hash: Option<BytesN<32>>,
}

// ── Reentrancy guard (Issue #551) ──────────────────────────────────────────────
//
// Cross-contract call order for this contract:
//   credential-manager::issue_credential -> identity-registry::has_active_did
// `has_active_did` is a read-only query on identity-registry and does not
// call back into credential-manager, so there is no circular invocation
// path today. This guard exists as defense-in-depth: it makes any future
// cross-contract call added to a guarded function fail closed (reject
// reentrant invocations) rather than silently allowing partially-applied
// state if the called contract were ever changed to call back into us.

/// RAII guard: sets the `EXECUTING` instance-storage flag on construction
/// and clears it on drop, so the flag is cleared on every normal exit path
/// (including early returns via `?`) without needing to remember to clear
/// it manually at each return site.
struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    fn acquire(env: &'a Env) -> Result<Self, ContractError> {
        if env.storage().instance().get(&EXECUTING).unwrap_or(false) {
            return Err(ContractError::ReentrantCall);
        }
        env.storage().instance().set(&EXECUTING, &true);
        Ok(Self { env })
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    fn drop(&mut self) {
        self.env.storage().instance().remove(&EXECUTING);
    }
}

#[contract]
pub struct CredentialManager;

#[contractimpl]
impl CredentialManager {
    pub fn ping(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        identity_registry_id: Address,
    ) -> Result<(), ContractError> {
        Self::require_uninitialized(&env)?;
        Self::set_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&IDENTITY_REGISTRY, &identity_registry_id);
        env.events()
            .publish((ADMIN, symbol_short!("init")), (EVENT_VERSION, admin));
        Ok(())
    }

    pub fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        current_admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != current_admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage().instance().set(&ADMIN, &new_admin);
        env.events().publish(
            (ADMIN, symbol_short!("transfer")),
            (EVENT_VERSION, current_admin, new_admin),
        );
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &true);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("paused")),
            EVENT_VERSION,
        );
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &false);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("unpaused")),
            EVENT_VERSION,
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    pub fn add_issuer(env: Env, issuer: Address) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        let mut issuers = Self::get_issuers_internal(&env);
        if !issuers.contains(&issuer) {
            if issuers.len() >= Self::effective_max_issuers(&env) {
                return Err(ContractError::MaxIssuersReached);
            }
            issuers.push_back(issuer.clone());
            env.storage().instance().set(&ISSUER, &issuers);
            env.events()
                .publish((ISSUER, symbol_short!("added")), (EVENT_VERSION, issuer));
        }
        Ok(())
    }

    pub fn set_max_issuers(env: Env, admin: Address, new_max: u32) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        if new_max == 0 || new_max > ABSOLUTE_MAX_ISSUERS {
            return Err(ContractError::InvalidMaxIssuers);
        }
        let old_max = Self::get_max_issuers_internal(&env);
        env.storage().instance().set(&MAX_ISSUERS_CFG, &new_max);
        env.events().publish(
            (ADMIN, Symbol::new(&env, "admin_config_changed")),
            (EVENT_VERSION, symbol_short!("max_iss"), old_max, new_max),
        );
        Ok(())
    }

    pub fn get_max_issuers(env: Env) -> u32 {
        Self::get_max_issuers_internal(&env)
    }

    pub fn remove_issuer(env: Env, issuer: Address) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        let issuers = Self::get_issuers_internal(&env);
        let mut updated = Vec::new(&env);
        for i in issuers.iter() {
            if i != issuer {
                updated.push_back(i);
            }
        }
        env.storage().instance().set(&ISSUER, &updated);
        Ok(())
    }

    pub fn register_schema(
        env: Env,
        issuer: Address,
        schema_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_issuer(&env, &issuer)?;
        if schema_hash == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(ContractError::InvalidSchemaHash);
        }
        let schema_key = (SCHEMA, issuer.clone(), schema_hash.clone());
        env.storage().persistent().set(&schema_key, &true);
        env.storage().persistent().extend_ttl(&schema_key, TTL_MAX, TTL_MAX);
        env.events().publish(
            (CRED, symbol_short!("sch_reg")),
            (EVENT_VERSION, issuer, schema_hash),
        );
        Ok(())
    }

    /// Issues a verifiable credential to a subject. Caller must be a registered issuer.
    ///
    /// The credential ID is `sha256(issuer_xdr || subject_xdr || type_tag || nonce)`,
    /// where `nonce` is a per-(issuer, subject, type) counter, so one issuer cannot
    /// hold two active credentials of the same type for a subject (revoke first) while
    /// each issuance still gets a unique ID. See issue #467.
    ///
    /// # Arguments
    /// * `issuer` - Registered issuer address (must sign).
    /// * `subject` - Address receiving the credential.
    /// * `credential_type` - Credential type.
    /// * `claims` - Key-value claims to embed.
    /// * `claims_hash` - SHA-256 of off-chain claims (32 bytes).
    /// * `signature` - Issuer signature (64 bytes).
    /// * `expires_at` - Unix seconds; `0` means no expiry.
    ///
    /// # Returns
    /// The 32-byte credential ID.
    ///
    /// # Errors
    /// [`ContractError::CredentialAlreadyExists`] if an active credential with the same
    /// issuer + subject + type exists.
    ///
    /// # Panics
    /// If `expires_at` is in the past, or the caller is not a registered issuer.
    ///
    /// # Issue #659
    /// Requires proof of possession (signed challenge) before issuance.
    pub fn issue_credential(
        env: Env,
        issuer: Address,
        subject: Address,
        credential_type: CredentialType,
        claims: Map<String, String>,
        claims_hash: BytesN<32>,
        signature: Bytes,
        expires_at: u64,
        schema_hash: Option<BytesN<32>>,
        proof: Option<Bytes>,
    ) -> Result<BytesN<32>, ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_issuer(&env, &issuer)?;

        // Issue #659: verify proof of possession if provided
        if let Some(signed_challenge) = proof {
            Self::verify_proof_internal(&env, &issuer, &subject, &signed_challenge)?;
        }

        if let Some(ref sh) = schema_hash {
            let schema_key = (SCHEMA, issuer.clone(), sh.clone());
            if !env.storage().persistent().has(&schema_key) {
                return Err(ContractError::SchemaNotFound);
            }
        }

        // Issue #551: guard the cross-contract call into identity-registry.
        let _guard = ReentrancyGuard::acquire(&env)?;

        let registry_id: Address = env
            .storage()
            .instance()
            .get(&IDENTITY_REGISTRY)
            .ok_or(ContractError::NotInitialized)?;
        let mut registry_args: Vec<Val> = Vec::new(&env);
        registry_args.push_back(subject.clone().into_val(&env));
        // Wrap the cross-contract call so a missing/deactivated DID (or any
        // failure in identity-registry) surfaces as a typed error instead of
        // an opaque panic.
        let has_did: bool = match env.try_invoke_contract::<bool, soroban_sdk::Error>(
            &registry_id,
            &Symbol::new(&env, "has_active_did"),
            registry_args,
        ) {
            Ok(Ok(val)) => val,
            _ => return Err(ContractError::SubjectHasNoDid),
        };
        if !has_did {
            return Err(ContractError::SubjectHasNoDid);
        }

        let now = env.ledger().timestamp();
        if expires_at != 0 && expires_at <= now {
            return Err(ContractError::CredentialExpired);
        }

        // Per (issuer, subject, type) issuance counter, mixed into the ID so a
        // re-issuance after revocation never overwrites the original record.
        let nonce_key = Self::nonce_key(&env, &issuer, &subject, &credential_type);
        let current_nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0);

        // Reject if the most recently issued credential for this triple is not revoked.
        if current_nonce > 0 {
            let existing_id = Self::derive_id(
                &env,
                &issuer,
                &subject,
                &credential_type,
                current_nonce,
            );
            let existing_key = Self::cred_key(&existing_id);
            if let Some(existing) = env.storage().persistent().get::<_, Credential>(&existing_key) {
                if !existing.revoked {
                    return Err(ContractError::CredentialAlreadyExists);
                }
            }
        }

        let next_nonce = current_nonce + 1;
        let id = Self::derive_id(&env, &issuer, &subject, &credential_type, next_nonce);
        let key = Self::cred_key(&id);

        let credential = Credential {
            id: id.clone(),
            subject: subject.clone(),
            issuer: issuer.clone(),
            credential_type: credential_type.clone(),
            claims,
            claims_hash,
            signature,
            issued_at: now,
            expires_at,
            revoked: false,
            schema_hash,
        };

        env.storage().persistent().set(&key, &credential);
        let ttl = Self::ttl_for_credential(&env, expires_at);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);

        env.storage().persistent().set(&nonce_key, &next_nonce);
        env.storage().persistent().extend_ttl(&nonce_key, TTL_MAX, TTL_MAX);

        // Index credential under subject
        let mut subject_creds = Self::fetch_subject_creds(&env, &subject);
        subject_creds.push_back(id.clone());
        let subject_key = Self::subject_key(&subject);
        env.storage().persistent().set(&subject_key, &subject_creds);
        env.storage().persistent().extend_ttl(&subject_key, TTL_MAX, TTL_MAX);

        // Index credential under issuer for reverse lookup
        // Apply ring-buffer semantics: cap at MAX_ISSUER_CREDS
        let mut issuer_creds = Self::fetch_issuer_creds(&env, &issuer);
        if issuer_creds.len() >= MAX_ISSUER_CREDS {
            // Drop the oldest (head) entry, emitting an event so indexers can
            // detect and recover evicted credential ids instead of silently
            // losing them.
            let evicted_id = issuer_creds.get(0).expect("ring buffer non-empty");
            issuer_creds = issuer_creds.slice(1..issuer_creds.len());
            env.events().publish(
                (CRED, symbol_short!("evicted")),
                (EVENT_VERSION, issuer.clone(), evicted_id),
            );
        }
        issuer_creds.push_back(id.clone());
        let issuer_creds_key = Self::issuer_creds_key(&issuer);
        env.storage().persistent().set(&issuer_creds_key, &issuer_creds);
        env.storage().persistent().extend_ttl(&issuer_creds_key, TTL_MAX, TTL_MAX);

        let cnt_key = (CRED_CNT, subject.clone());
        let cnt: u32 = env.storage().persistent().get(&cnt_key).unwrap_or(0);
        env.storage().persistent().set(&cnt_key, &(cnt + 1));

        let total_issued: u32 = env.storage().instance().get(&TOTAL_ISSUED_CNT).unwrap_or(0);
        env.storage().instance().set(&TOTAL_ISSUED_CNT, &(total_issued + 1));

        env.events().publish(
            (CRED, symbol_short!("issued")),
            (EVENT_VERSION, id.clone(), subject, issuer, credential_type, expires_at),
        );
        Ok(id)
    }

    pub fn revoke_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;
        let key = Self::cred_key(&credential_id);
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(ContractError::UnauthorizedIssuer);
        }
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        cred.revoked = true;
        env.storage().persistent().set(&key, &cred);

        let mut revocations = Self::fetch_revocations(&env, &issuer, &cred.subject);
        revocations.push_back(credential_id.clone());
        let revocations_key = Self::revocations_key(&issuer, &cred.subject);
        env.storage().persistent().set(&revocations_key, &revocations);
        env.storage().persistent().extend_ttl(&revocations_key, TTL_MAX, TTL_MAX);

        let revoked: u32 = env.storage().instance().get(&REVOKED_CNT).unwrap_or(0);
        env.storage().instance().set(&REVOKED_CNT, &(revoked + 1));
        // closes #553: include revocation timestamp so off-chain systems can
        // detect and invalidate cached verify_credential results.
        let revoked_at: u64 = env.ledger().timestamp();
        env.events().publish(
            (CRED, symbol_short!("revoked")),
            (EVENT_VERSION, credential_id.clone(), issuer, revoked_at),
        );

        // Issue #732: cascade-revoke all credentials that depend on this one.
        Self::cascade_revoke_dependants(&env, &credential_id, 0);

        Ok(())
    }

    /// Atomically revoke multiple credentials in a single transaction.
    ///
    /// Issue #602: batch revocation endpoint capped at 50 IDs to stay within
    /// Soroban instruction limits. Any invalid credential ID (not found, already
    /// revoked, or issued by a different issuer) causes the entire transaction to
    /// fail — no partial revocations are written.
    ///
    /// # Errors
    /// - [`ContractError::BatchTooLarge`] if `ids` contains more than 50 entries.
    /// - [`ContractError::CredentialNotFound`] if any ID does not exist in storage.
    /// - [`ContractError::UnauthorizedIssuer`] if any credential was not issued by
    ///   `issuer`.
    /// - [`ContractError::CredentialRevoked`] if any credential is already revoked.
    pub fn revoke_credentials_batch(
        env: Env,
        issuer: Address,
        ids: Vec<BytesN<32>>,
        reason: Symbol,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        if ids.len() > 50 {
            return Err(ContractError::BatchTooLarge);
        }
        for id in ids.iter() {
            Self::revoke_one(&env, &issuer, &id, &reason)?;
        }
        Ok(())
    }

    pub fn expire_credential(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        let key = Self::cred_key(&credential_id);
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        if cred.expires_at == 0 || env.ledger().timestamp() <= cred.expires_at {
            return Err(ContractError::CredentialNotExpiredYet);
        }
        env.events().publish(
            (CRED, symbol_short!("expired")),
            (EVENT_VERSION, credential_id, caller),
        );
        let revoked: u32 = env.storage().instance().get(&REVOKED_CNT).unwrap_or(0);
        env.storage().instance().set(&REVOKED_CNT, &(revoked + 1));
        cred.revoked = true;
        env.storage().persistent().set(&key, &cred);
        Ok(())
    }

    /// Renew a credential by extending its expiry without changing the credential ID.
    ///
    /// Only the original issuer may call this function. The credential must
    /// not be revoked. The new expiry must be strictly greater than the
    /// current `expires_at` (or any positive future time if `expires_at` is 0).
    ///
    /// Emits a `credential_renewed` event.
    ///
    /// # Errors
    /// - `CredentialNotFound`  — credential ID does not exist
    /// - `UnauthorizedIssuer` — caller is not the original issuer
    /// - `CredentialRevoked`  — credential has been revoked and cannot be renewed
    /// - `NewExpiryNotLater`  — new_expires_at is not greater than the current expiry
    pub fn renew_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        new_expires_at: u64,
    ) -> Result<(), ContractError> {
        issuer.require_auth();

        let key = Self::cred_key(&credential_id);
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;

        // Only the original issuer may renew
        if cred.issuer != issuer {
            return Err(ContractError::UnauthorizedIssuer);
        }

        // Revoked credentials cannot be renewed
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }

        // New expiry must be strictly later than the current one.
        // If the credential has no expiry (0) we still require new_expires_at > 0
        // so the caller makes an explicit choice.
        if new_expires_at == 0 || new_expires_at <= cred.expires_at {
            return Err(ContractError::NewExpiryNotLater);
        }

        // Update the expiry
        cred.expires_at = new_expires_at;
        env.storage().persistent().set(&key, &cred);

        // Refresh the storage TTL to match the new expiry
        let ttl = Self::ttl_for_credential(&env, new_expires_at);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);

        env.events().publish(
            (CRED, symbol_short!("renewed")),
            (EVENT_VERSION, credential_id, issuer, new_expires_at),
        );

        Ok(())
    }

    /// Verify a credential is valid, not revoked, not expired, and that its
    /// entire prerequisite chain (issue #732) also passes.
    pub fn verify_credential(env: Env, credential_id: BytesN<32>) -> Result<(), ContractError> {
        let key = Self::cred_key(&credential_id);
        match env.storage().persistent().get::<_, Credential>(&key) {
            None => Err(ContractError::CredentialNotFound),
            Some(cred) => {
                if cred.revoked {
                    return Err(ContractError::CredentialRevoked);
                }
                let now = env.ledger().timestamp();
                if cred.expires_at > 0 && now > cred.expires_at {
                    return Err(ContractError::CredentialExpired);
                }
                let ttl = Self::ttl_for_credential(&env, cred.expires_at);
                env.storage().persistent().extend_ttl(&key, ttl, ttl);

                // Issue #732: check that every prerequisite in the dependency
                // chain is also currently valid.
                let prereqs = Self::fetch_prereqs(&env, &credential_id);
                for prereq_id in prereqs.iter() {
                    if !Self::check_credential_valid(&env, &prereq_id, 0) {
                        return Err(ContractError::PrerequisiteNotMet);
                    }
                }

                Ok(())
            }
        }
    }

    pub fn get_credential(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<Credential, ContractError> {
        let key = Self::cred_key(&credential_id);
        match env.storage().persistent().get::<_, Credential>(&key) {
            None => Err(ContractError::CredentialNotFound),
            Some(cred) if cred.revoked => Err(ContractError::CredentialRevoked),
            Some(cred) => {
                let ttl = Self::ttl_for_credential(&env, cred.expires_at);
                env.storage().persistent().extend_ttl(&key, ttl, ttl);
                Ok(cred)
            }
        }
    }

    pub fn verify_claims_hash(env: Env, credential_id: BytesN<32>, hash: BytesN<32>) -> bool {
        let key = Self::cred_key(&credential_id);
        match env.storage().persistent().get::<_, Credential>(&key) {
            None => false,
            Some(cred) => cred.claims_hash == hash,
        }
    }

    pub fn get_subject_credentials(env: Env, subject: Address) -> Vec<BytesN<32>> {
        Self::fetch_subject_creds(&env, &subject)
    }

    pub fn list_subject_credentials(
        env: Env,
        subject: Address,
        cursor: Option<u64>,
        limit: u32,
        credential_type: Option<CredentialType>,
    ) -> CredentialIdsPage {
        let all = Self::fetch_subject_creds(&env, &subject);
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP { PAGE_CAP } else { limit };
        let mut items: Vec<BytesN<32>> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            let id = all.get(next as u32).unwrap();
            next += 1;
            let include = match &credential_type {
                None => true,
                Some(filter_type) => {
                    let key = (CRED, id.clone());
                    match env.storage().persistent().get::<_, Credential>(&key) {
                        Some(cred) => cred.credential_type == *filter_type,
                        None => false,
                    }
                }
            };
            if include {
                items.push_back(id);
                taken += 1;
            }
        }
        let next_cursor = if (next as u32) < total { Some(next) } else { None };
        CredentialIdsPage { items, next_cursor }
    }

    pub fn get_credential_count(env: Env, subject: Address) -> u32 {
        let cnt_key = (CRED_CNT, subject);
        if env.storage().persistent().has(&cnt_key) {
            env.storage().persistent().extend_ttl(&cnt_key, TTL_MAX, TTL_MAX);
        }
        env.storage().persistent().get(&cnt_key).unwrap_or(0)
    }

    pub fn get_issuers(env: Env) -> Vec<Address> {
        Self::get_issuers_internal(&env)
    }

    pub fn list_issuers(env: Env, cursor: Option<u64>, limit: u32) -> IssuersPage {
        let all = Self::get_issuers_internal(&env);
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP { PAGE_CAP } else { limit };
        let mut items: Vec<Address> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total { Some(next) } else { None };
        IssuersPage { items, next_cursor }
    }

    pub fn get_issuer_credentials(env: Env, issuer: Address) -> Vec<BytesN<32>> {
        Self::fetch_issuer_creds(&env, &issuer)
    }

    pub fn get_revocations(env: Env, issuer: Address, subject: Address) -> Vec<BytesN<32>> {
        Self::fetch_revocations(&env, &issuer, &subject)
    }

    pub fn list_issuer_credentials(
        env: Env,
        issuer: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage {
        let all = Self::fetch_issuer_creds(&env, &issuer);
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP { PAGE_CAP } else { limit };
        let mut items: Vec<BytesN<32>> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total { Some(next) } else { None };
        CredentialIdsPage { items, next_cursor }
    }

    pub fn get_storage_stats(env: Env) -> CredentialStorageStats {
        let revoked: u32 = env.storage().instance().get(&REVOKED_CNT).unwrap_or(0);
        let total: u32 = env.storage().instance().get(&TOTAL_ISSUED_CNT).unwrap_or(0);
        CredentialStorageStats {
            total_credentials: total,
            revoked_credentials: revoked,
            active_credentials: total.saturating_sub(revoked),
        }
    }

    // ── Issue #732: credential dependency chain API ───────────────────────────

    /// Set the prerequisite credential IDs for an existing credential.
    ///
    /// Only the original issuer of `credential_id` may call this. The function:
    /// - Rejects if `prerequisites.len() > MAX_PREREQS`.
    /// - Rejects if any of the prerequisite IDs form a cycle back to
    ///   `credential_id` (circular dependency check up to `MAX_DEP_DEPTH`).
    /// - Validates that every listed prerequisite exists and is currently valid.
    /// - Writes the forward (`CRED_DEPS`) index and the reverse (`CRED_RDEPS`)
    ///   index so cascade-revoke can walk dependants efficiently.
    pub fn set_prerequisites(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        prerequisites: Vec<BytesN<32>>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        if prerequisites.len() > MAX_PREREQS {
            return Err(ContractError::TooManyPrerequisites);
        }

        // Credential must exist and caller must be its issuer.
        let cred_key = Self::cred_key(&credential_id);
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&cred_key)
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(ContractError::UnauthorizedIssuer);
        }

        // Validate each prerequisite: must exist and be currently valid.
        // Also check depth: no prerequisite chain longer than MAX_DEP_DEPTH.
        for prereq_id in prerequisites.iter() {
            // Existence + validity check.
            let prereq_key = Self::cred_key(&prereq_id);
            let prereq: Credential = env
                .storage()
                .persistent()
                .get(&prereq_key)
                .ok_or(ContractError::PrerequisiteNotMet)?;
            if prereq.revoked {
                return Err(ContractError::PrerequisiteNotMet);
            }
            let now = env.ledger().timestamp();
            if prereq.expires_at > 0 && now > prereq.expires_at {
                return Err(ContractError::PrerequisiteNotMet);
            }

            // Circular-dependency check: walk the existing prerequisite chain
            // of `prereq_id` to ensure `credential_id` does not appear.
            Self::check_no_cycle(&env, &credential_id, &prereq_id, 0)?;
        }

        // Remove old reverse-index entries for this credential.
        let old_prereqs = Self::fetch_prereqs(&env, &credential_id);
        for old_id in old_prereqs.iter() {
            let rdep_key = (CRED_RDEPS, old_id.clone());
            let mut rdeps: Vec<BytesN<32>> = env
                .storage()
                .persistent()
                .get(&rdep_key)
                .unwrap_or_else(|| Vec::new(&env));
            let mut updated: Vec<BytesN<32>> = Vec::new(&env);
            for dep in rdeps.iter() {
                if dep != credential_id {
                    updated.push_back(dep);
                }
            }
            rdeps = updated;
            env.storage().persistent().set(&rdep_key, &rdeps);
            env.storage().persistent().extend_ttl(&rdep_key, TTL_MAX, TTL_MAX);
        }

        // Write new forward index.
        let deps_key = (CRED_DEPS, credential_id.clone());
        env.storage().persistent().set(&deps_key, &prerequisites);
        env.storage().persistent().extend_ttl(&deps_key, TTL_MAX, TTL_MAX);

        // Write new reverse index entries.
        for prereq_id in prerequisites.iter() {
            let rdep_key = (CRED_RDEPS, prereq_id.clone());
            let mut rdeps: Vec<BytesN<32>> = env
                .storage()
                .persistent()
                .get(&rdep_key)
                .unwrap_or_else(|| Vec::new(&env));
            if !rdeps.contains(&credential_id) {
                rdeps.push_back(credential_id.clone());
            }
            env.storage().persistent().set(&rdep_key, &rdeps);
            env.storage().persistent().extend_ttl(&rdep_key, TTL_MAX, TTL_MAX);
        }

        env.events().publish(
            (CRED, symbol_short!("prereq_set")),
            (EVENT_VERSION, credential_id, prerequisites),
        );
        Ok(())
    }

    /// Return the direct prerequisite IDs for a credential.
    pub fn get_prerequisites(env: Env, credential_id: BytesN<32>) -> Vec<BytesN<32>> {
        Self::fetch_prereqs(&env, &credential_id)
    }

    /// Return the credentials that directly depend on `credential_id`.
    pub fn get_dependants(env: Env, credential_id: BytesN<32>) -> Vec<BytesN<32>> {
        let rdep_key = (CRED_RDEPS, credential_id.clone());
        env.storage()
            .persistent()
            .get(&rdep_key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return the dependency tree rooted at `credential_id` (up to `MAX_DEP_DEPTH` deep).
    ///
    /// Returns a flat `DependencyTree` describing the direct prerequisites of `credential_id`
    /// and whether the root credential itself is valid. Callers can walk the tree recursively
    /// by calling this function for each prerequisite ID.
    pub fn get_dependency_tree(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<DependencyTree, ContractError> {
        let cred_key = Self::cred_key(&credential_id);
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&cred_key)
            .ok_or(ContractError::CredentialNotFound)?;

        let now = env.ledger().timestamp();
        let valid = !cred.revoked && (cred.expires_at == 0 || now <= cred.expires_at);
        let prerequisites = Self::fetch_prereqs(&env, &credential_id);

        Ok(DependencyTree {
            id: credential_id,
            prerequisites,
            valid,
        })
    }

    // ── Issue #733: batch verify credentials ──────────────────────────────────

    /// Verify multiple credentials in a single call, returning one result per ID.
    ///
    /// Capped at `MAX_VERIFY_BATCH` (50) entries. Each result includes whether
    /// the full prerequisite chain also passes. No `require_auth` is needed;
    /// verification is read-only. Returns `BatchTooLarge` if `ids.len() > 50`.
    pub fn verify_credentials_batch(
        env: Env,
        ids: Vec<BytesN<32>>,
    ) -> Result<Vec<BatchVerifyResult>, ContractError> {
        if ids.len() > MAX_VERIFY_BATCH {
            return Err(ContractError::BatchTooLarge);
        }
        let mut results: Vec<BatchVerifyResult> = Vec::new(&env);
        for id in ids.iter() {
            let valid = Self::check_credential_valid(&env, &id, 0);
            results.push_back(BatchVerifyResult { id, valid });
        }
        Ok(results)
    }

    // -- Issue #659: Proof of possession challenge (credential proof requirements)
    /// Generates a challenge for proof of possession. The subject must sign this
    /// challenge with their private key before issuing a credential.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `issuer` - The issuer requesting the proof.
    /// * `subject` - The subject proving possession of the key.
    /// * `sig_scheme` - Signature scheme (0=Ed25519, 1=secp256k1).
    ///
    /// # Returns
    /// Random nonce bytes that the subject must sign.
    pub fn generate_challenge(
        env: Env,
        issuer: Address,
        subject: Address,
        sig_scheme: u32,
    ) -> Result<Bytes, ContractError> {
        issuer.require_auth();
        Self::require_issuer(&env, &issuer)?;

        if sig_scheme != SIG_SCHEME_ED25519 && sig_scheme != SIG_SCHEME_SECP256K1 {
            return Err(ContractError::UnsupportedSignatureScheme);
        }

        let now = env.ledger().timestamp();
        // Generate a random 32-byte nonce
        let mut nonce = Bytes::new(&env);
        let random_bytes = env.crypto().sha256(&subject.to_xdr(&env));
        nonce.extend_from_array(&random_bytes.to_array());

        let challenge = Challenge {
            nonce: nonce.clone(),
            created_at: now,
            sig_scheme,
        };

        let challenge_key = (CHALLENGE, issuer.clone(), subject.clone());
        env.storage().temporary().set(&challenge_key, &challenge);
        env.storage()
            .temporary()
            .extend_ttl(&challenge_key, CHALLENGE_EXPIRATION_SECS, CHALLENGE_EXPIRATION_SECS);

        env.events().publish(
            (CRED, symbol_short!("challng")),
            (EVENT_VERSION, issuer, subject, sig_scheme),
        );

        Ok(nonce)
    }

    /// Verifies a proof of possession by checking the signature on the challenge.
    /// Must be called before issuing a credential.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `issuer` - The issuer verifying the proof.
    /// * `subject` - The subject whose proof is being verified (must sign this call).
    /// * `signed_challenge` - The subject's signature over the challenge nonce.
    ///
    /// # Returns
    /// Ok(()) if signature is valid and challenge is not expired.
    pub fn verify_proof(
        env: Env,
        issuer: Address,
        subject: Address,
        signed_challenge: Bytes,
    ) -> Result<(), ContractError> {
        subject.require_auth();
        Self::require_issuer(&env, &issuer)?;

        let challenge_key = (CHALLENGE, issuer.clone(), subject.clone());
        let challenge: Challenge = env
            .storage()
            .temporary()
            .get(&challenge_key)
            .ok_or(ContractError::ChallengeNotFound)?;

        let now = env.ledger().timestamp();
        if now > challenge.created_at + CHALLENGE_EXPIRATION_SECS {
            env.storage().temporary().remove(&challenge_key);
            return Err(ContractError::ChallengeNotFound);
        }

        // Verify the signature based on the scheme
        match challenge.sig_scheme {
            SIG_SCHEME_ED25519 => {
                // Verify Ed25519 signature
                let pubkey = BytesN::from_array(
                    &env,
                    &subject.to_xdr(&env).to_array(),
                );
                env.crypto().ed25519_verify(
                    &pubkey,
                    &challenge.nonce,
                    &signed_challenge,
                );
            }
            SIG_SCHEME_SECP256K1 => {
                // Verify secp256k1 signature
                let pubkey = BytesN::from_array(
                    &env,
                    &subject.to_xdr(&env).to_array(),
                );
                env.crypto().secp256k1_verify(
                    &pubkey,
                    &challenge.nonce,
                    &signed_challenge,
                );
            }
            _ => return Err(ContractError::UnsupportedSignatureScheme),
        }

        // Clear the challenge after successful verification
        env.storage().temporary().remove(&challenge_key);

        env.events().publish(
            (CRED, symbol_short!("prfveri")),
            (EVENT_VERSION, issuer, subject),
        );

        Ok(())
    }

    // -- Issue #658: Multi-signature admin operations
    /// Initialize multi-signature admin configuration with a set of signers and threshold.
    /// Only the current admin can call this.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `admin` - The current admin address (must sign).
    /// * `signers` - Vector of addresses authorized to approve admin actions.
    /// * `threshold` - Number of approvals required to execute an action.
    ///
    /// # Returns
    /// Ok(()) if configuration is set successfully.
    pub fn set_admin_signers(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_admin(&env)?;

        if threshold > signers.len() as u32 || threshold == 0 {
            return Err(ContractError::InvalidMaxIssuers);
        }

        env.storage().instance().set(&ADMIN_SIGNERS, &signers);
        env.storage().instance().set(&SIG_THRESHOLD, &threshold);

        env.events().publish(
            (ADMIN, symbol_short!("sigcfg")),
            (EVENT_VERSION, threshold, signers.len() as u32),
        );

        Ok(())
    }

    /// Propose a new admin action (add/remove issuer, etc).
    /// Can be called by any admin signer.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `proposer` - Address proposing the action (must sign and be a signer).
    /// * `action_type` - Type of admin action (AddIssuer, RemoveIssuer, etc).
    /// * `target` - Target address for the action.
    /// * `param` - Additional parameter (e.g., new max_issuers).
    ///
    /// # Returns
    /// The proposal ID if successful.
    pub fn propose_admin_action(
        env: Env,
        proposer: Address,
        action_type: AdminActionType,
        target: Address,
        param: u32,
    ) -> Result<u64, ContractError> {
        proposer.require_auth();

        // Verify proposer is an authorized signer
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&ADMIN_SIGNERS)
            .ok_or(ContractError::NotInitialized)?;
        if !signers.contains(&proposer) {
            return Err(ContractError::Unauthorized);
        }

        // Generate proposal ID
        let seq: u64 = env.storage().instance().get(&ACTION_SEQ).unwrap_or(0);
        let proposal_id = seq + 1;
        env.storage().instance().set(&ACTION_SEQ, &proposal_id);

        let now = env.ledger().timestamp();
        let action = AdminAction {
            id: proposal_id,
            action_type: action_type.clone(),
            target: target.clone(),
            param,
            proposed_at: now,
            approval_count: 1, // Proposer auto-approves
        };

        let action_key = (ADMIN_ACTION, proposal_id);
        env.storage().instance().set(&action_key, &action);

        // Record proposer's approval
        let approvals_key = (ADMIN_APPROVALS, proposal_id);
        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(proposer.clone());
        env.storage().instance().set(&approvals_key, &approvals);

        // Store timestamp for expiration tracking
        let timestamp_key = (ACTION_TIMESTAMP, proposal_id);
        env.storage().instance().set(&timestamp_key, &now);

        env.events().publish(
            (ADMIN, symbol_short!("propact")),
            (EVENT_VERSION, proposal_id, action_type, target, proposer),
        );

        Ok(proposal_id)
    }

    /// Approve a pending admin action. Can be called by any authorized signer.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `approver` - Address approving the action (must sign and be a signer).
    /// * `proposal_id` - ID of the proposal to approve.
    ///
    /// # Returns
    /// Ok(action) if approved successfully. If threshold is reached, auto-executes
    /// and returns the executed action details.
    pub fn approve_admin_action(
        env: Env,
        approver: Address,
        proposal_id: u64,
    ) -> Result<AdminAction, ContractError> {
        approver.require_auth();

        // Verify approver is an authorized signer
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&ADMIN_SIGNERS)
            .ok_or(ContractError::NotInitialized)?;
        if !signers.contains(&approver) {
            return Err(ContractError::Unauthorized);
        }

        // Get the action
        let action_key = (ADMIN_ACTION, proposal_id);
        let mut action: AdminAction = env
            .storage()
            .instance()
            .get(&action_key)
            .ok_or(ContractError::AdminActionNotFound)?;

        // Check expiration
        let timestamp_key = (ACTION_TIMESTAMP, proposal_id);
        let proposed_at: u64 = env
            .storage()
            .instance()
            .get(&timestamp_key)
            .ok_or(ContractError::AdminActionNotFound)?;

        let now = env.ledger().timestamp();
        if now > proposed_at + ADMIN_ACTION_EXPIRATION_SECS {
            // Clean up expired action
            env.storage().instance().remove(&action_key);
            env.storage().instance().remove(&(ADMIN_APPROVALS, proposal_id));
            env.storage().instance().remove(&timestamp_key);
            return Err(ContractError::AdminActionExpired);
        }

        // Check if already approved by this signer
        let approvals_key = (ADMIN_APPROVALS, proposal_id);
        let mut approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&approvals_key)
            .unwrap_or_else(|| Vec::new(&env));

        if approvals.contains(&approver) {
            return Err(ContractError::AlreadyApprovedAction);
        }

        // Add approval
        approvals.push_back(approver.clone());
        action.approval_count = approvals.len() as u32;
        env.storage().instance().set(&approvals_key, &approvals);
        env.storage().instance().set(&action_key, &action);

        env.events().publish(
            (ADMIN, symbol_short!("appact")),
            (EVENT_VERSION, proposal_id, approver.clone(), action.approval_count),
        );

        // Check if threshold is reached
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&SIG_THRESHOLD)
            .unwrap_or(signers.len() as u32);

        if action.approval_count >= threshold {
            // Auto-execute the action
            Self::execute_admin_action_internal(&env, &action)?;

            // Clean up after execution
            env.storage().instance().remove(&action_key);
            env.storage().instance().remove(&approvals_key);
            env.storage().instance().remove(&timestamp_key);

            env.events().publish(
                (ADMIN, symbol_short!("execact")),
                (EVENT_VERSION, proposal_id, action.action_type.clone(), action.target.clone()),
            );
        }

        Ok(action)
    }

    /// Get the details of a pending admin action.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `proposal_id` - ID of the proposal.
    ///
    /// # Returns
    /// The AdminAction details if found.
    pub fn get_admin_action(env: Env, proposal_id: u64) -> Result<AdminAction, ContractError> {
        let action_key = (ADMIN_ACTION, proposal_id);
        env.storage()
            .instance()
            .get(&action_key)
            .ok_or(ContractError::AdminActionNotFound)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Core single-credential revocation logic shared by [`Self::revoke_credential`]
    /// and [`Self::revoke_credentials_batch`]. Caller must have already called
    /// `issuer.require_auth()`.
    fn revoke_one(
        env: &Env,
        issuer: &Address,
        credential_id: &BytesN<32>,
        reason: &Symbol,
    ) -> Result<(), ContractError> {
        let key = Self::cred_key(credential_id);
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;
        if &cred.issuer != issuer {
            return Err(ContractError::UnauthorizedIssuer);
        }
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        cred.revoked = true;
        env.storage().persistent().set(&key, &cred);
        let revoked: u32 = env.storage().instance().get(&REVOKED_CNT).unwrap_or(0);
        env.storage().instance().set(&REVOKED_CNT, &(revoked + 1));
        // closes #553: include revocation timestamp in batch events too.
        let revoked_at: u64 = env.ledger().timestamp();
        env.events().publish(
            (CRED, symbol_short!("revoked")),
            (EVENT_VERSION, credential_id.clone(), issuer.clone(), revoked_at, reason.clone()),
        );
        Ok(())
    }

    fn require_uninitialized(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(ContractError::AlreadyInitialized);
        }
        Ok(())
    }

    fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&ADMIN, admin);
    }

    fn require_admin(env: &Env) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().get(&PAUSED).unwrap_or(false) {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    fn require_issuer(env: &Env, issuer: &Address) -> Result<(), ContractError> {
        if !Self::get_issuers_internal(env).contains(issuer) {
            return Err(ContractError::UnauthorizedIssuer);
        }
        Ok(())
    }

    /// Issue #659: Internal proof verification logic (no auth requirement).
    /// Used by issue_credential to verify proof of possession.
    fn verify_proof_internal(
        env: &Env,
        issuer: &Address,
        subject: &Address,
        signed_challenge: &Bytes,
    ) -> Result<(), ContractError> {
        let challenge_key = (CHALLENGE, issuer.clone(), subject.clone());
        let challenge: Challenge = env
            .storage()
            .temporary()
            .get(&challenge_key)
            .ok_or(ContractError::ChallengeNotFound)?;

        let now = env.ledger().timestamp();
        if now > challenge.created_at + CHALLENGE_EXPIRATION_SECS {
            env.storage().temporary().remove(&challenge_key);
            return Err(ContractError::ChallengeNotFound);
        }

        // Verify the signature based on the scheme
        match challenge.sig_scheme {
            SIG_SCHEME_ED25519 => {
                let pubkey = BytesN::from_array(
                    env,
                    &subject.to_xdr(env).to_array(),
                );
                env.crypto().ed25519_verify(
                    &pubkey,
                    &challenge.nonce,
                    signed_challenge,
                );
            }
            SIG_SCHEME_SECP256K1 => {
                let pubkey = BytesN::from_array(
                    env,
                    &subject.to_xdr(env).to_array(),
                );
                env.crypto().secp256k1_verify(
                    &pubkey,
                    &challenge.nonce,
                    signed_challenge,
                );
            }
            _ => return Err(ContractError::UnsupportedSignatureScheme),
        }

        // Clear the challenge after successful verification
        env.storage().temporary().remove(&challenge_key);

        Ok(())
    }

    /// Issue #658: Execute an admin action after threshold is reached.
    fn execute_admin_action_internal(
        env: &Env,
        action: &AdminAction,
    ) -> Result<(), ContractError> {
        match action.action_type {
            AdminActionType::AddIssuer => {
                // Execute add_issuer without requiring additional auth
                let mut issuers = Self::get_issuers_internal(env);
                if !issuers.contains(&action.target) {
                    if issuers.len() >= Self::effective_max_issuers(env) {
                        return Err(ContractError::MaxIssuersReached);
                    }
                    issuers.push_back(action.target.clone());
                    env.storage().instance().set(&ISSUER, &issuers);
                    env.events().publish(
                        (ISSUER, symbol_short!("added")),
                        (EVENT_VERSION, action.target.clone()),
                    );
                }
                Ok(())
            }
            AdminActionType::RemoveIssuer => {
                // Execute remove_issuer without requiring additional auth
                let issuers = Self::get_issuers_internal(env);
                let mut updated = Vec::new(env);
                for issuer in issuers.iter() {
                    if issuer != action.target {
                        updated.push_back(issuer);
                    }
                }
                if updated.len() < issuers.len() {
                    env.storage().instance().set(&ISSUER, &updated);
                    env.events().publish(
                        (ISSUER, symbol_short!("removed")),
                        (EVENT_VERSION, action.target.clone()),
                    );
                }
                Ok(())
            }
            AdminActionType::ChangeMaxIssuers => {
                // Execute set_max_issuers without requiring additional auth
                if action.param == 0 || action.param > ABSOLUTE_MAX_ISSUERS {
                    return Err(ContractError::InvalidMaxIssuers);
                }
                let old_max = Self::get_max_issuers_internal(env);
                env.storage().instance().set(&MAX_ISSUERS_CFG, &action.param);
                env.events().publish(
                    (ADMIN, Symbol::new(env, "admin_config_changed")),
                    (EVENT_VERSION, symbol_short!("max_iss"), old_max, action.param),
                );
                Ok(())
            }
            AdminActionType::SetSignatureThreshold => {
                // Execute set_admin_signers threshold update without requiring additional auth
                let signers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&ADMIN_SIGNERS)
                    .unwrap_or_else(|| Vec::new(env));

                if action.param > signers.len() as u32 || action.param == 0 {
                    return Err(ContractError::InvalidMaxIssuers);
                }
                env.storage().instance().set(&SIG_THRESHOLD, &action.param);
                env.events().publish(
                    (ADMIN, symbol_short!("sightr")),
                    (EVENT_VERSION, action.param),
                );
                Ok(())
            }
        }
    }

    fn get_issuers_internal(env: &Env) -> Vec<Address> {
        env.storage().instance().get(&ISSUER).unwrap_or_else(|| Vec::new(env))
    }

    /// Current effective issuer cap.
    fn effective_max_issuers(env: &Env) -> u32 {
        env.storage().instance().get(&MAX_ISSUERS_CFG).unwrap_or(MAX_ISSUERS)
    }

    fn get_max_issuers_internal(env: &Env) -> u32 {
        env.storage().instance().get(&MAX_ISSUERS_CFG).unwrap_or(MAX_ISSUERS)
    }

    /// Derives the deterministic credential ID as
    /// `sha256(issuer_xdr || subject_xdr || type_tag || nonce)`. `nonce` is the
    /// 1-based issuance count for this (issuer, subject, credential_type)
    /// triple (see [`Self::nonce_key`]), so re-issuing after a revocation
    /// always produces a fresh ID instead of colliding with the prior record.
    fn derive_id(
        env: &Env,
        issuer: &Address,
        subject: &Address,
        credential_type: &CredentialType,
        nonce: u64,
    ) -> BytesN<32> {
        let type_tag: u8 = match credential_type {
            CredentialType::Kyc => 0,
            CredentialType::Reputation => 1,
            CredentialType::Achievement => 2,
            CredentialType::Custom => 3,
        };
        let mut data = Bytes::new(env);
        data.append(&issuer.clone().to_xdr(env));
        data.append(&subject.clone().to_xdr(env));
        data.push_back(type_tag);
        data.extend_from_array(&nonce.to_be_bytes());
        env.crypto().sha256(&data).into()
    }

    fn cred_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
        (CRED, id.clone())
    }

    fn nonce_key(
        env: &Env,
        issuer: &Address,
        subject: &Address,
        credential_type: &CredentialType,
    ) -> (Symbol, BytesN<32>) {
        let type_tag: u8 = match credential_type {
            CredentialType::Kyc => 0,
            CredentialType::Reputation => 1,
            CredentialType::Achievement => 2,
            CredentialType::Custom => 3,
        };
        let mut data = Bytes::new(env);
        data.append(&issuer.clone().to_xdr(env));
        data.append(&subject.clone().to_xdr(env));
        data.push_back(type_tag);
        (ISS_NONCE, env.crypto().sha256(&data).into())
    }

    fn subject_key(subject: &Address) -> (Symbol, Address) {
        (SUBJECT, subject.clone())
    }

    fn issuer_creds_key(issuer: &Address) -> (Symbol, Address) {
        (ISSUER_CREDS, issuer.clone())
    }

    fn revocations_key(issuer: &Address, subject: &Address) -> (Symbol, Address, Address) {
        (REVOCATIONS, issuer.clone(), subject.clone())
    }

    fn fetch_subject_creds(env: &Env, subject: &Address) -> Vec<BytesN<32>> {
        let key = Self::subject_key(subject);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
    }

    fn fetch_issuer_creds(env: &Env, issuer: &Address) -> Vec<BytesN<32>> {
        let key = Self::issuer_creds_key(issuer);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
    }

    fn fetch_revocations(env: &Env, issuer: &Address, subject: &Address) -> Vec<BytesN<32>> {
        let key = Self::revocations_key(issuer, subject);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
    }

    fn ttl_for_credential(env: &Env, expires_at: u64) -> u32 {
        if expires_at == 0 {
            return TTL_MAX;
        }
        let now = env.ledger().timestamp();
        if expires_at <= now {
            return TTL_MIN;
        }
        let ledgers = ((expires_at - now) / 5) as u32;
        ledgers.min(TTL_MAX).max(TTL_MIN)
    }

    // ── Issue #732 private helpers ─────────────────────────────────────────────

    /// Fetch the direct prerequisite IDs for a credential.
    fn fetch_prereqs(env: &Env, credential_id: &BytesN<32>) -> Vec<BytesN<32>> {
        let key = (CRED_DEPS, credential_id.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Check that adding `new_prereq` as a prerequisite of `root` would not
    /// create a cycle. Walks the prerequisite chain of `new_prereq` up to
    /// `MAX_DEP_DEPTH` levels deep; returns `CircularDependency` if `root`
    /// appears anywhere in that chain, or `DependencyDepthExceeded` if the
    /// chain is already at the depth limit.
    fn check_no_cycle(
        env: &Env,
        root: &BytesN<32>,
        current: &BytesN<32>,
        depth: u32,
    ) -> Result<(), ContractError> {
        if depth >= MAX_DEP_DEPTH {
            return Err(ContractError::DependencyDepthExceeded);
        }
        let prereqs = Self::fetch_prereqs(env, current);
        for p in prereqs.iter() {
            if p == *root {
                return Err(ContractError::CircularDependency);
            }
            Self::check_no_cycle(env, root, &p, depth + 1)?;
        }
        Ok(())
    }

    /// Check whether a credential (and its entire prerequisite chain) is valid.
    /// Returns `false` instead of an error so callers in batch-verify can
    /// continue with other IDs.
    fn check_credential_valid(env: &Env, id: &BytesN<32>, depth: u32) -> bool {
        if depth >= MAX_DEP_DEPTH {
            return false;
        }
        let key = Self::cred_key(id);
        match env.storage().persistent().get::<_, Credential>(&key) {
            None => false,
            Some(cred) => {
                if cred.revoked {
                    return false;
                }
                let now = env.ledger().timestamp();
                if cred.expires_at > 0 && now > cred.expires_at {
                    return false;
                }
                // Recursively validate all prerequisites.
                let prereqs = Self::fetch_prereqs(env, id);
                for prereq_id in prereqs.iter() {
                    if !Self::check_credential_valid(env, &prereq_id, depth + 1) {
                        return false;
                    }
                }
                true
            }
        }
    }

    /// Cascade-revoke all credentials that list `parent_id` as a prerequisite.
    /// Walks the reverse-dependency index up to `MAX_DEP_DEPTH` levels deep
    /// and marks each dependent as revoked, emitting a `dep_revoked` event.
    /// Already-revoked dependants are skipped silently.
    fn cascade_revoke_dependants(env: &Env, parent_id: &BytesN<32>, depth: u32) {
        if depth >= MAX_DEP_DEPTH {
            return;
        }
        let rdep_key = (CRED_RDEPS, parent_id.clone());
        let dependants: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&rdep_key)
            .unwrap_or_else(|| Vec::new(env));
        for dep_id in dependants.iter() {
            let dep_key = Self::cred_key(&dep_id);
            if let Some(mut dep) = env.storage().persistent().get::<_, Credential>(&dep_key) {
                if !dep.revoked {
                    dep.revoked = true;
                    env.storage().persistent().set(&dep_key, &dep);
                    let revoked: u32 = env.storage().instance().get(&REVOKED_CNT).unwrap_or(0);
                    env.storage().instance().set(&REVOKED_CNT, &(revoked + 1));
                    env.events().publish(
                        (CRED, symbol_short!("dep_rev")),
                        (EVENT_VERSION, dep_id.clone(), parent_id.clone()),
                    );
                    // Recurse: cascade to credentials that depend on this one.
                    Self::cascade_revoke_dependants(env, &dep_id, depth + 1);
                }
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::{Address as _, Events as _, Ledger as _}, Bytes, Env, Map, String};

    #[contract]
    struct MockIdentityRegistry;
    #[contractimpl]
    impl MockIdentityRegistry {
        pub fn has_active_did(_env: Env, _controller: Address) -> bool { true }
    }

    fn setup() -> (Env, Address, CredentialManagerClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let registry_id = env.register_contract(None, MockIdentityRegistry);
        let contract_id = env.register_contract(None, CredentialManager);
        let client = CredentialManagerClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin, &registry_id);
        (env, admin, client)
    }

    fn issue_kyc(
        env: &Env,
        client: &CredentialManagerClient,
        issuer: &Address,
        subject: &Address,
    ) -> BytesN<32> {
        client.issue_credential(
            issuer, subject, &CredentialType::Kyc,
            &Map::new(env), &BytesN::from_array(env, &[1u8; 32]),
            &Bytes::from_array(env, &[0u8; 64]), &0u64, &None,
        )
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, CredentialManager);
        let client = CredentialManagerClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_issue_and_verify() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);
        client.verify_credential(&cred_id);
    }

    #[test]
    fn test_revoke_credential() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);
        client.revoke_credential(&issuer, &cred_id);
        assert_eq!(
            client.try_verify_credential(&cred_id),
            Err(Ok(ContractError::CredentialRevoked))
        );
    }

    #[test]
    fn test_verify_expired_credential() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let expires_at = env.ledger().timestamp() + 100;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[0u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );
        env.ledger().with_mut(|li| li.timestamp = expires_at + 1);
        assert_eq!(
            client.try_verify_credential(&cred_id),
            Err(Ok(ContractError::CredentialExpired))
        );
    }

    #[test]
    fn test_duplicate_credential_rejected() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        issue_kyc(&env, &client, &issuer, &subject);
        let result = client.try_issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &None,
        );
        assert_eq!(result, Err(Ok(ContractError::CredentialAlreadyExists)));
    }

    #[test]
    fn test_double_initialize_returns_error() {
        let (env, admin, client) = setup();
        let dummy_registry = Address::generate(&env);
        assert_eq!(
            client.try_initialize(&admin, &dummy_registry),
            Err(Ok(ContractError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_register_schema_and_issue() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let schema_hash = BytesN::from_array(&env, &[99u8; 32]);

        // Issuing with unregistered schema returns SchemaNotFound
        let result = client.try_issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &Some(schema_hash.clone()),
        );
        assert_eq!(result, Err(Ok(ContractError::SchemaNotFound)));

        // Register schema then issue succeeds
        client.register_schema(&issuer, &schema_hash);
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &Some(schema_hash),
        );
        client.verify_credential(&cred_id);
    }

    #[test]
    fn test_schema_optional_no_schema_works() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        // No schema_hash — must work as before
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);
        client.verify_credential(&cred_id);
    }

    /// Re-issuing after a revocation must not overwrite the original credential's
    /// storage record: the two IDs must differ and both must remain independently
    /// resolvable — the old one still revoked, the new one active. See issue #467.
    #[test]
    fn test_reissue_after_revoke_does_not_overwrite_original() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let original_id = issue_kyc(&env, &client, &issuer, &subject);
        client.revoke_credential(&issuer, &original_id);

        let new_id = issue_kyc(&env, &client, &issuer, &subject);

        assert_ne!(original_id, new_id);

        // The original record must still exist and still be revoked, untouched
        // by the new issuance (get_credential errors CredentialRevoked rather
        // than CredentialNotFound, proving the record wasn't wiped/overwritten).
        let original_result = client.try_get_credential(&original_id);
        assert_eq!(original_result, Err(Ok(ContractError::CredentialRevoked)));

        // The new record is a fresh, active credential.
        let fresh = client.get_credential(&new_id);
        assert!(!fresh.revoked);
        assert_eq!(fresh.id, new_id);
    }

    #[test]
    fn test_register_schema_rejects_zero_hash() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_register_schema(&issuer, &zero_hash);
        assert_eq!(result, Err(Ok(ContractError::InvalidSchemaHash)));
    }

    #[test]
    fn test_set_max_issuers_allows_admin_override() {
        let (env, admin, client) = setup();
        assert_eq!(client.get_max_issuers(), MAX_ISSUERS);

        client.set_max_issuers(&admin, &1);
        let issuer_a = Address::generate(&env);
        let issuer_b = Address::generate(&env);
        client.add_issuer(&issuer_a);
        assert_eq!(
            client.try_add_issuer(&issuer_b),
            Err(Ok(ContractError::MaxIssuersReached))
        );

        client.set_max_issuers(&admin, &2);
        client.add_issuer(&issuer_b);
        assert_eq!(client.get_issuers().len(), 2);
    }

    #[test]
    fn test_set_max_issuers_enforces_absolute_ceiling() {
        let (_env, admin, client) = setup();
        assert_eq!(
            client.try_set_max_issuers(&admin, &(ABSOLUTE_MAX_ISSUERS + 1)),
            Err(Ok(ContractError::InvalidMaxIssuers))
        );
        assert_eq!(
            client.try_set_max_issuers(&admin, &0),
            Err(Ok(ContractError::InvalidMaxIssuers))
        );
        client.set_max_issuers(&admin, &ABSOLUTE_MAX_ISSUERS);
        assert_eq!(client.get_max_issuers(), ABSOLUTE_MAX_ISSUERS);
    }

    #[test]
    fn test_set_max_issuers_rejects_non_admin() {
        let (env, _admin, client) = setup();
        let attacker = Address::generate(&env);
        assert_eq!(
            client.try_set_max_issuers(&attacker, &200),
            Err(Ok(ContractError::Unauthorized))
        );
    }

    #[test]
    fn test_expire_credential() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let caller = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 100;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[0u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        // Before expiry returns CredentialNotExpiredYet
        assert_eq!(
            client.try_expire_credential(&caller, &cred_id),
            Err(Ok(ContractError::CredentialNotExpiredYet))
        );

        // After expiry succeeds and marks credential expired
        env.ledger().with_mut(|li| li.timestamp = expires_at + 1);
        client.expire_credential(&caller, &cred_id);
        assert_eq!(
            client.try_verify_credential(&cred_id),
            Err(Ok(ContractError::CredentialRevoked))
        );
    }

    #[test]
    fn test_expire_already_revoked() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let caller = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 100;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[0u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );
        client.revoke_credential(&issuer, &cred_id);
        env.ledger().with_mut(|li| li.timestamp = expires_at + 1);
        assert_eq!(
            client.try_expire_credential(&caller, &cred_id),
            Err(Ok(ContractError::CredentialRevoked))
        );
    }

    #[test]
    fn test_list_subject_credentials_paginates() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        for ct in [CredentialType::Kyc, CredentialType::Reputation, CredentialType::Achievement] {
            client.issue_credential(
                &issuer, &subject, &ct,
                &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
                &Bytes::from_array(&env, &[0u8; 64]), &0u64, &None,
            );
        }
        let page1 = client.list_subject_credentials(&subject, &None, &2, &None);
        assert_eq!(page1.items.len(), 2);
        assert_eq!(page1.next_cursor, Some(2));
        let page2 = client.list_subject_credentials(&subject, &page1.next_cursor, &2, &None);
        assert_eq!(page2.items.len(), 1);
        assert_eq!(page2.next_cursor, None);
    }

    // ── renew_credential tests (#595) ─────────────────────────────────────────

    #[test]
    fn test_renew_credential_extends_expiry_preserving_id() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 1000;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        let new_expires_at = expires_at + 5000;
        client.renew_credential(&issuer, &cred_id, &new_expires_at);

        // Credential ID unchanged
        let renewed = client.get_credential(&cred_id);
        assert_eq!(renewed.id, cred_id);
        // Expiry updated
        assert_eq!(renewed.expires_at, new_expires_at);
        // Still not revoked
        assert!(!renewed.revoked);
    }

    #[test]
    fn test_renew_credential_emits_event() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 1000;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        let new_expires_at = expires_at + 5000;
        client.renew_credential(&issuer, &cred_id, &new_expires_at);

        // The event system in the test env records all published events
        let events = env.events().all();
        let has_renewed = events.iter().any(|ev| {
            // topic bytes contain "renewed"
            let topic_str = std::format!("{:?}", ev);
            topic_str.contains("renewed")
        });
        assert!(has_renewed, "credential_renewed event should have been emitted");
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_renew_credential_non_issuer_rejected() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let non_issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 1000;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        // non_issuer tries to renew — must fail with UnauthorizedIssuer(2)
        client.renew_credential(&non_issuer, &cred_id, &(expires_at + 1000));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_renew_revoked_credential_rejected() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 1000;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        client.revoke_credential(&issuer, &cred_id);
        // Revoked credential — must fail with CredentialRevoked(4)
        client.renew_credential(&issuer, &cred_id, &(expires_at + 1000));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_renew_with_earlier_expiry_rejected() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 5000;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        // new_expires_at <= current expires_at — must fail with NewExpiryNotLater(14)
        client.renew_credential(&issuer, &cred_id, &(expires_at - 1));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_renew_with_zero_expiry_rejected() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 1000;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        // new_expires_at == 0 is not allowed
        client.renew_credential(&issuer, &cred_id, &0u64);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_renew_nonexistent_credential_rejected() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);

        let fake_id = BytesN::from_array(&env, &[255u8; 32]);
        // ID does not exist — must fail with CredentialNotFound(3)
        client.renew_credential(&issuer, &fake_id, &(env.ledger().timestamp() + 1000));
    }

    #[test]
    fn test_renew_credential_credential_still_valid_after_original_expiry() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let expires_at = env.ledger().timestamp() + 500;
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &None,
        );

        let new_expires_at = expires_at + 10_000;
        client.renew_credential(&issuer, &cred_id, &new_expires_at);

        // Advance past the original expiry but before the new one
        env.ledger().with_mut(|l| l.timestamp = expires_at + 1);

        // Should still verify successfully with the extended expiry
        client.verify_credential(&cred_id);
    }

    #[test]
    fn test_storage_key_symbols_are_unique() {
        let keys = [
            ADMIN, ISSUER, CRED, SUBJECT, CRED_CNT, REVOKED_CNT, ISSUER_CREDS, SCHEMA, ISS_NONCE,
        ];
        for (i, left) in keys.iter().enumerate() {
            for right in keys.iter().skip(i + 1) {
                assert_ne!(left, right);
            }
        }
    }

    #[test]
    fn test_error_variants() {
        let (env, admin, client) = setup();
        let registry_id = env.register_contract(None, MockIdentityRegistry);
        assert_eq!(
            client.try_initialize(&admin, &registry_id),
            Err(Ok(ContractError::AlreadyInitialized))
        );

        let fake_id = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_get_credential(&fake_id).err(),
            Some(Ok(ContractError::CredentialNotFound))
        );

        let rando = Address::generate(&env);
        let claims: Map<String, String> = Map::new(&env);
        let claims_hash = BytesN::from_array(&env, &[1u8; 32]);
        let sig = Bytes::from_array(&env, &[0u8; 64]);
        assert_eq!(
            client.try_issue_credential(
                &rando, &rando, &CredentialType::Kyc, &claims, &claims_hash, &sig, &0u64, &None,
            ),
            Err(Ok(ContractError::UnauthorizedIssuer))
        );
    }

    /// Ring-buffer eviction: when issuer index reaches MAX_ISSUER_CREDS,
    /// issuing the (MAX_ISSUER_CREDS + 1)th credential drops the oldest entry.
    #[test]
    fn test_issuer_credentials_ring_buffer_eviction() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);

        let mut first_id = None;
        for i in 0..MAX_ISSUER_CREDS {
            let subject = Address::generate(&env);
            let id = issue_kyc(&env, &client, &issuer, &subject);
            if i == 0 {
                first_id = Some(id);
            }
        }

        let creds_before = client.get_issuer_credentials(&issuer);
        assert_eq!(creds_before.len(), MAX_ISSUER_CREDS as u32);

        let new_subject = Address::generate(&env);
        let _new_id = issue_kyc(&env, &client, &issuer, &new_subject);

        let creds_after = client.get_issuer_credentials(&issuer);
        assert_eq!(creds_after.len(), MAX_ISSUER_CREDS as u32);

        if let Some(first) = first_id {
            let mut found = false;
            for cred_id in creds_after.iter() {
                if cred_id == first {
                    found = true;
                    break;
                }
            }
            assert!(!found, "First credential ID should have been evicted from the index");
        }
    }
}
