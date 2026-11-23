#![no_std]

//! Credential extensions for Soroban Identity.
//!
//! - Oracle integration for off-chain credential data (#1134)
//! - Demand-based credential issuance pricing (#1137)
//! - Encrypted credential metadata with key management (#1138)
//! - Cross-contract credential verification (#1139)

mod encryption;
mod oracle;
mod pricing;
mod verification;

pub use encryption::{EncryptedMetadata, MetadataKey};
pub use oracle::{OracleConfig, OracleReport};
pub use pricing::PricingConfig;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN,
    Env, Symbol,
};

pub(crate) const ADMIN: Symbol = symbol_short!("ADMIN");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ExtError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    OracleNotConfigured = 4,
    OracleDataNotFound = 5,
    OracleDataStale = 6,
    InvalidPricing = 7,
    InsufficientPayment = 8,
    MetadataNotFound = 9,
    KeyNotFound = 10,
    KeyRevoked = 11,
    VerifierNotConfigured = 12,
    InvalidInput = 13,
}

#[contracttype]
#[derive(Clone)]
pub(crate) enum DataKey {
    Oracle,
    OracleReport(BytesN<32>),
    Pricing,
    Demand(u64),
    Metadata(BytesN<32>),
    Key(BytesN<32>),
    KeyAccess(BytesN<32>, Address),
    CredentialManager,
}

pub(crate) fn require_admin(env: &Env) -> Result<Address, ExtError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&ADMIN)
        .ok_or(ExtError::NotInitialized)?;
    admin.require_auth();
    Ok(admin)
}

#[contract]
pub struct CredentialExtensions;

#[contractimpl]
impl CredentialExtensions {
    pub fn initialize(env: Env, admin: Address, credential_manager: Address) -> Result<(), ExtError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(ExtError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CredentialManager, &credential_manager);
        Ok(())
    }

    // ── Oracle (#1134) ────────────────────────────────────────────────────────

    pub fn set_oracle(env: Env, oracle: Address, max_staleness: u64) -> Result<(), ExtError> {
        oracle::set_oracle(&env, oracle, max_staleness)
    }

    pub fn get_oracle(env: Env) -> Option<OracleConfig> {
        oracle::get_oracle(&env)
    }

    pub fn submit_oracle_report(
        env: Env,
        credential_id: BytesN<32>,
        data_hash: BytesN<32>,
        verified: bool,
    ) -> Result<(), ExtError> {
        oracle::submit_report(&env, credential_id, data_hash, verified)
    }

    pub fn get_oracle_report(env: Env, credential_id: BytesN<32>) -> Option<OracleReport> {
        oracle::get_report(&env, &credential_id)
    }

    /// True when a fresh oracle report attests the off-chain data as verified.
    pub fn is_oracle_verified(env: Env, credential_id: BytesN<32>) -> Result<bool, ExtError> {
        oracle::is_verified(&env, &credential_id)
    }

    // ── Pricing (#1137) ───────────────────────────────────────────────────────

    pub fn set_pricing(
        env: Env,
        token: Address,
        treasury: Address,
        base_price: i128,
        step_bps: u32,
        max_price: i128,
        window: u64,
    ) -> Result<(), ExtError> {
        pricing::set_pricing(&env, token, treasury, base_price, step_bps, max_price, window)
    }

    pub fn get_pricing(env: Env) -> Option<PricingConfig> {
        pricing::get_pricing(&env)
    }

    pub fn current_price(env: Env) -> Result<i128, ExtError> {
        pricing::current_price(&env)
    }

    /// Charges `payer` the current issuance price and records demand.
    pub fn pay_issuance_fee(env: Env, payer: Address, max_price: i128) -> Result<i128, ExtError> {
        pricing::pay(&env, payer, max_price)
    }

    // ── Encrypted metadata (#1138) ────────────────────────────────────────────

    pub fn register_key(
        env: Env,
        owner: Address,
        key_id: BytesN<32>,
        public_key: Bytes,
    ) -> Result<(), ExtError> {
        encryption::register_key(&env, owner, key_id, public_key)
    }

    pub fn rotate_key(
        env: Env,
        owner: Address,
        old_key_id: BytesN<32>,
        new_key_id: BytesN<32>,
        public_key: Bytes,
    ) -> Result<(), ExtError> {
        encryption::rotate_key(&env, owner, old_key_id, new_key_id, public_key)
    }

    pub fn revoke_key(env: Env, owner: Address, key_id: BytesN<32>) -> Result<(), ExtError> {
        encryption::revoke_key(&env, owner, key_id)
    }

    pub fn get_key(env: Env, key_id: BytesN<32>) -> Option<MetadataKey> {
        encryption::get_key(&env, &key_id)
    }

    pub fn store_encrypted_metadata(
        env: Env,
        owner: Address,
        credential_id: BytesN<32>,
        key_id: BytesN<32>,
        ciphertext: Bytes,
        nonce: BytesN<12>,
    ) -> Result<(), ExtError> {
        encryption::store(&env, owner, credential_id, key_id, ciphertext, nonce)
    }

    pub fn grant_metadata_access(
        env: Env,
        owner: Address,
        key_id: BytesN<32>,
        grantee: Address,
        wrapped_key: Bytes,
    ) -> Result<(), ExtError> {
        encryption::grant_access(&env, owner, key_id, grantee, wrapped_key)
    }

    pub fn revoke_metadata_access(
        env: Env,
        owner: Address,
        key_id: BytesN<32>,
        grantee: Address,
    ) -> Result<(), ExtError> {
        encryption::revoke_access(&env, owner, key_id, grantee)
    }

    /// Returns the ciphertext plus the caller's wrapped key, if granted.
    pub fn get_encrypted_metadata(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
    ) -> Result<(EncryptedMetadata, Bytes), ExtError> {
        encryption::fetch(&env, caller, &credential_id)
    }

    // ── Cross-contract verification (#1139) ───────────────────────────────────

    pub fn set_credential_manager(env: Env, credential_manager: Address) -> Result<(), ExtError> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::CredentialManager, &credential_manager);
        Ok(())
    }

    /// Callable by any contract: true when the credential is valid in the
    /// credential manager.
    pub fn is_credential_valid(env: Env, credential_id: BytesN<32>) -> Result<bool, ExtError> {
        verification::is_valid(&env, &credential_id)
    }

    /// Valid in the credential manager and held by `subject`.
    pub fn verify_for_subject(
        env: Env,
        credential_id: BytesN<32>,
        subject: Address,
    ) -> Result<bool, ExtError> {
        verification::verify_for_subject(&env, &credential_id, &subject)
    }

    /// Valid in the credential manager and, if `require_oracle`, oracle-attested.
    pub fn verify_full(
        env: Env,
        credential_id: BytesN<32>,
        require_oracle: bool,
    ) -> Result<bool, ExtError> {
        if !verification::is_valid(&env, &credential_id)? {
            return Ok(false);
        }
        if require_oracle {
            return oracle::is_verified(&env, &credential_id);
        }
        Ok(true)
    }
}
