use soroban_sdk::{symbol_short, Address, BytesN, Env, Symbol, Vec};
use crate::types::Credential;
use crate::keys::{CRED, cred_key};
use crate::revocation_registry::{
    self, RevocationProof, RevocationStats,
};
use crate::errors::ContractError;

pub fn revoke_credential(
    env: &Env,
    issuer: Address,
    credential_id: BytesN<32>,
) -> Result<(), ContractError> {
    issuer.require_auth();

    let key = cred_key(&credential_id);
    let mut cred: Credential = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::CredentialNotFound)?;

    if cred.issuer != issuer {
        return Err(ContractError::Unauthorized);
    }

    // Idempotent-safe: an already-revoked credential returns an error instead
    // of panicking or silently succeeding.
    if cred.revoked {
        return Err(ContractError::AlreadyRevoked);
    }

    // Delegate to the bitmap-based revocation registry. The registry allocates
    // (or reuses) a bitmap index for the credential and sets the bit, which is
    // far cheaper than rewriting the full credential record.
    revocation_registry::revoke(env, &issuer, &credential_id, symbol_short!("unspec"));

    cred.revoked = true;
    env.storage().persistent().set(&key, &cred);
    env.events().publish((CRED, symbol_short!("revoked")), credential_id);
    Ok(())
}

/// Issue #602: atomically revoke up to 50 credentials in one call.
///
/// Returns an error if `ids` contains more than 50 entries, if any credential
/// is not found, if the caller is not the issuer of every credential, or if
/// any credential is already revoked. No partial revocations are written.
pub fn revoke_credentials_batch(
    env: &Env,
    issuer: Address,
    ids: Vec<BytesN<32>>,
    reason: Symbol,
) -> Result<(), ContractError> {
    issuer.require_auth();
    if ids.len() > 50 {
        return Err(ContractError::BatchTooLarge);
    }

    // Validate the whole batch before writing anything so the operation stays
    // atomic: no partial revocations are persisted on failure.
    for id in ids.iter() {
        let key = cred_key(&id);
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(ContractError::Unauthorized);
        }
        if cred.revoked {
            return Err(ContractError::AlreadyRevoked);
        }
    }

    // Bitmap revocation is done in a single batched call for gas efficiency.
    revocation_registry::revoke_batch(env, &issuer, &ids, reason.clone());

    for id in ids.iter() {
        let key = cred_key(&id);
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;
        cred.revoked = true;
        env.storage().persistent().set(&key, &cred);
        env.events().publish(
            (CRED, symbol_short!("revoked")),
            (id, issuer.clone(), reason.clone()),
        );
    }
    Ok(())
}

/// Returns true if the credential is marked revoked in the bitmap registry.
pub fn is_revoked(env: &Env, issuer: &Address, credential_id: &BytesN<32>) -> bool {
    revocation_registry::is_revoked(env, issuer, credential_id)
}

/// Generates a bitmap-based revocation proof for a credential.
pub fn generate_revocation_proof(
    env: &Env,
    issuer: &Address,
    credential_id: &BytesN<32>,
) -> RevocationProof {
    revocation_registry::generate_proof(env, issuer, credential_id)
}

/// Verifies a revocation proof against the on-chain bitmap state.
pub fn verify_revocation_proof(env: &Env, issuer: &Address, proof: &RevocationProof) -> bool {
    revocation_registry::verify_proof(env, issuer, proof)
}

/// Returns aggregate revocation statistics for an issuer.
pub fn revocation_stats(env: &Env, issuer: &Address) -> RevocationStats {
    revocation_registry::stats(env, issuer)
}

pub fn verify_credential(env: &Env, credential_id: BytesN<32>) -> bool {
    let key = cred_key(&credential_id);
    match env
        .storage()
        .persistent()
        .get::<(Symbol, BytesN<32>), Credential>(&key)
    {
        None => false,
        Some(cred) => {
            if cred.revoked
                || revocation_registry::is_revoked(env, &cred.issuer, &credential_id)
            {
                return false;
            }
            if cred.expires_at > 0 && env.ledger().timestamp() > cred.expires_at {
                return false;
            }
            true
        }
    }
}

/// Verifies a credential on behalf of a delegate without ever panicking.
///
/// Returns `false` for missing, revoked, or expired credentials and for
/// delegates that are not authorized by the credential's issuer.
pub fn verify_credential_as_delegate(
    env: &Env,
    delegate: Address,
    credential_id: BytesN<32>,
) -> bool {
    let key = cred_key(&credential_id);
    let cred: Credential = match env.storage().persistent().get(&key) {
        Some(c) => c,
        None => return false,
    };

    if cred.issuer == delegate {
        return verify_credential(env, credential_id);
    }

    if !crate::delegation::is_delegate(env, &cred.issuer, &delegate) {
        return false;
    }

    verify_credential(env, credential_id)
}

/// Verifies a batch of credentials without ever panicking.
///
/// Returns a `Vec<bool>` aligned with `ids`; each entry is `false` for
/// missing, revoked, or expired credentials.
pub fn verify_credentials_batch(env: &Env, ids: Vec<BytesN<32>>) -> Vec<bool> {
    let mut results: Vec<bool> = Vec::new(env);
    for id in ids.iter() {
        results.push_back(verify_credential(env, id));
    }
    results
}
