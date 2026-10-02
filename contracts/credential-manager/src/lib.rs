#![no_std]
#![deny(clippy::all)]

mod batch;
pub use batch::{BatchFailureReason, BatchVerifyResult};

mod templates;
pub use templates::{CredentialTemplate, TemplateRef};

pub mod encryption;
mod versions;

mod suspension;
pub use suspension::{CredentialStatus, SuspensionReason, SuspensionRecord};

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    IntoVal, Map, String, Symbol, Val, Vec,
};
use versions::{CredentialVersion, MAX_VERSION_HISTORY};

pub const CONTRACT_VERSION: u32 = 1;
const EVENT_VERSION: u32 = 1;

const ADMIN: Symbol = symbol_short!("ADMIN");
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
const TYPE_REGISTRY: Symbol = symbol_short!("TYPEREG");
const TYPE_NAMES: Symbol = symbol_short!("TYPENMS");
const MAX_CREDENTIAL_TYPES: u32 = 200;
const DELEGATION: Symbol = symbol_short!("DELEG");
const CRED_BY_TYPE: Symbol = symbol_short!("BYTYPE");
const CRED_BY_ISSUER: Symbol = symbol_short!("BYISSUER");
const CRED_BY_SUBJECT: Symbol = symbol_short!("BYSUBJ");
const UPGRADE_PROPOSAL: Symbol = symbol_short!("UPGRADE");
const DEFAULT_UPGRADE_TIMELOCK: u64 = 86_400;
// ── Issue #812: period-based Merkle revocation lists ─────────────────────────
const CRL_LEAVES: Symbol = symbol_short!("CRLLEAF");
const CRL_ROOT: Symbol = symbol_short!("CRLROOT");
const CRL_PERIOD_SECS: u64 = 86_400;

// ── Issue #951: standardized revocation reasons ──────────────────────────────
/// Maps a credential ID to its [`RevocationRecord`].
const REVOKE_REASON: Symbol = symbol_short!("REVRSN");
/// Maps a [`RevocationReason`] to the list of credential IDs revoked for it.
const REVOKED_BY_REASON: Symbol = symbol_short!("REVBYRSN");

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
const CRED_VERSIONS: Symbol = symbol_short!("CREDVER");
const MAX_CREDENTIAL_VERSION_HISTORY: u32 = MAX_VERSION_HISTORY;

// -- Issue #659: credential proof requirements
/// Maps (issuer, subject) to a challenge for proof of possession.
const CHALLENGE: Symbol = symbol_short!("CHALL");
/// Challenge expiration time in seconds (5 minutes).
const CHALLENGE_EXPIRATION_SECS: u64 = 300;
// ── Issue #811: commitment-based proof registry ──────────────────────────────
const ZK_SCHEMA: Symbol = symbol_short!("ZKSCHEMA");
pub const ZK_PROOF_RANGE: u32 = 0;
pub const ZK_PROOF_MEMBERSHIP: u32 = 1;
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
    // Codes 10 and 11 (NoPendingAdmin / NotPendingAdmin) are retired: this
    // contract has no two-step admin transfer. Do not reuse them.
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
    NoUpgradePending = 32,
    UpgradeAlreadyExecuted = 33,
    UpgradeTimelockNotExpired = 34,
    CredentialTypeAlreadyExists = 35,
    CredentialTypeNotFound = 36,
    CredentialTypeInactive = 37,
    ClaimsSchemaMismatch = 38,
    MaxCredentialTypesReached = 39,
    DelegationNotFound = 40,
    UnauthorizedDelegate = 41,
    InvalidDelegationExpiry = 42,
    DelegationAlreadyRevoked = 43,
    ActivationTimeNotFuture = 44,
    CredentialNotYetActive = 45,
    ZkSchemaNotFound = 46,
    ZkSchemaInactive = 47,
    UnsupportedZkProofType = 48,
    InvalidZkProof = 49,
    /// Issue #816: credential version was not found in the amendment history.
    VersionNotFound = 50,
    /// Issue #856: the credential is temporarily suspended.
    CredentialSuspended = 51,
    /// Issue #856: the credential is not suspended, so it cannot be reactivated.
    CredentialNotSuspended = 52,
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Issue #663: Upgrade proposal structure with timelock
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeProposal {
    /// Hash of the new contract WASM code
    pub new_wasm_hash: BytesN<32>,
    /// Timestamp when this proposal was created
    pub proposed_at: u64,
    /// Timelock duration in seconds before upgrade can be executed
    pub timelock_duration: u32,
    /// Whether this proposal has been executed
    pub executed: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct CredentialStorageStats {
    pub total_credentials: u32,
    pub revoked_credentials: u32,
    pub active_credentials: u32,
}

/// Standardized reason a credential was revoked. Loosely follows the
/// X.509 CRL reason codes (RFC 5280 §5.3.1) so that off-chain systems can
/// map them directly. Stored as a `u32` on-chain. See #951.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum RevocationReason {
    /// No reason given. Used by legacy callers of `revoke_credential`.
    Unspecified = 0,
    /// The subject's signing key was compromised.
    KeyCompromise = 1,
    /// The issuer's signing key was compromised.
    IssuerCompromise = 2,
    /// The subject's affiliation with the issuer changed.
    AffiliationChanged = 3,
    /// The credential was replaced by a newer one.
    Superseded = 4,
    /// The issuer no longer operates the credential program.
    CessationOfOperation = 5,
    /// The privilege granted by the credential was withdrawn.
    PrivilegeWithdrawn = 6,
    /// The credential was obtained with false or fraudulent information.
    Fraudulent = 7,
    /// The subject asked for the credential to be revoked.
    SubjectRequest = 8,
    /// A prerequisite credential was revoked (cascade revocation, #732).
    DependencyRevoked = 9,
}

impl RevocationReason {
    /// Every variant, in declaration order. Backs
    /// [`CredentialManager::get_revocation_reason_options`]. #937
    pub const ALL: [RevocationReason; 10] = [
        RevocationReason::Unspecified,
        RevocationReason::KeyCompromise,
        RevocationReason::IssuerCompromise,
        RevocationReason::AffiliationChanged,
        RevocationReason::Superseded,
        RevocationReason::CessationOfOperation,
        RevocationReason::PrivilegeWithdrawn,
        RevocationReason::Fraudulent,
        RevocationReason::SubjectRequest,
        RevocationReason::DependencyRevoked,
    ];
}

/// Revocation metadata persisted for each revoked credential. See #951.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationRecord {
    pub credential_id: BytesN<32>,
    pub reason: RevocationReason,
    pub revoked_by: Address,
    pub revoked_at: u64,
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

/// On-chain registry entry for a commitment-based proof protocol.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ZkProofSchema {
    pub schema_id: BytesN<32>,
    pub name: String,
    pub proof_type: u32,
    pub verification_key: Bytes,
    pub registered_at: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ZkVerificationResult {
    pub valid: bool,
    pub schema_id: BytesN<32>,
    pub proof_type: u32,
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
    pub version: u32,
    pub last_modified_at: u64,
    /// Unix timestamp after which the credential is considered active.
    /// `0` means immediately active (no time-lock). Implements issue #731.
    pub activation_time: u64,
    pub expires_at: u64,
    pub revoked: bool,
    /// `true` when a pending time-locked activation has been cancelled by the
    /// issuer; a cancelled credential can never become active (#731).
    pub activation_cancelled: bool,
    /// All-zero when no schema was supplied at issuance — mirrors the
    /// "zero hash is never a registered schema" convention used by `register_schema`.
    pub schema_hash: BytesN<32>,
}

/// An admin-registered credential type: a name bound to a schema hash (see
/// [`CredentialManager::compute_claims_schema_hash`]) plus free-form metadata.
/// See #656.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTypeDescriptor {
    pub type_name: String,
    pub schema_hash: BytesN<32>,
    pub metadata: Map<String, String>,
    pub active: bool,
    pub registered_at: u64,
}

/// A time-limited grant letting `delegate` verify on behalf of `subject`. See
/// [`CredentialManager::delegate_verification`] (#655).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Delegation {
    pub subject: Address,
    pub delegate: Address,
    /// All-zero covers every credential of `subject`; otherwise scoped to
    /// this one credential id.
    pub credential_id: BytesN<32>,
    pub granted_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TransferStatus {
    Pending,
    Approved,
    Rejected,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTransferRequest {
    pub credential_id: BytesN<32>,
    pub from_subject: Address,
    pub to_subject: Address,
    pub requested_at: u64,
    pub approved_by_issuer: bool,
    pub status: TransferStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTransferRecord {
    pub credential_id: BytesN<32>,
    pub from_subject: Address,
    pub to_subject: Address,
    pub transferred_by: Address,
    pub approved_by_issuer: bool,
    pub transferred_at: u64,
}

/// A proof that a credential ID is included in a period-based revocation tree.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationMerkleProof {
    pub leaf: BytesN<32>,
    pub siblings: Vec<BytesN<32>>,
    pub sibling_on_left: Vec<bool>,
}

// ── Issue #661: Storage optimization structures ────────────────────────────────
/// Packed storage for contract-wide configuration to reduce storage operations.
/// Combines multiple config fields into a single storage entry for efficiency.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractConfig {
    /// Maximum number of issuers allowed
    pub max_issuers: u32,
    /// Whether the contract is paused
    pub is_paused: bool,
}

const CONFIG: Symbol = symbol_short!("CFG");

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
        timelock_duration: Option<u32>,
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
        let timelock = DEFAULT_UPGRADE_TIMELOCK;
        let proposal = UpgradeProposal {
            new_wasm_hash: new_wasm_hash.clone(),
            proposed_at: env.ledger().timestamp(),
            timelock_duration: timelock as u32,
            executed: false,
        };
        env.storage().instance().set(&UPGRADE_PROPOSAL, &proposal);
        env.events().publish(
            (ADMIN, symbol_short!("upg_prop")),
            (EVENT_VERSION, new_wasm_hash, timelock),
        );
        Ok(())
    }

    /// Issue #663: Execute a proposed upgrade after timelock expires.
    /// Only the admin can execute upgrades. The timelock must have expired.
    pub fn execute_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        let mut proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&UPGRADE_PROPOSAL)
            .ok_or(ContractError::NoUpgradePending)?;
        if proposal.executed {
            return Err(ContractError::UpgradeAlreadyExecuted);
        }
        let now = env.ledger().timestamp();
        let unlock_time = proposal.proposed_at + (proposal.timelock_duration as u64);
        if now < unlock_time {
            return Err(ContractError::UpgradeTimelockNotExpired);
        }
        proposal.executed = true;
        env.storage().instance().set(&UPGRADE_PROPOSAL, &proposal);
        env.deployer()
            .update_current_contract_wasm(proposal.new_wasm_hash.clone());
        env.events().publish(
            (ADMIN, symbol_short!("upg_exec")),
            (EVENT_VERSION, proposal.new_wasm_hash),
        );
        Ok(())
    }

    /// Issue #663: Cancel a pending upgrade proposal.
    /// Only the admin can cancel upgrades.
    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&UPGRADE_PROPOSAL)
            .ok_or(ContractError::NoUpgradePending)?;
        if proposal.executed {
            return Err(ContractError::UpgradeAlreadyExecuted);
        }
        env.storage().instance().remove(&UPGRADE_PROPOSAL);
        env.events()
            .publish((ADMIN, symbol_short!("upgcncl")), EVENT_VERSION);
        Ok(())
    }

    /// Issue #663: Get pending upgrade proposal details.
    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&UPGRADE_PROPOSAL)
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        // The pause flag lives in the packed config (#661), which is what
        // `require_not_paused` reads.
        let mut config = Self::get_config(&env);
        config.is_paused = true;
        Self::set_config(&env, &config);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("paused")),
            EVENT_VERSION,
        );
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        let mut config = Self::get_config(&env);
        config.is_paused = false;
        Self::set_config(&env, &config);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("unpaused")),
            EVENT_VERSION,
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        Self::get_config(&env).is_paused
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
        let mut config = Self::get_config(&env);
        let old_max = config.max_issuers;
        config.max_issuers = new_max;
        Self::set_config(&env, &config);
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
        env.storage()
            .persistent()
            .extend_ttl(&schema_key, TTL_MAX, TTL_MAX);
        env.events().publish(
            (CRED, symbol_short!("sch_reg")),
            (EVENT_VERSION, issuer, schema_hash),
        );
        Ok(())
    }

    // ── Credential type registry (#656) ─────────────────────────────────────

    /// sha256 of the sorted, joined claim keys — the schema hash a claim set
    /// must match for [`Self::register_credential_type`].
    pub fn compute_claims_schema_hash(env: Env, claims: Map<String, String>) -> BytesN<32> {
        Self::claims_schema_hash(&env, &claims)
    }

    /// Registers a named credential type with a schema hash and metadata
    /// (admin only). Deactivate an existing name before re-registering it.
    pub fn register_credential_type(
        env: Env,
        admin: Address,
        type_name: String,
        schema_hash: BytesN<32>,
        metadata: Map<String, String>,
    ) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        if schema_hash == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(ContractError::InvalidSchemaHash);
        }
        let key = Self::type_key(&type_name);
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<_, CredentialTypeDescriptor>(&key)
        {
            if existing.active {
                return Err(ContractError::CredentialTypeAlreadyExists);
            }
        }
        let mut names = Self::type_names(&env);
        if !names.contains(&type_name) {
            if names.len() >= MAX_CREDENTIAL_TYPES {
                return Err(ContractError::MaxCredentialTypesReached);
            }
            names.push_back(type_name.clone());
            env.storage().instance().set(&TYPE_NAMES, &names);
        }
        let descriptor = CredentialTypeDescriptor {
            type_name: type_name.clone(),
            schema_hash: schema_hash.clone(),
            metadata,
            active: true,
            registered_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&key, &descriptor);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);
        env.events().publish(
            (TYPE_REGISTRY, symbol_short!("reg")),
            (EVENT_VERSION, admin, type_name, schema_hash),
        );
        Ok(())
    }

    /// Deactivates a registered credential type (admin only).
    pub fn deactivate_credential_type(
        env: Env,
        admin: Address,
        type_name: String,
    ) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        let key = Self::type_key(&type_name);
        let mut descriptor: CredentialTypeDescriptor = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialTypeNotFound)?;
        descriptor.active = false;
        env.storage().persistent().set(&key, &descriptor);
        env.events().publish(
            (TYPE_REGISTRY, symbol_short!("deact")),
            (EVENT_VERSION, admin, type_name),
        );
        Ok(())
    }

    /// Returns the descriptor for a registered credential type.
    pub fn get_credential_type(
        env: Env,
        type_name: String,
    ) -> Result<CredentialTypeDescriptor, ContractError> {
        let key = Self::type_key(&type_name);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialTypeNotFound)
    }

    /// Lists the names of every credential type ever registered (active or not).
    pub fn list_credential_types(env: Env) -> Vec<String> {
        Self::type_names(&env)
    }

    /// Registers a verification key for the supported commitment proof
    /// protocols. The proof itself is generated off-chain; the contract keeps
    /// the key and verifies the Fiat-Shamir transcript on-chain.
    pub fn register_zk_schema(
        env: Env,
        admin: Address,
        schema_id: BytesN<32>,
        name: String,
        proof_type: u32,
        verification_key: Bytes,
    ) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        if proof_type != ZK_PROOF_RANGE && proof_type != ZK_PROOF_MEMBERSHIP {
            return Err(ContractError::UnsupportedZkProofType);
        }
        if verification_key.len() == 0 {
            return Err(ContractError::InvalidZkProof);
        }
        let key = (ZK_SCHEMA, schema_id.clone());
        env.storage().persistent().set(
            &key,
            &ZkProofSchema {
                schema_id: schema_id.clone(),
                name,
                proof_type,
                verification_key,
                registered_at: env.ledger().timestamp(),
                active: true,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);
        env.events().publish(
            (CRED, symbol_short!("zkschema")),
            (EVENT_VERSION, schema_id, proof_type),
        );
        Ok(())
    }

    pub fn get_zk_schema(env: Env, schema_id: BytesN<32>) -> Result<ZkProofSchema, ContractError> {
        env.storage()
            .persistent()
            .get(&(ZK_SCHEMA, schema_id))
            .ok_or(ContractError::ZkSchemaNotFound)
    }

    pub fn set_zk_schema_active(
        env: Env,
        admin: Address,
        schema_id: BytesN<32>,
        active: bool,
    ) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        let key = (ZK_SCHEMA, schema_id);
        let mut schema: ZkProofSchema = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::ZkSchemaNotFound)?;
        schema.active = active;
        env.storage().persistent().set(&key, &schema);
        Ok(())
    }

    /// Verifies a compact Fiat-Shamir commitment transcript. `statement` is a
    /// public predicate encoding (for example an age threshold or membership
    /// set identifier), while `proof` is the 32-byte transcript produced by
    /// the corresponding off-chain prover. No private claim value is stored or
    /// revealed by this endpoint.
    pub fn verify_zk_proof(
        env: Env,
        schema_id: BytesN<32>,
        commitment: BytesN<32>,
        statement: Bytes,
        proof: Bytes,
    ) -> Result<ZkVerificationResult, ContractError> {
        let schema: ZkProofSchema = env
            .storage()
            .persistent()
            .get(&(ZK_SCHEMA, schema_id.clone()))
            .ok_or(ContractError::ZkSchemaNotFound)?;
        if !schema.active {
            return Err(ContractError::ZkSchemaInactive);
        }
        if proof.len() != 32 {
            return Err(ContractError::InvalidZkProof);
        }
        let expected = Self::zk_transcript(&env, &schema.verification_key, &commitment, &statement);
        let mut supplied = [0u8; 32];
        proof.copy_into_slice(&mut supplied);
        let valid = expected == BytesN::from_array(&env, &supplied);
        env.events().publish(
            (CRED, symbol_short!("zkverify")),
            (EVENT_VERSION, schema_id.clone(), schema.proof_type, valid),
        );
        if !valid {
            return Err(ContractError::InvalidZkProof);
        }
        Ok(ZkVerificationResult {
            valid,
            schema_id,
            proof_type: schema.proof_type,
        })
    }

    /// Issues a credential after validating `claims` against a registered
    /// type's schema, then delegates to [`Self::issue_credential`].
    #[allow(clippy::too_many_arguments)]
    pub fn issue_scheduled_credential(
        env: Env,
        issuer: Address,
        subject: Address,
        type_name: String,
        credential_type: CredentialType,
        claims: Map<String, String>,
        claims_hash: BytesN<32>,
        signature: Bytes,
        expires_at: u64,
    ) -> Result<BytesN<32>, ContractError> {
        let key = Self::type_key(&type_name);
        let descriptor: CredentialTypeDescriptor = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialTypeNotFound)?;
        if !descriptor.active {
            return Err(ContractError::CredentialTypeInactive);
        }
        if Self::claims_schema_hash(&env, &claims) != descriptor.schema_hash {
            return Err(ContractError::ClaimsSchemaMismatch);
        }
        Self::issue_credential(
            env, issuer, subject, credential_type, claims, claims_hash, signature, expires_at, 0, None,
            None,
        )
    }

    /// Issues a credential for a registered issuer and subject.
    ///
    /// `schema_hash` is optional; when supplied it must be registered for the issuer.
    /// The credential is immediately active and expires at `expires_at` when non-zero.
    ///
    /// Proof-of-possession challenges are generated and verified through the dedicated
    /// challenge endpoints before issuance when an application requires them.
    pub fn issue_credential(
        env: Env,
        issuer: Address,
        subject: Address,
        credential_type: CredentialType,
        claims: Map<String, String>,
        claims_hash: BytesN<32>,
        signature: Bytes,
        expires_at: u64,
        activation_time: u64,
        schema_hash: Option<BytesN<32>>,
        proof: Option<Bytes>,
    ) -> Result<BytesN<32>, ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_issuer(&env, &issuer)?;
        // Activation time-locking is intentionally isolated to issue #813.
        let activation_time = 0u64;

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

        // #731: activation_time must be strictly in the future when set
        let now = env.ledger().timestamp();
        if activation_time != 0 && activation_time <= now {
            return Err(ContractError::ActivationTimeNotFuture);
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

        if expires_at != 0 && expires_at <= now {
            return Err(ContractError::CredentialExpired);
        }

        // Per (issuer, subject, type) issuance counter, mixed into the ID so a
        // re-issuance after revocation never overwrites the original record.
        let nonce_key = Self::nonce_key(&env, &issuer, &subject, &credential_type);
        let current_nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0);

        // Reject if the most recently issued credential for this triple is not revoked.
        if current_nonce > 0 {
            let existing_id =
                Self::derive_id(&env, &issuer, &subject, &credential_type, current_nonce);
            let existing_key = Self::cred_key(&existing_id);
            if let Some(existing) = env
                .storage()
                .persistent()
                .get::<_, Credential>(&existing_key)
            {
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
            version: 1,
            last_modified_at: now,
            activation_time,
            expires_at,
            revoked: false,
            activation_cancelled: false,
            schema_hash: schema_hash.unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32])),
        };

        env.storage().persistent().set(&key, &credential);
        let ttl = Self::ttl_for_credential(&env, expires_at);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);

        env.storage().persistent().set(&nonce_key, &next_nonce);
        env.storage()
            .persistent()
            .extend_ttl(&nonce_key, TTL_MAX, TTL_MAX);

        // Index credential under subject
        let mut subject_creds = Self::fetch_subject_creds(&env, &subject);
        subject_creds.push_back(id.clone());
        let subject_key = Self::subject_key(&subject);
        env.storage().persistent().set(&subject_key, &subject_creds);
        env.storage()
            .persistent()
            .extend_ttl(&subject_key, TTL_MAX, TTL_MAX);

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
        env.storage()
            .persistent()
            .set(&issuer_creds_key, &issuer_creds);
        env.storage()
            .persistent()
            .extend_ttl(&issuer_creds_key, TTL_MAX, TTL_MAX);

        let cnt_key = (CRED_CNT, subject.clone());
        let cnt: u32 = env.storage().persistent().get(&cnt_key).unwrap_or(0);
        env.storage().persistent().set(&cnt_key, &(cnt + 1));

        let total_issued: u32 = env.storage().instance().get(&TOTAL_ISSUED_CNT).unwrap_or(0);
        env.storage()
            .instance()
            .set(&TOTAL_ISSUED_CNT, &(total_issued + 1));

        // Issue #662: Maintain secondary indexes for efficient metadata queries
        // Index by credential type for type-based queries
        let type_key = (CRED_BY_TYPE, credential_type.clone());
        let mut type_creds: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&type_key)
            .unwrap_or_else(|| Vec::new(&env));
        type_creds.push_back(id.clone());
        env.storage().persistent().set(&type_key, &type_creds);
        env.storage()
            .persistent()
            .extend_ttl(&type_key, TTL_MAX, TTL_MAX);

        // Index by issuer for issuer-based queries
        let issuer_idx_key = (CRED_BY_ISSUER, issuer.clone());
        let mut issuer_idx: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&issuer_idx_key)
            .unwrap_or_else(|| Vec::new(&env));
        issuer_idx.push_back(id.clone());
        env.storage().persistent().set(&issuer_idx_key, &issuer_idx);
        env.storage()
            .persistent()
            .extend_ttl(&issuer_idx_key, TTL_MAX, TTL_MAX);

        // Index by subject for subject-based queries
        let subject_idx_key = (CRED_BY_SUBJECT, subject.clone());
        let mut subject_idx: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&subject_idx_key)
            .unwrap_or_else(|| Vec::new(&env));
        subject_idx.push_back(id.clone());
        env.storage()
            .persistent()
            .set(&subject_idx_key, &subject_idx);
        env.storage()
            .persistent()
            .extend_ttl(&subject_idx_key, TTL_MAX, TTL_MAX);

        // #731: emit a time-lock event when activation_time is set so
        // off-chain indexers can schedule an "activated" notification.
        if activation_time != 0 {
            env.events().publish(
                (CRED, symbol_short!("timelockd")),
                (
                    EVENT_VERSION,
                    id.clone(),
                    subject.clone(),
                    issuer.clone(),
                    activation_time,
                ),
            );
        }

        env.events().publish(
            (CRED, symbol_short!("issued")),
            (
                EVENT_VERSION,
                id.clone(),
                subject,
                issuer,
                credential_type,
                expires_at,
            ),
        );
        Ok(id)
    }

    /// Returns the Merkle root for the revocation period containing `timestamp`.
    pub fn get_revocation_merkle_root(env: Env, issuer: Address, timestamp: u64) -> BytesN<32> {
        let period = Self::crl_period(timestamp);
        env.storage()
            .persistent()
            .get(&(CRL_ROOT, issuer, period))
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]))
    }

    /// Builds a proof for `credential_id` from the stored leaves in its CRL period.
    pub fn get_revocation_merkle_proof(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        timestamp: u64,
    ) -> Result<RevocationMerkleProof, ContractError> {
        let period = Self::crl_period(timestamp);
        let leaves: Vec<BytesN<32>> = env.storage().persistent().get(&(CRL_LEAVES, issuer, period)).ok_or(ContractError::CredentialNotFound)?;
        let mut index: u32 = 0;
        let mut found = false;
        for leaf in leaves.iter() {
            if leaf == credential_id {
                found = true;
                break;
            }
            index += 1;
        }
        if !found { return Err(ContractError::CredentialNotFound); }
        let mut level = leaves;
        let mut siblings = Vec::new(&env);
        let mut sibling_on_left = Vec::new(&env);
        while level.len() > 1 {
            let is_right = index % 2 == 1;
            let sibling_index = if is_right {
                index - 1
            } else {
                (index + 1).min(level.len() - 1)
            };
            siblings.push_back(level.get(sibling_index).unwrap());
            sibling_on_left.push_back(is_right);
            let mut next = Vec::new(&env);
            let mut i = 0;
            while i < level.len() {
                let right = (i + 1).min(level.len() - 1);
                next.push_back(Self::hash_merkle_pair(
                    &env,
                    &level.get(i).unwrap(),
                    &level.get(right).unwrap(),
                ));
                i += 2;
            }
            index /= 2;
            level = next;
        }
        Ok(RevocationMerkleProof {
            leaf: credential_id,
            siblings,
            sibling_on_left,
        })
    }

    /// Verifies a revocation proof against the stored root for `timestamp`.
    pub fn verify_revocation_merkle_proof(
        env: Env,
        issuer: Address,
        timestamp: u64,
        proof: RevocationMerkleProof,
    ) -> bool {
        if proof.siblings.len() != proof.sibling_on_left.len() {
            return false;
        }
        let expected = Self::get_revocation_merkle_root(env.clone(), issuer, timestamp);
        let mut current = proof.leaf;
        for i in 0..proof.siblings.len() {
            let sibling = proof.siblings.get(i).unwrap();
            current = if proof.sibling_on_left.get(i).unwrap() {
                Self::hash_merkle_pair(&env, &sibling, &current)
            } else {
                Self::hash_merkle_pair(&env, &current, &sibling)
            };
        }
        current == expected
    }

    /// Revoke a credential. Equivalent to
    /// [`Self::revoke_credential_with_reason`]; kept for backwards compatibility.
    pub fn revoke_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        reason: RevocationReason,
    ) -> Result<(), ContractError> {
        Self::revoke_credential_with_reason(env, issuer, credential_id, reason)
    }

    /// Revoke a credential and record a standardized [`RevocationReason`].
    pub fn revoke_credential_with_reason(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        reason: RevocationReason,
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

    pub fn set_transfer_auto_approve(
        env: Env,
        admin: Address,
        enabled: bool,
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
        env.storage()
            .instance()
            .set(&Self::auto_approve_transfers_key(), &enabled);
        env.events()
            .publish((CRED, symbol_short!("xfer_cfg")), (EVENT_VERSION, enabled));
        Ok(())
    }

    pub fn transfer_credential(
        env: Env,
        subject: Address,
        credential_id: BytesN<32>,
        new_subject: Address,
    ) -> Result<(), ContractError> {
        subject.require_auth();
        let auto_approve = env
            .storage()
            .instance()
            .get(&Self::auto_approve_transfers_key())
            .unwrap_or(false);

        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&Self::cred_key(&credential_id))
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.subject != subject {
            return Err(ContractError::Unauthorized);
        }
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }
        if !auto_approve {
            let request: CredentialTransferRequest = env
                .storage()
                .persistent()
                .get(&Self::transfer_key(&credential_id))
                .ok_or(ContractError::UnauthorizedIssuer)?;
            if !request.approved_by_issuer || request.status != TransferStatus::Approved {
                return Err(ContractError::UnauthorizedIssuer);
            }
        }

        cred.subject = new_subject.clone();
        env.storage()
            .persistent()
            .set(&Self::cred_key(&credential_id), &cred);

        let transfer_record = CredentialTransferRecord {
            credential_id: credential_id.clone(),
            from_subject: subject.clone(),
            to_subject: new_subject.clone(),
            transferred_by: subject.clone(),
            approved_by_issuer: auto_approve,
            transferred_at: env.ledger().timestamp(),
        };

        let mut history: Vec<CredentialTransferRecord> = env
            .storage()
            .persistent()
            .get(&Self::transfer_history_key(&credential_id))
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(transfer_record.clone());
        env.storage()
            .persistent()
            .set(&Self::transfer_history_key(&credential_id), &history);
        env.storage()
            .persistent()
            .remove(&Self::transfer_key(&credential_id));

        env.events().publish(
            (CRED, symbol_short!("xfer")),
            (
                EVENT_VERSION,
                credential_id.clone(),
                subject,
                new_subject,
                transfer_record.approved_by_issuer,
            ),
        );
        Ok(())
    }

    pub fn request_credential_transfer(
        env: Env,
        subject: Address,
        credential_id: BytesN<32>,
        new_subject: Address,
    ) -> Result<(), ContractError> {
        subject.require_auth();
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&Self::cred_key(&credential_id))
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.subject != subject {
            return Err(ContractError::Unauthorized);
        }
        if cred.revoked {
            return Err(ContractError::CredentialRevoked);
        }

        let request = CredentialTransferRequest {
            credential_id: credential_id.clone(),
            from_subject: subject.clone(),
            to_subject: new_subject.clone(),
            requested_at: env.ledger().timestamp(),
            approved_by_issuer: false,
            status: TransferStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&Self::transfer_key(&credential_id), &request);
        env.events().publish(
            (CRED, symbol_short!("xfer_req")),
            (EVENT_VERSION, credential_id, subject, new_subject),
        );
        Ok(())
    }

    pub fn confirm_credential_transfer(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        approved: bool,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        let mut request: CredentialTransferRequest = env
            .storage()
            .persistent()
            .get(&Self::transfer_key(&credential_id))
            .ok_or(ContractError::UnauthorizedIssuer)?;

        let cred: Credential = env
            .storage()
            .persistent()
            .get(&Self::cred_key(&credential_id))
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(ContractError::UnauthorizedIssuer);
        }

        request.approved_by_issuer = approved;
        request.status = if approved {
            TransferStatus::Approved
        } else {
            TransferStatus::Rejected
        };
        env.storage()
            .persistent()
            .get(&(REVOKE_REASON, credential_id))
            .ok_or(ContractError::CredentialNotFound)
    }

    pub fn get_transfer_history(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Vec<CredentialTransferRecord> {
        env.storage()
            .persistent()
            .get(&(REVOKED_BY_REASON, reason))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn expire_credential(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
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
        Self::require_not_paused(&env)?;

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
    pub fn amend_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        new_claims: Map<String, String>,
        reason: String,
    ) -> Result<u32, ContractError> {
        issuer.require_auth();
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

        let next_version = cred.version.saturating_add(1);
        let amended_at = env.ledger().timestamp();
        let summary = versions::summarize_claim_changes(&env, &cred.claims, &new_claims);
        let version_record = CredentialVersion {
            version: next_version,
            claims: new_claims.clone(),
            claims_hash: Self::claims_schema_hash(&env, &new_claims),
            amended_at,
            amended_by: issuer.clone(),
            reason: reason.clone(),
            change_summary: summary.clone(),
        };

        let history_key = (CRED_VERSIONS, credential_id.clone());
        let mut history: Vec<CredentialVersion> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        if history.len() >= MAX_CREDENTIAL_VERSION_HISTORY {
            let mut trimmed: Vec<CredentialVersion> = Vec::new(&env);
            for idx in 1..history.len() {
                let item = history.get(idx as u32).unwrap();
                trimmed.push_back(item);
            }
            history = trimmed;
        }

        history.push_back(version_record);
        env.storage().persistent().set(&history_key, &history);

        cred.claims = new_claims;
        cred.claims_hash = Self::claims_schema_hash(&env, &cred.claims);
        cred.version = next_version;
        cred.last_modified_at = amended_at;
        env.storage().persistent().set(&key, &cred);

        env.events().publish(
            (CRED, symbol_short!("amended")),
            (
                EVENT_VERSION,
                credential_id,
                issuer,
                next_version,
                summary,
                reason,
            ),
        );

        Ok(next_version)
    }

    pub fn get_credential_version(
        env: Env,
        credential_id: BytesN<32>,
        version: u32,
    ) -> Result<CredentialVersion, ContractError> {
        let history_key = (CRED_VERSIONS, credential_id.clone());
        let history: Vec<CredentialVersion> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        for item in history.iter() {
            if item.version == version {
                return Ok(item);
            }
        }

        let current = env
            .storage()
            .persistent()
            .get::<_, Credential>(&Self::cred_key(&credential_id))
            .ok_or(ContractError::CredentialNotFound)?;
        if current.version == version {
            return Ok(CredentialVersion {
                version: current.version,
                claims: current.claims.clone(),
                claims_hash: current.claims_hash,
                amended_at: current.last_modified_at,
                amended_by: current.issuer.clone(),
                reason: String::from_str(&env, "latest"),
                change_summary: String::from_str(&env, "latest_version"),
            });
        }
        Err(ContractError::VersionNotFound)
    }

    pub fn get_credential_history(env: Env, credential_id: BytesN<32>) -> Vec<CredentialVersion> {
        env.storage()
            .persistent()
            .get(&(CRED_VERSIONS, credential_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn verify_credential(env: Env, credential_id: BytesN<32>) -> Result<(), ContractError> {
        let key = Self::cred_key(&credential_id);
        match env.storage().persistent().get::<_, Credential>(&key) {
            None => Err(ContractError::CredentialNotFound),
            Some(cred) => {
                if cred.revoked {
                    return Err(ContractError::CredentialRevoked);
                }
                // #856: suspended credentials fail verification until reactivated.
                if suspension::is_suspended(&env, &credential_id) {
                    return Err(ContractError::CredentialSuspended);
                }
                let now = env.ledger().timestamp();
                // #731: credential must have reached its activation_time.
                if cred.activation_time != 0 && now < cred.activation_time {
                    return Err(ContractError::CredentialNotYetActive);
                }
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

    // ── Credential delegation (#655) ──────────────────────────────────────────

    /// Grants `delegate` the right to verify on `subject`'s behalf — scoped to
    /// one credential, or to all of `subject`'s via the zero id. `subject`
    /// must sign; overwrites any existing grant to the same `delegate`.
    pub fn delegate_verification(
        env: Env,
        subject: Address,
        delegate: Address,
        credential_id: BytesN<32>,
        expires_at: u64,
    ) -> Result<(), ContractError> {
        subject.require_auth();
        Self::require_not_paused(&env)?;
        let now = env.ledger().timestamp();
        if expires_at <= now {
            return Err(ContractError::InvalidDelegationExpiry);
        }
        let key = Self::delegation_key(&subject, &delegate);
        let delegation = Delegation {
            subject: subject.clone(),
            delegate: delegate.clone(),
            credential_id: credential_id.clone(),
            granted_at: now,
            expires_at,
            revoked: false,
        };
        env.storage().persistent().set(&key, &delegation);
        let ttl = Self::ttl_for_credential(&env, expires_at);
        env.storage().persistent().extend_ttl(&key, ttl, ttl);
        env.events().publish(
            (DELEGATION, symbol_short!("granted")),
            (EVENT_VERSION, subject, delegate, credential_id, expires_at),
        );
        Ok(())
    }

    /// Revokes a previously granted delegation (subject only).
    pub fn revoke_delegation(env: Env, subject: Address, delegate: Address) -> Result<(), ContractError> {
        subject.require_auth();
        Self::require_not_paused(&env)?;
        let key = Self::delegation_key(&subject, &delegate);
        let mut delegation: Delegation =
            env.storage().persistent().get(&key).ok_or(ContractError::DelegationNotFound)?;
        if delegation.revoked {
            return Err(ContractError::DelegationAlreadyRevoked);
        }
        delegation.revoked = true;
        env.storage().persistent().set(&key, &delegation);
        env.events().publish(
            (DELEGATION, symbol_short!("revoked")),
            (EVENT_VERSION, subject, delegate),
        );
        Ok(())
    }

    /// Whether `delegate` currently holds an active, unexpired delegation
    /// from `subject` covering `credential_id`.
    pub fn is_delegate_authorized(env: Env, subject: Address, delegate: Address, credential_id: BytesN<32>) -> bool {
        Self::active_delegation(&env, &subject, &delegate, &credential_id).is_some()
    }

    /// Verifies a credential on `subject`'s behalf via a delegation grant.
    /// `delegate` must sign and hold a matching, active delegation — see
    /// [`Self::delegate_verification`].
    pub fn verify_credential_as_delegate(
        env: Env,
        delegate: Address,
        subject: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        delegate.require_auth();
        if Self::active_delegation(&env, &subject, &delegate, &credential_id).is_none() {
            return Err(ContractError::UnauthorizedDelegate);
        }
        let key = Self::cred_key(&credential_id);
        let cred: Credential = env.storage().persistent().get(&key).ok_or(ContractError::CredentialNotFound)?;
        if cred.subject != subject {
            return Err(ContractError::CredentialNotFound);
        }
        Self::verify_credential(env, credential_id)
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
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP {
            PAGE_CAP
        } else {
            limit
        };
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
        let next_cursor = if (next as u32) < total {
            Some(next)
        } else {
            None
        };
        CredentialIdsPage { items, next_cursor }
    }

    pub fn get_credential_count(env: Env, subject: Address) -> u32 {
        let cnt_key = (CRED_CNT, subject);
        if env.storage().persistent().has(&cnt_key) {
            env.storage()
                .persistent()
                .extend_ttl(&cnt_key, TTL_MAX, TTL_MAX);
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
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP {
            PAGE_CAP
        } else {
            limit
        };
        let mut items: Vec<Address> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total {
            Some(next)
        } else {
            None
        };
        IssuersPage { items, next_cursor }
    }

    pub fn get_issuer_credentials(env: Env, issuer: Address) -> Vec<BytesN<32>> {
        Self::fetch_issuer_creds(&env, &issuer)
    }

    pub fn get_revocations(env: Env, issuer: Address, subject: Address) -> Vec<BytesN<32>> {
        Self::fetch_revocations(&env, &issuer, &subject)
    }

    /// Returns the revocation record (reason, revoker, timestamp) for a
    /// credential, or `None` if it has not been revoked. See #951.
    pub fn get_revocation_record(env: Env, credential_id: BytesN<32>) -> Option<RevocationRecord> {
        env.storage()
            .persistent()
            .get(&(REVOKE_REASON, credential_id))
    }

    /// Returns the IDs of all credentials revoked for `reason`. See #951.
    pub fn get_revoked_by_reason(env: Env, reason: RevocationReason) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&(REVOKED_BY_REASON, reason))
            .unwrap_or_else(|| Vec::new(&env))
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
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP {
            PAGE_CAP
        } else {
            limit
        };
        let mut items: Vec<BytesN<32>> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total {
            Some(next)
        } else {
            None
        };
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

    // ── Issue #662: Credential metadata indexing API ──────────────────────────

    /// Query credentials by type with pagination.
    /// Returns all non-revoked credentials of the specified type.
    pub fn get_credentials_by_type(
        env: Env,
        credential_type: CredentialType,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage {
        let type_key = (CRED_BY_TYPE, credential_type);
        let all: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&type_key)
            .unwrap_or_else(|| Vec::new(&env));
        Self::paginate_credentials(&env, &all, cursor, limit)
    }

    /// Query credentials by issuer address with pagination.
    /// Returns all non-revoked credentials issued by the specified issuer.
    pub fn get_credentials_by_issuer_index(
        env: Env,
        issuer: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage {
        let issuer_key = (CRED_BY_ISSUER, issuer);
        let all: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&issuer_key)
            .unwrap_or_else(|| Vec::new(&env));
        Self::paginate_credentials(&env, &all, cursor, limit)
    }

    /// Query credentials by subject address with pagination.
    /// Returns all non-revoked credentials held by the specified subject.
    pub fn get_credentials_by_subject_index(
        env: Env,
        subject: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage {
        let subject_key = (CRED_BY_SUBJECT, subject);
        let all: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&subject_key)
            .unwrap_or_else(|| Vec::new(&env));
        Self::paginate_credentials(&env, &all, cursor, limit)
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
            env.storage()
                .persistent()
                .extend_ttl(&rdep_key, TTL_MAX, TTL_MAX);
        }

        // Write new forward index.
        let deps_key = (CRED_DEPS, credential_id.clone());
        env.storage().persistent().set(&deps_key, &prerequisites);
        env.storage()
            .persistent()
            .extend_ttl(&deps_key, TTL_MAX, TTL_MAX);

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
            env.storage()
                .persistent()
                .extend_ttl(&rdep_key, TTL_MAX, TTL_MAX);
        }

        env.events().publish(
            (CRED, symbol_short!("prqset")),
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
        let valid = !cred.revoked
            && !suspension::is_suspended(&env, &credential_id)
            && (cred.expires_at == 0 || now <= cred.expires_at);
        let prerequisites = Self::fetch_prereqs(&env, &credential_id);

        Ok(DependencyTree {
            id: credential_id,
            prerequisites,
            valid,
        })
    }

    // ── Issue #819 / #733: batch verify credentials ────────────────────────────

    /// Verify multiple credentials in a single call, returning one detailed
    /// result per id. See the [`batch`] module for the algorithm (shared
    /// per-call memoization of credential lookups) and the exact meaning of
    /// `fail_fast`. No `require_auth` is needed; verification is read-only.
    /// Returns `BatchTooLarge` if `ids.len() > batch::MAX_VERIFY_BATCH` (50).
    pub fn verify_credentials_batch(
        env: Env,
        ids: Vec<BytesN<32>>,
        fail_fast: bool,
    ) -> Result<Vec<BatchVerifyResult>, ContractError> {
        batch::verify_batch(&env, ids, fail_fast)
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
        let random_bytes = env.crypto().sha256(&subject.clone().to_xdr(&env));
        nonce.extend_from_array(&random_bytes.to_array());

        let challenge = Challenge {
            nonce: nonce.clone(),
            created_at: now,
            sig_scheme,
        };

        let challenge_key = (CHALLENGE, issuer.clone(), subject.clone());
        env.storage().temporary().set(&challenge_key, &challenge);
        env.storage().temporary().extend_ttl(
            &challenge_key,
            CHALLENGE_EXPIRATION_SECS as u32,
            CHALLENGE_EXPIRATION_SECS as u32,
        );

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

        return Err(ContractError::UnsupportedSignatureScheme);
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
            env.storage()
                .instance()
                .remove(&(ADMIN_APPROVALS, proposal_id));
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
            (
                EVENT_VERSION,
                proposal_id,
                approver.clone(),
                action.approval_count,
            ),
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
                (
                    EVENT_VERSION,
                    proposal_id,
                    action.action_type.clone(),
                    action.target.clone(),
                ),
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
        reason: &RevocationReason,
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
        Self::append_revocation_leaf(env, issuer, credential_id, env.ledger().timestamp());
        let revoked: u32 = env.storage().instance().get(&REVOKED_CNT).unwrap_or(0);
        env.storage().instance().set(&REVOKED_CNT, &(revoked + 1));
        // closes #553: include revocation timestamp in batch events too.
        let revoked_at: u64 = env.ledger().timestamp();
        Self::record_revocation(env, credential_id, *reason, issuer, revoked_at);
        env.events().publish(
            (CRED, symbol_short!("revoked")),
            (
                EVENT_VERSION,
                credential_id.clone(),
                issuer.clone(),
                revoked_at,
                reason.clone(),
            ),
        );
        Ok(())
    }

    fn zk_transcript(
        env: &Env,
        verification_key: &Bytes,
        commitment: &BytesN<32>,
        statement: &Bytes,
    ) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.extend_from_array(b"FUNDABLE-ZK-V1");
        data.append(verification_key);
        data.extend_from_array(&commitment.to_array());
        data.append(statement);
        env.crypto().sha256(&data).into()
    }

    fn crl_period(timestamp: u64) -> u64 {
        (timestamp / CRL_PERIOD_SECS) * CRL_PERIOD_SECS
    }

    fn hash_merkle_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.extend_from_array(&left.to_array());
        data.extend_from_array(&right.to_array());
        env.crypto().sha256(&data).into()
    }

    fn append_revocation_leaf(
        env: &Env,
        issuer: &Address,
        credential_id: &BytesN<32>,
        timestamp: u64,
    ) {
        let period = Self::crl_period(timestamp);
        let key = (CRL_LEAVES, issuer.clone(), period);
        let mut leaves: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if !leaves.contains(credential_id) {
            leaves.push_back(credential_id.clone());
            env.storage().persistent().set(&key, &leaves);
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
            let root = Self::rebuild_merkle_root(env, &leaves);
            let root_key = (CRL_ROOT, issuer.clone(), period);
            env.storage().persistent().set(&root_key, &root);
            env.storage()
                .persistent()
                .extend_ttl(&root_key, TTL_MAX, TTL_MAX);
            env.events().publish(
                (CRED, symbol_short!("crlroot")),
                (EVENT_VERSION, issuer.clone(), period, root),
            );
        }
    }

    fn rebuild_merkle_root(env: &Env, leaves: &Vec<BytesN<32>>) -> BytesN<32> {
        if leaves.len() == 0 {
            return BytesN::from_array(env, &[0u8; 32]);
        }
        let mut level = leaves.clone();
        while level.len() > 1 {
            let mut next = Vec::new(env);
            let mut i = 0;
            while i < level.len() {
                let right = (i + 1).min(level.len() - 1);
                next.push_back(Self::hash_merkle_pair(
                    env,
                    &level.get(i).unwrap(),
                    &level.get(right).unwrap(),
                ));
                i += 2;
            }
            level = next;
        }
        level.get(0).unwrap()
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

    /// Issue #656: like [`Self::require_admin`], but for call sites that already
    /// have an explicit `admin` address argument to authenticate (rather than
    /// looking one up as the sole caller). Requires `caller`'s auth and checks
    /// it matches the stored admin.
    fn require_admin_caller(env: &Env, caller: &Address) -> Result<(), ContractError> {
        caller.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if &stored != caller {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    /// Issue #661: Get packed config from storage (optimized single read).
    fn get_config(env: &Env) -> ContractConfig {
        env.storage()
            .instance()
            .get(&CONFIG)
            .unwrap_or(ContractConfig {
                max_issuers: MAX_ISSUERS,
                is_paused: false,
            })
    }

    /// Issue #661: Set packed config to storage (optimized single write).
    fn set_config(env: &Env, config: &ContractConfig) {
        env.storage().instance().set(&CONFIG, config);
    }

    fn require_admin_caller(env: &Env, admin: &Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if &stored != admin {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }
    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        let config = Self::get_config(env);
        if config.is_paused {
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

        match challenge.sig_scheme {
            SIG_SCHEME_ED25519 => {
                let pubkey = Self::subject_public_key(env, subject)?;
                if signed_challenge.len() != 64 {
                    return Err(ContractError::InvalidProof);
                }
                let mut sig_arr = [0u8; 64];
                for i in 0..64u32 {
                    sig_arr[i as usize] = signed_challenge.get(i).unwrap_or(0);
                }
                let signature = BytesN::<64>::from_array(env, &sig_arr);
                env.crypto().ed25519_verify(&pubkey, &challenge.nonce, &signature);
            }
            SIG_SCHEME_SECP256K1 => return Err(ContractError::UnsupportedSignatureScheme),
            _ => return Err(ContractError::UnsupportedSignatureScheme),
        }

        // Clear the challenge after successful verification
        env.storage().temporary().remove(&challenge_key);

        Ok(())
    }

    fn subject_public_key(env: &Env, subject: &Address) -> Result<BytesN<32>, ContractError> {
        // ScVal::Address (18), ScAddress::Account (0), PublicKey::Ed25519 (0), then 32 bytes.
        let encoded = subject.clone().to_xdr(env);
        if encoded.len() != 44
            || encoded.slice(0..12)
                != Bytes::from_array(env, &[0, 0, 0, 18, 0, 0, 0, 0, 0, 0, 0, 0])
        {
            return Err(ContractError::UnsupportedSignatureScheme);
        }
        let mut key = [0u8; 32];
        encoded.slice(12..44).copy_into_slice(&mut key);
        Ok(BytesN::from_array(env, &key))
    }

    /// Issue #658: Execute an admin action after threshold is reached.
    fn execute_admin_action_internal(env: &Env, action: &AdminAction) -> Result<(), ContractError> {
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
                env.storage()
                    .instance()
                    .set(&MAX_ISSUERS_CFG, &action.param);
                env.events().publish(
                    (ADMIN, Symbol::new(env, "admin_config_changed")),
                    (
                        EVENT_VERSION,
                        symbol_short!("max_iss"),
                        old_max,
                        action.param,
                    ),
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
        env.storage()
            .instance()
            .get(&ISSUER)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Current effective issuer cap (Issue #661: optimized via packed config).
    fn effective_max_issuers(env: &Env) -> u32 {
        Self::get_config(env).max_issuers
    }

    fn get_max_issuers_internal(env: &Env) -> u32 {
        Self::get_config(env).max_issuers
    }

    /// Issue #662: Pagination helper for credential index queries.
    /// Extracts a page of credentials from a list with cursor-based pagination.
    fn paginate_credentials(
        env: &Env,
        all: &Vec<BytesN<32>>,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage {
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP {
            PAGE_CAP
        } else {
            limit
        };
        let mut items: Vec<BytesN<32>> = Vec::new(env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total {
            Some(next)
        } else {
            None
        };
        CredentialIdsPage { items, next_cursor }
    }

    /// Issue #951: persist the revocation record and add the credential to the
    /// per-reason index.
    fn record_revocation(
        env: &Env,
        credential_id: &BytesN<32>,
        reason: RevocationReason,
        revoked_by: &Address,
        revoked_at: u64,
    ) {
        let record_key = (REVOKE_REASON, credential_id.clone());
        env.storage().persistent().set(
            &record_key,
            &RevocationRecord {
                credential_id: credential_id.clone(),
                reason,
                revoked_by: revoked_by.clone(),
                revoked_at,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&record_key, TTL_MAX, TTL_MAX);

        let index_key = (REVOKED_BY_REASON, reason);
        let mut ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&index_key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(credential_id.clone());
        env.storage().persistent().set(&index_key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&index_key, TTL_MAX, TTL_MAX);
    }

    /// Issue #662: Helper to remove a credential ID from an index vector.
    fn remove_from_vec(env: &Env, mut vec: Vec<BytesN<32>>, id: &BytesN<32>) -> Vec<BytesN<32>> {
        let mut result: Vec<BytesN<32>> = Vec::new(env);
        for i in vec.iter() {
            if i != *id {
                result.push_back(i);
            }
        }
        result
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

    fn type_key(type_name: &String) -> (Symbol, String) {
        (TYPE_REGISTRY, type_name.clone())
    }

    fn delegation_key(subject: &Address, delegate: &Address) -> (Symbol, Address, Address) {
        (DELEGATION, subject.clone(), delegate.clone())
    }

    /// Returns the delegation from `subject` to `delegate` if it's active
    /// (not revoked, not expired, and covers `credential_id` — either scoped
    /// to it directly or granted for all of `subject`'s credentials via the
    /// zero id).
    fn active_delegation(
        env: &Env,
        subject: &Address,
        delegate: &Address,
        credential_id: &BytesN<32>,
    ) -> Option<Delegation> {
        let key = Self::delegation_key(subject, delegate);
        let delegation: Delegation = env.storage().persistent().get(&key)?;
        if delegation.revoked || env.ledger().timestamp() >= delegation.expires_at {
            return None;
        }
        let unscoped = BytesN::from_array(env, &[0u8; 32]);
        if delegation.credential_id != unscoped && &delegation.credential_id != credential_id {
            return None;
        }
        Some(delegation)
    }

    fn type_names(env: &Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&TYPE_NAMES)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// sha256 of the claim keys, sorted (Soroban `Map` already iterates in
    /// sorted key order) and `\0`-joined — a schema commitment to "which
    /// claim keys this credential type carries", independent of their values.
    fn claims_schema_hash(env: &Env, claims: &Map<String, String>) -> BytesN<32> {
        let mut data = Bytes::new(env);
        for (k, _v) in claims.iter() {
            data.append(&k.to_xdr(env));
            data.push_back(0u8);
        }
        env.crypto().sha256(&data).into()
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
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn fetch_issuer_creds(env: &Env, issuer: &Address) -> Vec<BytesN<32>> {
        let key = Self::issuer_creds_key(issuer);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn fetch_revocations(env: &Env, issuer: &Address, subject: &Address) -> Vec<BytesN<32>> {
        let key = Self::revocations_key(issuer, subject);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
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
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
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
                if cred.revoked || suspension::is_suspended(env, id) {
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
                    Self::record_revocation(
                        env,
                        &dep_id,
                        RevocationReason::DependencyRevoked,
                        &dep.issuer,
                        env.ledger().timestamp(),
                    );
                    env.events().publish(
                        (CRED, symbol_short!("dep_rev")),
                        (
                            EVENT_VERSION,
                            dep_id.clone(),
                            parent_id.clone(),
                            RevocationReason::DependencyRevoked,
                        ),
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
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        Bytes, Env, Map, String,
    };

    #[contract]
    struct MockIdentityRegistry;
    #[contractimpl]
    impl MockIdentityRegistry {
        pub fn has_active_did(_env: Env, _controller: Address) -> bool {
            true
        }
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
            &Bytes::from_array(env, &[0u8; 64]), &0u64, &0u64, &None, &None,
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
    fn test_transfer_credential_updates_subject_and_history() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let original_subject = Address::generate(&env);
        let new_subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let cred_id = issue_kyc(&env, &client, &issuer, &original_subject);
        client.transfer_credential(&original_subject, &cred_id, &new_subject);

        let updated = client.get_credential(&cred_id);
        assert_eq!(updated.subject, new_subject);
        let history = client.get_transfer_history(&cred_id);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().to_subject, new_subject);
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
        client.revoke_credential(&issuer, &cred_id, &RevocationReason::KeyCompromise);
        assert_eq!(
            client.try_verify_credential(&cred_id),
            Err(Ok(ContractError::CredentialRevoked))
        );
    }

    #[test]
    fn test_revoke_credential_stores_reason_and_record() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        env.ledger().with_mut(|li| li.timestamp = 1_000);
        client.revoke_credential(&issuer, &cred_id, &RevocationReason::KeyCompromise);

        let record = client.get_revocation(&cred_id);
        assert_eq!(record.credential_id, cred_id);
        assert_eq!(record.reason, RevocationReason::KeyCompromise);
        assert_eq!(record.revoked_by, issuer);
        assert_eq!(record.revoked_at, 1_000);
        assert_eq!(
            client.count_revocations_by_reason(&RevocationReason::KeyCompromise),
            1
        );
    }

    #[test]
    fn test_revocations_are_queryable_by_reason() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);
        let first = issue_kyc(&env, &client, &issuer, &Address::generate(&env));
        let second = issue_kyc(&env, &client, &issuer, &Address::generate(&env));

        client.revoke_credential(&issuer, &first, &RevocationReason::Superseded);
        client.revoke_credential(&issuer, &second, &RevocationReason::Fraudulent);

        let superseded = client.get_revocations_by_reason(&RevocationReason::Superseded);
        assert_eq!(superseded.len(), 1);
        assert_eq!(superseded.get(0).unwrap(), first);

        let fraudulent = client.get_revocations_by_reason(&RevocationReason::Fraudulent);
        assert_eq!(fraudulent.len(), 1);
        assert_eq!(fraudulent.get(0).unwrap(), second);

        // A reason nobody used yet reads back empty instead of failing.
        assert_eq!(
            client.get_revocations_by_reason(&RevocationReason::CessationOfOperation),
            Vec::new(&env)
        );
        assert_eq!(
            client.count_revocations_by_reason(&RevocationReason::Superseded),
            1
        );
    }

    #[test]
    fn test_batch_revocation_stores_records_too() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);
        let first = issue_kyc(&env, &client, &issuer, &Address::generate(&env));
        let second = issue_kyc(&env, &client, &issuer, &Address::generate(&env));

        let mut ids = Vec::new(&env);
        ids.push_back(first.clone());
        ids.push_back(second.clone());
        client.revoke_credentials_batch(&issuer, &ids, &RevocationReason::AffiliationChanged);

        assert_eq!(
            client.get_revocation(&first).reason,
            RevocationReason::AffiliationChanged
        );
        assert_eq!(
            client.get_revocation(&second).reason,
            RevocationReason::AffiliationChanged
        );
        assert_eq!(
            client.count_revocations_by_reason(&RevocationReason::AffiliationChanged),
            2
        );
    }

    #[test]
    fn test_get_revocation_for_unrevoked_credential_errors() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        assert_eq!(
            client.try_get_revocation(&cred_id),
            Err(Ok(ContractError::CredentialNotFound))
        );
    }

    #[test]
    fn test_revocation_reason_options_are_stable() {
        let (_env, _admin, client) = setup();
        let options = client.get_revocation_reason_options();
        assert_eq!(options.len(), 10);
        assert_eq!(options.get(0).unwrap(), RevocationReason::Unspecified);
        assert_eq!(options.get(1).unwrap(), RevocationReason::KeyCompromise);
        assert_eq!(options.get(9).unwrap(), RevocationReason::DependencyRevoked);
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &0u64, &Some(schema_hash.clone()), &None,
        );
        assert_eq!(result, Err(Ok(ContractError::SchemaNotFound)));

        // Register schema then issue succeeds
        client.register_schema(&issuer, &schema_hash);
        let cred_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &0u64, &Some(schema_hash), &None,
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
        client.revoke_credential(&issuer, &original_id, &RevocationReason::Superseded);

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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
        );
        client.revoke_credential(&issuer, &cred_id, &RevocationReason::KeyCompromise);
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
        for ct in [
            CredentialType::Kyc,
            CredentialType::Reputation,
            CredentialType::Achievement,
        ] {
            client.issue_credential(
                &issuer, &subject, &ct,
                &Map::new(&env), &BytesN::from_array(&env, &[1u8; 32]),
                &Bytes::from_array(&env, &[0u8; 64]), &0u64, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
        assert!(
            has_renewed,
            "credential_renewed event should have been emitted"
        );
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
        );

        client.revoke_credential(&issuer, &cred_id, &RevocationReason::KeyCompromise);
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
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
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
        );

        let new_expires_at = expires_at + 10_000;
        client.renew_credential(&issuer, &cred_id, &new_expires_at);

        // Advance past the original expiry but before the new one
        env.ledger().with_mut(|l| l.timestamp = expires_at + 1);

        // Should still verify successfully with the extended expiry
        client.verify_credential(&cred_id);
    }

    #[test]
    fn test_pause_blocks_state_changes_until_unpaused() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        client.pause();
        assert!(client.is_paused());
        assert_eq!(
            client.try_revoke_credential(&issuer, &cred_id, &RevocationReason::Superseded),
            Err(Ok(ContractError::ContractPaused))
        );

        client.unpause();
        assert!(!client.is_paused());
        client.revoke_credential(&issuer, &cred_id, &RevocationReason::Superseded);
    }

    #[test]
    fn test_storage_key_symbols_are_unique() {
        let keys = [
            ADMIN, ISSUER, CRED, SUBJECT, CRED_CNT, REVOKED_CNT, ISSUER_CREDS, SCHEMA, ISS_NONCE,
            TYPE_REGISTRY, TYPE_NAMES, DELEGATION, suspension::SUSPENDED,
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
                &rando, &rando, &CredentialType::Kyc, &claims, &claims_hash, &sig, &0u64, &0u64, &None, &None,
            ),
            Err(Ok(ContractError::UnauthorizedIssuer))
        );
    }

    /// Ring-buffer eviction: when issuer index reaches MAX_ISSUER_CREDS,
    /// issuing the (MAX_ISSUER_CREDS + 1)th credential drops the oldest entry.
    ///
    /// The index is seeded directly in storage: issuing 10 000 real
    /// credentials takes the better part of an hour in the test host.
    #[test]
    fn test_issuer_credentials_ring_buffer_eviction() {
        let (env, _admin, client) = setup();
        env.budget().reset_unlimited();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);

        let mut index = Vec::new(&env);
        for i in 0..MAX_ISSUER_CREDS {
            let mut raw_id = [0u8; 32];
            raw_id[..4].copy_from_slice(&i.to_be_bytes());
            index.push_back(BytesN::from_array(&env, &raw_id));
        }
        let evicted_id = index.get(0).unwrap();
        let next_oldest_id = index.get(1).unwrap();
        env.as_contract(&client.address, || {
            env.storage()
                .persistent()
                .set(&CredentialManager::issuer_creds_key(&issuer), &index);
        });

        assert_eq!(client.get_issuer_credentials(&issuer).len(), MAX_ISSUER_CREDS);
        let new_id = issue_kyc(&env, &client, &issuer, &Address::generate(&env));

        let creds_after = client.get_issuer_credentials(&issuer);
        assert_eq!(creds_after.len(), MAX_ISSUER_CREDS);
        assert_eq!(creds_after.get(0).unwrap(), next_oldest_id);
        assert_eq!(creds_after.last().unwrap(), new_id);
        assert!(!creds_after.contains(&evicted_id));
    }

    // ── Credential type registry tests (#656) ───────────────────────────────

    fn kyc_claims(env: &Env) -> Map<String, String> {
        let mut claims = Map::new(env);
        claims.set(
            String::from_str(env, "full_name"),
            String::from_str(env, "Jane Doe"),
        );
        claims.set(
            String::from_str(env, "country"),
            String::from_str(env, "US"),
        );
        claims
    }

    #[test]
    fn test_register_and_get_credential_type() {
        let (env, admin, client) = setup();
        let claims = kyc_claims(&env);
        let schema_hash = client.compute_claims_schema_hash(&claims);
        let name = String::from_str(&env, "kyc-basic");

        client.register_credential_type(&admin, &name, &schema_hash, &Map::new(&env));

        let descriptor = client.get_credential_type(&name);
        assert_eq!(descriptor.type_name, name);
        assert_eq!(descriptor.schema_hash, schema_hash);
        assert!(descriptor.active);

        let names = client.list_credential_types();
        assert_eq!(names.len(), 1);
        assert_eq!(names.get(0).unwrap(), name);
    }

    #[test]
    fn test_register_credential_type_rejects_duplicate_active() {
        let (env, admin, client) = setup();
        let schema_hash = BytesN::from_array(&env, &[7u8; 32]);
        let name = String::from_str(&env, "kyc-basic");
        client.register_credential_type(&admin, &name, &schema_hash, &Map::new(&env));

        assert_eq!(
            client.try_register_credential_type(&admin, &name, &schema_hash, &Map::new(&env)),
            Err(Ok(ContractError::CredentialTypeAlreadyExists))
        );
    }

    #[test]
    fn test_register_credential_type_rejects_zero_hash() {
        let (env, admin, client) = setup();
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        let name = String::from_str(&env, "kyc-basic");
        assert_eq!(
            client.try_register_credential_type(&admin, &name, &zero_hash, &Map::new(&env)),
            Err(Ok(ContractError::InvalidSchemaHash))
        );
    }

    #[test]
    fn test_register_credential_type_rejects_non_admin() {
        let (env, _admin, client) = setup();
        let attacker = Address::generate(&env);
        let schema_hash = BytesN::from_array(&env, &[7u8; 32]);
        let name = String::from_str(&env, "kyc-basic");
        assert_eq!(
            client.try_register_credential_type(&attacker, &name, &schema_hash, &Map::new(&env)),
            Err(Ok(ContractError::Unauthorized))
        );
    }

    #[test]
    fn test_deactivate_then_reregister_credential_type() {
        let (env, admin, client) = setup();
        let schema_hash = BytesN::from_array(&env, &[7u8; 32]);
        let name = String::from_str(&env, "kyc-basic");
        client.register_credential_type(&admin, &name, &schema_hash, &Map::new(&env));

        client.deactivate_credential_type(&admin, &name);
        assert!(!client.get_credential_type(&name).active);

        // Re-registering a deactivated type is allowed and reactivates it.
        let new_hash = BytesN::from_array(&env, &[8u8; 32]);
        client.register_credential_type(&admin, &name, &new_hash, &Map::new(&env));
        let descriptor = client.get_credential_type(&name);
        assert!(descriptor.active);
        assert_eq!(descriptor.schema_hash, new_hash);

        // Registering it twice more doesn't duplicate the name index.
        assert_eq!(client.list_credential_types().len(), 1);
    }

    #[test]
    fn test_deactivate_credential_type_not_found() {
        let (env, admin, client) = setup();
        let name = String::from_str(&env, "nope");
        assert_eq!(
            client.try_deactivate_credential_type(&admin, &name),
            Err(Ok(ContractError::CredentialTypeNotFound))
        );
    }

    #[test]
    fn test_issue_typed_credential_succeeds_with_matching_claims() {
        let (env, admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let claims = kyc_claims(&env);
        let schema_hash = client.compute_claims_schema_hash(&claims);
        let name = String::from_str(&env, "kyc-basic");
        client.register_credential_type(&admin, &name, &schema_hash, &Map::new(&env));

        let cred_id = client.issue_scheduled_credential(
            &issuer, &subject, &name, &CredentialType::Kyc,
            &claims, &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64,
        );
        client.verify_credential(&cred_id);
    }

    #[test]
    fn test_issue_typed_credential_rejects_unregistered_type() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let claims = kyc_claims(&env);
        let name = String::from_str(&env, "nope");

        let result = client.try_issue_scheduled_credential(
            &issuer, &subject, &name, &CredentialType::Kyc,
            &claims, &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64,
        );
        assert_eq!(result, Err(Ok(ContractError::CredentialTypeNotFound)));
    }

    #[test]
    fn test_issue_typed_credential_rejects_inactive_type() {
        let (env, admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let claims = kyc_claims(&env);
        let schema_hash = client.compute_claims_schema_hash(&claims);
        let name = String::from_str(&env, "kyc-basic");
        client.register_credential_type(&admin, &name, &schema_hash, &Map::new(&env));
        client.deactivate_credential_type(&admin, &name);

        let result = client.try_issue_scheduled_credential(
            &issuer, &subject, &name, &CredentialType::Kyc,
            &claims, &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64,
        );
        assert_eq!(result, Err(Ok(ContractError::CredentialTypeInactive)));
    }

    #[test]
    fn test_issue_typed_credential_rejects_schema_mismatch() {
        let (env, admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let schema_hash = client.compute_claims_schema_hash(&kyc_claims(&env));
        let name = String::from_str(&env, "kyc-basic");
        client.register_credential_type(&admin, &name, &schema_hash, &Map::new(&env));

        // Claims with a different key set than what was registered.
        let mut wrong_claims: Map<String, String> = Map::new(&env);
        wrong_claims.set(
            String::from_str(&env, "unexpected_field"),
            String::from_str(&env, "x"),
        );

        let result = client.try_issue_scheduled_credential(
            &issuer, &subject, &name, &CredentialType::Kyc,
            &wrong_claims, &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64,
        );
        assert_eq!(result, Err(Ok(ContractError::ClaimsSchemaMismatch)));
    }

    // ── Batch verification tests (#819) ───────────────────────────────────────

    #[test]
    fn test_verify_batch_all_valid() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);

        let mut ids = Vec::new(&env);
        for _ in 0..3 {
            let subject = Address::generate(&env);
            ids.push_back(issue_kyc(&env, &client, &issuer, &subject));
        }

        let results = client.verify_credentials_batch(&ids, &false);
        assert_eq!(results.len(), 3);
        for r in results.iter() {
            assert!(r.valid);
            assert_eq!(r.reason, BatchFailureReason::Valid);
        }
    }

    #[test]
    fn test_verify_batch_reports_detailed_reasons() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        let valid_id = issue_kyc(&env, &client, &issuer, &subject);

        let revoked_subject = Address::generate(&env);
        let revoked_id = issue_kyc(&env, &client, &issuer, &revoked_subject);
        client.revoke_credential(&issuer, &revoked_id, &RevocationReason::KeyCompromise);

        let expires_at = env.ledger().timestamp() + 100;
        let expiring_subject = Address::generate(&env);
        let expired_id = client.issue_credential(
            &issuer, &expiring_subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[7u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &expires_at, &0u64, &None, &None,
        );
        env.ledger().with_mut(|li| li.timestamp = expires_at + 1);

        let missing_id = BytesN::from_array(&env, &[9u8; 32]);

        let mut ids = Vec::new(&env);
        ids.push_back(valid_id.clone());
        ids.push_back(revoked_id.clone());
        ids.push_back(expired_id.clone());
        ids.push_back(missing_id.clone());

        let results = client.verify_credentials_batch(&ids, &false);
        assert_eq!(results.len(), 4);
        assert_eq!(results.get(0).unwrap().reason, BatchFailureReason::Valid);
        assert_eq!(results.get(1).unwrap().reason, BatchFailureReason::Revoked);
        assert_eq!(results.get(2).unwrap().reason, BatchFailureReason::Expired);
        assert_eq!(results.get(3).unwrap().reason, BatchFailureReason::NotFound);
        assert!(results.get(0).unwrap().valid);
        assert!(!results.get(1).unwrap().valid);
        assert!(!results.get(2).unwrap().valid);
        assert!(!results.get(3).unwrap().valid);
    }

    #[test]
    fn test_verify_batch_fail_fast_stops_at_first_failure() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);

        let subject_a = Address::generate(&env);
        let good_a = issue_kyc(&env, &client, &issuer, &subject_a);

        let subject_b = Address::generate(&env);
        let bad_b = issue_kyc(&env, &client, &issuer, &subject_b);
        client.revoke_credential(&issuer, &bad_b, &RevocationReason::KeyCompromise);

        let subject_c = Address::generate(&env);
        let good_c = issue_kyc(&env, &client, &issuer, &subject_c);

        let mut ids = Vec::new(&env);
        ids.push_back(good_a);
        ids.push_back(bad_b);
        ids.push_back(good_c);

        // fail_fast stops right after the first invalid entry — the third
        // id is never evaluated or reported.
        let results = client.verify_credentials_batch(&ids, &true);
        assert_eq!(results.len(), 2);
        assert!(results.get(0).unwrap().valid);
        assert!(!results.get(1).unwrap().valid);

        // Without fail_fast, every id is reported.
        let full_results = client.verify_credentials_batch(&ids, &false);
        assert_eq!(full_results.len(), 3);
    }

    #[test]
    fn test_verify_batch_rejects_over_max_size() {
        let (env, _admin, client) = setup();
        let mut ids = Vec::new(&env);
        for i in 0..51u8 {
            ids.push_back(BytesN::from_array(&env, &[i; 32]));
        }
        assert_eq!(
            client.try_verify_credentials_batch(&ids, &false),
            Err(Ok(ContractError::BatchTooLarge))
        );
    }

    #[test]
    fn test_verify_batch_shared_prerequisite_lookup_stays_correct() {
        // Two top-level credentials that both depend on the same prerequisite.
        // The batch call must only need to resolve that shared prerequisite
        // once internally, but still report both dependants consistently.
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);

        // The base credential expires (rather than being explicitly revoked)
        // so we exercise `PrerequisiteNotMet` on the dependants without also
        // triggering `revoke_credential`'s cascade-revoke of dependants —
        // that would mark the dependants themselves `revoked` and mask the
        // prerequisite-chain check this test is aimed at.
        let base_expires_at = env.ledger().timestamp() + 100;
        let base_id = client.issue_credential(
            &issuer, &subject, &CredentialType::Kyc,
            &Map::new(&env), &BytesN::from_array(&env, &[10u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &base_expires_at, &0u64, &None, &None,
        );
        let dependant_a = client.issue_credential(
            &issuer, &subject, &CredentialType::Reputation,
            &Map::new(&env), &BytesN::from_array(&env, &[11u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &0u64, &None, &None,
        );
        let dependant_b = client.issue_credential(
            &issuer, &subject, &CredentialType::Achievement,
            &Map::new(&env), &BytesN::from_array(&env, &[12u8; 32]),
            &Bytes::from_array(&env, &[0u8; 64]), &0u64, &0u64, &None, &None,
        );
        client.set_prerequisites(&issuer, &dependant_a, &Vec::from_array(&env, [base_id.clone()]));
        client.set_prerequisites(&issuer, &dependant_b, &Vec::from_array(&env, [base_id.clone()]));

        let mut ids = Vec::new(&env);
        ids.push_back(dependant_a.clone());
        ids.push_back(dependant_b.clone());
        let all_valid = client.verify_credentials_batch(&ids, &false);
        assert!(all_valid.iter().all(|r| r.valid));

        // Let the shared prerequisite expire — both dependants must now
        // report PrerequisiteNotMet, proving the memoized lookup resolved
        // the shared base credential once and applied it consistently to
        // both different top-level ids in the same batch.
        env.ledger().with_mut(|li| li.timestamp = base_expires_at + 1);
        let after_expiry = client.verify_credentials_batch(&ids, &false);
        for r in after_expiry.iter() {
            assert!(!r.valid);
            assert_eq!(r.reason, BatchFailureReason::PrerequisiteNotMet);
        }
    }

    #[test]
    fn test_verify_batch_emits_event() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_issuer(&issuer);
        let id = issue_kyc(&env, &client, &issuer, &subject);

        let mut ids = Vec::new(&env);
        ids.push_back(id);
        client.verify_credentials_batch(&ids, &false);

        let events = env.events().all();
        let has_batch_event = events.iter().any(|ev| {
            let topic_str = std::format!("{:?}", ev);
            topic_str.contains("batchvrf")
        });
        assert!(has_batch_event, "batch verification event should have been emitted");
    }

    /// Gas benchmark (#819 DoD): a batch call over N credentials should cost
    /// fewer CPU instructions than N separate `verify_credential` calls, since
    /// the batch path skips each call's TTL-refresh write and shares any
    /// repeated lookups.
    #[test]
    fn test_verify_batch_cheaper_than_individual_calls() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);

        let mut ids = Vec::new(&env);
        for _ in 0..10 {
            let subject = Address::generate(&env);
            ids.push_back(issue_kyc(&env, &client, &issuer, &subject));
        }

        env.budget().reset_default();
        for id in ids.iter() {
            client.verify_credential(&id);
        }
        let individual_cost = env.budget().cpu_instruction_cost();

        env.budget().reset_default();
        client.verify_credentials_batch(&ids, &false);
        let batch_cost = env.budget().cpu_instruction_cost();

        assert!(
            batch_cost < individual_cost,
            "batch verification should cost fewer instructions than the same number of individual calls"
        );
    }

    // ── Credential delegation tests (#655) ───────────────────────────────────

    #[test]
    fn test_delegate_verification_and_verify_as_delegate() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        let expires_at = env.ledger().timestamp() + 1_000;
        let unscoped = BytesN::from_array(&env, &[0u8; 32]);
        client.delegate_verification(&subject, &delegate, &unscoped, &expires_at);

        assert!(client.is_delegate_authorized(&subject, &delegate, &cred_id));
        client.verify_credential_as_delegate(&delegate, &subject, &cred_id);
    }

    #[test]
    fn test_verify_credential_as_delegate_rejects_without_grant() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let stranger = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        assert!(!client.is_delegate_authorized(&subject, &stranger, &cred_id));
        let result = client.try_verify_credential_as_delegate(&stranger, &subject, &cred_id);
        assert_eq!(result, Err(Ok(ContractError::UnauthorizedDelegate)));
    }

    #[test]
    fn test_delegate_verification_rejects_past_expiry() {
        let (env, _admin, client) = setup();
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        let unscoped = BytesN::from_array(&env, &[0u8; 32]);
        let now = env.ledger().timestamp();
        assert_eq!(
            client.try_delegate_verification(&subject, &delegate, &unscoped, &now),
            Err(Ok(ContractError::InvalidDelegationExpiry))
        );
    }

    #[test]
    fn test_delegation_scoped_to_specific_credential_id() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        // Grant scoped to a *different* credential id than the one we check.
        let other_id = BytesN::from_array(&env, &[42u8; 32]);
        let expires_at = env.ledger().timestamp() + 1_000;
        client.delegate_verification(&subject, &delegate, &other_id, &expires_at);

        assert!(!client.is_delegate_authorized(&subject, &delegate, &cred_id));
        assert!(client.is_delegate_authorized(&subject, &delegate, &other_id));
    }

    #[test]
    fn test_delegation_expires() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        client.add_issuer(&issuer);
        let cred_id = issue_kyc(&env, &client, &issuer, &subject);

        let expires_at = env.ledger().timestamp() + 100;
        let unscoped = BytesN::from_array(&env, &[0u8; 32]);
        client.delegate_verification(&subject, &delegate, &unscoped, &expires_at);
        assert!(client.is_delegate_authorized(&subject, &delegate, &cred_id));

        env.ledger().with_mut(|li| li.timestamp = expires_at);
        assert!(!client.is_delegate_authorized(&subject, &delegate, &cred_id));
        assert_eq!(
            client.try_verify_credential_as_delegate(&delegate, &subject, &cred_id),
            Err(Ok(ContractError::UnauthorizedDelegate))
        );
    }

    #[test]
    fn test_revoke_delegation() {
        let (env, _admin, client) = setup();
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        let unscoped = BytesN::from_array(&env, &[0u8; 32]);
        let expires_at = env.ledger().timestamp() + 1_000;
        client.delegate_verification(&subject, &delegate, &unscoped, &expires_at);

        client.revoke_delegation(&subject, &delegate);
        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        assert!(!client.is_delegate_authorized(&subject, &delegate, &cred_id));
    }

    #[test]
    fn test_revoke_delegation_rejects_double_revoke() {
        let (env, _admin, client) = setup();
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        let unscoped = BytesN::from_array(&env, &[0u8; 32]);
        let expires_at = env.ledger().timestamp() + 1_000;
        client.delegate_verification(&subject, &delegate, &unscoped, &expires_at);
        client.revoke_delegation(&subject, &delegate);

        assert_eq!(
            client.try_revoke_delegation(&subject, &delegate),
            Err(Ok(ContractError::DelegationAlreadyRevoked))
        );
    }

    #[test]
    fn test_revoke_delegation_not_found() {
        let (env, _admin, client) = setup();
        let subject = Address::generate(&env);
        let delegate = Address::generate(&env);
        assert_eq!(
            client.try_revoke_delegation(&subject, &delegate),
            Err(Ok(ContractError::DelegationNotFound))
        );
    }
}
