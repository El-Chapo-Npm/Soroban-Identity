use soroban_sdk::{symbol_short, Address, Env, Vec};
use crate::keys::{ADMIN, ISSUER};
use crate::roles::{self, Role};
use crate::threshold::{SignedPayload, SignerSet};

/// Maximum number of issuers that may be whitelisted at once.
pub const MAX_ISSUERS: u32 = 64;

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

/// Result-returning admin check for use by the admin API. Returns `Ok(())` if
/// the stored admin has authorized the invocation, otherwise an error.
pub fn try_require_admin(env: &Env) -> Result<(), &'static str> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&ADMIN)
        .ok_or("not initialized")?;
    admin.require_auth();
    Ok(())
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
    if !roles::has_role(env, issuer, Role::Issuer) && !roles::has_role(env, issuer, Role::Owner) {
        panic!("caller lacks issuer role");
    }
}

/// Result-returning issuer check for use by the admin API. Returns `Ok(())`
/// if `issuer` is whitelisted, otherwise an error.
pub fn try_require_issuer(env: &Env, issuer: &Address) -> Result<(), &'static str> {
    if !get_issuers(env).contains(issuer) {
        return Err("not a registered issuer");
    }
    Ok(())
}

/// Adds `issuer` to the whitelist. Admin-only. Returns an error if the issuer
/// is already registered or if the whitelist is at capacity.
pub fn add_issuer(env: &Env, issuer: Address) -> Result<(), &'static str> {
    try_require_admin(env)?;
    let mut issuers = get_issuers(env);
    if issuers.contains(&issuer) {
        return Err("issuer already registered");
    }
    if issuers.len() >= MAX_ISSUERS {
        return Err("issuer whitelist full");
    }
    issuers.push_back(issuer.clone());
    env.storage().instance().set(&ISSUER, &issuers);
    env.events().publish((ISSUER, symbol_short!("added")), issuer);
    Ok(())
}

/// Removes `issuer` from the whitelist. Admin-only. Returns an error if the
/// issuer is not currently registered.
pub fn remove_issuer(env: &Env, issuer: Address) -> Result<(), &'static str> {
    try_require_admin(env)?;
    let issuers = get_issuers(env);
    if !issuers.contains(&issuer) {
        return Err("issuer not registered");
    }
    let mut updated = Vec::new(env);
    for i in issuers.iter() {
        if i != issuer {
            updated.push_back(i);
        }
    }
    env.storage().instance().set(&ISSUER, &updated);
    env.events()
        .publish((ISSUER, symbol_short!("removed")), issuer);
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        initialize(&env, admin.clone());
        (env, admin)
    }

    #[test]
    fn add_issuer_registers_and_emits() {
        let (env, _admin) = setup();
        let issuer = Address::generate(&env);
        assert!(add_issuer(&env, issuer.clone()).is_ok());
        assert!(get_issuers(&env).contains(&issuer));
        assert!(try_require_issuer(&env, &issuer).is_ok());
    }

    #[test]
    fn add_duplicate_issuer_errors() {
        let (env, _admin) = setup();
        let issuer = Address::generate(&env);
        assert!(add_issuer(&env, issuer.clone()).is_ok());
        assert_eq!(
            add_issuer(&env, issuer.clone()),
            Err("issuer already registered")
        );
        assert_eq!(get_issuers(&env).len(), 1);
    }

    #[test]
    fn remove_issuer_unregisters() {
        let (env, _admin) = setup();
        let issuer = Address::generate(&env);
        assert!(add_issuer(&env, issuer.clone()).is_ok());
        assert!(remove_issuer(&env, issuer.clone()).is_ok());
        assert!(!get_issuers(&env).contains(&issuer));
        assert!(try_require_issuer(&env, &issuer).is_err());
    }

    #[test]
    fn remove_nonexistent_issuer_errors() {
        let (env, _admin) = setup();
        let issuer = Address::generate(&env);
        assert_eq!(
            remove_issuer(&env, issuer.clone()),
            Err("issuer not registered")
        );
        assert_eq!(get_issuers(&env).len(), 0);
    }

    #[test]
    fn add_issuer_respects_capacity() {
        let (env, _admin) = setup();
        for _ in 0..MAX_ISSUERS {
            let issuer = Address::generate(&env);
            assert!(add_issuer(&env, issuer).is_ok());
        }
        let extra = Address::generate(&env);
        assert_eq!(add_issuer(&env, extra), Err("issuer whitelist full"));
        assert_eq!(get_issuers(&env).len(), MAX_ISSUERS);
    }
}

/// Returns the current threshold signer set, if one has been configured.
pub fn get_signer_set(env: &Env) -> Option<SignerSet> {
    env.storage().instance().get(&symbol_short!("signers"))
}

/// Stores a new threshold signer set. Admin-only.
pub fn set_signer_set(env: &Env, signer_set: SignerSet) {
    require_admin(env);
    signer_set.validate();
    env.storage()
        .instance()
        .set(&symbol_short!("signers"), &signer_set);
    env.events()
        .publish((ISSUER, symbol_short!("signers")), signer_set.threshold);
}

/// Validates that `payload` carries a valid threshold signature for the
/// currently configured signer set. Panics if no signer set is configured or
/// if the signature fails validation (threshold, weights, expiry, scheme).
pub fn require_threshold(env: &Env, payload: &SignedPayload) {
    let signer_set = get_signer_set(env).expect("signer set not configured");
    signer_set.verify(env, payload);
}

/// Rotates the signer set using guardian-based recovery. The caller must be a
/// registered guardian and must authorize the rotation. The new signer set is
/// validated and stored, replacing the previous one.
pub fn rotate_signers(env: &Env, guardian: Address, new_set: SignerSet) {
    let guardians: Vec<Address> = env
        .storage()
        .instance()
        .get(&symbol_short!("guardian"))
        .unwrap_or_else(|| Vec::new(env));
    if !guardians.contains(&guardian) {
        panic!("not a registered guardian");
    }
    guardian.require_auth();
    new_set.validate();
    env.storage()
        .instance()
        .set(&symbol_short!("signers"), &new_set);
    env.events()
        .publish((ISSUER, symbol_short!("rotated")), new_set.threshold);
}

/// Sets the guardian set used for signer rotation recovery. Admin-only.
pub fn set_guardians(env: &Env, guardians: Vec<Address>) {
    require_admin(env);
    env.storage()
        .instance()
        .set(&symbol_short!("guardian"), &guardians);
    env.events()
        .publish((ISSUER, symbol_short!("guard")), guardians.len());
}