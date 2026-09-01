#![no_std]
#![deny(clippy::all)]

//! Reputation contract — on-chain activity scoring and anti-sybil signals.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Symbol, Vec,
};

pub const CONTRACT_VERSION: u32 = 1;
const EVENT_VERSION: u32 = 1;

/// Default rate-limit window (in ledgers) used when the contract is initialized.
pub const DEFAULT_MIN_INTERVAL: u32 = 100;
/// Lowest value an admin may configure the rate-limit window to.
pub const MIN_INTERVAL_FLOOR: u32 = 10;
/// Highest value an admin may configure the rate-limit window to.
pub const MIN_INTERVAL_CEILING: u32 = 50_000;

// Aliases used by tests and the fuzz harness (#780).
pub const DEFAULT_RATE_LIMIT_WINDOW: u32 = DEFAULT_MIN_INTERVAL;
pub const MIN_RATE_LIMIT_WINDOW: u32 = MIN_INTERVAL_FLOOR;
pub const MAX_RATE_LIMIT_WINDOW: u32 = MIN_INTERVAL_CEILING;

const MIN_SCORE: i64 = 0;
const TTL_MAX: u32 = 6_312_000;
const MAX_HISTORY: usize = 50;
const PAGE_CAP: u32 = 100;
/// Maximum number of submissions in a single batch_submit_score call.
pub const MAX_BATCH_SIZE: u32 = 20;
/// Seconds a dispute remains open before it expires automatically (~1 day).
const DISPUTE_WINDOW_SECS: u64 = 86_400;

/// Ledgers a dispute remains open before it expires automatically (~1 day at 5s/ledger).
const DISPUTE_WINDOW_LEDGERS: u32 = 17_280;

// ── Score decay (#657) ───────────────────────────────────────────────────────

/// Seconds in one decay period ("day") used by [`Reputation::set_decay_rate`]
/// and [`Reputation::set_reporter_decay_rate`].
const DECAY_PERIOD_SECS: u64 = 86_400;
/// Decay rate is expressed in basis points (1/10000) removed per elapsed
/// period; 10_000 = 100% decay per period.
const MAX_DECAY_RATE_BPS: u32 = 10_000;
/// Caps the exponential-decay compounding loop so a very old, never-touched
/// record can't blow the view-call instruction budget.
const MAX_DECAY_PERIODS: u64 = 3_650;

mod keys;

// ── Storage key symbols ───────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const PENDING_ADMIN: Symbol = symbol_short!("PADMIN");
const REPORTER: Symbol = symbol_short!("REPORTER");
const DEF_THRESH: Symbol = symbol_short!("DEFTHRESH");
const SUBJECT_CNT: Symbol = symbol_short!("SUBCNT");
const SCORE_CNT: Symbol = symbol_short!("SCRCNT");
const RECORD: Symbol = symbol_short!("rec");
const HISTORY: Symbol = symbol_short!("h");
const RATE_LIMIT: Symbol = symbol_short!("rl");
/// Storage key prefix for dispute records.
const DISPUTE: Symbol = symbol_short!("dispute");
/// Global dispute ID counter.
const DISPUTE_CNT: Symbol = symbol_short!("disp_cnt");
const PAUSED: Symbol = symbol_short!("PAUSED");
/// Storage key for the configurable rate-limit window (in ledgers).
const MIN_INTERVAL_KEY: Symbol = symbol_short!("rl_win");
/// Storage key for the global default decay configuration.
const DECAY_CFG: Symbol = symbol_short!("DECAYCFG");
/// Storage key prefix for per-reporter decay configuration overrides.
const RPT_DECAY: Symbol = symbol_short!("RPTDECAY");
/// Storage key prefix for the most recent reporter to score each subject.
const LAST_RPT: Symbol = symbol_short!("LASTRPT");

// ── Error codes ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ContractError {
    AlreadyInitialized     = 1,
    ReporterNotFound       = 2,
    RateLimitExceeded      = 3,
    ReasonTooLong          = 4,
    NotInitialized         = 5,
    Unauthorized           = 6,
    InvalidHistoryIndex    = 7,
    NoPendingAdmin         = 8,
    NotPendingAdmin        = 9,
    DisputeNotFound        = 10,
    DisputeExpired         = 11,
    DisputeAlreadyResolved = 12,
    DisputeAlreadyOpen     = 13,
    InvalidMinInterval     = 14,
    ContractPaused         = 15,
    /// Issue #733: batch too large.
    BatchTooLarge          = 16,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationStorageStats {
    pub total_subjects: u32,
    pub total_score_entries: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationRecord {
    pub subject: Address,
    pub score: i64,
    pub reporter_count: u32,
    pub updated_at: u64,
}

/// How a score decays toward zero as time passes since `updated_at`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum DecayMode {
    /// Removes a fixed fraction of the *original* score per elapsed period.
    Linear,
    /// Removes a fixed fraction of the *remaining* score per elapsed period
    /// (compounding), so the score approaches — but never quite reaches — zero.
    Exponential,
}

/// A decay rate plus the curve it's applied with. See [`Reputation::set_decay_rate`]
/// and [`Reputation::set_reporter_decay_rate`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DecayConfig {
    /// Basis points (1/10000) of decay applied per [`DECAY_PERIOD_SECS`] elapsed.
    pub rate_bps: u32,
    pub mode: DecayMode,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DefaultThreshold {
    pub min_score: i64,
    pub min_reporters: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreEntry {
    pub reporter: Address,
    pub delta: i64,
    pub reason: soroban_sdk::String,
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreEntriesPage {
    pub items: Vec<ScoreEntry>,
    pub next_cursor: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReportersPage {
    pub items: Vec<Address>,
    pub next_cursor: Option<u64>,
}

/// A single score submission entry used in [`Reputation::batch_submit_score`] (#733).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchScoreEntry {
    pub subject: Address,
    pub delta: i64,
    pub reason: soroban_sdk::String,
}

/// A dispute record opened by a subject against a reporter's score delta.
///
/// Keyed by `(DISPUTE, subject, reporter, delta_index)`. At most one dispute
/// may be open per key at a time — see [`Reputation::dispute_score`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Dispute {
    /// Monotonically increasing global dispute ID.
    pub dispute_id: u32,
    pub subject: Address,
    pub reporter: Address,
    /// Zero-based index of the disputed entry in the (subject, reporter) history.
    pub delta_index: u32,
    /// The delta value that was disputed (snapshot at dispute-open time).
    pub delta: i64,
    /// Ledger sequence number when the dispute was opened.
    pub opened_at: u32,
    /// `true` once the dispute has been accepted or rejected by the admin.
    pub resolved: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Reputation;

#[contractimpl]
impl Reputation {
    pub fn ping(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// One-time initialization. Stores `admin` and seeds the configurable
    /// rate-limit window with [`DEFAULT_MIN_INTERVAL`].
    ///
    /// Closes #580: `rate_limit_window` is now stored at init time and is
    /// live-updatable via [`Self::set_min_interval`].
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_uninitialized(&env)?;
        Self::set_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&MIN_INTERVAL_KEY, &DEFAULT_MIN_INTERVAL);
        env.events().publish(
            (ADMIN, symbol_short!("init")),
            (EVENT_VERSION, admin),
        );
        Ok(())
    }

    /// Returns the current rate-limit window in ledgers.
    ///
    /// Closes #580.
    pub fn get_min_interval(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&MIN_INTERVAL_KEY)
            .unwrap_or(DEFAULT_MIN_INTERVAL)
    }

    /// Alias for `get_min_interval` — used by tests and the fuzz harness (#780).
    pub fn get_rate_limit_window(env: Env) -> u32 {
        Self::get_min_interval(env)
    }

    /// Updates the rate-limit window (admin only).
    ///
    /// Returns [`ContractError::InvalidMinInterval`] if `ledgers` is outside
    /// [[`MIN_INTERVAL_FLOOR`], [`MIN_INTERVAL_CEILING`]].
    ///
    /// Closes #580.
    pub fn set_min_interval(
        env: Env,
        admin: Address,
        ledgers: u32,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        if ledgers < MIN_INTERVAL_FLOOR || ledgers > MIN_INTERVAL_CEILING {
            return Err(ContractError::InvalidMinInterval);
        }
        env.storage().instance().set(&MIN_INTERVAL_KEY, &ledgers);
        env.events().publish(
            (MIN_INTERVAL_KEY, symbol_short!("updated")),
            (EVENT_VERSION, admin, ledgers),
        );
        Ok(())
    }

    /// Alias for `set_min_interval` — used by tests and the fuzz harness (#780).
    pub fn set_rate_limit_window(
        env: Env,
        admin: Address,
        ledgers: u32,
    ) -> Result<(), ContractError> {
        Self::set_min_interval(env, admin, ledgers)
    }

    pub fn propose_admin(
        env: Env,
        admin: Address,
        proposed: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage().instance().set(&PENDING_ADMIN, &proposed);
        env.events().publish(
            (ADMIN, symbol_short!("proposed")),
            (EVENT_VERSION, admin, proposed),
        );
        Ok(())
    }

    pub fn accept_admin(env: Env, proposed: Address) -> Result<(), ContractError> {
        proposed.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&PENDING_ADMIN)
            .ok_or(ContractError::NoPendingAdmin)?;
        if pending != proposed {
            return Err(ContractError::NotPendingAdmin);
        }
        env.storage().instance().remove(&PENDING_ADMIN);
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        env.storage().instance().set(&ADMIN, &proposed);
        env.events().publish(
            (ADMIN, symbol_short!("accepted")),
            (EVENT_VERSION, old_admin, proposed),
        );
        Ok(())
    }

    pub fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        current_admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != current_admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage().instance().set(&ADMIN, &new_admin);
        env.events().publish(
            (ADMIN, symbol_short!("transfer")),
            (EVENT_VERSION, current_admin, new_admin),
        );
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != admin {
            return Err(ContractError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &true);
        env.events().publish((symbol_short!("contract"), symbol_short!("paused")), EVENT_VERSION);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &false);
        env.events().publish((symbol_short!("contract"), symbol_short!("unpaused")), EVENT_VERSION);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    pub fn add_reporter(env: Env, reporter: Address) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        let mut reporters = Self::get_reporters(&env);
        if !reporters.contains(&reporter) {
            reporters.push_back(reporter.clone());
            env.storage().instance().set(&REPORTER, &reporters);
            env.events().publish(
                (REPORTER, symbol_short!("added")),
                (EVENT_VERSION, reporter, env.ledger().timestamp()),
            );
        }
        Ok(())
    }

    pub fn remove_reporter(env: Env, reporter: Address) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
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
            (EVENT_VERSION, reporter, env.ledger().timestamp()),
        );
        Ok(())
    }

    pub fn update_thresholds(
        env: Env,
        min_score: i64,
        min_reporters: u32,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DEF_THRESH, &DefaultThreshold { min_score, min_reporters });
        env.events().publish(
            (symbol_short!("THRESH"), symbol_short!("updated")),
            (EVENT_VERSION, min_score, min_reporters),
        );
        Ok(())
    }

    pub fn set_default_threshold(
        env: Env,
        min_score: i64,
        min_reporters: u32,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DEF_THRESH, &DefaultThreshold { min_score, min_reporters });
        Ok(())
    }

    // ── Score decay (#657) ────────────────────────────────────────────────────

    /// Sets the contract-wide default decay rate (admin only); `rate_bps` is
    /// basis points removed per elapsed day, `0` disables decay (the default).
    pub fn set_decay_rate(env: Env, admin: Address, rate_bps: u32, mode: DecayMode) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        if rate_bps > MAX_DECAY_RATE_BPS {
            return Err(ContractError::InvalidDecayRate);
        }
        let cfg = DecayConfig { rate_bps, mode };
        env.storage().instance().set(&DECAY_CFG, &cfg);
        env.events().publish(
            (DECAY_CFG, symbol_short!("updated")),
            (EVENT_VERSION, admin, rate_bps),
        );
        Ok(())
    }

    /// Returns the current contract-wide default decay configuration.
    pub fn get_decay_rate(env: Env) -> DecayConfig {
        Self::default_decay_config(&env)
    }

    /// Sets a decay-rate override for one reporter (admin only), used when
    /// that reporter made a subject's most recent `submit_score` call.
    pub fn set_reporter_decay_rate(
        env: Env,
        admin: Address,
        reporter: Address,
        rate_bps: u32,
        mode: DecayMode,
    ) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        if rate_bps > MAX_DECAY_RATE_BPS {
            return Err(ContractError::InvalidDecayRate);
        }
        let key = (RPT_DECAY, reporter.clone());
        env.storage().persistent().set(&key, &DecayConfig { rate_bps, mode });
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        env.events().publish(
            (RPT_DECAY, symbol_short!("updated")),
            (EVENT_VERSION, admin, reporter, rate_bps),
        );
        Ok(())
    }

    /// Removes a reporter's decay-rate override (admin only).
    pub fn clear_reporter_decay_rate(env: Env, admin: Address, reporter: Address) -> Result<(), ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        env.storage().persistent().remove(&(RPT_DECAY, reporter.clone()));
        env.events().publish(
            (RPT_DECAY, symbol_short!("cleared")),
            (EVENT_VERSION, admin, reporter),
        );
        Ok(())
    }

    /// Returns the effective decay configuration for `reporter` — its own
    /// override if one is set, otherwise the contract-wide default.
    pub fn get_reporter_decay_rate(env: Env, reporter: Address) -> DecayConfig {
        Self::decay_config_for_reporter(&env, &reporter)
    }

    pub fn submit_score(
        env: Env,
        reporter: Address,
        subject: Address,
        delta: i64,
        reason: soroban_sdk::String,
    ) -> Result<(), ContractError> {
        reporter.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_reporter(&env, &reporter)?;
        if reason.len() > 256 {
            return Err(ContractError::ReasonTooLong);
        }
        Self::check_and_set_rate_limit(&env, &subject, &reporter)?;

        let now = env.ledger().timestamp();
        let rec_key = Self::record_key(&subject);
        let history_key = Self::history_key(&subject, &reporter);

        // Issue #667: Add score entry to history BEFORE updating the record
        // This ensures the history is atomically updated even if the record update races
        let mut history: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        let is_new_reporter = history.is_empty();

        if history.len() >= MAX_HISTORY as u32 {
            history.remove(0);
        }
        history.push_back(ScoreEntry {
            reporter: reporter.clone(),
            delta,
            reason,
            submitted_at: now,
        });

        // Atomically write history first (this is the primary source of truth)
        env.storage().persistent().set(&history_key, &history);
        env.storage()
            .persistent()
            .extend_ttl(&history_key, TTL_MAX, TTL_MAX);

        // Now update the aggregate record
        // Issue #667: Recompute score from all reporter histories to handle race conditions
        let existing_record: Option<ReputationRecord> =
            env.storage().persistent().get(&rec_key);
        let is_new_subject = existing_record.is_none();

        // Compute the authoritative score by summing all reporter contributions
        // This avoids the race condition where concurrent submissions overwrite each other
        let mut computed_score: i64 = 0;
        let mut reporter_count: u32 = 0;
        let all_reporters = Self::get_reporters(&env);

        for rep in all_reporters.iter() {
            let rep_history_key = Self::history_key(&subject, &rep);
            if env.storage().persistent().has(&rep_history_key) {
                reporter_count += 1;
                let rep_history: Vec<ScoreEntry> = env
                    .storage()
                    .persistent()
                    .get(&rep_history_key)
                    .unwrap_or_else(|| Vec::new(&env));
                for entry in rep_history.iter() {
                    // Saturating add prevents overflow on extreme deltas (e.g. i64::MIN / i64::MAX).
                    // Clamp to MIN_SCORE (0) after each step so the running total never goes negative.
                    computed_score = computed_score.saturating_add(entry.delta).clamp(MIN_SCORE, i64::MAX);
                }
            }
        }

        let mut record: ReputationRecord =
            existing_record.unwrap_or(ReputationRecord {
                subject: subject.clone(),
                score: 0,
                reporter_count: 0,
                updated_at: now,
            });

        record.score = computed_score;
        record.reporter_count = reporter_count;
        record.updated_at = now;

        env.storage().persistent().set(&rec_key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&rec_key, TTL_MAX, TTL_MAX);

        // Update subject count only on first submission
        if is_new_subject {
            let cnt: u32 = env
                .storage()
                .instance()
                .get(&SUBJECT_CNT)
                .unwrap_or(0);
            env.storage().instance().set(&SUBJECT_CNT, &(cnt + 1));
        }

        // Note: SCORE_CNT is intentionally NOT incremented atomically as it's just a stat
        // Issue #667: Removed non-atomic SCORE_CNT increment to prevent similar race conditions

        env.events().publish(
            (symbol_short!("SCORE"), symbol_short!("updated")),
            (EVENT_VERSION, reporter, subject, delta),
        );
        Ok(())
    }

    /// Returns the subject's reputation record with `score` decayed for time
    /// elapsed since `updated_at`; the stored raw score is untouched. With no
    /// decay configured (the default) this is the raw accumulated score.
    pub fn get_reputation(env: Env, subject: Address) -> ReputationRecord {
        let key = Self::record_key(&subject);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        let mut record: ReputationRecord =
            env.storage().persistent().get(&key).unwrap_or(ReputationRecord {
                subject: subject.clone(),
                score: 0,
                reporter_count: 0,
                updated_at: 0,
            });
        record.score = Self::decayed_score(&env, &record);
        record
    }

    pub fn get_history(
        env: Env,
        subject: Address,
        reporter: Address,
        offset: u32,
        limit: u32,
        from_timestamp: Option<u64>,
        to_timestamp: Option<u64>,
    ) -> Result<Vec<ScoreEntry>, ContractError> {
        if !Self::get_reporters(&env).contains(&reporter) {
            return Err(ContractError::ReporterNotFound);
        }
        let key = Self::history_key(&subject, &reporter);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        let all: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        // Apply timestamp filters
        let mut filtered = Vec::new(&env);
        for entry in all.iter() {
            let matches_from = match from_timestamp {
                Some(from) => entry.submitted_at >= from,
                None => true,
            };
            let matches_to = match to_timestamp {
                Some(to) => entry.submitted_at <= to,
                None => true,
            };
            if matches_from && matches_to {
                filtered.push_back(entry);
            }
        }

        // Apply offset/limit pagination
        let effective_limit = if limit == 0 || limit > 100 { 100 } else { limit };
        let len = filtered.len();
        let start = offset.min(len);
        let end = (start + effective_limit).min(len);
        let mut page = Vec::new(&env);
        for i in start..end {
            page.push_back(filtered.get(i).unwrap());
        }
        Ok(page)
    }

    // ── Disputes (#591) ───────────────────────────────────────────────────────

    /// Opens a dispute against a specific score entry.
    ///
    /// The caller (`subject`) must sign the transaction. At most one dispute
    /// may be open per `(subject, reporter, delta_index)` at a time.
    ///
    /// Emits a `dispute_filed` event.
    ///
    /// # Errors
    /// - [`ContractError::ReporterNotFound`] if `reporter` is not registered.
    /// - [`ContractError::InvalidHistoryIndex`] if `delta_index` is out of bounds.
    /// - [`ContractError::DisputeAlreadyOpen`] if a dispute is already open for this entry.
    ///
    /// Closes #591.
    pub fn dispute_score(
        env: Env,
        subject: Address,
        reporter: Address,
        delta_index: u32,
    ) -> Result<u32, ContractError> {
        subject.require_auth();
        Self::require_not_paused(&env)?;
        if !Self::get_reporters(&env).contains(&reporter) {
            return Err(ContractError::ReporterNotFound);
        }

        let history_key = Self::history_key(&subject, &reporter);
        let history: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));
        if delta_index >= history.len() {
            return Err(ContractError::InvalidHistoryIndex);
        }

        let dispute_key = Self::dispute_key(&subject, &reporter, delta_index);
        if env.storage().persistent().has(&dispute_key) {
            let existing: Dispute = env
                .storage()
                .persistent()
                .get(&dispute_key)
                .unwrap();
            if !existing.resolved {
                return Err(ContractError::DisputeAlreadyOpen);
            }
        }

        let entry = history.get(delta_index).unwrap();
        let dispute_id: u32 = env
            .storage()
            .instance()
            .get(&DISPUTE_CNT)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DISPUTE_CNT, &dispute_id);

        let dispute = Dispute {
            dispute_id,
            subject: subject.clone(),
            reporter: reporter.clone(),
            delta_index,
            delta: entry.delta,
            opened_at: env.ledger().sequence(),
            resolved: false,
        };
        env.storage().persistent().set(&dispute_key, &dispute);
        env.storage()
            .persistent()
            .extend_ttl(&dispute_key, TTL_MAX, TTL_MAX);

        // Emit dispute_filed event
        env.events().publish(
            (DISPUTE, symbol_short!("filed")),
            (EVENT_VERSION, dispute_id, subject, reporter, delta_index),
        );
        Ok(dispute_id)
    }

    /// Resolves an open dispute (admin only).
    ///
    /// When `accepted` is `true`, the disputed delta is reversed from the
    /// subject's aggregated score and removed from history. When `false`, the
    /// dispute is closed with no state change.
    ///
    /// Emits a `dispute_resolved` event.
    ///
    /// # Errors
    /// - [`ContractError::DisputeNotFound`] if no dispute exists for this key.
    /// - [`ContractError::DisputeAlreadyResolved`] if already resolved.
    /// - [`ContractError::DisputeExpired`] if past the [`DISPUTE_WINDOW_LEDGERS`] window.
    ///
    /// Closes #591.
    pub fn resolve_dispute(
        env: Env,
        subject: Address,
        reporter: Address,
        delta_index: u32,
        accepted: bool,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env)?;

        let dispute_key = Self::dispute_key(&subject, &reporter, delta_index);
        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&dispute_key)
            .ok_or(ContractError::DisputeNotFound)?;

        if dispute.resolved {
            return Err(ContractError::DisputeAlreadyResolved);
        }
        if env.ledger().sequence() > dispute.opened_at + DISPUTE_WINDOW_LEDGERS {
            return Err(ContractError::DisputeExpired);
        }

        let now = env.ledger().timestamp();
        if accepted {
            let now = env.ledger().timestamp();
            let history_key = Self::history_key(&subject, &reporter);
            let mut history: Vec<ScoreEntry> = env
                .storage()
                .persistent()
                .get(&history_key)
                .unwrap_or_else(|| Vec::new(&env));

            if delta_index < history.len() {
                let disputed_delta = history.get(delta_index).unwrap().delta;
                history.remove(delta_index);
                let now = env.ledger().timestamp();

                let rec_key = Self::record_key(&subject);
                let mut record: ReputationRecord =
                    env.storage().persistent().get(&rec_key).unwrap_or(
                        ReputationRecord {
                            subject: subject.clone(),
                            score: 0,
                            reporter_count: 0,
                            updated_at: now,
                        },
                    );
                record.score = record
                    .score
                    .saturating_sub(disputed_delta)
                    .max(MIN_SCORE);
                record.updated_at = now;

                if history.is_empty() {
                    record.reporter_count =
                        record.reporter_count.saturating_sub(1);
                    env.storage().persistent().remove(&history_key);
                } else {
                    env.storage().persistent().set(&history_key, &history);
                    env.storage().persistent().extend_ttl(&history_key, TTL_MAX, TTL_MAX);
                }

                env.storage().persistent().set(&rec_key, &record);
                env.storage()
                    .persistent()
                    .extend_ttl(&rec_key, TTL_MAX, TTL_MAX);
            }
        }

        dispute.resolved = true;
        env.storage().persistent().set(&dispute_key, &dispute);

        // Emit dispute_resolved event
        env.events().publish(
            (DISPUTE, symbol_short!("resolved")),
            (EVENT_VERSION, dispute.dispute_id, subject, reporter, delta_index, accepted),
        );
        Ok(())
    }

    // ── Anti-sybil ────────────────────────────────────────────────────────────

    pub fn passes_sybil_check(
        env: Env,
        subject: Address,
        min_score: i64,
        min_reporters: u32,
    ) -> bool {
        let key = Self::record_key(&subject);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
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
                let active_reporters = Self::get_reporters(&env);
                let mut active_count = 0u32;
                for r in active_reporters.iter() {
                    let hk = Self::history_key(&subject, &r);
                    if env.storage().persistent().has(&hk) {
                        env.storage()
                            .persistent()
                            .extend_ttl(&hk, TTL_MAX, TTL_MAX);
                        active_count += 1;
                    }
                }
                active_count >= min_reporters
            }
        }
    }

    pub fn passes_sybil_check_default(
        env: Env,
        subject: Address,
    ) -> Result<bool, ContractError> {
        let threshold: DefaultThreshold = env
            .storage()
            .instance()
            .get(&DEF_THRESH)
            .ok_or(ContractError::NotInitialized)?;
        let key = Self::record_key(&subject);
        match env
            .storage()
            .persistent()
            .get::<(Symbol, Address), ReputationRecord>(&key)
        {
            None => Ok(false),
            Some(rec) => Ok(
                rec.score >= threshold.min_score
                    && rec.reporter_count >= threshold.min_reporters,
            ),
        }
    }

    // ── List / pagination helpers ─────────────────────────────────────────────

    pub fn get_reporters_list(env: Env) -> Vec<Address> {
        Self::get_reporters(&env)
    }

    pub fn list_reporters(
        env: Env,
        cursor: Option<u64>,
        limit: u32,
    ) -> ReportersPage {
        let all = Self::get_reporters(&env);
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 =
            if limit == 0 || limit > PAGE_CAP { PAGE_CAP } else { limit };
        let mut items: Vec<Address> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total { Some(next) } else { None };
        ReportersPage { items, next_cursor }
    }

    pub fn list_history(
        env: Env,
        subject: Address,
        reporter: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> Result<ScoreEntriesPage, ContractError> {
        if !Self::get_reporters(&env).contains(&reporter) {
            return Err(ContractError::ReporterNotFound);
        }
        let key = Self::history_key(&subject, &reporter);
        let all: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 =
            if limit == 0 || limit > PAGE_CAP { PAGE_CAP } else { limit };
        let mut items: Vec<ScoreEntry> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total { Some(next) } else { None };
        Ok(ScoreEntriesPage { items, next_cursor })
    }

    pub fn get_storage_stats(env: Env) -> ReputationStorageStats {
        ReputationStorageStats {
            total_subjects: env
                .storage()
                .instance()
                .get(&SUBJECT_CNT)
                .unwrap_or(0),
            total_score_entries: env
                .storage()
                .instance()
                .get(&SCORE_CNT)
                .unwrap_or(0),
        }
    }

    // ── Issue #733: batch reputation score submission ─────────────────────────

    /// Submit score deltas for multiple subjects in a single transaction.
    ///
    /// Capped at [`MAX_BATCH_SIZE`] (20) entries. The same rate-limit and
    /// reason-length checks that apply to [`Self::submit_score`] are enforced
    /// per entry. If any entry fails (e.g. rate-limited, reason too long, or
    /// reporter not registered) the **entire** batch is rejected — no partial
    /// writes occur.
    ///
    /// # Errors
    /// - [`ContractError::BatchTooLarge`] – more than `MAX_BATCH_SIZE` entries.
    /// - Any error that [`Self::submit_score`] can return, applied to the
    ///   first failing entry.
    pub fn batch_submit_score(
        env: Env,
        reporter: Address,
        entries: Vec<BatchScoreEntry>,
    ) -> Result<(), ContractError> {
        reporter.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_reporter(&env, &reporter)?;

        if entries.len() > MAX_BATCH_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        // Pre-validate all entries before writing any state (fail-fast, no partial writes).
        for entry in entries.iter() {
            if entry.reason.len() > 256 {
                return Err(ContractError::ReasonTooLong);
            }
            // Rate-limit check (read-only — does not advance the window).
            Self::check_rate_limit_readonly(&env, &entry.subject, &reporter)?;
        }

        // All entries valid — write state.
        for entry in entries.iter() {
            Self::apply_score_entry(&env, &reporter, &entry.subject, entry.delta, entry.reason.clone())?;
        }

        env.events().publish(
            (symbol_short!("SCORE"), symbol_short!("batch")),
            (EVENT_VERSION, reporter, entries.len()),
        );
        Ok(())
    }

    fn require_uninitialized(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(ContractError::AlreadyInitialized);
        }
        Ok(())
    }

    fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&ADMIN, admin);
    }

    fn require_admin(env: &Env) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    /// Like [`Self::require_admin`], but also checks that the caller-supplied
    /// `admin` matches the stored admin address (not just that *some* address
    /// authorized the call) — used by functions that take `admin` explicitly.
    fn require_admin_caller(env: &Env, admin: &Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if &stored != admin {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    fn require_reporter(env: &Env, reporter: &Address) -> Result<(), ContractError> {
        if !Self::get_reporters(env).contains(reporter) {
            return Err(ContractError::ReporterNotFound);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().get(&PAUSED).unwrap_or(false) {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    fn get_reporters(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&REPORTER)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn record_key(subject: &Address) -> (Symbol, Address) {
        (RECORD, subject.clone())
    }

    fn last_reporter_key(subject: &Address) -> (Symbol, Address) {
        (LAST_RPT, subject.clone())
    }

    fn default_decay_config(env: &Env) -> DecayConfig {
        env.storage()
            .instance()
            .get(&DECAY_CFG)
            .unwrap_or(DecayConfig { rate_bps: 0, mode: DecayMode::Linear })
    }

    fn decay_config_for_reporter(env: &Env, reporter: &Address) -> DecayConfig {
        let key = (RPT_DECAY, reporter.clone());
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Self::default_decay_config(env))
    }

    /// Applies decay to `record.score` for the time elapsed since
    /// `record.updated_at`, using the decay override of the reporter behind
    /// the subject's most recent `submit_score` call, if any (else the
    /// contract-wide default). Never negative; a no-op when the resolved
    /// rate is `0` (the default) or no time has passed.
    fn decayed_score(env: &Env, record: &ReputationRecord) -> i64 {
        if record.score <= 0 {
            return record.score.max(MIN_SCORE);
        }
        let now = env.ledger().timestamp();
        if now <= record.updated_at {
            return record.score;
        }
        let elapsed_periods = (now - record.updated_at) / DECAY_PERIOD_SECS;
        if elapsed_periods == 0 {
            return record.score;
        }
        let last_reporter: Option<Address> =
            env.storage().persistent().get(&Self::last_reporter_key(&record.subject));
        let cfg = match last_reporter {
            Some(reporter) => Self::decay_config_for_reporter(env, &reporter),
            None => Self::default_decay_config(env),
        };
        if cfg.rate_bps == 0 {
            return record.score;
        }
        let periods = elapsed_periods.min(MAX_DECAY_PERIODS);
        let raw = record.score as i128;
        let bps = cfg.rate_bps.min(MAX_DECAY_RATE_BPS) as i128;
        match cfg.mode {
            DecayMode::Linear => {
                let total_bps = (bps * periods as i128).min(MAX_DECAY_RATE_BPS as i128);
                let reduction = raw * total_bps / (MAX_DECAY_RATE_BPS as i128);
                (raw - reduction).max(0) as i64
            }
            DecayMode::Exponential => {
                let retain_bps = MAX_DECAY_RATE_BPS as i128 - bps;
                let mut value = raw;
                for _ in 0..periods {
                    value = value * retain_bps / (MAX_DECAY_RATE_BPS as i128);
                    if value <= 0 {
                        return 0;
                    }
                }
                value as i64
            }
        }
    }

    fn history_key(subject: &Address, reporter: &Address) -> (Symbol, Address, Address) {
        (HISTORY, subject.clone(), reporter.clone())
    }

    fn rate_key(subject: &Address, reporter: &Address) -> (Symbol, Address, Address) {
        (RATE_LIMIT, subject.clone(), reporter.clone())
    }

    fn dispute_key(
        subject: &Address,
        reporter: &Address,
        delta_index: u32,
    ) -> (Symbol, Address, Address, u32) {
        (DISPUTE, subject.clone(), reporter.clone(), delta_index)
    }

    /// Checks the rate limit for (subject, reporter) and records the current
    /// ledger sequence on success. Uses the admin-configurable window stored
    /// under [`MIN_INTERVAL_KEY`].
    fn check_and_set_rate_limit(
        env: &Env,
        subject: &Address,
        reporter: &Address,
    ) -> Result<(), ContractError> {
        let rate_key = Self::rate_key(subject, reporter);
        let current_ledger = env.ledger().sequence();
        let min_interval: u32 = env
            .storage()
            .instance()
            .get(&MIN_INTERVAL_KEY)
            .unwrap_or(DEFAULT_MIN_INTERVAL);
        if let Some(last_ledger) = env
            .storage()
            .persistent()
            .get::<(Symbol, Address, Address), u32>(&rate_key)
        {
            if current_ledger <= last_ledger + min_interval {
                return Err(ContractError::RateLimitExceeded);
            }
        }
        env.storage().persistent().set(&rate_key, &current_ledger);
        env.storage()
            .persistent()
            .extend_ttl(&rate_key, TTL_MAX, TTL_MAX);
        Ok(())
    }

    /// Read-only rate-limit check used for pre-validation in batch operations.
    /// Does **not** advance the rate-limit window; call `check_and_set_rate_limit`
    /// when the entry is actually written.
    fn check_rate_limit_readonly(
        env: &Env,
        subject: &Address,
        reporter: &Address,
    ) -> Result<(), ContractError> {
        let rate_key = Self::rate_key(subject, reporter);
        let current_ledger = env.ledger().sequence();
        let min_interval: u32 = env
            .storage()
            .instance()
            .get(&MIN_INTERVAL_KEY)
            .unwrap_or(DEFAULT_MIN_INTERVAL);
        if let Some(last_ledger) = env
            .storage()
            .persistent()
            .get::<(Symbol, Address, Address), u32>(&rate_key)
        {
            if current_ledger <= last_ledger + min_interval {
                return Err(ContractError::RateLimitExceeded);
            }
        }
        Ok(())
    }

    /// Core score-application logic shared by `submit_score` and `batch_submit_score`.
    /// The caller is responsible for auth and pre-validation (reason length, rate limit).
    fn apply_score_entry(
        env: &Env,
        reporter: &Address,
        subject: &Address,
        delta: i64,
        reason: soroban_sdk::String,
    ) -> Result<(), ContractError> {
        // Advance the rate-limit window for this (subject, reporter) pair.
        Self::check_and_set_rate_limit(env, subject, reporter)?;

        let now = env.ledger().timestamp();
        let rec_key = Self::record_key(subject);
        let history_key = Self::history_key(subject, reporter);

        let mut history: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(env));

        if history.len() >= MAX_HISTORY as u32 {
            history.remove(0);
        }
        history.push_back(ScoreEntry {
            reporter: reporter.clone(),
            delta,
            reason,
            submitted_at: now,
        });

        env.storage().persistent().set(&history_key, &history);
        env.storage().persistent().extend_ttl(&history_key, TTL_MAX, TTL_MAX);

        let existing_record: Option<ReputationRecord> = env.storage().persistent().get(&rec_key);
        let is_new_subject = existing_record.is_none();

        let mut computed_score: i64 = 0;
        let mut reporter_count: u32 = 0;
        let all_reporters = Self::get_reporters(env);

        for rep in all_reporters.iter() {
            let rep_history_key = Self::history_key(subject, &rep);
            if env.storage().persistent().has(&rep_history_key) {
                reporter_count += 1;
                let rep_history: Vec<ScoreEntry> = env
                    .storage()
                    .persistent()
                    .get(&rep_history_key)
                    .unwrap_or_else(|| Vec::new(env));
                for entry in rep_history.iter() {
                    // Saturating add prevents overflow on extreme deltas (e.g. i64::MIN / i64::MAX).
                    // Clamp to MIN_SCORE (0) after each step so the running total never goes negative.
                    computed_score = computed_score.saturating_add(entry.delta).clamp(MIN_SCORE, i64::MAX);
                }
            }
        }

        let mut record: ReputationRecord = existing_record.unwrap_or(ReputationRecord {
            subject: subject.clone(),
            score: 0,
            reporter_count: 0,
            updated_at: now,
        });

        record.score = computed_score;
        record.reporter_count = reporter_count;
        record.updated_at = now;

        env.storage().persistent().set(&rec_key, &record);
        env.storage().persistent().extend_ttl(&rec_key, TTL_MAX, TTL_MAX);

        if is_new_subject {
            let cnt: u32 = env.storage().instance().get(&SUBJECT_CNT).unwrap_or(0);
            env.storage().instance().set(&SUBJECT_CNT, &(cnt + 1));
        }

        env.events().publish(
            (symbol_short!("SCORE"), symbol_short!("updated")),
            (EVENT_VERSION, reporter.clone(), subject.clone(), delta),
        );
        Ok(())
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

    fn setup() -> (Env, Address, ReputationClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, Reputation);
        let client = ReputationClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_double_initialize_returns_error() {
        let (_env, admin, client) = setup();
        assert_eq!(
            client.try_initialize(&admin),
            Err(Ok(ContractError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_score_accumulation() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "completed KYC");
        client.submit_score(&reporter, &subject, &50, &reason);
        env.ledger().with_mut(|li| li.sequence_number += DEFAULT_RATE_LIMIT_WINDOW + 1);
        client.submit_score(&reporter, &subject, &25, &reason);
        let rec = client.get_reputation(&subject);
        assert_eq!(rec.score, 75);
        assert_eq!(rec.reporter_count, 1);
    }

    #[test]
    fn test_score_floor_at_zero() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "penalty");
        client.submit_score(&reporter, &subject, &-100, &reason);
        assert_eq!(client.get_reputation(&subject).score, 0);
    }

    #[test]
    fn test_sybil_check() {
        let (env, _admin, client) = setup();
        let reporter1 = Address::generate(&env);
        let reporter2 = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter1);
        client.add_reporter(&reporter2);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter1, &subject, &40, &reason);
        client.submit_score(&reporter2, &subject, &40, &reason);
        assert!(client.passes_sybil_check(&subject, &50, &2));
        assert!(!client.passes_sybil_check(&subject, &50, &3));
    }

    #[test]
    fn test_submit_score_rate_limit() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "first");
        client.submit_score(&reporter, &subject, &10, &reason);
        assert_eq!(
            client.try_submit_score(&reporter, &subject, &10, &reason),
            Err(Ok(ContractError::RateLimitExceeded))
        );
        env.ledger().with_mut(|li| li.sequence_number += 101);
        client.submit_score(&reporter, &subject, &10, &reason);
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
        client.transfer_admin(&attacker, &new_admin);
    }

    // ── #591: dispute mechanism ───────────────────────────────────────────────

    #[test]
    fn test_dispute_score_and_resolve_accepted() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &50, &reason);

        let dispute_id = client.dispute_score(&subject, &reporter, &0);
        assert_eq!(dispute_id, 1);

        let score_before = client.get_reputation(&subject).score;
        client.resolve_dispute(&subject, &reporter, &0, &true);
        let score_after = client.get_reputation(&subject).score;
        assert!(score_after < score_before);

        let history = client.get_history(&subject, &reporter, &0, &10, &None, &None);
        assert_eq!(history.len(), 0);

        // Resolved dispute cannot be reopened at same index (no entry left, index OOB)
        let result = client.try_dispute_score(&subject, &reporter, &0);
        assert_eq!(result, Err(Ok(ContractError::InvalidHistoryIndex)));
    }

    #[test]
    fn test_dispute_score_and_resolve_rejected() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &40, &reason);

        client.dispute_score(&subject, &reporter, &0);
        client.resolve_dispute(&subject, &reporter, &0, &false);

        let rec = client.get_reputation(&subject);
        assert_eq!(rec.score, 40);
        assert_eq!(rec.reporter_count, 1);
    }

    #[test]
    fn test_dispute_score_rejects_duplicate_open() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &40, &reason);
        client.dispute_score(&subject, &reporter, &0);
        assert_eq!(
            client.try_dispute_score(&subject, &reporter, &0),
            Err(Ok(ContractError::DisputeAlreadyOpen))
        );
    }

    #[test]
    fn test_dispute_score_invalid_index() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        assert_eq!(
            client.try_dispute_score(&subject, &reporter, &0),
            Err(Ok(ContractError::InvalidHistoryIndex))
        );
    }

    #[test]
    fn test_resolve_dispute_already_resolved() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "reason");
        client.submit_score(&reporter, &subject, &20, &reason);
        client.dispute_score(&subject, &reporter, &0);
        client.resolve_dispute(&subject, &reporter, &0, &false);
        assert_eq!(
            client.try_resolve_dispute(&subject, &reporter, &0, &false),
            Err(Ok(ContractError::DisputeAlreadyResolved))
        );
    }

    #[test]
    fn test_resolve_dispute_expired() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "reason");
        client.submit_score(&reporter, &subject, &20, &reason);
        client.dispute_score(&subject, &reporter, &0);
        env.ledger()
            .with_mut(|li| li.sequence_number += DISPUTE_WINDOW_LEDGERS + 1);
        assert_eq!(
            client.try_resolve_dispute(&subject, &reporter, &0, &true),
            Err(Ok(ContractError::DisputeExpired))
        );
    }

    // ── #580: configurable rate-limit window ──────────────────────────────────

    #[test]
    fn test_default_rate_limit_window_used_on_init() {
        let (_env, _admin, client) = setup();
        assert_eq!(client.get_min_interval(), DEFAULT_MIN_INTERVAL);
    }

    #[test]
    fn test_admin_can_change_min_interval() {
        let (env, admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        client.set_min_interval(&admin, &20);
        assert_eq!(client.get_min_interval(), 20);

        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &10, &reason);

        // Still within shorter window — rejected
        env.ledger().with_mut(|li| li.sequence_number += 15);
        assert_eq!(
            client.try_submit_score(&reporter, &subject, &10, &reason),
            Err(Ok(ContractError::RateLimitExceeded))
        );

        // Past the new window — accepted
        env.ledger().with_mut(|li| li.sequence_number += 300);
        client.submit_score(&reporter, &subject, &10, &reason);
    }

    #[test]
    fn test_set_min_interval_floor_enforced() {
        let (_env, admin, client) = setup();
        assert_eq!(
            client.try_set_min_interval(&admin, &(MIN_INTERVAL_FLOOR - 1)),
            Err(Ok(ContractError::InvalidMinInterval))
        );
    }

    #[test]
    fn test_set_min_interval_ceiling_enforced() {
        let (_env, admin, client) = setup();
        assert_eq!(
            client.try_set_min_interval(&admin, &(MIN_INTERVAL_CEILING + 1)),
            Err(Ok(ContractError::InvalidMinInterval))
        );
    }

    #[test]
    fn test_set_min_interval_boundary_values_allowed() {
        let (_env, admin, client) = setup();
        client.set_min_interval(&admin, &MIN_INTERVAL_FLOOR);
        assert_eq!(client.get_min_interval(), MIN_INTERVAL_FLOOR);
        client.set_min_interval(&admin, &MIN_INTERVAL_CEILING);
        assert_eq!(client.get_min_interval(), MIN_INTERVAL_CEILING);
    }

    #[test]
    fn test_set_min_interval_unauthorized() {
        let (env, _admin, client) = setup();
        let attacker = Address::generate(&env);
        assert_eq!(
            client.try_set_min_interval(&attacker, &500),
            Err(Ok(ContractError::Unauthorized))
        );
    }

    #[test]
    fn test_reputation_score_overflow_saturates_at_max() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "large_score");
        client.submit_score(&reporter, &subject, &i64::MAX, &reason);
        assert_eq!(client.get_reputation(&subject).score, i64::MAX);

        // Advance past rate limit and add another positive score
        env.ledger().with_mut(|li| li.sequence_number += 150);
        client.submit_score(&reporter, &subject, &100, &reason);
        // Does not overflow to negative; saturates safely at i64::MAX
        assert_eq!(client.get_reputation(&subject).score, i64::MAX);
    }

    #[test]
    fn test_remove_reporter_updates_sybil_check() {
        let (env, _admin, client) = setup();
        let reporter1 = Address::generate(&env);
        let reporter2 = Address::generate(&env);
        let reporter3 = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter1);
        client.add_reporter(&reporter2);
        client.add_reporter(&reporter3);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter1, &subject, &40, &reason);
        client.submit_score(&reporter2, &subject, &40, &reason);
        client.submit_score(&reporter3, &subject, &40, &reason);
        assert!(client.passes_sybil_check(&subject, &50, &3));
        client.remove_reporter(&reporter2);
        assert!(!client.passes_sybil_check(&subject, &50, &3));
        assert!(client.passes_sybil_check(&subject, &50, &2));
    }

    #[test]
    fn test_get_history_unknown_reporter() {
        let (env, _admin, client) = setup();
        let subject = Address::generate(&env);
        let unknown = Address::generate(&env);
        assert_eq!(
            client.try_get_history(&subject, &unknown, &0, &10, &None, &None),
            Err(Ok(ContractError::ReporterNotFound))
        );
    }

    #[test]
    fn test_get_history_with_timestamp_filters() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "activity");

        env.ledger().with_mut(|li| li.timestamp = 1000);
        client.submit_score(&reporter, &subject, &10, &reason);
        env.ledger().with_mut(|li| { li.sequence_number += 101; li.timestamp = 2000; });
        client.submit_score(&reporter, &subject, &20, &reason);
        env.ledger().with_mut(|li| { li.sequence_number += 101; li.timestamp = 3000; });
        client.submit_score(&reporter, &subject, &30, &reason);

        let filtered = client.get_history(&subject, &reporter, &0, &100, &Some(1500), &None);
        assert_eq!(filtered.len(), 2);

        let filtered = client.get_history(&subject, &reporter, &0, &100, &None, &Some(2500));
        assert_eq!(filtered.len(), 2);

        let filtered = client.get_history(&subject, &reporter, &0, &100, &Some(1500), &Some(2500));
        assert_eq!(filtered.len(), 1);

        let all = client.get_history(&subject, &reporter, &0, &100, &None, &None);
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn test_list_reporters_paginates() {
        let (env, _admin, client) = setup();
        for _ in 0..3 {
            client.add_reporter(&Address::generate(&env));
        }
        let page1 = client.list_reporters(&None, &2);
        assert_eq!(page1.items.len(), 2);
        assert_eq!(page1.next_cursor, Some(2));
        let page2 = client.list_reporters(&page1.next_cursor, &2);
        assert_eq!(page2.items.len(), 1);
        assert_eq!(page2.next_cursor, None);
    }

    #[test]
    fn test_storage_key_symbols_are_unique() {
        let keys = [
            ADMIN, REPORTER, DEF_THRESH, SUBJECT_CNT, SCORE_CNT,
            RECORD, HISTORY, RATE_LIMIT, DISPUTE, DISPUTE_CNT, MIN_INTERVAL_KEY,
            DECAY_CFG, RPT_DECAY,
        ];
        for (i, left) in keys.iter().enumerate() {
            for right in keys.iter().skip(i + 1) {
                assert_ne!(left, right);
            }
        }
    }

    #[test]
    fn test_pause_blocks_submit_allows_reads() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "completed KYC");
        client.submit_score(&reporter, &subject, &50, &reason);

        assert!(!client.is_paused());
        client.pause();
        assert!(client.is_paused());

        env.ledger().with_mut(|li| li.sequence_number += 101);
        assert_eq!(
            client.try_submit_score(&reporter, &subject, &25, &reason),
            Err(Ok(ContractError::ContractPaused))
        );

        let rec = client.get_reputation(&subject);
        assert_eq!(rec.score, 50);

        client.unpause();
        assert!(!client.is_paused());
        client.submit_score(&reporter, &subject, &25, &reason);
        assert_eq!(client.get_reputation(&subject).score, 75);
    }

    // ── Score decay (#657) ─────────────────────────────────────────────────────

    #[test]
    fn test_no_decay_by_default() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &100, &reason);

        env.ledger().with_mut(|li| li.timestamp += 30 * 86_400);
        assert_eq!(client.get_reputation(&subject).score, 100);
    }

    #[test]
    fn test_linear_decay_reduces_score_over_time() {
        let (env, admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        client.set_decay_rate(&admin, &1_000, &DecayMode::Linear); // 10%/day
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &100, &reason);

        env.ledger().with_mut(|li| li.timestamp += 2 * 86_400); // 2 days -> 20% off
        assert_eq!(client.get_reputation(&subject).score, 80);
    }

    #[test]
    fn test_exponential_decay_compounds_differently_than_linear() {
        let (env, admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        client.set_decay_rate(&admin, &1_000, &DecayMode::Exponential); // 10%/day compounding
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &100, &reason);

        env.ledger().with_mut(|li| li.timestamp += 2 * 86_400);
        // 100 -> 90 (day 1) -> 81 (day 2), strictly above linear's 80.
        assert_eq!(client.get_reputation(&subject).score, 81);
    }

    #[test]
    fn test_decay_floors_at_zero_and_never_negative() {
        let (env, admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        client.set_decay_rate(&admin, &5_000, &DecayMode::Linear); // 50%/day
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &100, &reason);

        env.ledger().with_mut(|li| li.timestamp += 10 * 86_400); // way past 100%
        assert_eq!(client.get_reputation(&subject).score, 0);
    }

    #[test]
    fn test_decayed_read_does_not_mutate_stored_raw_score() {
        let (env, admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);
        client.set_decay_rate(&admin, &1_000, &DecayMode::Linear);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &100, &reason);

        env.ledger().with_mut(|li| li.timestamp += 2 * 86_400);
        assert_eq!(client.get_reputation(&subject).score, 80);

        // A fresh submission accumulates on the raw (undecayed) stored score,
        // not the decayed value just read.
        env.ledger().with_mut(|li| li.sequence_number += 101);
        client.submit_score(&reporter, &subject, &10, &reason);
        assert_eq!(client.get_reputation(&subject).score, 110);
    }

    #[test]
    fn test_reporter_decay_override_takes_precedence_over_default() {
        let (env, admin, client) = setup();
        let fast_reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&fast_reporter);

        client.set_decay_rate(&admin, &0, &DecayMode::Linear); // default: no decay
        client.set_reporter_decay_rate(&admin, &fast_reporter, &5_000, &DecayMode::Linear); // 50%/day

        let reason = String::from_str(&env, "activity");
        client.submit_score(&fast_reporter, &subject, &100, &reason);

        env.ledger().with_mut(|li| li.timestamp += 86_400);
        // Uses fast_reporter's override, not the zero default.
        assert_eq!(client.get_reputation(&subject).score, 50);
    }

    #[test]
    fn test_clear_reporter_decay_rate_reverts_to_default() {
        let (env, admin, client) = setup();
        let reporter = Address::generate(&env);
        let subject = Address::generate(&env);
        client.add_reporter(&reporter);

        client.set_reporter_decay_rate(&admin, &reporter, &5_000, &DecayMode::Linear);
        client.clear_reporter_decay_rate(&admin, &reporter);
        assert_eq!(client.get_reporter_decay_rate(&reporter), client.get_decay_rate());

        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &subject, &100, &reason);
        env.ledger().with_mut(|li| li.timestamp += 86_400);
        // Default rate is 0, so no decay after clearing the override.
        assert_eq!(client.get_reputation(&subject).score, 100);
    }

    #[test]
    fn test_set_decay_rate_rejects_rate_over_100_percent() {
        let (_env, admin, client) = setup();
        assert_eq!(
            client.try_set_decay_rate(&admin, &10_001, &DecayMode::Linear),
            Err(Ok(ContractError::InvalidDecayRate))
        );
    }

    #[test]
    fn test_set_decay_rate_rejects_non_admin() {
        let (env, _admin, client) = setup();
        let attacker = Address::generate(&env);
        assert_eq!(
            client.try_set_decay_rate(&attacker, &1_000, &DecayMode::Linear),
            Err(Ok(ContractError::Unauthorized))
        );
    }

    #[test]
    fn test_set_reporter_decay_rate_rejects_non_admin() {
        let (env, _admin, client) = setup();
        let attacker = Address::generate(&env);
        let reporter = Address::generate(&env);
        assert_eq!(
            client.try_set_reporter_decay_rate(&attacker, &reporter, &1_000, &DecayMode::Linear),
            Err(Ok(ContractError::Unauthorized))
        );
    }
}
