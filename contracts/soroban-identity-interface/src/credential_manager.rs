//! Stable trait ABI for the `credential-manager` contract.

use credential_manager::{
    BatchVerifyResult, Credential, CredentialIdsPage, CredentialManager, CredentialStorageStats,
    CredentialTemplate, CredentialTypeDescriptor, CredentialType, ContractError, DataFeedSchema,
    Escrow, EscrowConditions, EscrowDeposit, EscrowStatus, IssuersPage, OracleConfig,
    OracleRequest, OracleResponse, PresentationTemplate, RevocationProof, RevocationReason,
    RevocationRecord, RevocationStats, SignatureScheme, SignedPayload, SignerSet,
    VerifiablePresentation,
};
use soroban_sdk::{Address, Bytes, BytesN, Env, Map, String, Vec};

/// Public entry points exposed by the `credential-manager` contract.
///
/// Integrators can depend on this trait (and the `credential-manager`
/// crate's re-exported types) to code against a stable ABI without needing
/// to track the contract's internal implementation.
pub trait CredentialManagerInterface {
    fn ping(env: Env) -> u32;

    fn initialize(
        env: Env,
        admin: Address,
        identity_registry_id: Address,
    ) -> Result<(), ContractError>;

    fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError>;

    fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        timelock_duration: Option<u32>,
    ) -> Result<(), ContractError>;

    fn add_issuer(env: Env, issuer: Address) -> Result<(), ContractError>;

    fn remove_issuer(env: Env, issuer: Address) -> Result<(), ContractError>;

    fn register_schema(
        env: Env,
        issuer: Address,
        schema_hash: BytesN<32>,
    ) -> Result<(), ContractError>;

    #[allow(clippy::too_many_arguments)]
    fn issue_credential(
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
    ) -> Result<BytesN<32>, ContractError>;

    // ── Credential type registry (#656) ─────────────────────────────────────

    fn compute_claims_schema_hash(env: Env, claims: Map<String, String>) -> BytesN<32>;

    fn register_credential_type(
        env: Env,
        admin: Address,
        type_name: String,
        schema_hash: BytesN<32>,
        metadata: Map<String, String>,
    ) -> Result<(), ContractError>;

    fn deactivate_credential_type(env: Env, admin: Address, type_name: String) -> Result<(), ContractError>;

    fn get_credential_type(env: Env, type_name: String) -> Result<CredentialTypeDescriptor, ContractError>;

    fn list_credential_types(env: Env) -> Vec<String>;

    #[allow(clippy::too_many_arguments)]
    fn issue_typed_credential(
        env: Env,
        issuer: Address,
        subject: Address,
        type_name: String,
        credential_type: CredentialType,
        claims: Map<String, String>,
        claims_hash: BytesN<32>,
        signature: Bytes,
        expires_at: u64,
    ) -> Result<BytesN<32>, ContractError>;

    // ── Credential delegation (#655) ────────────────────────────────────────

    fn delegate_verification(
        env: Env,
        subject: Address,
        delegate: Address,
        credential_id: BytesN<32>,
        expires_at: u64,
    ) -> Result<(), ContractError>;

    fn revoke_delegation(env: Env, subject: Address, delegate: Address) -> Result<(), ContractError>;

    fn is_delegate_authorized(env: Env, subject: Address, delegate: Address, credential_id: BytesN<32>) -> bool;

    fn verify_credential_as_delegate(
        env: Env,
        delegate: Address,
        subject: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError>;

    fn revoke_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        reason: RevocationReason,
    ) -> Result<(), ContractError>;

    /// The stored revocation record, or `CredentialNotFound` if the credential
    /// was never revoked. #937
    fn get_revocation(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<RevocationRecord, ContractError>;

    // ── Bitmap revocation list (#1121) ──────────────────────────────────────

    /// Revoke up to 50 credentials in one call, recording the same reason for
    /// each. Returns the number of credentials newly revoked.
    fn batch_revoke(
        env: Env,
        issuer: Address,
        credential_ids: Vec<BytesN<32>>,
        reason: RevocationReason,
    ) -> Result<u32, ContractError>;

    /// Generate a merkle proof that `credential_id` is (or is not) revoked.
    fn generate_revocation_proof(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<RevocationProof, ContractError>;

    /// Verify a revocation proof against the on-chain revocation root.
    fn verify_revocation_proof(env: Env, proof: RevocationProof) -> bool;

    /// Aggregate revocation statistics for the bitmap revocation list.
    fn get_revocation_stats(env: Env) -> RevocationStats;

    // ── Verifiable presentations (#1123) ────────────────────────────────────

    /// Create a W3C Verifiable Presentation bundling the given credentials.
    fn create_presentation(
        env: Env,
        holder: Address,
        credential_ids: Vec<BytesN<32>>,
        challenge: Option<String>,
        expires_at: u64,
        template_name: Option<String>,
    ) -> Result<BytesN<32>, ContractError>;

    /// Verify a verifiable presentation, including its proofs and expiry.
    fn verify_presentation(
        env: Env,
        presentation: VerifiablePresentation,
        challenge: Option<String>,
    ) -> Result<(), ContractError>;

    /// Register a reusable presentation template.
    fn register_presentation_template(
        env: Env,
        admin: Address,
        template_name: String,
        template: PresentationTemplate,
    ) -> Result<(), ContractError>;

    /// Fetch a registered presentation template by name.
    fn get_presentation_template(
        env: Env,
        template_name: String,
    ) -> Result<PresentationTemplate, ContractError>;

    fn expire_credential(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError>;

    fn verify_credential(env: Env, credential_id: BytesN<32>) -> Result<(), ContractError>;

    fn get_credential(env: Env, credential_id: BytesN<32>) -> Result<Credential, ContractError>;

    fn verify_claims_hash(env: Env, credential_id: BytesN<32>, hash: BytesN<32>) -> bool;

    fn get_subject_credentials(env: Env, subject: Address) -> Vec<BytesN<32>>;

    fn list_subject_credentials(
        env: Env,
        subject: Address,
        cursor: Option<u64>,
        limit: u32,
        credential_type: Option<CredentialType>,
    ) -> CredentialIdsPage;

    fn get_credential_count(env: Env, subject: Address) -> u32;

    fn get_issuers(env: Env) -> Vec<Address>;

    fn list_issuers(env: Env, cursor: Option<u64>, limit: u32) -> IssuersPage;

    fn get_issuer_credentials(env: Env, issuer: Address) -> Vec<BytesN<32>>;

    fn list_issuer_credentials(
        env: Env,
        issuer: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage;

    fn get_storage_stats(env: Env) -> CredentialStorageStats;

    /// Verify up to 50 credentials in one call (#819).
    ///
    /// `fail_fast` stops after the first invalid id and returns only the
    /// results computed so far. Otherwise every id is reported.
    fn verify_credentials_batch(
        env: Env,
        ids: Vec<BytesN<32>>,
        fail_fast: bool,
    ) -> Result<Vec<BatchVerifyResult>, ContractError>;

    // ── Credential escrow (#1057) ───────────────────────────────────────────

    /// Deposit a credential into escrow under the given release conditions.
    fn escrow_deposit(
        env: Env,
        depositor: Address,
        subject: Address,
        credential_id: BytesN<32>,
        conditions: EscrowConditions,
    ) -> Result<BytesN<32>, ContractError>;

    /// Verify whether the escrow's release conditions are currently met.
    fn escrow_verify_conditions(env: Env, escrow_id: BytesN<32>) -> Result<bool, ContractError>;

    /// Release an escrowed credential once its conditions are satisfied.
    fn escrow_release(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError>;

    /// Refund an escrow whose conditions failed or expired.
    fn escrow_refund(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError>;

    /// Raise a dispute on an active escrow.
    fn escrow_dispute(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
        reason: String,
    ) -> Result<(), ContractError>;

    /// Resolve a disputed escrow, releasing or refunding it.
    fn escrow_resolve_dispute(
        env: Env,
        admin: Address,
        escrow_id: BytesN<32>,
        release_to_subject: bool,
    ) -> Result<(), ContractError>;

    /// Query the full escrow record.
    fn get_escrow(env: Env, escrow_id: BytesN<32>) -> Result<Escrow, ContractError>;

    /// Query the lifecycle status of an escrow.
    fn get_escrow_status(env: Env, escrow_id: BytesN<32>) -> Result<EscrowStatus, ContractError>;

    /// List escrows created by a depositor.
    fn list_depositor_escrows(env: Env, depositor: Address) -> Vec<BytesN<32>>;

    /// List escrows targeting a subject.
    fn list_subject_escrows(env: Env, subject: Address) -> Vec<BytesN<32>>;

    // ── Oracle integration (#1124) ──────────────────────────────────────────

    /// Register an oracle node and its configuration.
    fn register_oracle(
        env: Env,
        admin: Address,
        oracle: Address,
        config: OracleConfig,
    ) -> Result<(), ContractError>;

    /// Define or update the schema for an off-chain data feed.
    fn set_feed_schema(
        env: Env,
        admin: Address,
        feed_id: BytesN<32>,
        schema: DataFeedSchema,
    ) -> Result<(), ContractError>;

    /// Configure the fee charged by an oracle for a request.
    fn set_oracle_fee(
        env: Env,
        admin: Address,
        oracle: Address,
        fee: i128,
    ) -> Result<(), ContractError>;

    /// Configure the ordered list of fallback oracles.
    fn set_fallback_oracles(
        env: Env,
        admin: Address,
        oracles: Vec<Address>,
    ) -> Result<(), ContractError>;

    /// Submit an off-chain data request to an oracle.
    fn request_offchain_data(
        env: Env,
        requester: Address,
        oracle: Address,
        feed_id: BytesN<32>,
        payload: Bytes,
    ) -> Result<BytesN<32>, ContractError>;

    /// Oracle callback delivering the response for a request.
    fn oracle_callback(
        env: Env,
        oracle: Address,
        request_id: BytesN<32>,
        response: OracleResponse,
    ) -> Result<(), ContractError>;

    /// Whether a stored oracle response is still within its staleness window.
    fn is_response_fresh(env: Env, request_id: BytesN<32>) -> bool;

    // ── Credential templates (#1125) ────────────────────────────────────────

    /// Register a reusable credential template.
    fn register_template(
        env: Env,
        issuer: Address,
        template: CredentialTemplate,
    ) -> Result<BytesN<32>, ContractError>;

    /// Publish a new version of an existing template.
    fn publish_template_version(
        env: Env,
        issuer: Address,
        template_id: BytesN<32>,
        template: CredentialTemplate,
    ) -> Result<(), ContractError>;

    /// Validate claims against a template's rules.
    fn validate_against_template(
        env: Env,
        template_id: BytesN<32>,
        claims: Map<String, String>,
    ) -> Result<bool, ContractError>;

    /// List a template for sale in the template marketplace.
    fn list_template_for_sale(
        env: Env,
        issuer: Address,
        template_id: BytesN<32>,
        price: i128,
    ) -> Result<(), ContractError>;

    /// Purchase a template listed in the marketplace.
    fn buy_template(
        env: Env,
        buyer: Address,
        template_id: BytesN<32>,
    ) -> Result<(), ContractError>;

    // ── Threshold signatures (#1126) ────────────────────────────────────────

    /// Configure the initial signer set and threshold.
    fn set_signers(
        env: Env,
        admin: Address,
        signers: SignerSet,
    ) -> Result<(), ContractError>;

    /// Update the signer set (weights, threshold, membership).
    fn update_signers(
        env: Env,
        admin: Address,
        signers: SignerSet,
    ) -> Result<(), ContractError>;

    /// Validate that a set of signatures meets the configured threshold.
    fn validate_threshold(
        env: Env,
        payload: SignedPayload,
        scheme: SignatureScheme,
    ) -> Result<bool, ContractError>;

    /// Aggregate multiple signatures into a single payload.
    fn aggregate_signatures(
        env: Env,
        payload: SignedPayload,
        scheme: SignatureScheme,
    ) -> Result<Bytes, ContractError>;
}

/// Blanket implementation delegating to `CredentialManager`'s existing
/// `#[contractimpl]` entry points, so the trait impl and the deployed
/// contract can never drift apart.
impl CredentialManagerInterface for CredentialManager {
    fn ping(env: Env) -> u32 {
        Self::ping(env)
    }

    fn initialize(
        env: Env,
        admin: Address,
        identity_registry_id: Address,
    ) -> Result<(), ContractError> {
        Self::initialize(env, admin, identity_registry_id)
    }

    fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        Self::transfer_admin(env, current_admin, new_admin)
    }

    fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        timelock_duration: Option<u32>,
    ) -> Result<(), ContractError> {
        Self::upgrade(env, admin, new_wasm_hash, timelock_duration)
    }

    fn add_issuer(env: Env, issuer: Address) -> Result<(), ContractError> {
        Self::add_issuer(env, issuer)
    }

    fn remove_issuer(env: Env, issuer: Address) -> Result<(), ContractError> {
        Self::remove_issuer(env, issuer)
    }

    fn register_schema(
        env: Env,
        issuer: Address,
        schema_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        Self::register_schema(env, issuer, schema_hash)
    }

    fn issue_credential(
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
        Self::issue_credential(
            env,
            issuer,
            subject,
            credential_type,
            claims,
            claims_hash,
            signature,
            expires_at,
            activation_time,
            schema_hash,
            proof,
        )
    }

    fn compute_claims_schema_hash(env: Env, claims: Map<String, String>) -> BytesN<32> {
        Self::compute_claims_schema_hash(env, claims)
    }

    fn register_credential_type(
        env: Env,
        admin: Address,
        type_name: String,
        schema_hash: BytesN<32>,
        metadata: Map<String, String>,
    ) -> Result<(), ContractError> {
        Self::register_credential_type(env, admin, type_name, schema_hash, metadata)
    }

    fn deactivate_credential_type(env: Env, admin: Address, type_name: String) -> Result<(), ContractError> {
        Self::deactivate_credential_type(env, admin, type_name)
    }

    fn get_credential_type(env: Env, type_name: String) -> Result<CredentialTypeDescriptor, ContractError> {
        Self::get_credential_type(env, type_name)
    }

    fn list_credential_types(env: Env) -> Vec<String> {
        Self::list_credential_types(env)
    }

    fn issue_typed_credential(
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
        Self::issue_typed_credential(
            env, issuer, subject, type_name, credential_type, claims, claims_hash, signature, expires_at,
        )
    }

    fn delegate_verification(
        env: Env,
        subject: Address,
        delegate: Address,
        credential_id: BytesN<32>,
        expires_at: u64,
    ) -> Result<(), ContractError> {
        Self::delegate_verification(env, subject, delegate, credential_id, expires_at)
    }

    fn revoke_delegation(env: Env, subject: Address, delegate: Address) -> Result<(), ContractError> {
        Self::revoke_delegation(env, subject, delegate)
    }

    fn is_delegate_authorized(env: Env, subject: Address, delegate: Address, credential_id: BytesN<32>) -> bool {
        Self::is_delegate_authorized(env, subject, delegate, credential_id)
    }

    fn verify_credential_as_delegate(
        env: Env,
        delegate: Address,
        subject: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        Self::verify_credential_as_delegate(env, delegate, subject, credential_id)
    }

    fn revoke_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        reason: RevocationReason,
    ) -> Result<(), ContractError> {
        Self::revoke_credential(env, issuer, credential_id, reason)
    }

    fn get_revocation(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<RevocationRecord, ContractError> {
        Self::get_revocation(env, credential_id)
    }

    fn batch_revoke(
        env: Env,
        issuer: Address,
        credential_ids: Vec<BytesN<32>>,
        reason: RevocationReason,
    ) -> Result<u32, ContractError> {
        Self::batch_revoke(env, issuer, credential_ids, reason)
    }

    fn generate_revocation_proof(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<RevocationProof, ContractError> {
        Self::generate_revocation_proof(env, credential_id)
    }

    fn verify_revocation_proof(env: Env, proof: RevocationProof) -> bool {
        Self::verify_revocation_proof(env, proof)
    }

    fn get_revocation_stats(env: Env) -> RevocationStats {
        Self::get_revocation_stats(env)
    }

    fn create_presentation(
        env: Env,
        holder: Address,
        credential_ids: Vec<BytesN<32>>,
        challenge: Option<String>,
        expires_at: u64,
        template_name: Option<String>,
    ) -> Result<BytesN<32>, ContractError> {
        Self::create_presentation(env, holder, credential_ids, challenge, expires_at, template_name)
    }

    fn verify_presentation(
        env: Env,
        presentation: VerifiablePresentation,
        challenge: Option<String>,
    ) -> Result<(), ContractError> {
        Self::verify_presentation(env, presentation, challenge)
    }

    fn register_presentation_template(
        env: Env,
        admin: Address,
        template_name: String,
        template: PresentationTemplate,
    ) -> Result<(), ContractError> {
        Self::register_presentation_template(env, admin, template_name, template)
    }

    fn get_presentation_template(
        env: Env,
        template_name: String,
    ) -> Result<PresentationTemplate, ContractError> {
        Self::get_presentation_template(env, template_name)
    }

    fn expire_credential(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        Self::expire_credential(env, caller, credential_id)
    }

    fn verify_credential(env: Env, credential_id: BytesN<32>) -> Result<(), ContractError> {
        Self::verify_credential(env, credential_id)
    }

    fn get_credential(env: Env, credential_id: BytesN<32>) -> Result<Credential, ContractError> {
        Self::get_credential(env, credential_id)
    }

    fn verify_claims_hash(env: Env, credential_id: BytesN<32>, hash: BytesN<32>) -> bool {
        Self::verify_claims_hash(env, credential_id, hash)
    }

    fn get_subject_credentials(env: Env, subject: Address) -> Vec<BytesN<32>> {
        Self::get_subject_credentials(env, subject)
    }

    fn list_subject_credentials(
        env: Env,
        subject: Address,
        cursor: Option<u64>,
        limit: u32,
        credential_type: Option<CredentialType>,
    ) -> CredentialIdsPage {
        Self::list_subject_credentials(env, subject, cursor, limit, credential_type)
    }

    fn get_credential_count(env: Env, subject: Address) -> u32 {
        Self::get_credential_count(env, subject)
    }

    fn get_issuers(env: Env) -> Vec<Address> {
        Self::get_issuers(env)
    }

    fn list_issuers(env: Env, cursor: Option<u64>, limit: u32) -> IssuersPage {
        Self::list_issuers(env, cursor, limit)
    }

    fn get_issuer_credentials(env: Env, issuer: Address) -> Vec<BytesN<32>> {
        Self::get_issuer_credentials(env, issuer)
    }

    fn list_issuer_credentials(
        env: Env,
        issuer: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> CredentialIdsPage {
        Self::list_issuer_credentials(env, issuer, cursor, limit)
    }

    fn get_storage_stats(env: Env) -> CredentialStorageStats {
        Self::get_storage_stats(env)
    }

    fn verify_credentials_batch(
        env: Env,
        ids: Vec<BytesN<32>>,
        fail_fast: bool,
    ) -> Result<Vec<BatchVerifyResult>, ContractError> {
        Self::verify_credentials_batch(env, ids, fail_fast)
    }

    fn escrow_deposit(
        env: Env,
        depositor: Address,
        subject: Address,
        credential_id: BytesN<32>,
        conditions: EscrowConditions,
    ) -> Result<BytesN<32>, ContractError> {
        Self::escrow_deposit(env, depositor, subject, credential_id, conditions)
    }

    fn escrow_verify_conditions(env: Env, escrow_id: BytesN<32>) -> Result<bool, ContractError> {
        Self::escrow_verify_conditions(env, escrow_id)
    }

    fn escrow_release(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        Self::escrow_release(env, caller, escrow_id)
    }

    fn escrow_refund(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        Self::escrow_refund(env, caller, escrow_id)
    }

    fn escrow_dispute(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
        reason: String,
    ) -> Result<(), ContractError> {
        Self::escrow_dispute(env, caller, escrow_id, reason)
    }

    fn escrow_resolve_dispute(
        env: Env,
        admin: Address,
        escrow_id: BytesN<32>,
        release_to_subject: bool,
    ) -> Result<(), ContractError> {
        Self::escrow_resolve_dispute(env, admin, escrow_id, release_to_subject)
    }

    fn get_escrow(env: Env, escrow_id: BytesN<32>) -> Result<Escrow, ContractError> {
        Self::get_escrow(env, escrow_id)
    }

    fn get_escrow_status(env: Env, escrow_id: BytesN<32>) -> Result<EscrowStatus, ContractError> {
        Self::get_escrow_status(env, escrow_id)
    }

    fn list_depositor_escrows(env: Env, depositor: Address) -> Vec<BytesN<32>> {
        Self::list_depositor_escrows(env, depositor)
    }

    fn list_subject_escrows(env: Env, subject: Address) -> Vec<BytesN<32>> {
        Self::list_subject_escrows(env, subject)
    }

    fn register_oracle(
        env: Env,
        admin: Address,
        oracle: Address,
        config: OracleConfig,
    ) -> Result<(), ContractError> {
        Self::register_oracle(env, admin, oracle, config)
    }

    fn set_feed_schema(
        env: Env,
        admin: Address,
        feed_id: BytesN<32>,
        schema: DataFeedSchema,
    ) -> Result<(), ContractError> {
        Self::set_feed_schema(env, admin, feed_id, schema)
    }

    fn set_oracle_fee(
        env: Env,
        admin: Address,
        oracle: Address,
        fee: i128,
    ) -> Result<(), ContractError> {
        Self::set_oracle_fee(env, admin, oracle, fee)
    }

    fn set_fallback_oracles(
        env: Env,
        admin: Address,
        oracles: Vec<Address>,
    ) -> Result<(), ContractError> {
        Self::set_fallback_oracles(env, admin, oracles)
    }

    fn request_offchain_data(
        env: Env,
        requester: Address,
        oracle: Address,
        feed_id: BytesN<32>,
        payload: Bytes,
    ) -> Result<BytesN<32>, ContractError> {
        Self::request_offchain_data(env, requester, oracle, feed_id, payload)
    }

    fn oracle_callback(
        env: Env,
        oracle: Address,
        request_id: BytesN<32>,
        response: OracleResponse,
    ) -> Result<(), ContractError> {
        Self::oracle_callback(env, oracle, request_id, response)
    }

    fn is_response_fresh(env: Env, request_id: BytesN<32>) -> bool {
        Self::is_response_fresh(env, request_id)
    }

    fn register_template(
        env: Env,
        issuer: Address,
        template: CredentialTemplate,
    ) -> Result<BytesN<32>, ContractError> {
        Self::register_template(env, issuer, template)
    }

    fn publish_template_version(
        env: Env,
        issuer: Address,
        template_id: BytesN<32>,
        template: CredentialTemplate,
    ) -> Result<(), ContractError> {
        Self::publish_template_version(env, issuer, template_id, template)
    }

    fn validate_against_template(
        env: Env,
        template_id: BytesN<32>,
        claims: Map<String, String>,
    ) -> Result<bool, ContractError> {
        Self::validate_against_template(env, template_id, claims)
    }

    fn list_template_for_sale(
        env: Env,
        issuer: Address,
        template_id: BytesN<32>,
        price: i128,
    ) -> Result<(), ContractError> {
        Self::list_template_for_sale(env, issuer, template_id, price)
    }

    fn buy_template(
        env: Env,
        buyer: Address,
        template_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        Self::buy_template(env, buyer, template_id)
    }

    fn set_signers(
        env: Env,
        admin: Address,
        signers: SignerSet,
    ) -> Result<(), ContractError> {
        Self::set_signers(env, admin, signers)
    }

    fn update_signers(
        env: Env,
        admin: Address,
        signers: SignerSet,
    ) -> Result<(), ContractError> {
        Self::update_signers(env, admin, signers)
    }

    fn validate_threshold(
        env: Env,
        payload: SignedPayload,
        scheme: SignatureScheme,
    ) -> Result<bool, ContractError> {
        Self::validate_threshold(env, payload, scheme)
    }

    fn aggregate_signatures(
        env: Env,
        payload: SignedPayload,
        scheme: SignatureScheme,
    ) -> Result<Bytes, ContractError> {
        Self::aggregate_signatures(env, payload, scheme)
    }
}
