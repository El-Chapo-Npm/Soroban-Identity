//! Stable trait ABI for the `identity-registry` contract.

use identity_registry::{
    ContractError, DidDocument, DidMethod, IdentityRegistry, IdentityStorageStats, ResolverPlugin,
    ServiceEndpoint,
};
use soroban_sdk::{Address, BytesN, Env, Map, String, Vec};

/// Public entry points exposed by the `identity-registry` contract.
///
/// Integrators can depend on this trait (and the `identity-registry` crate's
/// re-exported types) to code against a stable ABI without needing to track
/// the contract's internal implementation or risk breakage from an
/// unannounced function rename.
pub trait IdentityRegistryInterface {
    fn ping(env: Env) -> u32;

    fn initialize(env: Env, admin: Address) -> Result<(), ContractError>;

    fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError>;

    fn propose_admin(env: Env, admin: Address, proposed: Address) -> Result<(), ContractError>;

    fn accept_admin(env: Env, proposed: Address) -> Result<(), ContractError>;

    fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) -> Result<(), ContractError>;

    fn create_did(
        env: Env,
        controller: Address,
        metadata: Map<String, String>,
    ) -> Result<String, ContractError>;

    fn create_dids_batch(
        env: Env,
        entries: Vec<(Address, Map<String, String>)>,
    ) -> Result<Vec<String>, ContractError>;

    fn add_service(
        env: Env,
        controller: Address,
        service: ServiceEndpoint,
    ) -> Result<(), ContractError>;

    fn update_did(
        env: Env,
        controller: Address,
        metadata: Map<String, String>,
    ) -> Result<(), ContractError>;

    fn deactivate_did(env: Env, controller: Address) -> Result<(), ContractError>;

    fn reactivate_did(env: Env, admin: Address, controller: Address) -> Result<(), ContractError>;

    fn resolve_did(env: Env, controller: Address) -> Result<DidDocument, ContractError>;

    fn has_active_did(env: Env, controller: Address) -> bool;

    fn did_exists(env: Env, controller: Address) -> bool;

    fn get_did_count(env: Env) -> u32;

    fn get_storage_stats(env: Env) -> IdentityStorageStats;

    fn remove_service(
        env: Env,
        controller: Address,
        service_id: String,
    ) -> Result<(), ContractError>;

    fn get_services(env: Env, controller: Address) -> Result<Vec<ServiceEndpoint>, ContractError>;

    /// Resolve a DID through the universal resolver, dispatching to the
    /// appropriate method-specific resolver (`did:stellar`, `did:ethr`,
    /// `did:web`, or a registered custom plugin) with caching and fallback.
    fn resolve_did_universal(env: Env, did: String) -> Result<DidDocument, ContractError>;

    /// Register a custom resolver plugin for a DID method.
    fn register_resolver_plugin(
        env: Env,
        admin: Address,
        plugin: ResolverPlugin,
    ) -> Result<(), ContractError>;

    /// Configure the ordered fallback chain of resolver methods.
    fn set_fallback_chain(
        env: Env,
        admin: Address,
        chain: Vec<String>,
    ) -> Result<(), ContractError>;

    /// Fetch a previously cached resolved DID document, if present.
    fn get_cached_did(env: Env, did: String) -> Result<DidDocument, ContractError>;

    /// Validate a DID document against the resolver's structural rules.
    fn validate_did_document(env: Env, document: DidDocument) -> Result<bool, ContractError>;

    fn register_did_method(
        env: Env,
        controller: Address,
        method: DidMethod,
    ) -> Result<(), ContractError>;

    fn resolve_did_string(env: Env, did: String) -> Result<DidDocument, ContractError>;

    fn get_did_methods(env: Env, controller: Address) -> Result<Vec<DidMethod>, ContractError>;

    fn initiate_signer_rotation(
        env: Env,
        controller: Address,
        new_signers: Vec<Address>,
    ) -> Result<u32, ContractError>;

    fn approve_signer_rotation(
        env: Env,
        signer: Address,
        rotation_id: u32,
    ) -> Result<(), ContractError>;

    fn complete_signer_rotation(
        env: Env,
        controller: Address,
        rotation_id: u32,
    ) -> Result<(), ContractError>;
}

/// Blanket implementation delegating to `IdentityRegistry`'s existing
/// `#[contractimpl]` entry points, so the trait impl and the deployed
/// contract can never drift apart.
impl IdentityRegistryInterface for IdentityRegistry {
    fn ping(env: Env) -> u32 {
        Self::ping(env)
    }

    fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::initialize(env, admin)
    }

    fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        Self::transfer_admin(env, current_admin, new_admin)
    }

    fn propose_admin(env: Env, admin: Address, proposed: Address) -> Result<(), ContractError> {
        Self::propose_admin(env, admin, proposed)
    }

    fn accept_admin(env: Env, proposed: Address) -> Result<(), ContractError> {
        Self::accept_admin(env, proposed)
    }

    fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
        Self::upgrade(env, admin, new_wasm_hash)
    }

    fn create_did(
        env: Env,
        controller: Address,
        metadata: Map<String, String>,
    ) -> Result<String, ContractError> {
        Self::create_did(env, controller, metadata)
    }

    fn create_dids_batch(
        env: Env,
        entries: Vec<(Address, Map<String, String>)>,
    ) -> Result<Vec<String>, ContractError> {
        Self::create_dids_batch(env, entries)
    }

    fn add_service(
        env: Env,
        controller: Address,
        service: ServiceEndpoint,
    ) -> Result<(), ContractError> {
        Self::add_service(env, controller, service)
    }

    fn update_did(
        env: Env,
        controller: Address,
        metadata: Map<String, String>,
    ) -> Result<(), ContractError> {
        Self::update_did(env, controller, metadata)
    }

    fn deactivate_did(env: Env, controller: Address) -> Result<(), ContractError> {
        Self::deactivate_did(env, controller)
    }

    fn reactivate_did(env: Env, admin: Address, controller: Address) -> Result<(), ContractError> {
        Self::reactivate_did(env, admin, controller)
    }

    fn resolve_did(env: Env, controller: Address) -> Result<DidDocument, ContractError> {
        Self::resolve_did(env, controller)
    }

    fn has_active_did(env: Env, controller: Address) -> bool {
        Self::has_active_did(env, controller)
    }

    fn did_exists(env: Env, controller: Address) -> bool {
        Self::did_exists(env, controller)
    }

    fn get_did_count(env: Env) -> u32 {
        Self::get_did_count(env)
    }

    fn get_storage_stats(env: Env) -> IdentityStorageStats {
        Self::get_storage_stats(env)
    }

    fn remove_service(
        env: Env,
        controller: Address,
        service_id: String,
    ) -> Result<(), ContractError> {
        Self::remove_service(env, controller, service_id)
    }

    fn get_services(env: Env, controller: Address) -> Result<Vec<ServiceEndpoint>, ContractError> {
        Self::get_services(env, controller)
    }

    fn resolve_did_universal(env: Env, did: String) -> Result<DidDocument, ContractError> {
        Self::resolve_did_universal(env, did)
    }

    fn register_resolver_plugin(
        env: Env,
        admin: Address,
        plugin: ResolverPlugin,
    ) -> Result<(), ContractError> {
        Self::register_resolver_plugin(env, admin, plugin)
    }

    fn set_fallback_chain(
        env: Env,
        admin: Address,
        chain: Vec<String>,
    ) -> Result<(), ContractError> {
        Self::set_fallback_chain(env, admin, chain)
    }

    fn get_cached_did(env: Env, did: String) -> Result<DidDocument, ContractError> {
        Self::get_cached_did(env, did)
    }

    fn validate_did_document(env: Env, document: DidDocument) -> Result<bool, ContractError> {
        Self::validate_did_document(env, document)
    }

    fn register_did_method(
        env: Env,
        controller: Address,
        method: DidMethod,
    ) -> Result<(), ContractError> {
        Self::register_did_method(env, controller, method)
    }

    fn resolve_did_string(env: Env, did: String) -> Result<DidDocument, ContractError> {
        Self::resolve_did_string(env, did)
    }

    fn get_did_methods(env: Env, controller: Address) -> Result<Vec<DidMethod>, ContractError> {
        Self::get_did_methods(env, controller)
    }

    fn initiate_signer_rotation(
        env: Env,
        controller: Address,
        new_signers: Vec<Address>,
    ) -> Result<u32, ContractError> {
        Self::initiate_signer_rotation(env, controller, new_signers)
    }

    fn approve_signer_rotation(
        env: Env,
        signer: Address,
        rotation_id: u32,
    ) -> Result<(), ContractError> {
        Self::approve_signer_rotation(env, signer, rotation_id)
    }

    fn complete_signer_rotation(
        env: Env,
        controller: Address,
        rotation_id: u32,
    ) -> Result<(), ContractError> {
        Self::complete_signer_rotation(env, controller, rotation_id)
    }
}
