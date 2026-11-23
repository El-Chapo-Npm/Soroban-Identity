#![no_std]
#![deny(clippy::all)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Map, String, Symbol, Vec,
};
use soroban_sdk::xdr::ToXdr;

pub mod recovery;
pub mod resolver;
pub mod did_resolver;

pub use did_resolver::{DidMethod, ResolvedDid};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    DidNotFound = 1,
    DidDeactivated = 2,
    MetadataTooLong = 3,
    AlreadyInitialized = 4,
    EmptyMetadata = 5,
    Unauthorized = 6,
    DidAlreadyExists = 7,
    NotInitialized = 8,
    MetadataTooLarge = 9,
    NoPendingAdmin = 10,
    NotPendingAdmin = 11,
    ServiceAlreadyExists = 12,
    MaxServicesReached = 13,
    ContractPaused = 14,
    /// `create_dids_batch` was called with more than [`MAX_BATCH_DIDS`] entries.
    BatchTooLarge = 15,
    /// `create_dids_batch` was called with an empty entry list.
    EmptyBatch = 16,
    /// `set_recovery_address` / `initiate_recovery` called but no recovery address is stored.
    RecoveryNotSet = 17,
    /// `initiate_recovery` called while a recovery request is already pending.
    RecoveryPending = 18,
    /// `cancel_recovery` or `recover_did` called but no pending recovery exists.
    NoPendingRecovery = 19,
    /// `recover_did` called before the timelock window has elapsed.
    RecoveryTimelockActive = 20,
    /// The caller is not the registered recovery address for the target DID.
    RecoveryNotAuthorized = 21,
    /// `recover_did` would transfer the DID to an address that already owns one.
    RecoveryTargetExists = 22,
    /// The DID string passed to the universal resolver is malformed or empty.
    InvalidDid = 23,
    /// The DID method (e.g. `stellar`) is not supported by the resolver.
    UnsupportedDidMethod = 24,
    /// The DID method is already registered with the resolver.
    DidMethodAlreadyRegistered = 25,
    /// The DID string uses a method that has no registered resolver.
    UnknownDidMethod = 26,
    /// The resolved DID document is missing required fields or is malformed.
    InvalidDidDocument = 27,
    /// No cached resolution exists for the requested DID (or it has expired).
    CacheMiss = 28,
    /// A resolver plugin operation failed (bad registration, duplicate, etc.).
    ResolverPluginError = 29,
    /// The fallback chain is empty or exceeds the maximum supported length.
    InvalidFallbackChain = 30,
    /// An existing IPFS CID cannot be changed or removed.
    CidImmutable = 31,
    /// `upgrade`/`migrate` called by an address that is not the stored admin.
    UpgradeUnauthorized = 32,
    /// `upgrade` was given a version that is not strictly greater than the stored one.
    InvalidUpgradeVersion = 33,
    /// The requested DID document version does not exist.
    VersionNotFound = 34,
    /// Issue #1361: this DID requires M-of-N signer approval to deactivate;
    /// use `approve_deactivation` instead of `deactivate_did`.
    MultiSigRequired = 35,
    /// Issue #1361: invalid signer set or threshold (empty, duplicates,
    /// too many signers, or threshold outside `1..=signers.len()`).
    InvalidMultiSigConfig = 36,
    /// Issue #1361: the signer has already approved this pending deactivation.
    AlreadyApproved = 37,
    /// Issue #1361: no multi-sig deactivation policy is configured for this DID.
    MultiSigNotConfigured = 38,
}

/// Version returned by `ping` for deployment health checks.
pub const CONTRACT_VERSION: u32 = 1;

/// Schema version stamped on every emitted event. Increment on breaking schema changes
/// so indexers can distinguish old from new event formats without silent breakage.
const EVENT_VERSION: u32 = 1;

// ── Storage keys ──────────────────────────────────────────────────────────────

const IDENTITY: Symbol = symbol_short!("IDENTITY");
const ADMIN: Symbol = symbol_short!("ADMIN");
const PENDING_ADMIN: Symbol = symbol_short!("PADMIN");
const DID_COUNT: Symbol = symbol_short!("DIDCNT");
const TOTAL_DIDS: Symbol = symbol_short!("TOTDIDS");
const DID_INDEX: Symbol = symbol_short!("DIDIDX");
const PAUSED: Symbol = symbol_short!("PAUSED");
/// Stored schema version, bumped by the admin-only `upgrade` entrypoint.
const SCHEMA_VERSION: Symbol = symbol_short!("SCHEMAV");

/// Byte prefix for on-chain DID strings (`did:stellar:<address>`).
const DID_STELLAR_PREFIX: &[u8] = b"did:stellar:";

/// ~1 year in ledgers (5-second ledger close time).
/// Used as the TTL extension on every persistent read/write.
const TTL_LEDGERS: u32 = 6_312_000;
/// Extend a persistent entry's TTL only once it has dropped below this many
/// ledgers (#866). With the threshold equal to the target, every access
/// re-extended the TTL and paid rent again; now an entry that is read or
/// written often is extended at most about once every 30 days
/// (518_400 ledgers at 5 s), while never having less than ~11 months left.
const TTL_BUMP_THRESHOLD: u32 = TTL_LEDGERS - 518_400;

/// Maximum number of service endpoints allowed on a DID document.
/// Exceeding this limit returns [`ContractError::MaxServicesReached`].
const MAX_SERVICES: u32 = 10;

/// Maximum number of entries accepted by [`IdentityRegistry::create_dids_batch`]
/// in a single call, chosen to stay well within Soroban instruction limits.
pub const MAX_BATCH_DIDS: u32 = 50;
/// Maximum depth of a delegation chain, including the direct parent edge.
pub const MAX_DELEGATION_DEPTH: u32 = 3;
const DELEGATION: Symbol = symbol_short!("DELEG");
const DELEGATION_CHILDREN: Symbol = symbol_short!("DELGCH");
const DELEGATION_PARENT: Symbol = symbol_short!("DELGPAR");
const MAX_DELEGATION_SCOPE_LEN: u32 = 128;

/// Issue #1361: maximum number of signers in a deactivation multi-sig policy.
pub const MAX_MULTISIG_SIGNERS: u32 = 10;
/// Issue #1361: seconds after which partial deactivation approvals lapse.
pub const DEACTIVATION_APPROVAL_TTL_SECS: u64 = 7 * 24 * 60 * 60;
const DEACT_CFG: Symbol = symbol_short!("DEACTCFG");
const DEACT_PEND: Symbol = symbol_short!("DEACTPND");

/// Maximum number of entries accepted in a resolver fallback chain.
pub const MAX_FALLBACK_CHAIN: u32 = 8;
/// Default TTL (in ledgers) applied to cached DID resolutions.
pub const DEFAULT_RESOLVER_CACHE_TTL: u32 = 17_280;
/// Maximum TTL (in ledgers) accepted for a cached DID resolution (~30 days).
pub const MAX_RESOLVER_CACHE_TTL: u32 = 518_400;

/// Maximum number of entries accepted by [`IdentityRegistry::update_dids_batch`]
/// in a single call. Set lower than creation batch to account for additional
/// validation overhead (existence checks, deactivation status).
pub const MAX_BATCH_UPDATE_SIZE: u32 = 20;

/// Maximum number of historical DID document revisions retained per DID.
/// Older revisions are dropped once this cap is reached (oldest first).
pub const MAX_DID_HISTORY: u32 = 20;

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct IdentityStorageStats {
    pub total_dids: u32,
    pub active_dids: u32,
}

/// Issue #1361: M-of-N signer policy guarding `deactivate_did` for one DID.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MultiSigConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

/// Issue #1361: partial approvals collected for a pending deactivation.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingDeactivation {
    pub approvals: Vec<Address>,
    pub started_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ServiceEndpoint {
    pub id: String,
    pub type_: String,
    pub service_endpoint: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DidDocument {
    pub id: String,
    pub controller: Address,
    pub metadata: Map<String, String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub active: bool,
    pub services: Vec<ServiceEndpoint>,
    /// Parent controller. A root DID stores its own controller here.
    pub parent: Address,
    pub delegation_depth: u32,
}

/// On-chain DID document record stored by the registry interface
/// ([`IdentityRegistry::create_identity`] / [`IdentityRegistry::resolve_identity`]).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DidRecord {
    /// The full DID string, e.g. `did:stellar:<address>`.
    pub did: String,
    /// The address that owns (controls) the DID.
    pub owner: Address,
    /// Hash of the current DID document metadata.
    pub metadata_hash: BytesN<32>,
    /// Ledger timestamp at registration.
    pub created_at: u64,
    /// Ledger timestamp of the last update.
    pub updated_at: u64,
    /// Monotonically increasing record version, starting at 1.
    pub version: u32,
    /// Whether the DID is active.
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Delegation {
    pub parent: Address,
    pub child: Address,
    pub scope: String,
    pub depth: u32,
    pub created_at: u64,
    pub active: bool,
}

/// A single historical revision of a DID document.
///
/// `version` is monotonically increasing per DID, starting at 1 for the
/// document as created. `timestamp` is the ledger timestamp at which the
/// revision was superseded by a newer one.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DidVersion {
    pub version: u32,
    pub timestamp: u64,
    pub document: DidDocument,
}

#[contract]
pub struct IdentityRegistry;

#[contractimpl]
impl IdentityRegistry {
    pub fn ping(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_uninitialized(&env)?;
        Self::set_admin(&env, &admin);
        env.events().publish((ADMIN, symbol_short!("init")), (EVENT_VERSION, admin));
        Ok(())
    }

    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), ContractError> {
        current_admin.require_auth();
        let stored: Address = env.storage().instance().get(&ADMIN).expect("not initialized");
        if stored != current_admin {
            panic!("not the admin");
        }
        env.storage().instance().set(&ADMIN, &new_admin);
        env.events().publish((ADMIN, symbol_short!("transfer")), (EVENT_VERSION, current_admin, new_admin));
        Ok(())
    }

    /// Proposes a new admin. Only the current admin can call this. This is step
    /// one of the two-step admin handoff — the proposed admin does not gain any
    /// privileges until they call [`Self::accept_admin`] themselves, which
    /// prevents accidentally handing control to an unreachable or wrong address.
    ///
    /// Calling this again before acceptance overwrites the pending proposal.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `current_admin` - The current admin address (must sign the transaction).
    /// * `proposed_admin` - The address to propose as the next admin.
    ///
    /// # Errors
    /// Returns [`ContractError::NotInitialized`] if the contract has not been initialized.
    /// Returns [`ContractError::Unauthorized`] if `current_admin` does not match the stored admin address.
    pub fn propose_admin(
        env: Env,
        current_admin: Address,
        proposed_admin: Address,
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
        env.storage().instance().set(&PENDING_ADMIN, &proposed_admin);
        env.events().publish(
            (ADMIN, symbol_short!("propose")),
            (EVENT_VERSION, current_admin, proposed_admin),
        );
        Ok(())
    }

    /// Accepts a pending admin proposal. Only the proposed address can call this,
    /// and it must sign the transaction — this is step two of the two-step admin
    /// handoff started by [`Self::propose_admin`].
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `new_admin` - The proposed admin address (must sign the transaction).
    ///
    /// # Errors
    /// Returns [`ContractError::NotInitialized`] if there is no pending proposal.
    /// Returns [`ContractError::Unauthorized`] if `new_admin` does not match the pending proposal.
    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), ContractError> {
        new_admin.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&PENDING_ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if pending != new_admin {
            return Err(ContractError::Unauthorized);
        }
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        env.storage().instance().set(&ADMIN, &new_admin);
        env.storage().instance().remove(&PENDING_ADMIN);
        env.events().publish(
            (ADMIN, symbol_short!("accept")),
            (EVENT_VERSION, old_admin.clone(), new_admin.clone()),
        );
        // Issue #549: explicit admin-transfer-completed event for off-chain
        // monitors/audit logs watching for ownership changes.
        env.events().publish(
            (symbol_short!("admin"), symbol_short!("xfer")),
            (old_admin, new_admin),
        );
        Ok(())
    }

    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&ADMIN).ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Admin-only contract upgrade / migration entrypoint (#1281 BE-17).
    ///
    /// Verifies the caller is the stored admin, rewrites every existing DID
    /// record in place (preserving all fields and state), bumps the stored
    /// schema version to `new_version`, and emits an `upgrade` event.
    ///
    /// `migration_data` is reserved for future schema migrations and is
    /// currently only recorded in the emitted event.
    ///
    /// # Errors
    /// Returns [`ContractError::NotInitialized`] if the contract has not been initialized.
    /// Returns [`ContractError::UpgradeUnauthorized`] if `admin` is not the stored admin.
    /// Returns [`ContractError::InvalidUpgradeVersion`] if `new_version` is not
    /// strictly greater than the currently stored schema version.
    pub fn migrate(
        env: Env,
        admin: Address,
        new_version: u32,
        migration_data: Bytes,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::UpgradeUnauthorized);
        }

        let current_version = Self::get_schema_version(env.clone());
        if new_version <= current_version {
            return Err(ContractError::InvalidUpgradeVersion);
        }

        // Rewrite every existing DID record without loss. Each record is read
        // and written back unchanged so the migration is a no-op on the data
        // itself while still exercising the storage path for future schemas.
        let storage = env.storage().persistent();
        let total: u32 = env.storage().instance().get(&TOTAL_DIDS).unwrap_or(0);
        let mut migrated: u32 = 0;
        let mut index: u32 = 0;
        while index < total {
            let key = (IDENTITY, index);
            if let Some(doc) = storage.get::<_, DidDocument>(&key) {
                storage.set(&key, &doc);
                storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
                migrated += 1;
            }
            index += 1;
        }

        env.storage().instance().set(&SCHEMA_VERSION, &new_version);
        env.events().publish(
            (symbol_short!("upgrade"), symbol_short!("migrate")),
            (EVENT_VERSION, admin, current_version, new_version, migrated, migration_data),
        );
        Ok(())
    }

    /// Returns the stored schema version (0 if the contract predates versioning).
    pub fn get_schema_version(env: Env) -> u32 {
        env.storage().instance().get(&SCHEMA_VERSION).unwrap_or(0)
    }

    /// Emergency stop: admin pauses all state-changing operations.
    /// Read-only queries remain available. Emits `contract_paused`.
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&PAUSED, &true);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("paused")),
            (EVENT_VERSION, admin),
        );
        Ok(())
    }

    /// Lifts an emergency stop. Admin-only. Emits `contract_unpaused`.
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&PAUSED, &false);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("unpaused")),
            (EVENT_VERSION, admin),
        );
        Ok(())
    }

    /// Read-only: whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    pub fn create_did(env: Env, controller: Address, metadata: Map<String, String>) -> Result<String, ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        let now = env.ledger().timestamp();
        Self::create_did_unchecked(&env, &controller, metadata, now)
    }

    /// Creates multiple DIDs (up to [`MAX_BATCH_DIDS`]) in one transaction;
    /// every controller must sign. Fully validated before any write, so a
    /// rejected batch leaves no partial result. Returns ids in entry order.
    pub fn create_dids_batch(
        env: Env,
        entries: Vec<(Address, Map<String, String>)>,
    ) -> Result<Vec<String>, ContractError> {
        Self::require_not_paused(&env)?;
        if entries.is_empty() {
            return Err(ContractError::EmptyBatch);
        }
        if entries.len() > MAX_BATCH_DIDS {
            return Err(ContractError::BatchTooLarge);
        }

        // Validate every entry — existence (including duplicates within this
        // batch), metadata shape, and auth — before writing anything. Duplicate
        // detection runs before `require_auth` so a repeated controller is
        // rejected without asking the same address to authorize twice.
        let storage = env.storage().persistent();
        let mut seen: Vec<Address> = Vec::new(&env);
        for (controller, metadata) in entries.iter() {
            let key = Self::did_key(&env, &controller);
            if storage.has(&key) || seen.contains(&controller) {
                return Err(ContractError::DidAlreadyExists);
            }
            seen.push_back(controller.clone());
            controller.require_auth();
            Self::validate_metadata(&metadata)?;
        }

        let now = env.ledger().timestamp();
        let mut created_ids = Vec::new(&env);
        for (controller, metadata) in entries.iter() {
            let did_id = Self::create_did_unchecked(&env, &controller, metadata, now)?;
            created_ids.push_back(did_id);
        }
        Ok(created_ids)
    }

    /// Appends a service endpoint to an existing DID document.
    /// Returns [`ContractError::MaxServicesReached`] when the document already has
    /// [`MAX_SERVICES`] endpoints, or [`ContractError::ServiceAlreadyExists`] when
    /// an endpoint with the same `id` is already present.
    pub fn add_service(env: Env, controller: Address, service: ServiceEndpoint) -> Result<(), ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        let storage = env.storage().persistent();
        let key = Self::did_key(&env, &controller);
        let mut doc: DidDocument = storage.get(&key).ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        if doc.services.len() >= MAX_SERVICES {
            return Err(ContractError::MaxServicesReached);
        }
        // Enforce id-uniqueness across existing endpoints.
        for svc in doc.services.iter() {
            if svc.id == service.id {
                return Err(ContractError::ServiceAlreadyExists);
            }
        }
        doc.updated_at = env.ledger().timestamp();
        doc.services.push_back(service.clone());
        storage.set(&key, &doc);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        env.events().publish((IDENTITY, symbol_short!("svc_add")), (EVENT_VERSION, controller, doc.updated_at));
        Ok(())
    }

    pub fn update_did(env: Env, controller: Address, metadata: Map<String, String>) -> Result<(), ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        if metadata.is_empty() {
            return Err(ContractError::EmptyMetadata);
        }
        Self::validate_metadata(&metadata)?;
        let storage = env.storage().persistent();
        let key = Self::did_key(&env, &controller);
        let mut doc: DidDocument = storage.get(&key).ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        Self::ensure_cid_immutable(&env, &doc.metadata, &metadata)?;
        let now = env.ledger().timestamp();
        Self::push_history(&env, &controller, &doc, now);
        doc.metadata = metadata;
        doc.updated_at = now;
        storage.set(&key, &doc);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        let mut hash_input = Self::string_to_bytes(&env, &doc.id);
        hash_input.extend_from_array(&doc.updated_at.to_be_bytes());
        let meta_hash: BytesN<32> = env.crypto().sha256(&hash_input).into();
        env.events().publish((IDENTITY, symbol_short!("updated")), (EVENT_VERSION, controller, meta_hash));
        Ok(())
    }

    /// Updates multiple DIDs (up to [`MAX_BATCH_UPDATE_SIZE`]) in one transaction.
    /// Each controller must sign. All updates are validated before any writes occur,
    /// ensuring atomic success or failure. Returns a vector of results indicating
    /// success or failure for each DID update.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `entries` - A vector of tuples, each containing an address (controller) and
    ///   the new metadata map for that DID.
    ///
    /// # Returns
    /// A vector of `Result<(), ContractError>` in the same order as `entries`.
    /// Each element indicates whether the corresponding update succeeded or failed.
    ///
    /// # Errors
    /// Returns [`ContractError::ContractPaused`] if the contract is paused.
    /// Returns [`ContractError::EmptyBatch`] if the entries vector is empty.
    /// Returns [`ContractError::BatchTooLarge`] if entries exceed [`MAX_BATCH_UPDATE_SIZE`].
    ///
    /// Individual update failures are captured in the returned vector and do not
    /// halt processing of remaining entries. Common per-entry errors include:
    /// - [`ContractError::DidNotFound`] if the DID doesn't exist
    /// - [`ContractError::DidDeactivated`] if the DID is deactivated
    /// - [`ContractError::EmptyMetadata`] if metadata is empty
    /// - [`ContractError::MetadataTooLong`] or [`ContractError::MetadataTooLarge`] on validation failure
    ///
    /// # Example
    /// ```rust,ignore
    /// let entries = vec![
    ///     &env,
    ///     (user1.clone(), metadata1.clone()),
    ///     (user2.clone(), metadata2.clone()),
    /// ];
    /// let results = contract.update_dids_batch(&entries);
    /// // results[0] -> Ok(()) or Err(...)
    /// // results[1] -> Ok(()) or Err(...)
    /// ```
    pub fn update_dids_batch(
        env: Env,
        entries: Vec<(Address, Map<String, String>)>,
    ) -> Result<Vec<Result<(), ContractError>>, ContractError> {
        Self::require_not_paused(&env)?;

        // Validate batch size constraints
        if entries.is_empty() {
            return Err(ContractError::EmptyBatch);
        }
        if entries.len() > MAX_BATCH_UPDATE_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        let storage = env.storage().persistent();
        let now = env.ledger().timestamp();
        let mut results = Vec::new(&env);

        // Phase 1: Validate all entries before applying any updates
        // This ensures we can provide meaningful per-entry error information
        // while still validating the entire batch upfront
        let mut validation_results = Vec::new(&env);
        
        for (controller, metadata) in entries.iter() {
            // Require authorization for each controller
            controller.require_auth();

            // Validate this entry
            let validation_result: Result<(), ContractError> = (|| {
                if metadata.is_empty() {
                    return Err(ContractError::EmptyMetadata);
                }
                Self::validate_metadata(&metadata)?;
                
                let key = Self::did_key(&env, &controller);
                let doc: DidDocument = storage.get(&key).ok_or(ContractError::DidNotFound)?;
                
                if !doc.active {
                    return Err(ContractError::DidDeactivated);
                }
                Self::ensure_cid_immutable(&env, &doc.metadata, &metadata)?;
                Ok(())
            })();
            
            validation_results.push_back(validation_result);
        }

        // Phase 2: Apply updates for entries that passed validation
        for (i, (controller, metadata)) in entries.iter().enumerate() {
            // Check if validation passed for this entry
            let validation_passed = validation_results.get(i).unwrap_or(Err(ContractError::DidNotFound));
            
            if validation_passed.is_err() {
                // Validation failed, record the error and skip update
                results.push_back(validation_passed);
                continue;
            }

            // Validation passed, perform the update
            let update_result: Result<(), ContractError> = (|| {
                let key = Self::did_key(&env, &controller);
                let mut doc: DidDocument = storage.get(&key).ok_or(ContractError::DidNotFound)?;

                Self::push_history(&env, &controller, &doc, now);
                doc.metadata = metadata.clone();
                doc.updated_at = now;

                storage.set(&key, &doc);
                storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
                
                // Emit update event with metadata hash
                let mut hash_input = Self::string_to_bytes(&env, &doc.id);
                hash_input.extend_from_array(&doc.updated_at.to_be_bytes());
                let meta_hash: BytesN<32> = env.crypto().sha256(&hash_input).into();
                
                env.events().publish(
                    (IDENTITY, symbol_short!("updated")),
                    (EVENT_VERSION, controller.clone(), meta_hash),
                );
                
                Ok(())
            })();
            
            results.push_back(update_result);
        }

        Ok(results)
    }

    /// Deactivates a DID. Only its controller can call this.
    ///
    /// # Errors
    /// Returns [`ContractError::DidNotFound`] if no DID exists for the given controller.
    /// Returns [`ContractError::DidDeactivated`] if the DID is already inactive —
    /// repeated calls are rejected rather than double-decrementing [`DID_COUNT`].
    pub fn deactivate_did(env: Env, controller: Address) -> Result<(), ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        // Issue #1361: DIDs with a multi-sig policy cannot be deactivated by
        // the controller alone.
        if env
            .storage()
            .persistent()
            .has(&(DEACT_CFG, controller.clone()))
        {
            return Err(ContractError::MultiSigRequired);
        }
        Self::apply_deactivation(&env, &controller)
    }

    /// Issue #1361: configure (or replace) the M-of-N signer policy that must
    /// approve deactivation of `controller`'s DID.
    ///
    /// The controller must authorize the call. When a policy already exists,
    /// replacing it additionally requires `approvers` to contain at least the
    /// existing `threshold` of distinct members of the existing signer set,
    /// each of which must authorize, so a compromised controller key cannot
    /// strip the policy.
    ///
    /// # Errors
    /// [`ContractError::DidNotFound`], [`ContractError::InvalidMultiSigConfig`],
    /// [`ContractError::Unauthorized`] (insufficient or non-signer approvers).
    pub fn set_deactivation_signers(
        env: Env,
        controller: Address,
        signers: Vec<Address>,
        threshold: u32,
        approvers: Vec<Address>,
    ) -> Result<(), ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        let storage = env.storage().persistent();
        if !storage.has(&Self::did_key(&env, &controller)) {
            return Err(ContractError::DidNotFound);
        }
        let n = signers.len();
        if n == 0 || n > MAX_MULTISIG_SIGNERS || threshold == 0 || threshold > n {
            return Err(ContractError::InvalidMultiSigConfig);
        }
        for i in 0..n {
            let a = signers.get(i).unwrap();
            for j in (i + 1)..n {
                if a == signers.get(j).unwrap() {
                    return Err(ContractError::InvalidMultiSigConfig);
                }
            }
        }

        let cfg_key = (DEACT_CFG, controller.clone());
        if let Some(existing) = storage.get::<_, MultiSigConfig>(&cfg_key) {
            let mut seen: Vec<Address> = Vec::new(&env);
            for a in approvers.iter() {
                if !existing.signers.contains(&a) {
                    return Err(ContractError::Unauthorized);
                }
                if seen.contains(&a) {
                    continue;
                }
                a.require_auth();
                seen.push_back(a);
            }
            if seen.len() < existing.threshold {
                return Err(ContractError::Unauthorized);
            }
        }

        storage.set(&cfg_key, &MultiSigConfig { signers, threshold });
        storage.extend_ttl(&cfg_key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        // A policy change invalidates approvals gathered under the old one.
        storage.remove(&(DEACT_PEND, controller.clone()));
        env.events().publish(
            (IDENTITY, symbol_short!("msigcfg")),
            (EVENT_VERSION, controller, threshold, n),
        );
        Ok(())
    }

    /// Issue #1361: record `approver`'s approval to deactivate `controller`'s
    /// DID. The first approval opens the proposal; once `threshold` distinct
    /// signers have approved, the DID is deactivated.
    ///
    /// Partial approvals lapse after [`DEACTIVATION_APPROVAL_TTL_SECS`].
    ///
    /// # Returns
    /// `true` if this approval executed the deactivation, `false` otherwise.
    ///
    /// # Errors
    /// [`ContractError::MultiSigNotConfigured`], [`ContractError::Unauthorized`]
    /// (not a signer), [`ContractError::AlreadyApproved`],
    /// [`ContractError::DidNotFound`], [`ContractError::DidDeactivated`].
    pub fn approve_deactivation(
        env: Env,
        approver: Address,
        controller: Address,
    ) -> Result<bool, ContractError> {
        approver.require_auth();
        Self::require_not_paused(&env)?;
        let storage = env.storage().persistent();
        let cfg: MultiSigConfig = storage
            .get(&(DEACT_CFG, controller.clone()))
            .ok_or(ContractError::MultiSigNotConfigured)?;
        if !cfg.signers.contains(&approver) {
            return Err(ContractError::Unauthorized);
        }
        let doc: DidDocument = storage
            .get(&Self::did_key(&env, &controller))
            .ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }

        let now = env.ledger().timestamp();
        let pend_key = (DEACT_PEND, controller.clone());
        let mut pending: PendingDeactivation = storage
            .get::<_, PendingDeactivation>(&pend_key)
            .filter(|p| now <= p.started_at + DEACTIVATION_APPROVAL_TTL_SECS)
            .unwrap_or(PendingDeactivation {
                approvals: Vec::new(&env),
                started_at: now,
            });
        if pending.approvals.contains(&approver) {
            return Err(ContractError::AlreadyApproved);
        }
        pending.approvals.push_back(approver.clone());
        env.events().publish(
            (IDENTITY, symbol_short!("deactapp")),
            (EVENT_VERSION, controller.clone(), approver, pending.approvals.len()),
        );

        if pending.approvals.len() >= cfg.threshold {
            storage.remove(&pend_key);
            Self::apply_deactivation(&env, &controller)?;
            Ok(true)
        } else {
            storage.set(&pend_key, &pending);
            storage.extend_ttl(&pend_key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
            Ok(false)
        }
    }

    /// Issue #1361: the deactivation signer policy for a DID, if any.
    pub fn get_deactivation_signers(env: Env, controller: Address) -> Option<MultiSigConfig> {
        env.storage().persistent().get(&(DEACT_CFG, controller))
    }

    /// Issue #1361: unexpired partial approvals for a pending deactivation.
    pub fn get_deactivation_approvals(env: Env, controller: Address) -> Vec<Address> {
        let now = env.ledger().timestamp();
        env.storage()
            .persistent()
            .get::<_, PendingDeactivation>(&(DEACT_PEND, controller))
            .filter(|p| now <= p.started_at + DEACTIVATION_APPROVAL_TTL_SECS)
            .map(|p| p.approvals)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Reactivates a deactivated DID. Only the admin can call this.
    ///
    /// Sets `active=true` and updates `updated_at` on the existing document.
    /// If the DID is already active, this is a no-op and returns `Ok(())`.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `admin` - The admin address (must sign the transaction).
    /// * `controller` - The address whose DID to reactivate.
    ///
    /// # Errors
    /// Returns [`ContractError::Unauthorized`] if `admin` is not the current admin.
    /// Returns [`ContractError::DidNotFound`] if no DID exists for the controller.
    pub fn reactivate_did(env: Env, admin: Address, controller: Address) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored_admin != admin {
            return Err(ContractError::Unauthorized);
        }

        let storage = env.storage().persistent();
        let key = Self::did_key(&env, &controller);
        let mut doc: DidDocument = storage.get(&key).ok_or(ContractError::DidNotFound)?;

        // No-op if already active
        if doc.active {
            return Ok(());
        }

        doc.active = true;
        doc.updated_at = env.ledger().timestamp();

        storage.set(&key, &doc);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);

        // Increment active DID count
        let count: u32 = env.storage().instance().get(&DID_COUNT).unwrap_or(0);
        env.storage().instance().set(&DID_COUNT, &(count + 1));

        env.events().publish(
            (IDENTITY, Symbol::new(&env, "reactivated")),
            (EVENT_VERSION, controller, doc.updated_at),
        );
        Ok(())
    }

    pub fn resolve_did(env: Env, controller: Address) -> Result<DidDocument, ContractError> {
        let key = Self::did_key(&env, &controller);
        // Read once and extend the TTL only on a hit, instead of has() + get().
        let doc: DidDocument = env.storage().persistent().get(&key).ok_or(ContractError::DidNotFound)?;
        env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        Ok(doc)
    }

    /// Guard used by attestation issuance/receipt paths: returns
    /// [`ContractError::DidDeactivated`] if the DID exists but is inactive,
    /// [`ContractError::DidNotFound`] if it does not exist at all.
    pub fn require_active_did(env: Env, controller: Address) -> Result<(), ContractError> {
        let key = Self::did_key(&env, &controller);
        let doc: DidDocument = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        Ok(())
    }

    /// Returns the ordered history of prior revisions of a DID document,
    /// oldest first. The current (live) document is not included; it is
    /// available via [`Self::resolve_did`].
    ///
    /// At most [`MAX_DID_HISTORY`] revisions are retained per DID; once the
    /// cap is reached the oldest revision is dropped on each new update.
    ///
    /// # Errors
    /// Returns [`ContractError::DidNotFound`] if no DID exists for `controller`.
    pub fn get_did_history(env: Env, controller: Address) -> Result<Vec<DidVersion>, ContractError> {
        let key = Self::did_key(&env, &controller);
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::DidNotFound);
        }
        let history_key = Self::history_key(&env, &controller);
        let history: Vec<DidVersion> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));
        if !history.is_empty() {
            env.storage()
                .persistent()
                .extend_ttl(&history_key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        }
        Ok(history)
    }

    // ── DID registry interface (#1265 / #1266 / #1267) ────────────────────────

    /// Registers a new DID owned by `owner` and stores the initial metadata hash.
    ///
    /// The DID string must be non-empty and use a supported method prefix
    /// (`did:stellar:`). The owner must sign the transaction. A DID that is
    /// already registered returns [`ContractError::DidAlreadyExists`].
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `owner` - The address that owns (controls) the DID (must sign).
    /// * `did` - The DID string to register, e.g. `did:stellar:<address>`.
    /// * `metadata_hash` - Hash of the initial DID document metadata.
    ///
    /// # Returns
    /// The registered DID string.
    ///
    /// # Errors
    /// Returns [`ContractError::ContractPaused`] if the contract is paused.
    /// Returns [`ContractError::InvalidDid`] if `did` is empty or malformed.
    /// Returns [`ContractError::UnsupportedDidMethod`] if the method is not `stellar`.
    /// Returns [`ContractError::DidAlreadyExists`] if the DID is already registered.
    pub fn create_identity(
        env: Env,
        owner: Address,
        did: String,
        metadata_hash: BytesN<32>,
    ) -> Result<String, ContractError> {
        owner.require_auth();
        Self::require_not_paused(&env)?;
        Self::validate_identity_did(&env, &did)?;

        let storage = env.storage().persistent();
        let key = Self::identity_key(&env, &did);
        if storage.has(&key) {
            return Err(ContractError::DidAlreadyExists);
        }

        let now = env.ledger().timestamp();
        let record = DidRecord {
            did: did.clone(),
            owner: owner.clone(),
            metadata_hash: metadata_hash.clone(),
            created_at: now,
            updated_at: now,
            version: 1,
            active: true,
        };
        storage.set(&key, &record);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);

        env.events().publish(
            (IDENTITY, symbol_short!("did_crtd")),
            (EVENT_VERSION, owner, did.clone(), metadata_hash, now),
        );
        Ok(did)
    }

    /// Updates the metadata hash of an existing, active DID. Only the owner can
    /// call this and must sign the transaction.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `owner` - The DID owner (must sign).
    /// * `did` - The DID string to update.
    /// * `metadata_hash` - The new metadata hash.
    ///
    /// # Errors
    /// Returns [`ContractError::ContractPaused`] if the contract is paused.
    /// Returns [`ContractError::InvalidDid`] if `did` is empty or malformed.
    /// Returns [`ContractError::DidNotFound`] if the DID is not registered.
    /// Returns [`ContractError::DidDeactivated`] if the DID is inactive.
    /// Returns [`ContractError::Unauthorized`] if `owner` is not the DID owner.
    pub fn update_identity(
        env: Env,
        owner: Address,
        did: String,
        metadata_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        owner.require_auth();
        Self::require_not_paused(&env)?;
        Self::validate_identity_did(&env, &did)?;

        let storage = env.storage().persistent();
        let key = Self::identity_key(&env, &did);
        let mut record: DidRecord = storage.get(&key).ok_or(ContractError::DidNotFound)?;
        if !record.active {
            return Err(ContractError::DidDeactivated);
        }
        if record.owner != owner {
            return Err(ContractError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        record.metadata_hash = metadata_hash.clone();
        record.updated_at = now;
        record.version = record.version.saturating_add(1);
        storage.set(&key, &record);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);

        env.events().publish(
            (IDENTITY, symbol_short!("did_upd")),
            (EVENT_VERSION, owner, did, metadata_hash, now),
        );
        Ok(())
    }

    /// Resolves a registered DID to its full on-chain document record.
    ///
    /// # Errors
    /// Returns [`ContractError::InvalidDid`] if `did` is empty or malformed.
    /// Returns [`ContractError::DidNotFound`] if the DID is not registered.
    pub fn resolve_identity(env: Env, did: String) -> Result<DidRecord, ContractError> {
        Self::validate_identity_did(&env, &did)?;
        let key = Self::identity_key(&env, &did);
        let record: DidRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::DidNotFound)?;
        if !record.active {
            return Err(ContractError::DidDeactivated);
        }
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        Ok(record)
    }

    // ── Universal DID resolver (#1127) ────────────────────────────────────────

    /// Registers a DID method with the universal resolver. Admin-only.
    ///
    /// The `stellar` method is registered by default and cannot be re-registered.
    ///
    /// # Errors
    /// Returns [`ContractError::Unauthorized`] if `admin` is not the current admin.
    /// Returns [`ContractError::DidMethodAlreadyRegistered`] if the method is already known.
    pub fn register_did_method(
        env: Env,
        admin: Address,
        method: DidMethod,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        did_resolver::register_method(&env, &method)
    }

    /// Universal string-based DID resolver. Accepts a full DID string such as
    /// `did:stellar:<address>` and returns the resolved document together with
    /// the method that handled it.
    ///
    /// The legacy [`Self::resolve_did`] entrypoint (address-based) remains
    /// available for backward compatibility.
    ///
    /// # Errors
    /// Returns [`ContractError::InvalidDid`] if `did` is empty or malformed.
    /// Returns [`ContractError::UnsupportedDidMethod`] if the method is not registered.
    /// Returns [`ContractError::DidNotFound`] / [`ContractError::DidDeactivated`]
    /// depending on the resolved document's state.
    pub fn resolve_did_string(env: Env, did: String) -> Result<ResolvedDid, ContractError> {
        // `did_resolver::resolve` returns `Result` and never panics on an
        // unknown DID; propagate the error to the caller instead of trapping.
        did_resolver::resolve(&env, &did)
    }

    /// Returns the list of DID methods currently supported by the resolver.
    pub fn get_did_methods(env: Env) -> Vec<DidMethod> {
        did_resolver::get_methods(&env)
    }

    pub fn has_active_did(env: Env, controller: Address) -> bool {
        let key = Self::did_key(&env, &controller);
        match env.storage().persistent().get::<_, DidDocument>(&key) {
            Some(doc) => {
                env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
                doc.active
            }
            None => false,
        }
    }

    /// Returns `true` if the DID exists but has been deactivated.
    pub fn is_did_deactivated(env: Env, controller: Address) -> bool {
        let key = Self::did_key(&env, &controller);
        match env.storage().persistent().get::<_, DidDocument>(&key) {
            Some(doc) => !doc.active,
            None => false,
        }
    }

    /// Lightweight existence check for a DID, regardless of activation status.
    ///
    /// Returns `true` if a DID document exists for the given address (active or
    /// deactivated), `false` otherwise. This avoids the overhead of deserializing
    /// the full document when only an existence check is needed.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment.
    /// * `controller` - The address to check.
    ///
    /// # Returns
    /// `true` if a DID exists for the address, `false` otherwise.
    pub fn did_exists(env: Env, controller: Address) -> bool {
        let key = Self::did_key(&env, &controller);
        env.storage().persistent().has(&key)
    }

    pub fn get_did_count(env: Env) -> u32 {
        env.storage().instance().get(&DID_COUNT).unwrap_or(0)
    }

    /// List DID documents using a stable, offset-based index.
    ///
    /// Inactive documents remain in the index so administrative consumers can
    /// search and filter the complete registry. Reads are capped at 100 items
    /// per call to keep simulations within Soroban resource limits.
    pub fn list_dids(env: Env, offset: u32, limit: u32) -> Vec<DidDocument> {
        let total: u32 = env.storage().instance().get(&TOTAL_DIDS).unwrap_or(0);
        let end = core::cmp::min(total, offset.saturating_add(limit.min(100)));
        let storage = env.storage().persistent();
        let mut result = Vec::new(&env);

        for index in offset..end {
            let index_key = (DID_INDEX, index);
            let Some(controller) = storage.get::<_, Address>(&index_key) else {
                continue;
            };
            storage.extend_ttl(&index_key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
            if let Some(document) = storage.get::<_, DidDocument>(&Self::did_key(&env, &controller)) {
                result.push_back(document);
            }
        }
        result
    }

    pub fn get_storage_stats(env: Env) -> IdentityStorageStats {
        IdentityStorageStats {
            total_dids: env.storage().instance().get(&TOTAL_DIDS).unwrap_or(0),
            active_dids: env.storage().instance().get(&DID_COUNT).unwrap_or(0),
        }
    }

    // ── Recovery (#879) ───────────────────────────────────────────────────────

    /// Register a recovery address for the caller's DID.
    /// The recovery address can later initiate a time-locked ownership transfer.
    pub fn set_recovery_address(
        env: Env,
        controller: Address,
        recovery_addr: Address,
    ) -> Result<(), ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        let key = Self::did_key(&env, &controller);
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::DidNotFound);
        }
        recovery::store_recovery_address(&env, &controller, &recovery_addr);
        Ok(())
    }

    /// Return the registered recovery address for `controller`, or `None`.
    pub fn get_recovery_address(env: Env, controller: Address) -> Option<Address> {
        recovery::load_recovery_address(&env, &controller)
    }

    /// Phase 1: recovery address initiates a time-locked challenge to transfer the DID.
    pub fn initiate_recovery(
        env: Env,
        recovery_addr: Address,
        controller: Address,
        new_controller: Address,
    ) -> Result<(), ContractError> {
        recovery_addr.require_auth();
        Self::require_not_paused(&env)?;
        recovery::initiate(&env, &recovery_addr, &controller, &new_controller)
    }

    /// Phase 1b: original DID owner responds to cancel a pending recovery request.
    pub fn cancel_recovery(env: Env, controller: Address) -> Result<(), ContractError> {
        controller.require_auth();
        recovery::cancel(&env, &controller)
    }

    /// Phase 2: after the timelock elapses, recovery address completes the transfer.
    /// The DID document is re-keyed to `new_controller`; the original key is removed.
    pub fn recover_did(
        env: Env,
        recovery_addr: Address,
        controller: Address,
    ) -> Result<(), ContractError> {
        recovery_addr.require_auth();
        Self::require_not_paused(&env)?;
        let new_controller = recovery::finalize(&env, &recovery_addr, &controller)?;

        // Guard: new_controller must not already own a DID.
        let new_key = Self::did_key(&env, &new_controller);
        if env.storage().persistent().has(&new_key) {
            return Err(ContractError::RecoveryTargetExists);
        }

        // Re-key the DID document from old controller to new controller.
        let old_key = Self::did_key(&env, &controller);
        let mut doc: DidDocument = env
            .storage()
            .persistent()
            .get(&old_key)
            .ok_or(ContractError::DidNotFound)?;
        doc.controller = new_controller.clone();
        doc.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&new_key, &doc);
        env.storage().persistent().extend_ttl(&new_key, TTL_LEDGERS, TTL_LEDGERS);
        env.storage().persistent().remove(&old_key);
        env.events().publish(
            (IDENTITY, symbol_short!("rec_done")),
            (EVENT_VERSION, controller, new_controller, doc.updated_at),
        );
        Ok(())
    }

    /// Return the pending recovery request for `controller`, if any.
    pub fn get_pending_recovery(
        env: Env,
        controller: Address,
    ) -> Option<recovery::RecoveryRequest> {
        recovery::get_pending(&env, &controller)
    }

    // ── Universal DID resolver (#1120) ────────────────────────────────────────

    /// Resolves any supported DID string (`did:stellar:`, `did:ethr:`, `did:web:`)
    /// to a validated [`resolver::ResolvedDid`], consulting the resolution cache
    /// first and falling back through the configured chain on failure.
    ///
    /// # Errors
    /// Returns [`ContractError::InvalidDid`] if the DID string is malformed,
    /// [`ContractError::UnknownDidMethod`] if no resolver (built-in or plugin)
    /// handles the method, [`ContractError::InvalidDidDocument`] if the resolved
    /// document fails validation, or [`ContractError::DidNotFound`] if every
    /// resolver in the fallback chain fails.
    pub fn resolve_did_universal(env: Env, did: String) -> Result<resolver::ResolvedDid, ContractError> {
        // `resolver::resolve_universal` returns `Result` and never panics on an
        // unknown DID; propagate the error to the caller instead of trapping.
        resolver::resolve_universal(&env, &did)
    }

    /// Registers a custom resolver plugin for `method` (e.g. `"did:key"`).
    /// Admin-only. Re-registering an existing method overwrites its handler.
    pub fn register_resolver_plugin(
        env: Env,
        admin: Address,
        method: String,
        handler: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        resolver::register_plugin(&env, &method, &handler)
    }

    /// Sets the ordered fallback chain of method names tried when the primary
    /// resolution fails. Admin-only. An empty chain disables fallback.
    pub fn set_fallback_chain(env: Env, admin: Address, chain: Vec<String>) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        resolver::set_fallback_chain(&env, &chain)
    }

    /// Returns the cached resolution for `did`, or [`ContractError::CacheMiss`]
    /// if it is absent or expired.
    pub fn get_cached_did(env: Env, did: String) -> Result<resolver::ResolvedDid, ContractError> {
        resolver::get_cached(&env, &did)
    }

    /// Validates a DID document against the required-field rules. Returns
    /// [`ContractError::InvalidDidDocument`] when the document is malformed.
    pub fn validate_did_document(env: Env, doc: resolver::ResolvedDid) -> Result<(), ContractError> {
        resolver::validate_document(&env, &doc)
    }

    // ── Service endpoints ─────────────────────────────────────────────────────
    pub fn remove_service(env: Env, controller: Address, service_id: String) -> Result<(), ContractError> {
        controller.require_auth();
        Self::require_not_paused(&env)?;
        let key = Self::did_key(&env, &controller);
        let mut doc: DidDocument = env.storage().persistent().get(&key).ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        let mut found = false;
        let mut updated = Vec::new(&env);
        for svc in doc.services.iter() {
            if svc.id == service_id {
                found = true;
            } else {
                updated.push_back(svc);
            }
        }
        if !found { return Err(ContractError::DidNotFound); }
        doc.services = updated;
        doc.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &doc);
        env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        env.events().publish((IDENTITY, symbol_short!("svc_rmvd")), (EVENT_VERSION, controller, service_id));
        Ok(())
    }

    /// Returns all service endpoints for a DID.
    pub fn get_services(env: Env, controller: Address) -> Result<Vec<ServiceEndpoint>, ContractError> {
        let key = Self::did_key(&env, &controller);
        let doc: DidDocument = env.storage().persistent().get(&key).ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        Ok(doc.services)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn require_uninitialized(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(ContractError::AlreadyInitialized);
        }
        Ok(())
    }

    fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&ADMIN, admin);
    }

    fn require_admin(env: &Env, admin: &Address) -> Result<(), ContractError> {
        let stored: Address = env.storage().instance().get(&ADMIN).ok_or(ContractError::NotInitialized)?;
        if stored != *admin { return Err(ContractError::Unauthorized); }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().get(&PAUSED).unwrap_or(false) {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    /// Shared deactivation logic used by `deactivate_did` and the multi-sig path.
    fn apply_deactivation(env: &Env, controller: &Address) -> Result<(), ContractError> {
        let storage = env.storage().persistent();
        let key = Self::did_key(env, controller);
        let mut doc: DidDocument = storage.get(&key).ok_or(ContractError::DidNotFound)?;
        if !doc.active {
            return Err(ContractError::DidDeactivated);
        }
        doc.active = false;
        doc.updated_at = env.ledger().timestamp();
        storage.set(&key, &doc);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        let count: u32 = env.storage().instance().get(&DID_COUNT).unwrap_or(0);
        if count > 0 {
            env.storage().instance().set(&DID_COUNT, &(count - 1));
        }
        env.events().publish(
            (IDENTITY, symbol_short!("deact")),
            (EVENT_VERSION, controller.clone(), doc.updated_at),
        );
        Ok(())
    }

    /// Core DID-creation logic shared by [`Self::create_did`] and
    /// [`Self::create_dids_batch`]. Caller must have already authorized
    /// `controller` (via `require_auth`) and confirmed the contract isn't paused.
    fn create_did_unchecked(
        env: &Env,
        controller: &Address,
        metadata: Map<String, String>,
        now: u64,
    ) -> Result<String, ContractError> {
        let storage = env.storage().persistent();
        let key = Self::did_key(env, controller);
        if storage.has(&key) {
            return Err(ContractError::DidAlreadyExists);
        }
        Self::validate_metadata(&metadata)?;
        let did_id = Self::build_did_string(env, controller);
        if !Self::validate_did_format(env, &did_id) {
            return Err(ContractError::DidNotFound);
        }
        let doc = DidDocument {
            id: did_id.clone(),
            controller: controller.clone(),
            metadata,
            created_at: now,
            updated_at: now,
            active: true,
            services: Vec::new(env),
            parent: controller.clone(),
            delegation_depth: 0,
        };
        storage.set(&key, &doc);
        storage.extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        let count: u32 = env.storage().instance().get(&DID_COUNT).unwrap_or(0);
        env.storage().instance().set(&DID_COUNT, &(count + 1));
        let total: u32 = env.storage().instance().get(&TOTAL_DIDS).unwrap_or(0);
        let index_key = (DID_INDEX, total);
        storage.set(&index_key, &controller);
        storage.extend_ttl(&index_key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
        env.storage().instance().set(&TOTAL_DIDS, &(total + 1));
        env.events().publish((IDENTITY, symbol_short!("created")), (EVENT_VERSION, controller.clone(), now));
        Ok(did_id)
    }

    fn ensure_cid_immutable(
        env: &Env,
        existing: &Map<String, String>,
        updated: &Map<String, String>,
    ) -> Result<(), ContractError> {
        for key_name in ["cid", "ipfs_cid"] {
            let key = String::from_str(env, key_name);
            if let Some(old_cid) = existing.get(key.clone()) {
                if updated.get(key) != Some(old_cid) {
                    return Err(ContractError::CidImmutable);
                }
            }
        }
        Ok(())
    }

    fn validate_metadata(metadata: &Map<String, String>) -> Result<(), ContractError> {
        if metadata.len() > 10 {
            return Err(ContractError::MetadataTooLarge);
        }
        for (k, v) in metadata.iter() {
            if k.len() > 64 || v.len() > 256 {
                return Err(ContractError::MetadataTooLong);
            }
        }
        Ok(())
    }

    fn did_key(env: &Env, controller: &Address) -> (Symbol, BytesN<32>) {
        let key_bytes = env.crypto().sha256(&controller.clone().to_xdr(env));
        (IDENTITY, key_bytes.into())
    }

    fn history_key(env: &Env, controller: &Address) -> (Symbol, BytesN<32>) {
        let key_bytes = env.crypto().sha256(&controller.clone().to_xdr(env));
        (symbol_short!("DIDHIST"), key_bytes.into())
    }

    /// Appends the current state of `doc` to the DID's version history before
    /// it is superseded. The stored revision number is the length of the
    /// existing history plus one, so versions are contiguous and monotonic.
    /// When the history is full, the oldest revision is dropped.
    fn push_history(env: &Env, controller: &Address, doc: &DidDocument, now: u64) {
        let storage = env.storage().persistent();
        let history_key = Self::history_key(env, controller);
        let mut history: Vec<DidVersion> = storage
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(env));
        let version = history.len() + 1;
        history.push_back(DidVersion {
            version,
            timestamp: now,
            document: doc.clone(),
        });
        while history.len() > MAX_DID_HISTORY {
            history.pop_front();
        }
        storage.set(&history_key, &history);
        storage.extend_ttl(&history_key, TTL_BUMP_THRESHOLD, TTL_LEDGERS);
    }

    /// Storage key for a DID string registered through the registry interface.
    fn identity_key(env: &Env, did: &String) -> (Symbol, BytesN<32>) {
        let key_bytes = env.crypto().sha256(&Self::string_to_bytes(env, did));
        (IDENTITY, key_bytes.into())
    }

    /// Validates that `did` is non-empty and uses the supported `did:stellar:` method.
    fn validate_identity_did(env: &Env, did: &String) -> Result<(), ContractError> {
        if did.is_empty() {
            return Err(ContractError::InvalidDid);
        }
        let did_bytes = Self::string_to_bytes(env, did);
        if did_bytes.len() as usize <= DID_STELLAR_PREFIX.len() {
            return Err(ContractError::InvalidDid);
        }
        for (i, expected) in DID_STELLAR_PREFIX.iter().enumerate() {
            if did_bytes.get(i as u32) != Some(*expected) {
                return Err(ContractError::UnsupportedDidMethod);
            }
        }
        Ok(())
    }

    fn build_did_string(env: &Env, controller: &Address) -> String {
        let addr_str = controller.to_string();
        let mut addr_bytes = [0u8; 56];
        addr_str.copy_into_slice(&mut addr_bytes);
        let prefix_len = DID_STELLAR_PREFIX.len();
        let mut result = [0u8; 68];
        result[..prefix_len].copy_from_slice(DID_STELLAR_PREFIX);
        result[prefix_len..].copy_from_slice(&addr_bytes);
        String::from_bytes(env, &result)
    }

    fn validate_did_format(env: &Env, did: &String) -> bool {
        if did.len() != 68 { return false; }
        let did_bytes = Self::string_to_bytes(env, did);
        for (i, expected) in DID_STELLAR_PREFIX.iter().enumerate() {
            if did_bytes.get(i as u32).unwrap() != *expected { return false; }
        }
        true
    }

    fn string_to_bytes(env: &Env, value: &String) -> Bytes {
        let mut result = Bytes::new(env);
        let mut buffer = [0u8; 68];
        value.copy_into_slice(&mut buffer[..value.len() as usize]);
        result.extend_from_slice(&buffer[..value.len() as usize]);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, Map};
    extern crate std;
    use std::string::ToString;

    fn setup() -> (Env, IdentityRegistryClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client)
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_double_initialize_returns_error() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        assert_eq!(client.try_initialize(&admin), Err(Ok(ContractError::AlreadyInitialized)));
    }

    #[test]
    fn test_create_and_resolve_did() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let did_id = client.create_did(&user, &Map::new(&env));
        let did_str = did_id.to_string();
        assert!(did_str.contains("did:stellar:"));
        let doc = client.resolve_did(&user);
        assert!(doc.active);
        assert_eq!(doc.controller, user);
    }

    // -- Issue #1361: multi-sig deactivation

    fn msig_setup(
        n: u32,
        threshold: u32,
    ) -> (Env, IdentityRegistryClient<'static>, Address, std::vec::Vec<Address>) {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let mut signers = Vec::new(&env);
        let mut list = std::vec::Vec::new();
        for _ in 0..n {
            let a = Address::generate(&env);
            signers.push_back(a.clone());
            list.push(a);
        }
        client.set_deactivation_signers(&user, &signers, &threshold, &Vec::new(&env));
        (env, client, user, list)
    }

    #[test]
    fn test_multisig_blocks_direct_deactivation() {
        let (_env, client, user, _s) = msig_setup(3, 2);
        assert_eq!(client.try_deactivate_did(&user), Err(Ok(ContractError::MultiSigRequired)));
        assert!(client.has_active_did(&user));
    }

    #[test]
    fn test_multisig_executes_at_threshold() {
        let (_env, client, user, s) = msig_setup(3, 2);
        assert!(!client.approve_deactivation(&s[0], &user));
        assert!(client.has_active_did(&user));
        assert_eq!(client.get_deactivation_approvals(&user).len(), 1);
        assert!(client.approve_deactivation(&s[1], &user));
        assert!(!client.has_active_did(&user));
        assert_eq!(client.get_deactivation_approvals(&user).len(), 0);
    }

    #[test]
    fn test_multisig_rejects_duplicate_and_non_signer() {
        let (env, client, user, s) = msig_setup(3, 3);
        client.approve_deactivation(&s[0], &user);
        assert_eq!(
            client.try_approve_deactivation(&s[0], &user),
            Err(Ok(ContractError::AlreadyApproved))
        );
        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_approve_deactivation(&outsider, &user),
            Err(Ok(ContractError::Unauthorized))
        );
        assert!(client.has_active_did(&user));
    }

    #[test]
    fn test_multisig_not_configured_keeps_single_controller_flow() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let other = Address::generate(&env);
        assert_eq!(
            client.try_approve_deactivation(&other, &user),
            Err(Ok(ContractError::MultiSigNotConfigured))
        );
        client.deactivate_did(&user);
        assert!(!client.has_active_did(&user));
    }

    #[test]
    fn test_multisig_invalid_config() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let a = Address::generate(&env);
        let none: Vec<Address> = Vec::new(&env);
        let empty: Vec<Address> = Vec::new(&env);
        assert_eq!(
            client.try_set_deactivation_signers(&user, &empty, &1, &none),
            Err(Ok(ContractError::InvalidMultiSigConfig))
        );
        let mut one = Vec::new(&env);
        one.push_back(a.clone());
        assert_eq!(
            client.try_set_deactivation_signers(&user, &one, &0, &none),
            Err(Ok(ContractError::InvalidMultiSigConfig))
        );
        assert_eq!(
            client.try_set_deactivation_signers(&user, &one, &2, &none),
            Err(Ok(ContractError::InvalidMultiSigConfig))
        );
        let mut dup = Vec::new(&env);
        dup.push_back(a.clone());
        dup.push_back(a);
        assert_eq!(
            client.try_set_deactivation_signers(&user, &dup, &1, &none),
            Err(Ok(ContractError::InvalidMultiSigConfig))
        );
    }

    #[test]
    fn test_multisig_policy_change_requires_existing_signers() {
        let (env, client, user, s) = msig_setup(3, 2);
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(Address::generate(&env));
        let mut approvers = Vec::new(&env);
        approvers.push_back(s[0].clone());
        assert_eq!(
            client.try_set_deactivation_signers(&user, &new_signers, &1, &approvers),
            Err(Ok(ContractError::Unauthorized))
        );
        approvers.push_back(s[1].clone());
        client.set_deactivation_signers(&user, &new_signers, &1, &approvers);
        assert_eq!(client.get_deactivation_signers(&user).unwrap().threshold, 1);
    }

    #[test]
    fn test_multisig_approvals_expire() {
        use soroban_sdk::testutils::Ledger;
        let (env, client, user, s) = msig_setup(2, 2);
        client.approve_deactivation(&s[0], &user);
        env.ledger()
            .with_mut(|l| l.timestamp += DEACTIVATION_APPROVAL_TTL_SECS + 1);
        assert_eq!(client.get_deactivation_approvals(&user).len(), 0);
        assert!(!client.approve_deactivation(&s[1], &user));
        assert!(client.has_active_did(&user));
    }

    #[test]
    fn test_deactivate_did() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        assert!(client.has_active_did(&user));
        client.deactivate_did(&user);
        assert!(!client.has_active_did(&user));
    }

    /// propose_admin + accept_admin must hand off control; the old admin loses
    /// privileges and the new admin gains them.
    #[test]
    fn test_propose_and_accept_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        client.initialize(&admin);

        client.propose_admin(&admin, &new_admin);
        client.accept_admin(&new_admin);

        // Old admin can no longer propose a further transfer.
        let another = Address::generate(&env);
        let result = client.try_propose_admin(&admin, &another);
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));

        // New admin can now propose.
        client.propose_admin(&new_admin, &another);
    }

    /// accept_admin must reject an address that was not the one proposed.
    #[test]
    fn test_accept_admin_wrong_caller_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let proposed = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.initialize(&admin);

        client.propose_admin(&admin, &proposed);

        let result = client.try_accept_admin(&attacker);
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
    }

    /// accept_admin with no pending proposal must return NotInitialized.
    #[test]
    fn test_accept_admin_no_pending_proposal_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let someone = Address::generate(&env);
        let result = client.try_accept_admin(&someone);
        assert_eq!(result, Err(Ok(ContractError::NotInitialized)));
    }

    /// propose_admin from a non-admin address must return Unauthorized.
    #[test]
    fn test_propose_admin_unauthorized_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);
        client.initialize(&admin);

        let result = client.try_propose_admin(&attacker, &target);
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
    }

    /// Repeated deactivate_did calls on an already-inactive DID must error and
    /// must not decrement DID_COUNT more than once.
    #[test]
    fn test_repeated_deactivate_did_is_idempotent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        assert_eq!(client.get_did_count(), 1);

        client.deactivate_did(&user);
        assert_eq!(client.get_did_count(), 0);

        let result = client.try_deactivate_did(&user);
        assert_eq!(result, Err(Ok(ContractError::DidDeactivated)));
        // DID_COUNT must still be 0, not underflowed/saturated a second time.
        assert_eq!(client.get_did_count(), 0);
    }

    /// resolve_did on a deactivated DID must return DidDeactivated error.
    #[test]
    fn test_resolve_deactivated_did_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        client.deactivate_did(&user);
        assert_eq!(client.try_resolve_did(&user), Err(Ok(ContractError::DidDeactivated)));
    }

    #[test]
    fn test_resolve_nonexistent_did_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.try_resolve_did(&user), Err(Ok(ContractError::DidNotFound)));
    }

    /// #1301 BUG-04: resolving an unknown DID string must return an error
    /// rather than panicking/trapping the host.
    #[test]
    fn test_resolve_unknown_did_string_returns_error() {
        let (env, client) = setup();
        let unknown = String::from_str(&env, "did:stellar:GUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWN");
        let result = client.try_resolve_did_string(&unknown);
        assert!(result.is_err());
    }

    /// #1301 BUG-04: the universal resolver must also return an error for an
    /// unknown DID instead of panicking.
    #[test]
    fn test_resolve_unknown_did_universal_returns_error() {
        let (env, client) = setup();
        let unknown = String::from_str(&env, "did:stellar:GUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKNOWN");
        let result = client.try_resolve_did_universal(&unknown);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_did_count() {
        let (env, client) = setup();
        assert_eq!(client.get_did_count(), 0);
        let user1 = Address::generate(&env);
        client.create_did(&user1, &Map::new(&env));
        assert_eq!(client.get_did_count(), 1);
        let user2 = Address::generate(&env);
        client.create_did(&user2, &Map::new(&env));
        assert_eq!(client.get_did_count(), 2);
        client.deactivate_did(&user1);
        assert_eq!(client.get_did_count(), 1);
    }

    #[test]
    fn test_create_did_metadata_key_too_long() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let mut metadata: Map<String, String> = Map::new(&env);
        metadata.set(
            String::from_str(&env, "aaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeeefffff1234567890"),
            String::from_str(&env, "value"),
        );
        assert_eq!(client.try_create_did(&user, &metadata), Err(Ok(ContractError::MetadataTooLong)));
    }

    #[test]
    fn test_upgrade_unauthorized_returns_error() {
        let (env, client) = setup();
        let attacker = Address::generate(&env);
        assert_eq!(
            client.try_upgrade(&attacker, &BytesN::from_array(&env, &[0u8; 32])),
            Err(Ok(ContractError::Unauthorized))
        );
    }

    /// #1281 BE-17: admin-only migration bumps the schema version and preserves
    /// existing DID state.
    #[test]
    fn test_migrate_preserves_did_state_and_bumps_version() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let before = client.resolve_did(&user);
        assert_eq!(client.get_schema_version(), 0);

        client.migrate(&admin, &2, &Bytes::new(&env));
        assert_eq!(client.get_schema_version(), 2);

        let after = client.resolve_did(&user);
        assert_eq!(before, after);
        assert!(client.has_active_did(&user));
    }

    /// #1281 BE-17: non-admin callers cannot migrate.
    #[test]
    fn test_migrate_unauthorized_returns_error() {
        let (env, client) = setup();
        let attacker = Address::generate(&env);
        assert_eq!(
            client.try_migrate(&attacker, &1, &Bytes::new(&env)),
            Err(Ok(ContractError::UpgradeUnauthorized))
        );
    }

    /// #1281 BE-17: the version must strictly increase.
    #[test]
    fn test_migrate_rejects_non_increasing_version() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        client.migrate(&admin, &3, &Bytes::new(&env));
        assert_eq!(
            client.try_migrate(&admin, &3, &Bytes::new(&env)),
            Err(Ok(ContractError::InvalidUpgradeVersion))
        );
        assert_eq!(
            client.try_migrate(&admin, &2, &Bytes::new(&env)),
            Err(Ok(ContractError::InvalidUpgradeVersion))
        );
    }

    /// #1283 BE-19: deactivated DIDs cannot issue or receive attestations.
    #[test]
    fn test_deactivated_did_cannot_issue_or_receive() {
        let (env, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        client.create_did(&issuer, &Map::new(&env));
        client.create_did(&subject, &Map::new(&env));

        client.deactivate_did(&issuer);
        assert!(client.is_did_deactivated(&issuer));
        assert_eq!(
            client.try_require_active_did(&issuer),
            Err(Ok(ContractError::DidDeactivated))
        );

        client.deactivate_did(&subject);
        assert_eq!(
            client.try_require_active_did(&subject),
            Err(Ok(ContractError::DidDeactivated))
        );

        // Unknown DIDs are reported as not found.
        let unknown = Address::generate(&env);
        assert_eq!(
            client.try_require_active_did(&unknown),
            Err(Ok(ContractError::DidNotFound))
        );
    }

    #[test]
    fn test_get_storage_stats() {
        let (env, client) = setup();
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 0);
        assert_eq!(stats.active_dids, 0);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        client.create_did(&user1, &Map::new(&env));
        client.create_did(&user2, &Map::new(&env));
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 2);
        assert_eq!(stats.active_dids, 2);
        client.deactivate_did(&user1);
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 2);
        assert_eq!(stats.active_dids, 1);
    }

    fn make_service(env: &Env, n: u32) -> ServiceEndpoint {
        let mut buf = [0u8; 3];
        buf[0] = b'a' + (n % 26) as u8;
        buf[1] = b'0' + (n / 10) as u8;
        buf[2] = b'0' + (n % 10) as u8;
        let s = String::from_bytes(env, &buf);
        ServiceEndpoint { id: s.clone(), type_: s.clone(), service_endpoint: s }
    }

    /// Exactly MAX_SERVICES endpoints must be accepted; MAX_SERVICES+1 must return MaxServicesReached.
    #[test]
    fn test_add_service_max_services_boundary() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        for i in 0..MAX_SERVICES {
            client.add_service(&user, &make_service(&env, i));
        }
        let result = client.try_add_service(&user, &make_service(&env, MAX_SERVICES));
        assert_eq!(result, Err(Ok(ContractError::MaxServicesReached)));
    }

    /// reactivate_did called by non-admin returns Unauthorized.
    #[test]
    fn test_reactivate_did_unauthorized_non_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        client.create_did(&user, &Map::new(&env));
        client.deactivate_did(&user);

        let result = client.try_reactivate_did(&non_admin, &user);
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
    }

    /// reactivate_did on an already-active DID is a no-op and returns Ok.
    #[test]
    fn test_reactivate_did_already_active_is_noop() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        client.create_did(&u1, &Map::new(&env));
        client.create_did(&u2, &Map::new(&env));
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 2);
        assert_eq!(stats.active_dids, 2);
        client.deactivate_did(&u1);
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 2);
        assert_eq!(stats.active_dids, 1);
    }

    // ── Service endpoint tests (#393 / #460) ────────────────────────────────

    fn make_endpoint(env: &Env, id: &str) -> ServiceEndpoint {
        ServiceEndpoint {
            id: String::from_str(env, id),
            type_: String::from_str(env, "DIDCommMessaging"),
            service_endpoint: String::from_str(env, "https://example.com"),
        }
    }

    #[test]
    fn test_add_service() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &cid);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        client.create_did(&user, &Map::new(&env));

        // DID is already active; reactivate should be a no-op
        let result = client.try_reactivate_did(&admin, &user);
        assert_eq!(result, Ok(Ok(())));

        // Verify DID is still active
        assert!(client.has_active_did(&user));
    }

    /// Regression for #460: adding an endpoint with a duplicate id must return
    /// ServiceAlreadyExists (previously this variant was missing from the enum).
    #[test]
    fn test_add_service_duplicate_id_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        let ep = make_endpoint(&env, "messaging-1");
        client.add_service(&user, &ep);

        // Second add with the same id must fail.
        let result = client.try_add_service(&user, &ep);
        assert_eq!(result, Err(Ok(ContractError::ServiceAlreadyExists)));
    }

    /// Regression for #460: both MAX_SERVICES cap and id-uniqueness are enforced
    /// by the single merged add_service implementation.
    #[test]
    fn test_add_service_enforces_both_max_cap_and_uniqueness() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        // Fill up to MAX_SERVICES using unique ids.
        for i in 0..MAX_SERVICES {
            let mut id_bytes = [b'e', b'0', b'0'];
            id_bytes[1] = b'0' + (i / 10) as u8;
            id_bytes[2] = b'0' + (i % 10) as u8;
            let id = String::from_bytes(&env, &id_bytes);
            client.add_service(&user, &ServiceEndpoint {
                id: id.clone(),
                type_: id.clone(),
                service_endpoint: id,
            });
        }

        // MAX_SERVICES cap is enforced.
        let overflow = make_endpoint(&env, "overflow");
        assert_eq!(
            client.try_add_service(&user, &overflow),
            Err(Ok(ContractError::MaxServicesReached)),
        );

        // Uniqueness is enforced independently (id that already exists on a non-full doc).
        let (env2, client2) = setup();
        let user2 = Address::generate(&env2);
        client2.create_did(&user2, &Map::new(&env2));
        client2.add_service(&user2, &make_endpoint(&env2, "dup-id"));
        assert_eq!(
            client2.try_add_service(&user2, &make_endpoint(&env2, "dup-id")),
            Err(Ok(ContractError::ServiceAlreadyExists)),
        );
    }

    /// reactivate_did restores an active DID and increments count.
    #[test]
    fn test_reactivate_did_restores_active_did() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &cid);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        client.create_did(&user, &Map::new(&env));

        assert_eq!(client.get_did_count(), 1);
        assert!(client.has_active_did(&user));

        // Deactivate
        client.deactivate_did(&user);
        assert_eq!(client.get_did_count(), 0);
        assert!(!client.has_active_did(&user));

        // Reactivate
        let result = client.try_reactivate_did(&admin, &user);
        assert_eq!(result, Ok(Ok(())));

        assert_eq!(client.get_did_count(), 1);
        assert!(client.has_active_did(&user));

        // Verify the document is now active
        let doc = client.resolve_did(&user);
        assert!(doc.active);
    }

    /// did_exists returns true for both active and deactivated DIDs.
    #[test]
    fn test_did_exists() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        
        // Before creation, did_exists should return false
        assert!(!client.did_exists(&user));
        
        // Create DID
        client.create_did(&user, &Map::new(&env));
        assert!(client.did_exists(&user));
        assert!(client.has_active_did(&user));
        
        // After deactivation, did_exists should still return true
        client.deactivate_did(&user);
        assert!(client.did_exists(&user));
        assert!(!client.has_active_did(&user));
    }

    /// did_exists is lightweight and doesn't deserialize the document.
    #[test]
    fn test_did_exists_vs_has_active_did() {
        let (env, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        
        // No DID exists
        assert!(!client.did_exists(&user1));
        assert!(!client.has_active_did(&user1));
        
        // Active DID
        client.create_did(&user1, &Map::new(&env));
        assert!(client.did_exists(&user1));
        assert!(client.has_active_did(&user1));
        
        // Deactivated DID
        client.create_did(&user2, &Map::new(&env));
        client.deactivate_did(&user2);
        assert!(client.did_exists(&user2));
        assert!(!client.has_active_did(&user2));
    }

    #[test]
    fn test_pause_blocks_writes_allows_reads() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        assert!(!client.is_paused());
        client.pause(&admin);
        assert!(client.is_paused());

        let user2 = Address::generate(&env);
        assert_eq!(
            client.try_create_did(&user2, &Map::new(&env)),
            Err(Ok(ContractError::ContractPaused))
        );

        let doc = client.resolve_did(&user);
        assert!(doc.active);
        assert!(client.has_active_did(&user));

        client.unpause(&admin);
        assert!(!client.is_paused());
        client.create_did(&user2, &Map::new(&env));
        assert!(client.has_active_did(&user2));
    }

    #[test]
    fn test_only_admin_can_pause() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let rando = Address::generate(&env);
        assert_eq!(client.try_pause(&rando), Err(Ok(ContractError::Unauthorized)));
        assert!(!client.is_paused());
    }

    #[test]
    fn test_resolve_did_id_format() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let doc = client.resolve_did(&user);
        let id = doc.id.to_string();
        assert!(id.starts_with("did:stellar:"));
        assert_eq!(doc.id.len(), 68);
    }

    // ── create_dids_batch tests (#654) ────────────────────────────────────────

    #[test]
    fn test_create_dids_batch_creates_all_and_returns_ids_in_order() {
        let (env, client) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        let u3 = Address::generate(&env);

        let mut entries = Vec::new(&env);
        entries.push_back((u1.clone(), Map::new(&env)));
        entries.push_back((u2.clone(), Map::new(&env)));
        entries.push_back((u3.clone(), Map::new(&env)));

        let ids = client.create_dids_batch(&entries);
        assert_eq!(ids.len(), 3);

        assert!(client.has_active_did(&u1));
        assert!(client.has_active_did(&u2));
        assert!(client.has_active_did(&u3));
        assert_eq!(client.get_did_count(), 3);

        let doc1 = client.resolve_did(&u1);
        assert_eq!(doc1.id, ids.get(0).unwrap());
    }

    #[test]
    fn test_create_dids_batch_rejects_empty() {
        let (env, client) = setup();
        let entries: Vec<(Address, Map<String, String>)> = Vec::new(&env);
        assert_eq!(client.try_create_dids_batch(&entries), Err(Ok(ContractError::EmptyBatch)));
    }

    #[test]
    fn test_create_dids_batch_enforces_size_cap() {
        let (env, client) = setup();
        let mut entries = Vec::new(&env);
        for _ in 0..(MAX_BATCH_DIDS + 1) {
            entries.push_back((Address::generate(&env), Map::new(&env)));
        }
        assert_eq!(client.try_create_dids_batch(&entries), Err(Ok(ContractError::BatchTooLarge)));

        // Exactly MAX_BATCH_DIDS succeeds and nothing was written by the rejected call above.
        entries.pop_back();
        let ids = client.create_dids_batch(&entries);
        assert_eq!(ids.len(), MAX_BATCH_DIDS);
    }

    #[test]
    fn test_create_dids_batch_rejects_duplicate_controller_in_batch() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let mut entries = Vec::new(&env);
        entries.push_back((user.clone(), Map::new(&env)));
        entries.push_back((user.clone(), Map::new(&env)));

        let result = client.try_create_dids_batch(&entries);
        assert_eq!(result, Err(Ok(ContractError::DidAlreadyExists)));
        // Nothing should have been written — not even the first occurrence.
        assert!(!client.did_exists(&user));
    }

    #[test]
    fn test_create_dids_batch_rejects_controller_with_existing_did() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        let other = Address::generate(&env);
        let mut entries = Vec::new(&env);
        entries.push_back((other.clone(), Map::new(&env)));
        entries.push_back((user.clone(), Map::new(&env)));

        let result = client.try_create_dids_batch(&entries);
        assert_eq!(result, Err(Ok(ContractError::DidAlreadyExists)));
        // The batch is atomic: `other` must not have been created either.
        assert!(!client.did_exists(&other));
    }

    #[test]
    fn test_create_dids_batch_validates_metadata_before_writing() {
        let (env, client) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);

        let mut bad_metadata: Map<String, String> = Map::new(&env);
        bad_metadata.set(
            String::from_str(&env, "aaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeeefffff1234567890"),
            String::from_str(&env, "value"),
        );

        let mut entries = Vec::new(&env);
        entries.push_back((u1.clone(), Map::new(&env)));
        entries.push_back((u2.clone(), bad_metadata));

        let result = client.try_create_dids_batch(&entries);
        assert_eq!(result, Err(Ok(ContractError::MetadataTooLong)));
        assert!(!client.did_exists(&u1));
    }

    #[test]
    fn test_create_dids_batch_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.pause(&admin);

        let mut entries = Vec::new(&env);
        entries.push_back((Address::generate(&env), Map::new(&env)));
        assert_eq!(client.try_create_dids_batch(&entries), Err(Ok(ContractError::ContractPaused)));
    }

    #[test]
    fn test_hierarchical_delegation_updates_document_and_chain() {
        let (env, client) = setup();
        let root = Address::generate(&env);
        let child = Address::generate(&env);
        let grandchild = Address::generate(&env);
        client.create_did(&root, &Map::new(&env));
        client.create_did(&child, &Map::new(&env));
        client.create_did(&grandchild, &Map::new(&env));

        client.delegate_authority(&root, &child, &String::from_str(&env, "issue"));
        client.delegate_authority(&child, &grandchild, &String::from_str(&env, "verify"));

        let doc = client.resolve_did(&grandchild);
        assert_eq!(doc.parent, child.clone());
        assert_eq!(doc.delegation_depth, 2);
        assert!(client.is_delegation_authorized(&root, &grandchild));
        assert_eq!(client.get_delegation_chain(&grandchild).len(), 2);
        assert_eq!(client.get_delegations(&root).len(), 1);
    }

    #[test]
    fn test_delegation_depth_is_limited_to_three_edges() {
        let (env, client) = setup();
        let root = Address::generate(&env);
        let first = Address::generate(&env);
        let second = Address::generate(&env);
        let third = Address::generate(&env);
        let fourth = Address::generate(&env);
        for address in [&root, &first, &second, &third, &fourth] {
            client.create_did(address, &Map::new(&env));
        }
        let scope = String::from_str(&env, "all");
        client.delegate_authority(&root, &first, &scope);
        client.delegate_authority(&first, &second, &scope);
        client.delegate_authority(&second, &third, &scope);
        assert_eq!(
            client.try_delegate_authority(&third, &fourth, &scope),
            Err(Ok(ContractError::DelegationDepthExceeded))
        );
    }

    #[test]
    fn test_delegation_rejects_cycles_and_duplicate_parent() {
        let (env, client) = setup();
        let parent = Address::generate(&env);
        let child = Address::generate(&env);
        let other_parent = Address::generate(&env);
        for address in [&parent, &child, &other_parent] {
            client.create_did(address, &Map::new(&env));
        }
        let scope = String::from_str(&env, "read");
        assert_eq!(
            client.try_delegate_authority(&parent, &parent, &scope),
            Err(Ok(ContractError::DelegationCycle))
        );
        client.delegate_authority(&parent, &child, &scope);
        assert_eq!(
            client.try_delegate_authority(&other_parent, &child, &scope),
            Err(Ok(ContractError::DelegationAlreadyExists))
        );
    }

    #[test]
    fn test_revoke_delegation_clears_child_parent_and_authorization() {
        let (env, client) = setup();
        let parent = Address::generate(&env);
        let child = Address::generate(&env);
        client.create_did(&parent, &Map::new(&env));
        client.create_did(&child, &Map::new(&env));
        client.delegate_authority(&parent, &child, &String::from_str(&env, "read"));
        client.revoke_delegation(&parent, &child);
        let doc = client.resolve_did(&child);
        assert_eq!(doc.parent, child.clone());
        assert_eq!(doc.delegation_depth, 0);
        assert!(!client.is_delegation_authorized(&parent, &child));
        assert_eq!(
            client.try_revoke_delegation(&parent, &child),
            Err(Ok(ContractError::DelegationRevoked))
        );
    }

    // ── DID registry lifecycle tests (#1271) ─────────────────────────────────

    /// `create_did` stores an active document with the expected fields and
    /// emits a `created` event carrying the controller and timestamp.
    #[test]
    fn test_create_did_success_stores_document_and_emits_event() {
        use soroban_sdk::testutils::Events as _;
        use soroban_sdk::TryFromVal;

        let (env, client) = setup();
        let user = Address::generate(&env);
        let mut metadata: Map<String, String> = Map::new(&env);
        metadata.set(String::from_str(&env, "name"), String::from_str(&env, "alice"));

        let did_id = client.create_did(&user, &metadata);
        assert_eq!(did_id.len(), 68);

        let doc = client.resolve_did(&user);
        assert!(doc.active);
        assert_eq!(doc.controller, user);
        assert_eq!(doc.id, did_id);
        assert_eq!(doc.created_at, doc.updated_at);
        assert_eq!(doc.metadata.get(String::from_str(&env, "name")), Some(String::from_str(&env, "alice")));
        assert_eq!(client.get_did_count(), 1);

        // The `created` event must be emitted with the controller as subject.
        let events = env.events().all();
        let mut found = false;
        for event in events.iter() {
            let topics: Vec<soroban_sdk::Val> = event.1.clone();
            if topics.len() == 2 {
                let t0 = Symbol::try_from_val(&env, &topics.get(0).unwrap());
                let t1 = Symbol::try_from_val(&env, &topics.get(1).unwrap());
                if t0 == Ok(IDENTITY) && t1 == Ok(symbol_short!("created")) {
                    found = true;
                }
            }
        }
        assert!(found, "expected a `created` event to be emitted");
    }

    /// Creating a DID twice for the same controller must return DidAlreadyExists
    /// and must not bump the DID counters a second time.
    #[test]
    fn test_create_did_duplicate_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        let result = client.try_create_did(&user, &Map::new(&env));
        assert_eq!(result, Err(Ok(ContractError::DidAlreadyExists)));
        assert_eq!(client.get_did_count(), 1);
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 1);
        assert_eq!(stats.active_dids, 1);
    }

    /// `create_did` with an empty metadata map is allowed (metadata is optional).
    #[test]
    fn test_create_did_empty_metadata_succeeds() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let metadata: Map<String, String> = Map::new(&env);
        let did_id = client.create_did(&user, &metadata);
        assert_eq!(did_id.len(), 68);
        let doc = client.resolve_did(&user);
        assert!(doc.metadata.is_empty());
    }

    /// `create_did` with too many metadata entries returns MetadataTooLarge.
    #[test]
    fn test_create_did_metadata_too_large_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let mut metadata: Map<String, String> = Map::new(&env);
        for i in 0..11u32 {
            let mut buf = [b'k', b'0', b'0'];
            buf[1] = b'0' + (i / 10) as u8;
            buf[2] = b'0' + (i % 10) as u8;
            metadata.set(
                String::from_bytes(&env, &buf),
                String::from_str(&env, "v"),
            );
        }
        assert_eq!(
            client.try_create_did(&user, &metadata),
            Err(Ok(ContractError::MetadataTooLarge))
        );
        assert!(!client.did_exists(&user));
    }

    /// `create_did` with an over-long metadata value returns MetadataTooLong.
    #[test]
    fn test_create_did_metadata_value_too_long_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let mut metadata: Map<String, String> = Map::new(&env);
        let mut long_value = [b'x'; 257];
        long_value[0] = b'x';
        metadata.set(
            String::from_str(&env, "key"),
            String::from_bytes(&env, &long_value),
        );
        assert_eq!(
            client.try_create_did(&user, &metadata),
            Err(Ok(ContractError::MetadataTooLong))
        );
    }

    /// `resolve_did` returns the stored document for an active DID.
    #[test]
    fn test_resolve_did_success() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let doc = client.resolve_did(&user);
        assert!(doc.active);
        assert_eq!(doc.controller, user);
        assert_eq!(doc.delegation_depth, 0);
        assert_eq!(doc.parent, user);
    }

    /// `resolve_did` for an address with no DID returns DidNotFound.
    #[test]
    fn test_resolve_did_missing_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.try_resolve_did(&user), Err(Ok(ContractError::DidNotFound)));
    }

    /// `resolve_did` for a deactivated DID returns DidDeactivated.
    #[test]
    fn test_resolve_did_deactivated_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        client.deactivate_did(&user);
        assert_eq!(client.try_resolve_did(&user), Err(Ok(ContractError::DidDeactivated)));
    }

    /// `update_did` replaces metadata and advances `updated_at`.
    #[test]
    fn test_update_did_success() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        let before = client.resolve_did(&user);

        env.ledger().with_mut(|li| li.timestamp += 100);

        let mut metadata: Map<String, String> = Map::new(&env);
        metadata.set(String::from_str(&env, "name"), String::from_str(&env, "bob"));
        client.update_did(&user, &metadata);

        let after = client.resolve_did(&user);
        assert_eq!(after.metadata.get(String::from_str(&env, "name")), Some(String::from_str(&env, "bob")));
        assert_eq!(after.created_at, before.created_at);
        assert!(after.updated_at > before.updated_at);
    }

    /// `update_did` with empty metadata returns EmptyMetadata.
    #[test]
    fn test_update_did_empty_metadata_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        assert_eq!(
            client.try_update_did(&user, &Map::new(&env)),
            Err(Ok(ContractError::EmptyMetadata))
        );
    }

    /// `update_did` for an address with no DID returns DidNotFound.
    #[test]
    fn test_update_did_missing_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let mut metadata: Map<String, String> = Map::new(&env);
        metadata.set(String::from_str(&env, "name"), String::from_str(&env, "bob"));
        assert_eq!(
            client.try_update_did(&user, &metadata),
            Err(Ok(ContractError::DidNotFound))
        );
    }

    /// `update_did` on a deactivated DID returns DidDeactivated.
    #[test]
    fn test_update_did_deactivated_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        client.deactivate_did(&user);
        let mut metadata: Map<String, String> = Map::new(&env);
        metadata.set(String::from_str(&env, "name"), String::from_str(&env, "bob"));
        assert_eq!(
            client.try_update_did(&user, &metadata),
            Err(Ok(ContractError::DidDeactivated))
        );
    }

    /// `update_did` requires the controller's authorization: without it the
    /// host rejects the call (auth failure), so the update never lands.
    #[test]
    fn test_update_did_unauthorized_caller_is_rejected() {
        let env = Env::default();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(&admin);
        client.create_did(&user, &Map::new(&env));

        // From here on, no auths are mocked: the controller's signature is missing.
        env.set_auths(&[]);
        let mut metadata: Map<String, String> = Map::new(&env);
        metadata.set(String::from_str(&env, "name"), String::from_str(&env, "mallory"));
        let result = client.try_update_did(&user, &metadata);
        assert!(result.is_err());

        // The original metadata is untouched.
        env.mock_all_auths();
        let doc = client.resolve_did(&user);
        assert!(doc.metadata.is_empty());
    }

    /// `deactivate_did` flips `active` to false, decrements the active count and
    /// emits a `deact` event.
    #[test]
    fn test_deactivate_did_success_emits_event() {
        use soroban_sdk::testutils::Events as _;
        use soroban_sdk::TryFromVal;

        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        assert_eq!(client.get_did_count(), 1);

        client.deactivate_did(&user);

        assert_eq!(client.get_did_count(), 0);
        assert!(!client.has_active_did(&user));
        assert!(client.did_exists(&user));
        let stats = client.get_storage_stats();
        assert_eq!(stats.total_dids, 1);
        assert_eq!(stats.active_dids, 0);

        let events = env.events().all();
        let mut found = false;
        for event in events.iter() {
            let topics: Vec<soroban_sdk::Val> = event.1.clone();
            if topics.len() == 2 {
                let t0 = Symbol::try_from_val(&env, &topics.get(0).unwrap());
                let t1 = Symbol::try_from_val(&env, &topics.get(1).unwrap());
                if t0 == Ok(IDENTITY) && t1 == Ok(symbol_short!("deact")) {
                    found = true;
                }
            }
        }
        assert!(found, "expected a `deact` event to be emitted");
    }

    /// Deactivating an already-deactivated DID returns DidDeactivated and does
    /// not decrement the count again.
    #[test]
    fn test_deactivate_did_already_deactivated_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        client.deactivate_did(&user);
        assert_eq!(
            client.try_deactivate_did(&user),
            Err(Ok(ContractError::DidDeactivated))
        );
        assert_eq!(client.get_did_count(), 0);
    }

    /// Deactivating a DID that was never created returns DidNotFound.
    #[test]
    fn test_deactivate_did_missing_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(
            client.try_deactivate_did(&user),
            Err(Ok(ContractError::DidNotFound))
        );
    }

    /// `deactivate_did` requires the controller's authorization.
    #[test]
    fn test_deactivate_did_unauthorized_caller_is_rejected() {
        let env = Env::default();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(&admin);
        client.create_did(&user, &Map::new(&env));

        env.set_auths(&[]);
        let result = client.try_deactivate_did(&user);
        assert!(result.is_err());

        env.mock_all_auths();
        assert!(client.has_active_did(&user));
        assert_eq!(client.get_did_count(), 1);
    }

    // ── DID document versioning (#1288) ──────────────────────────────────────

    #[test]
    fn test_history_empty_for_fresh_did() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        assert_eq!(client.get_did_history(&user).len(), 0);
    }

    #[test]
    fn test_history_records_prior_revisions_on_update() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        let mut meta1: Map<String, String> = Map::new(&env);
        meta1.set(String::from_str(&env, "name"), String::from_str(&env, "first"));
        client.update_did(&user, &meta1);

        let mut meta2: Map<String, String> = Map::new(&env);
        meta2.set(String::from_str(&env, "name"), String::from_str(&env, "second"));
        client.update_did(&user, &meta2);

        let history = client.get_did_history(&user);
        assert_eq!(history.len(), 2);

        let v1 = history.get(0).unwrap();
        assert_eq!(v1.version, 1);
        assert_eq!(v1.document.metadata.len(), 0);

        let v2 = history.get(1).unwrap();
        assert_eq!(v2.version, 2);
        assert_eq!(
            v2.document.metadata.get(String::from_str(&env, "name")),
            Some(String::from_str(&env, "first"))
        );

        // The live document holds the latest metadata.
        let doc = client.resolve_did(&user);
        assert_eq!(
            doc.metadata.get(String::from_str(&env, "name")),
            Some(String::from_str(&env, "second"))
        );
    }

    #[test]
    fn test_history_is_bounded() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));
        for i in 0..(MAX_DID_HISTORY + 5) {
            let mut meta: Map<String, String> = Map::new(&env);
            meta.set(String::from_str(&env, "n"), String::from_str(&env, "v"));
            meta.set(String::from_str(&env, "i"), String::from_str(&env, "x"));
            let _ = i;
            client.update_did(&user, &meta);
        }
        let history = client.get_did_history(&user);
        assert_eq!(history.len(), MAX_DID_HISTORY);
        // Versions remain contiguous and end at the total number of updates.
        assert_eq!(history.get(0).unwrap().version, 6);
        assert_eq!(
            history.get(MAX_DID_HISTORY - 1).unwrap().version,
            MAX_DID_HISTORY + 5
        );
    }

    #[test]
    fn test_history_unknown_did_returns_error() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.try_get_did_history(&user), Err(Ok(ContractError::DidNotFound)));
    }

    #[test]
    fn test_batch_update_records_history() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        client.create_did(&user, &Map::new(&env));

        let mut meta: Map<String, String> = Map::new(&env);
        meta.set(String::from_str(&env, "k"), String::from_str(&env, "v"));
        let mut entries = Vec::new(&env);
        entries.push_back((user.clone(), meta));
        client.update_dids_batch(&entries);

        let history = client.get_did_history(&user);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().version, 1);
    }

    // ── DID registry interface tests (#1265 / #1266 / #1267) ─────────────────

    fn sample_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    #[test]
    fn test_create_identity_success() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let did = String::from_str(&env, "did:stellar:GOWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNER");
        let hash = sample_hash(&env, 7);

        let returned = client.create_identity(&owner, &did, &hash);
        assert_eq!(returned, did);

        let record = client.resolve_identity(&did);
        assert_eq!(record.did, did);
        assert_eq!(record.owner, owner);
        assert_eq!(record.metadata_hash, hash);
        assert!(record.active);
        assert_eq!(record.version, 1);
        assert_eq!(record.created_at, record.updated_at);
    }

    #[test]
    fn test_create_identity_rejects_duplicate() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let did = String::from_str(&env, "did:stellar:GOWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNER");
        client.create_identity(&owner, &did, &sample_hash(&env, 1));

        let result = client.try_create_identity(&owner, &did, &sample_hash(&env, 2));
        assert_eq!(result, Err(Ok(ContractError::DidAlreadyExists)));
    }

    #[test]
    fn test_create_identity_rejects_empty_did() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let did = String::from_str(&env, "");
        let result = client.try_create_identity(&owner, &did, &sample_hash(&env, 1));
        assert_eq!(result, Err(Ok(ContractError::InvalidDid)));
    }

    #[test]
    fn test_resolve_identity_found() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let did = String::from_str(&env, "did:stellar:GOWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNER");
        let hash = sample_hash(&env, 3);
        client.create_identity(&owner, &did, &hash);

        let record = client.resolve_identity(&did);
        assert_eq!(record.owner, owner);
        assert_eq!(record.metadata_hash, hash);
    }

    #[test]
    fn test_resolve_identity_not_found() {
        let (env, client) = setup();
        let did = String::from_str(&env, "did:stellar:GMISSINGMISSINGMISSINGMISSINGMISSINGMISSINGMISSINGMISSING");
        let result = client.try_resolve_identity(&did);
        assert_eq!(result, Err(Ok(ContractError::DidNotFound)));
    }

    #[test]
    fn test_update_identity_success() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let did = String::from_str(&env, "did:stellar:GOWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNER");
        client.create_identity(&owner, &did, &sample_hash(&env, 1));

        let new_hash = sample_hash(&env, 9);
        client.update_identity(&owner, &did, &new_hash);

        let record = client.resolve_identity(&did);
        assert_eq!(record.metadata_hash, new_hash);
        assert_eq!(record.version, 2);
    }

    #[test]
    fn test_update_identity_unauthorized_owner() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let attacker = Address::generate(&env);
        let did = String::from_str(&env, "did:stellar:GOWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNEROWNER");
        client.create_identity(&owner, &did, &sample_hash(&env, 1));

        let result = client.try_update_identity(&attacker, &did, &sample_hash(&env, 2));
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
    }

    #[test]
    fn test_update_identity_not_found() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let did = String::from_str(&env, "did:stellar:GMISSINGMISSINGMISSINGMISSINGMISSINGMISSINGMISSINGMISSING");
        let result = client.try_update_identity(&owner, &did, &sample_hash(&env, 2));
        assert_eq!(result, Err(Ok(ContractError::DidNotFound)));
    }

    /// #866: an access only extends the TTL once it has dropped below
    /// `TTL_BUMP_THRESHOLD`, instead of on every call.
    #[test]
    fn test_reads_extend_ttl_only_below_threshold() {
        use soroban_sdk::testutils::{storage::Persistent as _, Ledger as _};
        let (env, client) = setup();
        let controller = Address::generate(&env);
        client.create_did(&controller, &Map::new(&env));
        let ttl = || {
            env.as_contract(&client.address, || {
                let key = IdentityRegistry::did_key(&env, &controller);
                env.storage().persistent().get_ttl(&key)
            })
        };
        let full = ttl();
        // Keep the contract instance itself alive across the ledger jumps below.
        env.as_contract(&client.address, || {
            env.storage().instance().extend_ttl(6_000_000, 6_000_000)
        });

        env.ledger().with_mut(|li| li.sequence_number += 1_000);
        client.resolve_did(&controller);
        assert!(client.has_active_did(&controller));
        assert_eq!(ttl(), full - 1_000);

        env.ledger().with_mut(|li| li.sequence_number += 518_400);
        client.resolve_did(&controller);
        assert_eq!(ttl(), full);
    }
}
