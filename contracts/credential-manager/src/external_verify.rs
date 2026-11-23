//! Issue #1130: cross-contract credential verification.
//!
//! Whitelisted contracts can verify credentials (single or batch), optionally
//! paying a per-call fee and receiving the result via a callback. Results are
//! cached in temporary storage for a short window to save repeated reads.

use soroban_sdk::{
    contractimpl, contracttype, symbol_short, token, vec, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

use crate::{ContractError, CredentialManager, EVENT_VERSION};

/// Cached verification results live for ~1 hour (5s ledgers).
const CACHE_TTL: u32 = 720;
const MAX_BATCH: u32 = 50;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationFee {
    pub token: Address,
    pub amount: i128,
    pub collector: Address,
}

#[contracttype]
#[derive(Clone)]
enum XvKey {
    Whitelist(Address),
    Fee,
    Cache(BytesN<32>),
}

impl CredentialManager {
    fn xv_check(env: &Env, caller: &Address, count: u32) -> Result<(), ContractError> {
        caller.require_auth();
        if !env.storage().persistent().has(&XvKey::Whitelist(caller.clone())) {
            return Err(ContractError::NotWhitelisted);
        }
        if let Some(fee) = env.storage().instance().get::<_, VerificationFee>(&XvKey::Fee) {
            if fee.amount > 0 {
                token::Client::new(env, &fee.token).transfer(caller, &fee.collector, &(fee.amount * count as i128));
            }
        }
        Ok(())
    }

    fn xv_verify_cached(env: &Env, id: &BytesN<32>) -> bool {
        let key = XvKey::Cache(id.clone());
        if let Some(ok) = env.storage().temporary().get(&key) {
            return ok;
        }
        let ok = Self::verify_credential(env.clone(), id.clone()).is_ok() && !Self::crl_is_revoked(env.clone(), id.clone());
        env.storage().temporary().set(&key, &ok);
        env.storage().temporary().extend_ttl(&key, CACHE_TTL, CACHE_TTL);
        ok
    }
}

#[contractimpl]
impl CredentialManager {
    pub fn set_verifier_whitelisted(env: Env, contract: Address, allowed: bool) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        let key = XvKey::Whitelist(contract.clone());
        if allowed {
            env.storage().persistent().set(&key, &true);
        } else {
            env.storage().persistent().remove(&key);
        }
        env.events().publish((symbol_short!("xv"), symbol_short!("wlist")), (EVENT_VERSION, contract, allowed));
        Ok(())
    }

    pub fn is_verifier_whitelisted(env: Env, contract: Address) -> bool {
        env.storage().persistent().has(&XvKey::Whitelist(contract))
    }

    pub fn set_verification_fee(env: Env, fee: Option<VerificationFee>) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        match fee {
            Some(f) if f.amount < 0 => return Err(ContractError::InvalidInput),
            Some(f) => env.storage().instance().set(&XvKey::Fee, &f),
            None => env.storage().instance().remove(&XvKey::Fee),
        }
        Ok(())
    }

    /// Drop a cached result, e.g. after revocation, so callers see it at once.
    pub fn invalidate_verification_cache(env: Env, credential_id: BytesN<32>) {
        env.storage().temporary().remove(&XvKey::Cache(credential_id));
    }

    pub fn external_verify(env: Env, caller: Address, credential_id: BytesN<32>) -> Result<bool, ContractError> {
        Self::xv_check(&env, &caller, 1)?;
        Ok(Self::xv_verify_cached(&env, &credential_id))
    }

    pub fn external_verify_batch(
        env: Env,
        caller: Address,
        credential_ids: Vec<BytesN<32>>,
    ) -> Result<Vec<bool>, ContractError> {
        if credential_ids.len() > MAX_BATCH {
            return Err(ContractError::BatchTooLarge);
        }
        Self::xv_check(&env, &caller, credential_ids.len())?;
        let mut out = Vec::new(&env);
        for id in credential_ids.iter() {
            out.push_back(Self::xv_verify_cached(&env, &id));
        }
        Ok(out)
    }

    /// Verify and invoke `caller.<callback>(credential_id, result)`.
    pub fn external_verify_callback(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
        callback: Symbol,
    ) -> Result<bool, ContractError> {
        Self::xv_check(&env, &caller, 1)?;
        let ok = Self::xv_verify_cached(&env, &credential_id);
        env.invoke_contract::<()>(&caller, &callback, vec![&env, credential_id.into_val(&env), ok.into_val(&env)]);
        Ok(ok)
    }
}
