//! Issue #1131: on-chain credential revocation list backed by a bitmap.
//!
//! Each issuer's credentials are assigned a sequential CRL index. Revocation
//! status is packed 128 bits per storage entry, so checking or flipping a
//! bit touches a single `u128` word instead of a full credential record.

use soroban_sdk::{contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec};

use crate::{ContractError, Credential, CredentialManager, EVENT_VERSION};

const WORD_BITS: u32 = 128;

#[contracttype]
#[derive(Clone)]
enum CrlKey {
    /// (issuer) -> next free index
    Next(Address),
    /// credential_id -> index
    Index(BytesN<32>),
    /// (issuer, word index) -> u128 bitmap word
    Word(Address, u32),
}

impl CredentialManager {
    fn crl_set_bit(env: &Env, issuer: &Address, index: u32, revoked: bool) {
        let key = CrlKey::Word(issuer.clone(), index / WORD_BITS);
        let mask = 1u128 << (index % WORD_BITS);
        let word: u128 = env.storage().persistent().get(&key).unwrap_or(0);
        let word = if revoked { word | mask } else { word & !mask };
        env.storage().persistent().set(&key, &word);
    }

    fn crl_issuer_of(env: &Env, credential_id: &BytesN<32>) -> Result<Address, ContractError> {
        env.storage()
            .persistent()
            .get::<_, Credential>(&Self::cred_key(credential_id))
            .map(|c| c.issuer)
            .ok_or(ContractError::CredentialNotFound)
    }
}

#[contractimpl]
impl CredentialManager {
    /// Assign a CRL index to a credential (idempotent). Returns the index.
    pub fn crl_register(env: Env, issuer: Address, credential_id: BytesN<32>) -> Result<u32, ContractError> {
        issuer.require_auth();
        if Self::crl_issuer_of(&env, &credential_id)? != issuer {
            return Err(ContractError::Unauthorized);
        }
        let idx_key = CrlKey::Index(credential_id.clone());
        if let Some(idx) = env.storage().persistent().get(&idx_key) {
            return Ok(idx);
        }
        let next_key = CrlKey::Next(issuer);
        let idx: u32 = env.storage().persistent().get(&next_key).unwrap_or(0);
        env.storage().persistent().set(&next_key, &(idx + 1));
        env.storage().persistent().set(&idx_key, &idx);
        Ok(idx)
    }

    /// Set or clear revocation bits for a batch of credential IDs.
    pub fn crl_update(
        env: Env,
        issuer: Address,
        credential_ids: Vec<BytesN<32>>,
        revoked: bool,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        if credential_ids.len() > 100 {
            return Err(ContractError::BatchTooLarge);
        }
        for id in credential_ids.iter() {
            if Self::crl_issuer_of(&env, &id)? != issuer {
                return Err(ContractError::Unauthorized);
            }
            let idx: u32 = env
                .storage()
                .persistent()
                .get(&CrlKey::Index(id.clone()))
                .ok_or(ContractError::NotFound)?;
            Self::crl_set_bit(&env, &issuer, idx, revoked);
            env.events().publish(
                (symbol_short!("crl"), symbol_short!("updated")),
                (EVENT_VERSION, id, idx, revoked),
            );
        }
        Ok(())
    }

    pub fn crl_is_revoked(env: Env, credential_id: BytesN<32>) -> bool {
        let Some(idx) = env.storage().persistent().get::<_, u32>(&CrlKey::Index(credential_id.clone())) else {
            return false;
        };
        let Ok(issuer) = Self::crl_issuer_of(&env, &credential_id) else {
            return false;
        };
        let word: u128 = env
            .storage()
            .persistent()
            .get(&CrlKey::Word(issuer, idx / WORD_BITS))
            .unwrap_or(0);
        word & (1u128 << (idx % WORD_BITS)) != 0
    }

    /// Raw bitmap word for off-chain sync of an issuer's CRL.
    pub fn crl_get_word(env: Env, issuer: Address, word_index: u32) -> u128 {
        env.storage().persistent().get(&CrlKey::Word(issuer, word_index)).unwrap_or(0)
    }
}
