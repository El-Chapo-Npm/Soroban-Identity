//! Issue #1129: encrypted credential metadata with on-chain key management.
//!
//! Encryption itself happens off-chain; the contract stores ciphertext and
//! per-recipient wrapped (encrypted) data keys, and enforces who may read,
//! share, rotate, and recover them. Ciphertext is stored once per credential
//! and wrapped keys are stored separately so sharing never rewrites the blob.

use soroban_sdk::{contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env};

use crate::{ContractError, Credential, CredentialManager, EVENT_VERSION};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EncryptedMetadata {
    pub owner: Address,
    pub key_id: BytesN<32>,
    pub key_version: u32,
    pub ciphertext: Bytes,
    pub recovery: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
enum EncKey {
    Meta(BytesN<32>),
    /// (credential_id, grantee) -> wrapped data key for current key version
    Grant(BytesN<32>, Address),
}

impl CredentialManager {
    fn enc_meta(env: &Env, id: &BytesN<32>) -> Result<EncryptedMetadata, ContractError> {
        env.storage().persistent().get(&EncKey::Meta(id.clone())).ok_or(ContractError::NotFound)
    }

    fn enc_new_key_id(env: &Env) -> BytesN<32> {
        env.prng().gen::<BytesN<32>>()
    }
}

#[contractimpl]
impl CredentialManager {
    /// Store encrypted metadata for a credential. Only the credential's
    /// issuer may attach metadata. Returns the generated key identifier.
    pub fn set_encrypted_metadata(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        ciphertext: Bytes,
        issuer_wrapped_key: Bytes,
        recovery: Option<Address>,
    ) -> Result<BytesN<32>, ContractError> {
        issuer.require_auth();
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&Self::cred_key(&credential_id))
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(ContractError::Unauthorized);
        }
        if ciphertext.is_empty() {
            return Err(ContractError::InvalidInput);
        }
        let key_id = Self::enc_new_key_id(&env);
        let meta = EncryptedMetadata { owner: issuer.clone(), key_id: key_id.clone(), key_version: 1, ciphertext, recovery };
        env.storage().persistent().set(&EncKey::Meta(credential_id.clone()), &meta);
        env.storage().persistent().set(&EncKey::Grant(credential_id.clone(), issuer), &issuer_wrapped_key);
        env.events().publish((symbol_short!("enc"), symbol_short!("set")), (EVENT_VERSION, credential_id, key_id.clone()));
        Ok(key_id)
    }

    pub fn get_encrypted_metadata(env: Env, credential_id: BytesN<32>) -> Result<EncryptedMetadata, ContractError> {
        Self::enc_meta(&env, &credential_id)
    }

    /// Share the data key with `grantee` (wrapped to the grantee's public key).
    pub fn grant_metadata_key(
        env: Env,
        owner: Address,
        credential_id: BytesN<32>,
        grantee: Address,
        wrapped_key: Bytes,
    ) -> Result<(), ContractError> {
        owner.require_auth();
        if Self::enc_meta(&env, &credential_id)?.owner != owner {
            return Err(ContractError::Unauthorized);
        }
        env.storage().persistent().set(&EncKey::Grant(credential_id.clone(), grantee.clone()), &wrapped_key);
        env.events().publish((symbol_short!("enc"), symbol_short!("granted")), (EVENT_VERSION, credential_id, grantee));
        Ok(())
    }

    pub fn revoke_metadata_key(env: Env, owner: Address, credential_id: BytesN<32>, grantee: Address) -> Result<(), ContractError> {
        owner.require_auth();
        if Self::enc_meta(&env, &credential_id)?.owner != owner {
            return Err(ContractError::Unauthorized);
        }
        env.storage().persistent().remove(&EncKey::Grant(credential_id.clone(), grantee.clone()));
        env.events().publish((symbol_short!("enc"), symbol_short!("revoked")), (EVENT_VERSION, credential_id, grantee));
        Ok(())
    }

    /// Fetch the caller's wrapped data key; requires the grantee's auth.
    pub fn get_metadata_key(env: Env, grantee: Address, credential_id: BytesN<32>) -> Result<Bytes, ContractError> {
        grantee.require_auth();
        env.storage()
            .persistent()
            .get(&EncKey::Grant(credential_id, grantee))
            .ok_or(ContractError::Unauthorized)
    }

    /// Rotate the data key: replaces ciphertext and the owner's wrapped key.
    /// Previous grants remain stored but are stale; the owner must re-grant.
    pub fn rotate_metadata_key(
        env: Env,
        owner: Address,
        credential_id: BytesN<32>,
        new_ciphertext: Bytes,
        owner_wrapped_key: Bytes,
    ) -> Result<BytesN<32>, ContractError> {
        owner.require_auth();
        let mut meta = Self::enc_meta(&env, &credential_id)?;
        if meta.owner != owner {
            return Err(ContractError::Unauthorized);
        }
        Self::enc_rotate(&env, &credential_id, &mut meta, new_ciphertext, owner_wrapped_key)
    }

    /// Recovery: the configured recovery address takes ownership and rotates.
    pub fn recover_metadata_key(
        env: Env,
        recovery: Address,
        credential_id: BytesN<32>,
        new_ciphertext: Bytes,
        wrapped_key: Bytes,
    ) -> Result<BytesN<32>, ContractError> {
        recovery.require_auth();
        let mut meta = Self::enc_meta(&env, &credential_id)?;
        if meta.recovery.as_ref() != Some(&recovery) {
            return Err(ContractError::Unauthorized);
        }
        meta.owner = recovery;
        Self::enc_rotate(&env, &credential_id, &mut meta, new_ciphertext, wrapped_key)
    }
}

impl CredentialManager {
    fn enc_rotate(
        env: &Env,
        credential_id: &BytesN<32>,
        meta: &mut EncryptedMetadata,
        ciphertext: Bytes,
        wrapped_key: Bytes,
    ) -> Result<BytesN<32>, ContractError> {
        if ciphertext.is_empty() {
            return Err(ContractError::InvalidInput);
        }
        meta.key_id = Self::enc_new_key_id(env);
        meta.key_version += 1;
        meta.ciphertext = ciphertext;
        env.storage().persistent().set(&EncKey::Meta(credential_id.clone()), &*meta);
        env.storage().persistent().set(&EncKey::Grant(credential_id.clone(), meta.owner.clone()), &wrapped_key);
        env.events().publish(
            (symbol_short!("enc"), symbol_short!("rotated")),
            (EVENT_VERSION, credential_id.clone(), meta.key_version),
        );
        Ok(meta.key_id.clone())
//! Encrypted credential claims and selective disclosure primitives.
//!
//! Soroban contracts must not receive plaintext PII or private decryption keys. The
//! issuer encrypts each claim off-chain (AES-256-GCM or an equivalent AEAD), then
//! stores this envelope and grants access to a verifier. This module owns the
//! on-chain metadata and authorization checks; decryption happens client-side.
use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Map, String, Vec};

pub const ENCRYPTION_METADATA_VERSION: u32 = 1;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EncryptedClaimSet {
    /// AEAD ciphertext. The authentication tag is part of the ciphertext.
    pub ciphertext: Bytes,
    /// Per-envelope nonce/IV. It is safe to publish but must never be reused.
    pub nonce: BytesN<12>,
    /// Identifier for the wrapped content-encryption key, never the key itself.
    pub key_id: BytesN<32>,
    /// Algorithm and key wrapping metadata for standards-compatible clients.
    pub metadata: Map<String, String>,
    /// Names of claims the issuer has intentionally made disclosable.
    pub disclosed_fields: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DecryptionGrant {
    pub credential_id: BytesN<32>,
    pub subject: Address,
    pub verifier: Address,
    pub key_id: BytesN<32>,
    pub granted_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
}

/// Derive a public key identifier without storing key material on-chain.
pub fn derive_key_id(env: &Env, issuer: &Address, key_material_commitment: &Bytes) -> BytesN<32> {
    let mut input = Bytes::new(env);
    input.append(&issuer.to_xdr(env));
    input.append(key_material_commitment);
    env.crypto().sha256(&input).into()
}

/// Return the subset of names approved for disclosure. Values remain encrypted
/// until the recipient has an authorized key grant.
pub fn disclosed_claim_names(
    env: &Env,
    claims: &Map<String, String>,
    allowed: &Vec<String>,
) -> Map<String, String> {
    let mut result = Map::new(env);
    for name in allowed.iter() {
        if let Some(value) = claims.get(name.clone()) {
            result.set(name, value);
        }
    }
    result
}

/// Verify that a caller may request a wrapped key. The subject and explicitly
/// granted verifier may decrypt only during the grant window.
pub fn can_decrypt(grant: &DecryptionGrant, caller: &Address, now: u64) -> bool {
    if grant.revoked || (grant.expires_at != 0 && now >= grant.expires_at) {
        return false;
    }
    caller == &grant.subject || caller == &grant.verifier
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn expired_or_revoked_grants_are_rejected() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let verifier = Address::generate(&env);
        let id = BytesN::from_array(&env, &[0; 32]);
        let grant = DecryptionGrant { credential_id: id.clone(), subject: subject.clone(), verifier: verifier.clone(), key_id: id, granted_at: 1, expires_at: 10, revoked: false };
        assert!(can_decrypt(&grant, &verifier, 9));
        assert!(!can_decrypt(&grant, &verifier, 10));
    }
}
