//! Oracle integration (#1134). A trusted oracle (e.g. a Chainlink-style
//! relayer contract or account) posts attestations about off-chain
//! credential data; consumers accept them only while fresh.
use crate::{require_admin, DataKey, ExtError};
use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OracleConfig {
    pub oracle: Address,
    /// Maximum report age in seconds; 0 disables the staleness check.
    pub max_staleness: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OracleReport {
    pub credential_id: BytesN<32>,
    /// Hash of the off-chain data the oracle checked.
    pub data_hash: BytesN<32>,
    pub verified: bool,
    pub reported_at: u64,
}

pub fn set_oracle(env: &Env, oracle: Address, max_staleness: u64) -> Result<(), ExtError> {
    require_admin(env)?;
    env.storage()
        .instance()
        .set(&DataKey::Oracle, &OracleConfig { oracle, max_staleness });
    Ok(())
}

pub fn get_oracle(env: &Env) -> Option<OracleConfig> {
    env.storage().instance().get(&DataKey::Oracle)
}

pub fn submit_report(
    env: &Env,
    credential_id: BytesN<32>,
    data_hash: BytesN<32>,
    verified: bool,
) -> Result<(), ExtError> {
    let cfg = get_oracle(env).ok_or(ExtError::OracleNotConfigured)?;
    cfg.oracle.require_auth();
    let report = OracleReport {
        credential_id: credential_id.clone(),
        data_hash,
        verified,
        reported_at: env.ledger().timestamp(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::OracleReport(credential_id.clone()), &report);
    env.events()
        .publish((symbol_short!("oracle"), credential_id), verified);
    Ok(())
}

pub fn get_report(env: &Env, credential_id: &BytesN<32>) -> Option<OracleReport> {
    env.storage()
        .persistent()
        .get(&DataKey::OracleReport(credential_id.clone()))
}

pub fn is_verified(env: &Env, credential_id: &BytesN<32>) -> Result<bool, ExtError> {
    let cfg = get_oracle(env).ok_or(ExtError::OracleNotConfigured)?;
    let report = get_report(env, credential_id).ok_or(ExtError::OracleDataNotFound)?;
    let now = env.ledger().timestamp();
    if cfg.max_staleness != 0 && now.saturating_sub(report.reported_at) > cfg.max_staleness {
        return Err(ExtError::OracleDataStale);
    }
    Ok(report.verified)
}
