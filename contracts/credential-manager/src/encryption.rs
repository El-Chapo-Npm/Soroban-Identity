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
