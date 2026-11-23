//! Cross-contract credential verification (#1139). Wraps the credential
//! manager's `verify_credential` / `get_credential` entrypoints so other
//! contracts get a simple boolean answer instead of a trapping call.
use crate::{DataKey, ExtError};
use soroban_sdk::{Address, BytesN, Env, IntoVal, Symbol, Val, Vec};

fn manager(env: &Env) -> Result<Address, ExtError> {
    env.storage()
        .instance()
        .get(&DataKey::CredentialManager)
        .ok_or(ExtError::VerifierNotConfigured)
}

fn args(env: &Env, credential_id: &BytesN<32>) -> Vec<Val> {
    let mut v = Vec::new(env);
    v.push_back(credential_id.into_val(env));
    v
}

pub fn is_valid(env: &Env, credential_id: &BytesN<32>) -> Result<bool, ExtError> {
    let cm = manager(env)?;
    let res = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &cm,
        &Symbol::new(env, "verify_credential"),
        args(env, credential_id),
    );
    Ok(matches!(res, Ok(Ok(()))))
}

pub fn verify_for_subject(
    env: &Env,
    credential_id: &BytesN<32>,
    subject: &Address,
) -> Result<bool, ExtError> {
    if !is_valid(env, credential_id)? {
        return Ok(false);
    }
    let cm = manager(env)?;
    let mut ids = Vec::new(env);
    ids.push_back(subject.into_val(env));
    let held: Vec<BytesN<32>> = env.invoke_contract(
        &cm,
        &Symbol::new(env, "get_subject_credentials"),
        ids,
    );
    Ok(held.contains(credential_id))
}
