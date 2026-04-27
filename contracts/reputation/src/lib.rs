#![no_std]

//! Reputation contract — on-chain activity scoring and anti-sybil signals.
//!
//! Trusted reporters (e.g. dApps, oracles) submit score deltas for a subject.
//! The contract accumulates a total score and tracks per-reporter contributions
//! so scores can be audited or disputed.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    Symbol, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const REPORTER: Symbol = symbol_short!("REPORTER");
const DEF_THRESH: Symbol = symbol_short!("DEFTHRESH");
const SUBJECT_CNT: Symbol = symbol_short!("SUBCNT");
const SCORE_CNT: Symbol = symbol_short!("SCRCNT");

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    AlreadyInitialized = 1,
    ReporterNotFound = 2,
    RateLimitExceeded = 3,
    ReasonTooLong = 4,
}

/// Minimum ledger interval between submissions from the same reporter for the same subject.
const MIN_INTERVAL: u32 = 100;

// ── Data types ────────────────────────────────────────────────────────────────

/// Storage usage statistics for the reputation contract.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationStorageStats {
    pub total_subjects: u32,
    pub total_score_entries: u32,
}

/// Aggregated reputation record for a subject.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationRecord {
    pub subject: Address,
    /// Total accumulated score (can be negative)
    pub score: i64,
    /// Number of distinct reporters that have submitted
    pub reporter_count: u32,
    /// Last update timestamp
    pub updated_at: u64,
}

/// Stored default sybil threshold set by the admin.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DefaultThreshold {
    pub min_score: i64,
    pub min_reporters: u32,
}

/// A single score submission from a reporter.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreEntry {
    pub reporter: Address,
    pub delta: i64,
    pub reason: soroban_sdk::String,
    pub submitted_at: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Reputation;

#[contractimpl]
impl Reputation {
    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        Ok(())
    }

    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        if stored != current_admin {
            panic!("not the admin");
        }
        env.storage().instance().set(&ADMIN, &new_admin);
        env.events().publish(
            (ADMIN, symbol_short!("transfer")),
            (current_admin, new_admin),
        );
    }

    /// Upgrade the contract WASM. Only the admin can call this.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        if stored != admin {
            panic!("not the admin");
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn add_reporter(env: Env, reporter: Address) {
        Self::require_admin(&env);
        let mut reporters = Self::get_reporters(&env);
        if !reporters.contains(&reporter) {
            reporters.push_back(reporter.clone());
            env.storage().instance().set(&REPORTER, &reporters);
            env.events().publish(
                (REPORTER, symbol_short!("added")),
                (reporter, env.ledger().timestamp()),
            );
        }
    }

    pub fn remove_reporter(env: Env, reporter: Address) {
        Self::require_admin(&env);
        let reporters = Self::get_reporters(&env);
        let mut updated = Vec::new(&env);
        for r in reporters.iter() {
            if r != reporter {
                updated.push_back(r);
            }
        }
        env.storage().instance().set(&REPORTER, &updated);
        env.events().publish(
            (REPORTER, symbol_short!("removed")),
            (reporter, env.ledger().timestamp()),
        );
    }

    /// Set the default sybil threshold (admin only).
    pub fn set_default_threshold(env: Env, min_score: i64, min_reporters: u32) {
        Self::require_admin(&env);
        env.storage().instance().set(
            &DEF_THRESH,
            &DefaultThreshold {
                min_score,
                min_reporters,
            },
        );
    }

    /// Anti-sybil check using the stored default threshold.
    pub fn passes_sybil_check_default(env: Env, subject: Address) -> bool {
        let threshold: DefaultThreshold = env
            .storage()
            .instance()
            .get(&DEF_THRESH)
            .expect("default threshold not set");
        let key = Self::record_key(&subject);
        match env
            .storage()
            .persistent()
            .get::<(Symbol, Address), ReputationRecord>(&key)
        {
            None => false,
            Some(rec) => {
                rec.score >= threshold.min_score && rec.reporter_count >= threshold.min_reporters
            }
        }
    }

    // ── Scoring ───────────────────────────────────────────────────────────────

    /// Submit a score delta for a subject. Caller must be a registered reporter.
    pub fn submit_score(
        env: Env,
        reporter: Address,
        subject: Address,
        delta: i64,
        reason: soroban_sdk::String,
    ) -> Result<(), ContractError> {
        reporter.require_auth();
        Self::require_reporter(&env, &reporter);

        // Validate reason string length
        if reason.len() > 256 {
            return Err(ContractError::ReasonTooLong);
        }

        // Rate limiting: enforce MIN_INTERVAL ledgers between submissions per (reporter, subject)
        let rate_key = Self::rate_key(&subject, &reporter);
        let current_ledger = env.ledger().sequence();
        if let Some(last_ledger) = env
            .storage()
            .persistent()
            .get::<(Symbol, Address, Address), u32>(&rate_key)
        {
            if current_ledger <= last_ledger + MIN_INTERVAL {
                return Err(ContractError::RateLimitExceeded);
            }
        }
        env.storage().persistent().set(&rate_key, &current_ledger);

        let now = env.ledger().timestamp();
        let rec_key = Self::record_key(&subject);
        let existing_record: Option<ReputationRecord> = env.storage().persistent().get(&rec_key);
        let is_new_subject = existing_record.is_none();
        let mut record: ReputationRecord = existing_record.unwrap_or(ReputationRecord {
            subject: subject.clone(),
            score: 0,
            reporter_count: 0,
            updated_at: now,
        });

        record.score = record.score.saturating_add(delta).max(0);
        record.updated_at = now;

        // Track whether this reporter is new for this subject
        let history_key = Self::history_key(&subject, &reporter);
        let is_new = !env.storage().persistent().has(&history_key);
        if is_new {
            record.reporter_count = record.reporter_count.saturating_add(1);
        }

        // Track new subject
        if is_new_subject {
            let cnt: u32 = env.storage().instance().get(&SUBJECT_CNT).unwrap_or(0);
            env.storage().instance().set(&SUBJECT_CNT, &(cnt + 1));
        }

        env.storage().persistent().set(&rec_key, &record);

        // Append to per-reporter history
        let mut history: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        history.push_back(ScoreEntry {
            reporter: reporter.clone(),
            delta,
            reason,
            submitted_at: now,
        });
        env.storage().persistent().set(&history_key, &history);

        // Increment total score entries counter
        let score_cnt: u32 = env.storage().instance().get(&SCORE_CNT).unwrap_or(0);
        env.storage().instance().set(&SCORE_CNT, &(score_cnt + 1));

        env.events().publish(
            (symbol_short!("SCORE"), symbol_short!("updated")),
            (reporter, subject, delta),
        );

        Ok(())
    }

    /// Get the reputation record for a subject.
    pub fn get_reputation(env: Env, subject: Address) -> ReputationRecord {
        let key = Self::record_key(&subject);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(ReputationRecord {
                subject: subject.clone(),
                score: 0,
                reporter_count: 0,
                updated_at: 0,
            })
    }

    /// Get score history submitted by a specific reporter for a subject.
    ///
    /// `offset` — number of entries to skip (0-based).
    /// `limit`  — maximum number of entries to return (capped at 100).
    pub fn get_history(
        env: Env,
        subject: Address,
        reporter: Address,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<ScoreEntry>, ContractError> {
        if !Self::get_reporters(&env).contains(&reporter) {
            return Err(ContractError::ReporterNotFound);
        }

        let key = Self::history_key(&subject, &reporter);
        let all: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let cap: u32 = 100;
        let effective_limit = if limit == 0 || limit > cap {
            cap
        } else {
            limit
        };
        let len = all.len();
        let start = offset.min(len);
        let end = (start + effective_limit).min(len);

        let mut page = Vec::new(&env);
        for i in start..end {
            page.push_back(all.get(i).unwrap());
        }
        Ok(page)
    }

    /// Simple anti-sybil check: returns true if score >= threshold AND
    /// at least `min_reporters` distinct active reporters have contributed.
    pub fn passes_sybil_check(
        env: Env,
        subject: Address,
        min_score: i64,
        min_reporters: u32,
    ) -> bool {
        let key = Self::record_key(&subject);
        match env
            .storage()
            .persistent()
            .get::<(Symbol, Address), ReputationRecord>(&key)
        {
            None => false,
            Some(rec) => {
                if rec.score < min_score {
                    return false;
                }
                // Count active reporters that have contributed to this subject
                let active_reporters = Self::get_reporters(&env);
                let mut active_count = 0u32;
                for reporter in active_reporters.iter() {
                    let history_key = Self::history_key(&subject, &reporter);
                    if env.storage().persistent().has(&history_key) {
                        active_count += 1;
                    }
                }
                active_count >= min_reporters
            }
        }
    }

    /// Get the list of all registered reporters.
    pub fn get_reporters_list(env: Env) -> Vec<Address> {
        Self::get_reporters(&env)
    }

    /// Get storage usage statistics.
    pub fn get_storage_stats(env: Env) -> ReputationStorageStats {
        ReputationStorageStats {
            total_subjects: env.storage().instance().get(&SUBJECT_CNT).unwrap_or(0),
            total_score_entries: env.storage().instance().get(&SCORE_CNT).unwrap_or(0),
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_reporter(env: &Env, reporter: &Address) {
        if !Self::get_reporters(env).contains(reporter) {
            panic!("not a registered reporter");
        }
    }

    fn get_reporters(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&REPORTER)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn record_key(subject: &Address) -> (Symbol, Address) {
        (symbol_short!("rec"), subject.clone())
    }

    fn history_key(subject: &Address, reporter: &Address) -> (Symbol, Address, Address) {
        (symbol_short!("h"), subject.clone(), reporter.clone())
    }

    fn rate_key(subject: &Address, reporter: &Address) -> (Symbol, Address, Address) {
        (symbol_short!("rl"), subject.clone(), reporter.clone())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    #[test]
    fn test_double_initialize_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let result = client.try_initialize(&admin);
        assert_eq!(result, Err(Ok(ContractError::AlreadyInitialized)));
    }

    #[test]
    fn test_score_accumulation() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        let reason = String::from_str(&env, "completed KYC");
        client.submit_score(&reporter, &subject, &50, &reason);
        env.ledger().with_mut(|li| li.sequence_number += 101);
        client.submit_score(&reporter, &subject, &25, &reason);

        let rec = client.get_reputation(&subject);
        assert_eq!(rec.score, 75);
        assert_eq!(rec.reporter_count, 1); // same reporter
    }

    #[test]
    fn test_get_history_pagination() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        // Submit 5 entries (advance ledger between each to bypass rate limit)
        for i in 0..5_i64 {
            let reason = String::from_str(&env, "reason");
            client.submit_score(&reporter, &subject, &i, &reason);
            env.ledger().with_mut(|li| li.sequence_number += 101);
        }

        // First page: offset=0, limit=2 → entries 0,1
        let page1 = client.get_history(&subject, &reporter, &0, &2);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap().delta, 0);
        assert_eq!(page1.get(1).unwrap().delta, 1);

        // Second page: offset=2, limit=2 → entries 2,3
        let page2 = client.get_history(&subject, &reporter, &2, &2);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().delta, 2);

        // Last page: offset=4, limit=10 → only entry 4 remains
        let page3 = client.get_history(&subject, &reporter, &4, &10);
        assert_eq!(page3.len(), 1);
        assert_eq!(page3.get(0).unwrap().delta, 4);

        // Offset beyond length → empty
        let empty = client.get_history(&subject, &reporter, &99, &10);
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_sybil_check() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter1 = Address::generate(&env);
        let reporter2 = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter1);
        client.add_reporter(&reporter2);

        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter1, &subject, &40, &reason);
        client.submit_score(&reporter2, &subject, &40, &reason);

        // score=80, reporters=2 — should pass
        assert!(client.passes_sybil_check(&subject, &50, &2));
        // requires 3 reporters — should fail
        assert!(!client.passes_sybil_check(&subject, &50, &3));
    }

    /// submit_score must panic when the reporter is not registered.
    #[test]
    #[should_panic]
    fn test_submit_score_unauthorized_reporter() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env); // never added as reporter
        let subject = Address::generate(&env);

        client.initialize(&admin);

        let reason = String::from_str(&env, "unauthorized");
        client.submit_score(&reporter, &subject, &10, &reason);
    }

    /// passes_sybil_check returns false when score is below the minimum threshold.
    #[test]
    fn test_sybil_check_score_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &30, &reason);

        // score=30, reporters=1 — passes with matching thresholds
        assert!(client.passes_sybil_check(&subject, &30, &1));
        // score=30 is below min_score=50 — must fail
        assert!(!client.passes_sybil_check(&subject, &50, &1));
    }

    /// passes_sybil_check returns false for a subject with no reputation record at all.
    #[test]
    fn test_sybil_check_no_record() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let subject = Address::generate(&env); // no history
                                               // Even with zero thresholds the contract returns false when no record exists
        assert!(!client.passes_sybil_check(&subject, &0, &0));
    }

    /// Score must never go below 0 regardless of negative deltas.
    #[test]
    fn test_score_floor_at_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        let reason = String::from_str(&env, "penalty");
        client.submit_score(&reporter, &subject, &-9_999_999, &reason);

        let rec = client.get_reputation(&subject);
        assert_eq!(rec.score, 0);
    }

    /// get_history returns only entries submitted by the specified reporter.
    #[test]
    fn test_get_history_per_reporter() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter1 = Address::generate(&env);
        let reporter2 = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter1);
        client.add_reporter(&reporter2);

        let r1 = String::from_str(&env, "reporter1 reason");
        let r2 = String::from_str(&env, "reporter2 reason");
        client.submit_score(&reporter1, &subject, &10, &r1);
        env.ledger().with_mut(|li| li.sequence_number += 101);
        client.submit_score(&reporter1, &subject, &20, &r1);
        client.submit_score(&reporter2, &subject, &99, &r2);

        let h1 = client.get_history(&subject, &reporter1, &0, &10);
        assert_eq!(h1.len(), 2);
        assert_eq!(h1.get(0).unwrap().delta, 10);
        assert_eq!(h1.get(1).unwrap().delta, 20);

        let h2 = client.get_history(&subject, &reporter2, &0, &10);
        assert_eq!(h2.len(), 1);
        assert_eq!(h2.get(0).unwrap().delta, 99);
    }

    #[test]
    fn test_transfer_admin_authorized() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let reporter = Address::generate(&env);

        client.initialize(&admin);
        client.transfer_admin(&admin, &new_admin);
        // new_admin can now add a reporter (mock_all_auths satisfies auth)
        client.add_reporter(&reporter);
    }

    #[test]
    #[should_panic]
    fn test_transfer_admin_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.initialize(&admin);
        // attacker is not the admin — must panic
        client.transfer_admin(&attacker, &new_admin);
    }

    /// get_history returns ReporterNotFound error for unregistered reporter.
    #[test]
    fn test_get_history_unknown_reporter() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let unknown = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        let reason = String::from_str(&env, "test");
        client.submit_score(&reporter, &subject, &10, &reason);

        // Registered reporter should work
        let result = client.get_history(&subject, &reporter, &0, &10);
        assert_eq!(result.len(), 1);

        // Unknown reporter should return error
        let result = client.try_get_history(&subject, &unknown, &0, &10);
        assert_eq!(result, Err(Ok(ContractError::ReporterNotFound)));
    }

    /// submit_score must return RateLimitExceeded when called again within MIN_INTERVAL ledgers.
    #[test]
    fn test_submit_score_rate_limit() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        let reason = String::from_str(&env, "first");
        // First submission succeeds
        client.submit_score(&reporter, &subject, &10, &reason);

        // Second submission in the same ledger must fail
        let result = client.try_submit_score(&reporter, &subject, &10, &reason);
        assert_eq!(result, Err(Ok(ContractError::RateLimitExceeded)));

        // Advance ledger past MIN_INTERVAL (100)
        env.ledger().with_mut(|li| li.sequence_number += 101);

        // Now it should succeed again
        client.submit_score(&reporter, &subject, &10, &reason);
    }

    /// Removing a reporter should decrement reporter_count in passes_sybil_check.
    #[test]
    fn test_remove_reporter_updates_sybil_check() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter1 = Address::generate(&env);
        let reporter2 = Address::generate(&env);
        let reporter3 = Address::generate(&env);
        let subject = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter1);
        client.add_reporter(&reporter2);
        client.add_reporter(&reporter3);

        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter1, &subject, &40, &reason);
        client.submit_score(&reporter2, &subject, &40, &reason);
        client.submit_score(&reporter3, &subject, &40, &reason);

        // All 3 reporters active — should pass with min_reporters=3
        assert!(client.passes_sybil_check(&subject, &50, &3));

        // Remove reporter2
        client.remove_reporter(&reporter2);

        // Now only 2 active reporters — should fail with min_reporters=3
        assert!(!client.passes_sybil_check(&subject, &50, &3));
        // But should pass with min_reporters=2
        assert!(client.passes_sybil_check(&subject, &50, &2));
    }

    /// get_storage_stats returns correct subject and score entry counts.
    #[test]
    fn test_get_storage_stats() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        let subject1 = Address::generate(&env);
        let subject2 = Address::generate(&env);

        client.initialize(&admin);
        client.add_reporter(&reporter);

        let stats = client.get_storage_stats();
        assert_eq!(stats.total_subjects, 0);
        assert_eq!(stats.total_score_entries, 0);

        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject1, &10, &reason);
        env.ledger().with_mut(|li| li.sequence_number += 101);
        client.submit_score(&reporter, &subject1, &20, &reason);
        env.ledger().with_mut(|li| li.sequence_number += 101);
        client.submit_score(&reporter, &subject2, &30, &reason);

        let stats = client.get_storage_stats();
        assert_eq!(stats.total_subjects, 2);
        assert_eq!(stats.total_score_entries, 3);
    }
}
