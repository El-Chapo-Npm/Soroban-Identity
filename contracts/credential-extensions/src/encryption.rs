//! Encrypted credential metadata with key management (#1138).
//!
//! Metadata is encrypted off-chain with a symmetric content key. Only the
//! ciphertext, nonce and a key id live on-chain. The key owner registers a
//! public key, and grants readers a copy of the content key wrapped to the
//! reader's own public key. No plaintext or unwrapped key ever touches the
//! ledger.
use crate::{DataKey, ExtError};
use soroban_sdk::{contracttype, symbol_short, Address, Bytes, BytesN, Env};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MetadataKey {
    pub owner: Address,
    pub public_key: Bytes,
    pub created_at: u64,
    pub revoked: bool,
    /// Key id that replaced this one on rotation; all zeros when not rotated.
    pub rotated_to: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EncryptedMetadata {
    pub owner: Address,
    pub key_id: BytesN<32>,
    pub ciphertext: Bytes,
    pub nonce: BytesN<12>,
    pub updated_at: u64,
}

pub fn get_key(env: &Env, key_id: &BytesN<32>) -> Option<MetadataKey> {
    env.storage().persistent().get(&DataKey::Key(key_id.clone()))
}

fn owned_active_key(env: &Env, owner: &Address, key_id: &BytesN<32>) -> Result<MetadataKey, ExtError> {
    let key = get_key(env, key_id).ok_or(ExtError::KeyNotFound)?;
    if &key.owner != owner {
        return Err(ExtError::Unauthorized);
    }
    if key.revoked {
        return Err(ExtError::KeyRevoked);
    }
    Ok(key)
}

pub fn register_key(
    env: &Env,
    owner: Address,
    key_id: BytesN<32>,
    public_key: Bytes,
) -> Result<(), ExtError> {
    owner.require_auth();
    if public_key.is_empty() || get_key(env, &key_id).is_some() {
        return Err(ExtError::InvalidInput);
    }
    let key = MetadataKey {
        owner,
        public_key,
        created_at: env.ledger().timestamp(),
        revoked: false,
        rotated_to: BytesN::from_array(env, &[0; 32]),
    };
    env.storage().persistent().set(&DataKey::Key(key_id), &key);
    Ok(())
}

pub fn rotate_key(
    env: &Env,
    owner: Address,
    old_key_id: BytesN<32>,
    new_key_id: BytesN<32>,
    public_key: Bytes,
) -> Result<(), ExtError> {
    owner.require_auth();
    let mut old = owned_active_key(env, &owner, &old_key_id)?;
    register_key(env, owner, new_key_id.clone(), public_key)?;
    old.revoked = true;
    old.rotated_to = new_key_id.clone();
    env.storage().persistent().set(&DataKey::Key(old_key_id.clone()), &old);
    env.events()
        .publish((symbol_short!("key_rot"), old_key_id), new_key_id);
    Ok(())
}

pub fn revoke_key(env: &Env, owner: Address, key_id: BytesN<32>) -> Result<(), ExtError> {
    owner.require_auth();
    let mut key = owned_active_key(env, &owner, &key_id)?;
    key.revoked = true;
    env.storage().persistent().set(&DataKey::Key(key_id.clone()), &key);
    env.events().publish((symbol_short!("key_rev"), key_id), ());
    Ok(())
}

pub fn store(
    env: &Env,
    owner: Address,
    credential_id: BytesN<32>,
    key_id: BytesN<32>,
    ciphertext: Bytes,
    nonce: BytesN<12>,
) -> Result<(), ExtError> {
    owner.require_auth();
    owned_active_key(env, &owner, &key_id)?;
    if ciphertext.is_empty() {
        return Err(ExtError::InvalidInput);
    }
    let meta_key = DataKey::Metadata(credential_id.clone());
    if let Some(existing) = env
        .storage()
        .persistent()
        .get::<_, EncryptedMetadata>(&meta_key)
    {
        if existing.owner != owner {
            return Err(ExtError::Unauthorized);
        }
    }
    let meta = EncryptedMetadata {
        owner,
        key_id,
        ciphertext,
        nonce,
        updated_at: env.ledger().timestamp(),
    };
    env.storage().persistent().set(&meta_key, &meta);
    env.events().publish((symbol_short!("enc_meta"), credential_id), ());
    Ok(())
}

pub fn grant_access(
    env: &Env,
    owner: Address,
    key_id: BytesN<32>,
    grantee: Address,
    wrapped_key: Bytes,
) -> Result<(), ExtError> {
    owner.require_auth();
    owned_active_key(env, &owner, &key_id)?;
    if wrapped_key.is_empty() {
        return Err(ExtError::InvalidInput);
    }
    env.storage()
        .persistent()
        .set(&DataKey::KeyAccess(key_id, grantee), &wrapped_key);
    Ok(())
}

pub fn revoke_access(
    env: &Env,
    owner: Address,
    key_id: BytesN<32>,
    grantee: Address,
) -> Result<(), ExtError> {
    owner.require_auth();
    let key = get_key(env, &key_id).ok_or(ExtError::KeyNotFound)?;
    if key.owner != owner {
        return Err(ExtError::Unauthorized);
    }
    env.storage()
        .persistent()
        .remove(&DataKey::KeyAccess(key_id, grantee));
    Ok(())
}

pub fn fetch(
    env: &Env,
    caller: Address,
    credential_id: &BytesN<32>,
) -> Result<(EncryptedMetadata, Bytes), ExtError> {
    caller.require_auth();
    let meta: EncryptedMetadata = env
        .storage()
        .persistent()
        .get(&DataKey::Metadata(credential_id.clone()))
        .ok_or(ExtError::MetadataNotFound)?;
    let key = get_key(env, &meta.key_id).ok_or(ExtError::KeyNotFound)?;
    if key.revoked {
        return Err(ExtError::KeyRevoked);
    }
    let wrapped: Bytes = env
        .storage()
        .persistent()
        .get(&DataKey::KeyAccess(meta.key_id.clone(), caller))
        .ok_or(ExtError::Unauthorized)?;
    Ok((meta, wrapped))
}
