use soroban_sdk::{symbol_short, Address, BytesN, Env, Symbol, Vec};
use crate::types::Credential;
use crate::keys::{CRED, cred_key};
use crate::revocation_registry::{
    self, RevocationProof, RevocationStats,
};

pub fn revoke_credential(env: &Env, issuer: Address, credential_id: BytesN<32>) {
    issuer.require_auth();

    let key = cred_key(&credential_id);
    let mut cred: Credential = env
        .storage()
        .persistent()
        .get(&key)
        .expect("credential not found");

    if cred.issuer != issuer {
        panic!("only the issuer can revoke");
    }

    // Delegate to the bitmap-based revocation registry. The registry allocates
    // (or reuses) a bitmap index for the credential and sets the bit, which is
    // far cheaper than rewriting the full credential record.
    revocation_registry::revoke(env, &issuer, &credential_id, symbol_short!("unspec"));

    cred.revoked = true;
    env.storage().persistent().set(&key, &cred);
    env.events().publish((CRED, symbol_short!("revoked")), credential_id);
}

/// Issue #602: atomically revoke up to 50 credentials in one call.
///
/// Panics if `ids` contains more than 50 entries, if any credential is not
/// found, if the caller is not the issuer of every credential, or if any
/// credential is already revoked. No partial revocations are written.
pub fn revoke_credentials_batch(
    env: &Env,
    issuer: Address,
    ids: Vec<BytesN<32>>,
    reason: Symbol,
) {
    issuer.require_auth();
    assert!(ids.len() <= 50, "batch too large: max 50 credential IDs per call");

    // Validate the whole batch before writing anything so the operation stays
    // atomic: no partial revocations are persisted on failure.
    for id in ids.iter() {
        let key = cred_key(&id);
        let cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .expect("credential not found");
        assert_eq!(cred.issuer, issuer, "only the issuer can revoke");
        assert!(!cred.revoked, "credential already revoked");
    }

    // Bitmap revocation is done in a single batched call for gas efficiency.
    revocation_registry::revoke_batch(env, &issuer, &ids, reason.clone());

    for id in ids.iter() {
        let key = cred_key(&id);
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .expect("credential not found");
        cred.revoked = true;
        env.storage().persistent().set(&key, &cred);
        env.events().publish(
            (CRED, symbol_short!("revoked")),
            (id, issuer.clone(), reason.clone()),
        );
    }
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
