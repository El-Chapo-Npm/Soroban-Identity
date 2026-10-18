use soroban_sdk::{symbol_short, Address, Env, Vec};
use crate::keys::{ADMIN, ISSUER};

pub fn initialize(env: &Env, admin: Address) {
    if env.storage().instance().has(&ADMIN) {
        panic!("already initialized");
    }
    env.storage().instance().set(&ADMIN, &admin);
}

pub fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&ADMIN).expect("not initialized");
    admin.require_auth();
}

pub fn get_issuers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&ISSUER)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn require_issuer(env: &Env, issuer: &Address) {
    if !get_issuers(env).contains(issuer) {
        panic!("not a registered issuer");
    }
}

pub fn add_issuer(env: &Env, issuer: Address) {
    require_admin(env);
    let mut issuers = get_issuers(env);
    if !issuers.contains(&issuer) {
        issuers.push_back(issuer.clone());
        env.storage().instance().set(&ISSUER, &issuers);
        env.events().publish((ISSUER, symbol_short!("added")), issuer);
    }
}

pub fn remove_issuer(env: &Env, issuer: Address) {
    require_admin(env);
    let issuers = get_issuers(env);
    let mut updated = Vec::new(env);
    for i in issuers.iter() {
        if i != issuer {
            updated.push_back(i);
        }
    }
    env.storage().instance().set(&ISSUER, &updated);
}

/// Returns true if the given credential type is allowed to be transferred.
/// Issuer-scoped transfer policy: only a whitelist of credential types may be
/// transferred between addresses.
pub fn is_transferable_type(env: &Env, credential_type: u32) -> bool {
    let allowed: Vec<u32> = env
        .storage()
        .instance()
        .get(&symbol_short!("tr_types"))
        .unwrap_or_else(|| Vec::new(env));
    allowed.contains(&credential_type)
}

/// Sets the whitelist of credential types that may be transferred.
/// Admin-only.
pub fn set_transferable_types(env: &Env, types: Vec<u32>) {
    require_admin(env);
    env.storage()
        .instance()
        .set(&symbol_short!("tr_types"), &types);
    env.events()
        .publish((ISSUER, symbol_short!("tr_pol")), types);
}

/// Enforces the issuer-scoped transfer policy for a credential type.
/// Panics if the credential type is not allowed to be transferred.
pub fn require_transferable_type(env: &Env, credential_type: u32) {
    if !is_transferable_type(env, credential_type) {
        panic!("credential type not transferable");
    }
}

/// Validates that `caller` is the issuer of the credential identified by
/// `credential_id`, requiring the caller's authorization. Used before
/// confirming or rejecting a pending transfer.
pub fn require_credential_issuer(env: &Env, credential_id: u64, caller: &Address) {
    let issuer: Address = env
        .storage()
        .persistent()
        .get(&(symbol_short!("iss"), credential_id))
        .expect("credential not found");
    if &issuer != caller {
        panic!("caller is not the credential issuer");
    }
    caller.require_auth();
}

/// Records the issuer for a credential so that issuer-scoped checks can be
/// performed during the transfer flow.
pub fn set_credential_issuer(env: &Env, credential_id: u64, issuer: Address) {
    env.storage()
        .persistent()
        .set(&(symbol_short!("iss"), credential_id), &issuer);
}

/// Returns the issuer recorded for a credential, if any.
pub fn get_credential_issuer(env: &Env, credential_id: u64) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&(symbol_short!("iss"), credential_id))
}