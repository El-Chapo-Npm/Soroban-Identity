use soroban_sdk::{contracttype, Address, BytesN, Env, Map, String, Symbol, Vec};

pub const MAX_VERSION_HISTORY: u32 = 20;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialVersion {
    pub version: u32,
    pub claims: Map<String, String>,
    pub claims_hash: BytesN<32>,
    pub amended_at: u64,
    pub amended_by: Address,
    pub reason: String,
    pub change_summary: String,
}

pub fn summarize_claim_changes(
    env: &Env,
    previous: &Map<String, String>,
    next: &Map<String, String>,
) -> String {
    let mut changed = 0u32;
    let mut added = 0u32;
    let mut removed = 0u32;

    for (key, value) in next.iter() {
        match previous.get(key.clone()) {
            Some(prev_value) => {
                if prev_value != value {
                    changed += 1;
                }
            }
            None => added += 1,
        }
    }

    for (key, _) in previous.iter() {
        if next.get(key.clone()).is_none() {
            removed += 1;
        }
    }

    if added == 0 && changed == 0 && removed == 0 {
        return String::from_str(env, "no_claim_changes");
    }

    let total = added + changed + removed;
    if total == 1 {
        String::from_str(env, "claims_updated")
    } else {
        String::from_str(env, "claims_updated")
    }
}
