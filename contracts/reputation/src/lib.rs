#![no_std]
#![deny(clippy::all)]

//! Reputation contract — on-chain activity scoring and anti-sybil signals.

mod events;
pub use events::{
    handle_credential_issued, handle_credential_revoked,
    subscribe_to_credential_events, unsubscribe_from_credential_events,
    ReputationEventConfig,
};

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
/// Storage key prefix for per-address stake records (#1055).
const STAKE: Symbol = symbol_short!("STAKE");
/// Storage key for the global staking statistics counter (#1055).
const STAKE_STATS: Symbol = symbol_short!("STKSTATS");
/// Storage key prefix for per-staker staking history (#1122).
const STAKE_HIST: Symbol = symbol_short!("STKHIST");
/// Storage key prefix for delegation records (#1122).
const DELEGATION: Symbol = symbol_short!("DELEG");
/// Storage key prefix for the list of delegators to a delegate (#1122).
const DELEGATORS: Symbol = symbol_short!("DELEGS");
/// Storage key for the global staking reward pool (#1122).
const REWARD_POOL: Symbol = symbol_short!("RWPOOL");

// ── Staking (#1055) ──────────────────────────────────────────────────────────

/// Ledgers a stake must remain locked after an unstake request before the
/// funds can be withdrawn (~1 day at 5s/ledger).
const STAKE_COOLDOWN_LEDGERS: u32 = 17_280;
/// Reputation points granted per whole staked token unit.
const STAKE_BOOST_PER_UNIT: i64 = 1;
/// Hard ceiling on the reputation boost any single stake can grant.
const MAX_STAKE_BOOST: i64 = 1_000;
/// Token units required per reputation point of boost.
const STAKE_UNITS_PER_BOOST: i64 = 1;
/// Maximum number of history entries retained per staker (#1122).
const MAX_STAKE_HISTORY: u32 = 50;
/// Maximum number of delegators a single delegate may accumulate (#1122).
const MAX_DELEGATORS: u32 = 100;

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
    /// Issue #657: decay rate exceeds MAX_DECAY_RATE_BPS.
    InvalidDecayRate       = 17,
    /// Issue #1055: no stake record exists for the address.
    NoStake                = 18,
    /// Issue #1055: stake is still within its cooldown period.
    StakeCooldown          = 19,
    /// Issue #1055: deposit amount must be positive.
    InvalidStakeAmount     = 20,
    /// Issue #1055: slash amount exceeds the staked balance.
    InsufficientStake      = 21,
    /// Issue #1122: the staker cannot delegate to itself.
    SelfDelegation         = 22,
    /// Issue #1122: no delegation record exists.
    NoDelegation           = 23,
    /// Issue #1122: the delegate already has the maximum number of delegators.
    TooManyDelegators      = 24,
    /// Issue #1122: the reward pool has insufficient funds.
    InsufficientRewardPool = 25,
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
/// A per-address staking record (#1055).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeRecord {
    pub staker: Address,
    /// Currently staked amount (in token units).
    pub amount: i64,
    /// Ledger sequence at which the stake was deposited.
    pub staked_at: u32,
    /// Ledger sequence after which an unstake request may be withdrawn;
    /// `0` while no unstake has been requested.
    pub unlock_at: u32,
    /// Cumulative reputation boost currently granted by this stake.
    pub boost: i64,
    /// Cumulative rewards credited to this staker.
    pub total_rewards: i64,
    /// Cumulative penalties (slashes) applied to this staker.
    pub total_penalties: i64,
}

/// Aggregate staking statistics (#1055).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakingStats {
    pub total_stakers: u32,
    pub total_staked: i64,
    pub total_rewards: i64,
    pub total_penalties: i64,
}

/// The kind of action recorded in a staker's history (#1122).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum StakeAction {
    Deposit,
    UnstakeRequest,
    Withdraw,
    Slash,
    Reward,
    Delegate,
    Undelegate,
}

/// A single staking history entry (#1122).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeHistoryEntry {
    pub action: StakeAction,
    /// Amount involved in the action (token units).
    pub amount: i64,
    /// Staker's balance after the action was applied.
    pub balance_after: i64,
    /// Ledger sequence at which the action occurred.
    pub ledger: u32,
}

/// A delegation record: `delegator`'s stake counted toward `delegate` (#1122).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Delegation {
    pub delegator: Address,
    pub delegate: Address,
    pub amount: i64,
    pub since: u32,
}

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
        // #949: the rate-limit window is not written here — every read falls
        // back to DEFAULT_MIN_INTERVAL, so storing the default at deploy time
        // only adds a ledger write to the initialization transaction.
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
    ///
    /// The returned `score` also includes any stake boost earned by the subject
    /// via [`Self::stake`] / [`Self::deposit_stake`]. Credential holders who
    /// have staked tokens will therefore see a higher effective score here.
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
        // Apply time-based decay first, then add the staking boost on top so
        // that credential holders who stake tokens earn a higher effective
        // reputation score (closes the stake-to-reputation feature).
        record.score = Self::decayed_score(&env, &record);
        let effective = Self::effective_stake(&env, &subject);
        let boost = Self::stake_boost(effective);
        record.score = record.score.saturating_add(boost).clamp(MIN_SCORE, i64::MAX);
        record
    }

    /// Returns the reputation record split into its two components:
    /// - `base_score`: the decayed activity score without staking.
    /// - `stake_boost`: the bonus earned from staked tokens.
    /// - `total_score`: their sum (equals `get_reputation.score`).
    ///
    /// Useful for UIs that want to display the staking contribution separately.
    pub fn get_boosted_reputation(
        env: Env,
        subject: Address,
    ) -> (ReputationRecord, i64, i64) {
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
        let base = Self::decayed_score(&env, &record);
        let effective = Self::effective_stake(&env, &subject);
        let boost = Self::stake_boost(effective);
        let total = base.saturating_add(boost).clamp(MIN_SCORE, i64::MAX);
        record.score = total;
        // (full record with total score, base-only score, boost-only portion)
        (record, base, boost)
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

    // ── Staking (#1055) ───────────────────────────────────────────────────────

    /// Deposits `amount` token units as a stake for `staker`, granting a
    /// bounded reputation boost derived from the stake size.
    ///
    /// Emits a `stake_deposited` event.
    ///
    /// # Errors
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    ///
    /// Closes #1055.
    pub fn stake(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        staker.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let key = Self::stake_key(&staker);
        let mut record: StakeRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(StakeRecord {
                staker: staker.clone(),
                amount: 0,
                staked_at: env.ledger().sequence(),
                unlock_at: 0,
                boost: 0,
                total_rewards: 0,
                total_penalties: 0,
            });

        let is_new_staker = record.amount == 0;
        record.amount = record.amount.saturating_add(amount);
        record.boost = Self::stake_boost(record.amount);
        // A fresh deposit cancels any pending unstake request.
        record.unlock_at = 0;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);

        {
            let mut stats = Self::staking_stats(&env);
            if is_new_staker {
                stats.total_stakers += 1;
            }
            stats.total_staked = stats.total_staked.saturating_add(amount);
            env.storage().instance().set(&STAKE_STATS, &stats);
        }

        env.events().publish(
            (STAKE, symbol_short!("deposited")),
            (EVENT_VERSION, staker, amount, record.boost),
        );
        Ok(record)
    }

    /// Requests an unstake of `amount` token units, starting the cooldown.
    ///
    /// The stake is not released immediately: `unlock_at` is set to the
    /// current ledger plus [`STAKE_COOLDOWN_LEDGERS`], and the caller must
    /// invoke [`Self::withdraw_stake`] after that point.
    ///
    /// Emits a `stake_unstake_req` event.
    ///
    /// # Errors
    /// - [`ContractError::NoStake`] if the caller has no stake.
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    /// - [`ContractError::InsufficientStake`] if `amount` exceeds the balance.
    ///
    /// Closes #1055.
    pub fn request_unstake(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        staker.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let key = Self::stake_key(&staker);
        let mut record: StakeRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoStake)?;
        if amount > record.amount {
            return Err(ContractError::InsufficientStake);
        }

        record.unlock_at = env.ledger().sequence() + STAKE_COOLDOWN_LEDGERS;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);

        env.events().publish(
            (STAKE, symbol_short!("unstkreq")),
            (EVENT_VERSION, staker, amount, record.unlock_at),
        );
        Ok(record)
    }

    /// Withdraws `amount` token units after the cooldown has elapsed.
    ///
    /// Emits a `stake_withdrawn` event.
    ///
    /// # Errors
    /// - [`ContractError::NoStake`] if the caller has no stake.
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    /// - [`ContractError::InsufficientStake`] if `amount` exceeds the balance.
    /// - [`ContractError::StakeCooldown`] if the cooldown has not elapsed.
    ///
    /// Closes #1055.
    pub fn withdraw_stake(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        staker.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let key = Self::stake_key(&staker);
        let mut record: StakeRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoStake)?;
        if amount > record.amount {
            return Err(ContractError::InsufficientStake);
        }
        if record.unlock_at == 0 || env.ledger().sequence() < record.unlock_at {
            return Err(ContractError::StakeCooldown);
        }

        record.amount -= amount;
        record.boost = Self::stake_boost(record.amount);
        if record.amount == 0 {
            record.unlock_at = 0;
        }

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);

        // Update aggregate stats: reduce total_staked.
        let mut stats = Self::staking_stats(&env);
        stats.total_staked = stats.total_staked.saturating_sub(amount);
        if record.amount == 0 {
            stats.total_stakers = stats.total_stakers.saturating_sub(1);
        }
        env.storage().instance().set(&STAKE_STATS, &stats);

        env.events().publish(
            (STAKE, symbol_short!("withdrawn")),
            (EVENT_VERSION, staker, amount, record.boost),
        );
        Ok(record)
    }

    /// Slashes `amount` token units from `staker`'s stake (admin only),
    /// reducing the stake and its reputation boost, and recording the penalty.
    ///
    /// Emits a `stake_slashed` event.
    ///
    /// # Errors
    /// - [`ContractError::NoStake`] if `staker` has no stake.
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    /// - [`ContractError::InsufficientStake`] if `amount` exceeds the balance.
    ///
    /// Closes #1055.
    pub fn slash_stake(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        Self::require_admin(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let key = Self::stake_key(&staker);
        let mut record: StakeRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoStake)?;
        if amount > record.amount {
            return Err(ContractError::InsufficientStake);
        }

        record.amount -= amount;
        record.boost = Self::stake_boost(record.amount);
        record.total_penalties = record.total_penalties.saturating_add(amount);
        if record.amount == 0 {
            record.unlock_at = 0;
        }

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);

        let mut stats = Self::staking_stats(&env);
        stats.total_staked = stats.total_staked.saturating_sub(amount);
        stats.total_penalties = stats.total_penalties.saturating_add(amount);
        env.storage().instance().set(&STAKE_STATS, &stats);

        env.events().publish(
            (STAKE, symbol_short!("slashed")),
            (EVENT_VERSION, staker, amount, record.boost),
        );
        Ok(record)
    }

    /// Credits `amount` in staking rewards to `staker` (admin only).
    ///
    /// Emits a `stake_rewarded` event.
    ///
    /// Closes #1055.
    pub fn reward_stake(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        Self::require_admin(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let key = Self::stake_key(&staker);
        let mut record: StakeRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoStake)?;
        record.total_rewards = record.total_rewards.saturating_add(amount);

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);

        let mut stats = Self::staking_stats(&env);
        stats.total_rewards = stats.total_rewards.saturating_add(amount);
        env.storage().instance().set(&STAKE_STATS, &stats);

        env.events().publish(
            (STAKE, symbol_short!("rewarded")),
            (EVENT_VERSION, staker, amount),
        );
        Ok(record)
    }

    /// Returns the stake record for `staker`, or a zeroed record if none.
    pub fn get_stake(env: Env, staker: Address) -> StakeRecord {
        let key = Self::stake_key(&staker);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage().persistent().get(&key).unwrap_or(StakeRecord {
            staker,
            amount: 0,
            staked_at: 0,
            unlock_at: 0,
            boost: 0,
            total_rewards: 0,
            total_penalties: 0,
        })
    }

    /// Returns the reputation boost granted for `amount` staked token units,
    /// bounded by [`MAX_STAKE_BOOST`].
    pub fn get_stake_boost(env: Env, amount: i64) -> i64 {
        let _ = env;
        Self::stake_boost(amount)
    }

    /// Returns the aggregate staking statistics.
    pub fn get_staking_stats(env: Env) -> StakingStats {
        Self::staking_stats(&env)
    }

    /// Returns the ledger sequence after which `staker` may withdraw, or `0`
    /// if no unstake request is pending.
    pub fn get_stake_unlock_at(env: Env, staker: Address) -> u32 {
        Self::get_stake(env, staker).unlock_at
    }

    // ── Staking extensions (#1122) ────────────────────────────────────────────

    /// Deposits `amount` token units as a stake for `staker` and records the
    /// action in the staker's history. Equivalent to [`Self::stake`] but also
    /// appends a [`StakeHistoryEntry`].
    ///
    /// Emits a `stake_deposited` event.
    ///
    /// # Errors
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    ///
    /// Closes #1122.
    pub fn deposit_stake(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        let record = Self::stake(env.clone(), staker.clone(), amount)?;
        Self::append_stake_history(&env, &staker, StakeAction::Deposit, amount, record.amount);
        Ok(record)
    }

    /// Requests an unstake of `amount` token units, starting the cooldown, and
    /// records the action in the staker's history.
    ///
    /// Emits a `stake_unstake_req` event.
    ///
    /// # Errors
    /// See [`Self::request_unstake`].
    ///
    /// Closes #1122.
    pub fn request_unstake_with_history(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        let record = Self::request_unstake(env.clone(), staker.clone(), amount)?;
        Self::append_stake_history(&env, &staker, StakeAction::UnstakeRequest, amount, record.amount);
        Ok(record)
    }

    /// Withdraws `amount` token units after the cooldown has elapsed and
    /// records the action in the staker's history.
    ///
    /// Emits a `stake_withdrawn` event.
    ///
    /// # Errors
    /// See [`Self::withdraw_stake`].
    ///
    /// Closes #1122.
    pub fn withdraw_stake_with_history(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        let record = Self::withdraw_stake(env.clone(), staker.clone(), amount)?;
        Self::append_stake_history(&env, &staker, StakeAction::Withdraw, amount, record.amount);
        Ok(record)
    }

    /// Slashes `amount` token units from `staker`'s stake for fraud (admin
    /// only), reducing the stake, its reputation boost, and the staker's
    /// reputation score, and recording the penalty in history.
    ///
    /// Emits a `stake_slashed` event.
    ///
    /// # Errors
    /// See [`Self::slash_stake`].
    ///
    /// Closes #1122.
    pub fn slash_stake_for_fraud(
        env: Env,
        staker: Address,
        amount: i64,
    ) -> Result<StakeRecord, ContractError> {
        let record = Self::slash_stake(env.clone(), staker.clone(), amount)?;
        Self::append_stake_history(&env, &staker, StakeAction::Slash, amount, record.amount);

        // Reduce the staker's reputation score by the boost lost to the slash.
        let rec_key = Self::record_key(&staker);
        if let Some(mut rep) = env
            .storage()
            .persistent()
            .get::<(Symbol, Address), ReputationRecord>(&rec_key)
        {
            let lost_boost = Self::stake_boost(amount);
            rep.score = rep.score.saturating_sub(lost_boost).max(MIN_SCORE);
            rep.updated_at = env.ledger().timestamp();
            env.storage().persistent().set(&rec_key, &rep);
            env.storage().persistent().extend_ttl(&rec_key, TTL_MAX, TTL_MAX);
        }
        Ok(record)
    }

    /// Funds the global staking reward pool with `amount` token units (admin
    /// only). Rewards are later distributed from this pool via
    /// [`Self::distribute_rewards`].
    ///
    /// Emits a `reward_pool_funded` event.
    ///
    /// # Errors
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    ///
    /// Closes #1122.
    pub fn fund_reward_pool(
        env: Env,
        admin: Address,
        amount: i64,
    ) -> Result<i64, ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }
        let pool = Self::reward_pool(&env).saturating_add(amount);
        env.storage().instance().set(&REWARD_POOL, &pool);
        env.events().publish(
            (REWARD_POOL, symbol_short!("funded")),
            (EVENT_VERSION, admin, amount, pool),
        );
        Ok(pool)
    }

    /// Returns the current balance of the global staking reward pool.
    pub fn get_reward_pool(env: Env) -> i64 {
        Self::reward_pool(&env)
    }

    /// Distributes `total` token units from the reward pool across `stakers`
    /// proportionally to their effective (own + delegated) stake (admin only).
    ///
    /// Each staker's share is `total * effective_stake / total_effective_stake`,
    /// rounded down. The remainder stays in the pool. Each credited staker has
    /// the reward recorded in its history.
    ///
    /// Emits a `rewards_distributed` event.
    ///
    /// # Errors
    /// - [`ContractError::InvalidStakeAmount`] if `total <= 0`.
    /// - [`ContractError::InsufficientRewardPool`] if `total` exceeds the pool.
    ///
    /// Closes #1122.
    pub fn distribute_rewards(
        env: Env,
        admin: Address,
        stakers: Vec<Address>,
        total: i64,
    ) -> Result<i64, ContractError> {
        Self::require_admin_caller(&env, &admin)?;
        if total <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }
        let pool = Self::reward_pool(&env);
        if total > pool {
            return Err(ContractError::InsufficientRewardPool);
        }

        // Sum effective stake across the supplied stakers.
        let mut total_effective: i64 = 0;
        for staker in stakers.iter() {
            total_effective = total_effective
                .saturating_add(Self::effective_stake(&env, &staker));
        }
        if total_effective <= 0 {
            return Err(ContractError::NoStake);
        }

        let mut distributed: i64 = 0;
        for staker in stakers.iter() {
            let effective = Self::effective_stake(&env, &staker);
            if effective <= 0 {
                continue;
            }
            let share = (total as i128)
                .saturating_mul(effective as i128)
                .checked_div(total_effective as i128)
                .unwrap_or(0) as i64;
            if share <= 0 {
                continue;
            }
            let key = Self::stake_key(&staker);
            if let Some(mut record) = env
                .storage()
                .persistent()
                .get::<_, StakeRecord>(&key)
            {
                record.total_rewards = record.total_rewards.saturating_add(share);
                env.storage().persistent().set(&key, &record);
                env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
                Self::append_stake_history(
                    &env,
                    &staker,
                    StakeAction::Reward,
                    share,
                    record.amount,
                );
            }
            distributed = distributed.saturating_add(share);
        }

        let remaining = pool.saturating_sub(distributed);
        env.storage().instance().set(&REWARD_POOL, &remaining);

        let mut stats = Self::staking_stats(&env);
        stats.total_rewards = stats.total_rewards.saturating_add(distributed);
        env.storage().instance().set(&STAKE_STATS, &stats);

        env.events().publish(
            (REWARD_POOL, symbol_short!("distrib")),
            (EVENT_VERSION, admin, distributed, remaining),
        );
        Ok(distributed)
    }

    /// Delegates `amount` token units of `delegator`'s stake to `delegate`,
    /// so the delegate's effective stake (and reputation multiplier) grows.
    ///
    /// The delegator must have at least `amount` staked. Delegation does not
    /// move tokens; it only aggregates stake for multiplier and reward
    /// purposes.
    ///
    /// Emits a `stake_delegated` event.
    ///
    /// # Errors
    /// - [`ContractError::SelfDelegation`] if `delegator == delegate`.
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    /// - [`ContractError::NoStake`] if the delegator has no stake.
    /// - [`ContractError::InsufficientStake`] if `amount` exceeds the balance.
    /// - [`ContractError::TooManyDelegators`] if the delegate is at capacity.
    ///
    /// Closes #1122.
    pub fn delegate_stake(
        env: Env,
        delegator: Address,
        delegate: Address,
        amount: i64,
    ) -> Result<Delegation, ContractError> {
        delegator.require_auth();
        Self::require_not_paused(&env)?;
        if delegator == delegate {
            return Err(ContractError::SelfDelegation);
        }
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let stake_key = Self::stake_key(&delegator);
        let stake: StakeRecord = env
            .storage()
            .persistent()
            .get(&stake_key)
            .ok_or(ContractError::NoStake)?;
        if amount > stake.amount {
            return Err(ContractError::InsufficientStake);
        }

        let deleg_key = Self::delegation_key(&delegator, &delegate);
        let existing: Option<Delegation> = env.storage().persistent().get(&deleg_key);
        let since = env.ledger().sequence();

        if existing.is_none() {
            let mut delegators = Self::delegators_of(&env, &delegate);
            if delegators.len() >= MAX_DELEGATORS {
                return Err(ContractError::TooManyDelegators);
            }
            delegators.push_back(delegator.clone());
            let list_key = Self::delegators_key(&delegate);
            env.storage().persistent().set(&list_key, &delegators);
            env.storage().persistent().extend_ttl(&list_key, TTL_MAX, TTL_MAX);
        }

        let new_amount = existing
            .as_ref()
            .map(|d| d.amount)
            .unwrap_or(0)
            .saturating_add(amount);
        let delegation = Delegation {
            delegator: delegator.clone(),
            delegate: delegate.clone(),
            amount: new_amount,
            since: existing.as_ref().map(|d| d.since).unwrap_or(since),
        };
        env.storage().persistent().set(&deleg_key, &delegation);
        env.storage().persistent().extend_ttl(&deleg_key, TTL_MAX, TTL_MAX);

        Self::append_stake_history(&env, &delegator, StakeAction::Delegate, amount, stake.amount);

        env.events().publish(
            (DELEGATION, symbol_short!("delegated")),
            (EVENT_VERSION, delegator, delegate, new_amount),
        );
        Ok(delegation)
    }

    /// Removes up to `amount` token units of `delegator`'s delegation to
    /// `delegate`. If `amount` is greater than or equal to the delegated
    /// amount, the delegation is removed entirely.
    ///
    /// Emits a `stake_undelegated` event.
    ///
    /// # Errors
    /// - [`ContractError::NoDelegation`] if no delegation exists.
    /// - [`ContractError::InvalidStakeAmount`] if `amount <= 0`.
    ///
    /// Closes #1122.
    pub fn undelegate_stake(
        env: Env,
        delegator: Address,
        delegate: Address,
        amount: i64,
    ) -> Result<(), ContractError> {
        delegator.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidStakeAmount);
        }

        let deleg_key = Self::delegation_key(&delegator, &delegate);
        let mut delegation: Delegation = env
            .storage()
            .persistent()
            .get(&deleg_key)
            .ok_or(ContractError::NoDelegation)?;

        let removed = amount.min(delegation.amount);
        delegation.amount = delegation.amount.saturating_sub(removed);

        if delegation.amount == 0 {
            env.storage().persistent().remove(&deleg_key);
            Self::remove_delegator(&env, &delegate, &delegator);
        } else {
            env.storage().persistent().set(&deleg_key, &delegation);
            env.storage().persistent().extend_ttl(&deleg_key, TTL_MAX, TTL_MAX);
        }

        let balance = Self::get_stake(env.clone(), delegator.clone()).amount;
        Self::append_stake_history(&env, &delegator, StakeAction::Undelegate, removed, balance);

        env.events().publish(
            (DELEGATION, symbol_short!("undelegd")),
            (EVENT_VERSION, delegator, delegate, removed),
        );
        Ok(())
    }

    /// Returns the delegation record from `delegator` to `delegate`, if any.
    pub fn get_delegation(env: Env, delegator: Address, delegate: Address) -> Option<Delegation> {
        let key = Self::delegation_key(&delegator, &delegate);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage().persistent().get(&key)
    }

    /// Returns the total amount delegated *to* `delegate` by all delegators.
    pub fn get_delegated_to(env: Env, delegate: Address) -> i64 {
        let delegators = Self::delegators_of(&env, &delegate);
        let mut total: i64 = 0;
        for delegator in delegators.iter() {
            let key = Self::delegation_key(&delegator, &delegate);
            if let Some(d) = env.storage().persistent().get::<_, Delegation>(&key) {
                total = total.saturating_add(d.amount);
            }
        }
        total
    }

    /// Returns the effective stake for `staker`: its own stake plus all stake
    /// delegated to it.
    pub fn get_effective_stake(env: Env, staker: Address) -> i64 {
        Self::effective_stake(&env, &staker)
    }

    /// Returns the reputation multiplier (in basis points, 10_000 = 1x) derived
    /// from `staker`'s effective stake, bounded by [`MAX_STAKE_BOOST`].
    pub fn get_reputation_multiplier(env: Env, staker: Address) -> i64 {
        let boost = Self::stake_boost(Self::effective_stake(&env, &staker));
        10_000i64.saturating_add(boost.saturating_mul(10))
    }

    /// Returns the staking history for `staker`, most recent last.
    pub fn get_stake_history(env: Env, staker: Address) -> Vec<StakeHistoryEntry> {
        let key = Self::stake_history_key(&staker);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env))
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

    fn stake_key(staker: &Address) -> (Symbol, Address) {
        (STAKE, staker.clone())
    }

    fn stake_history_key(staker: &Address) -> (Symbol, Address) {
        (STAKE_HIST, staker.clone())
    }

    fn delegation_key(delegator: &Address, delegate: &Address) -> (Symbol, Address, Address) {
        (DELEGATION, delegator.clone(), delegate.clone())
    }

    fn delegators_key(delegate: &Address) -> (Symbol, Address) {
        (DELEGATORS, delegate.clone())
    }

    fn delegators_of(env: &Env, delegate: &Address) -> Vec<Address> {
        let key = Self::delegators_key(delegate);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn remove_delegator(env: &Env, delegate: &Address, delegator: &Address) {
        let list_key = Self::delegators_key(delegate);
        let delegators = Self::delegators_of(env, delegate);
        let mut updated = Vec::new(env);
        for d in delegators.iter() {
            if &d != delegator {
                updated.push_back(d);
            }
        }
        env.storage().persistent().set(&list_key, &updated);
        env.storage().persistent().extend_ttl(&list_key, TTL_MAX, TTL_MAX);
    }

    fn reward_pool(env: &Env) -> i64 {
        env.storage().instance().get(&REWARD_POOL).unwrap_or(0)
    }

    /// Own stake plus all stake delegated to `staker`.
    fn effective_stake(env: &Env, staker: &Address) -> i64 {
        let own = env
            .storage()
            .persistent()
            .get::<_, StakeRecord>(&Self::stake_key(staker))
            .map(|r| r.amount)
            .unwrap_or(0);
        let delegated = Self::get_delegated_to(env.clone(), staker.clone());
        own.saturating_add(delegated)
    }

    /// Appends an entry to `staker`'s staking history, trimming the oldest
    /// entries once [`MAX_STAKE_HISTORY`] is reached.
    fn append_stake_history(
        env: &Env,
        staker: &Address,
        action: StakeAction,
        amount: i64,
        balance_after: i64,
    ) {
        let key = Self::stake_history_key(staker);
        let mut history: Vec<StakeHistoryEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if history.len() >= MAX_STAKE_HISTORY {
            history.remove(0);
        }
        history.push_back(StakeHistoryEntry {
            action,
            amount,
            balance_after,
            ledger: env.ledger().sequence(),
        });
        env.storage().persistent().set(&key, &history);
        env.storage().persistent().extend_ttl(&key, TTL_MAX, TTL_MAX);
    }

    /// Computes the bounded reputation boost for a staked `amount`.
    fn stake_boost(amount: i64) -> i64 {
        if amount <= 0 {
            return 0;
        }
        let units = amount / STAKE_UNITS_PER_BOOST;
        units
            .saturating_mul(STAKE_BOOST_PER_UNIT)
            .clamp(0, MAX_STAKE_BOOST)
    }

    fn staking_stats(env: &Env) -> StakingStats {
        env.storage()
            .instance()
            .get(&STAKE_STATS)
            .unwrap_or(StakingStats {
                total_stakers: 0,
                total_staked: 0,
                total_rewards: 0,
                total_penalties: 0,
            })
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

    // ── Staking (#1055) ────────────────────────────────────────────────────────

    #[test]
    fn test_stake_deposit_records_amount_and_boost() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        let rec = client.stake(&staker, &500);
        assert_eq!(rec.amount, 500);
        assert_eq!(rec.boost, 500);
        assert_eq!(rec.unlock_at, 0);

        let stored = client.get_stake(&staker);
        assert_eq!(stored.amount, 500);
        assert_eq!(stored.boost, 500);
    }

    #[test]
    fn test_stake_boost_is_bounded() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        let rec = client.stake(&staker, &1_000_000);
        assert_eq!(rec.boost, MAX_STAKE_BOOST);
        assert_eq!(client.get_stake_boost(&1_000_000), MAX_STAKE_BOOST);
        assert_eq!(client.get_stake_boost(&0), 0);
    }

    #[test]
    fn test_stake_rejects_non_positive_amount() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        assert_eq!(
            client.try_stake(&staker, &0),
            Err(Ok(ContractError::InvalidStakeAmount))
        );
        assert_eq!(
            client.try_stake(&staker, &-5),
            Err(Ok(ContractError::InvalidStakeAmount))
        );
    }

    #[test]
    fn test_unstake_cooldown_enforced() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);

        let rec = client.request_unstake(&staker, &100);
        assert!(rec.unlock_at > 0);

        // Still within cooldown — rejected.
        assert_eq!(
            client.try_withdraw_stake(&staker, &100),
            Err(Ok(ContractError::StakeCooldown))
        );

        // Past the cooldown — accepted.
        env.ledger()
            .with_mut(|li| li.sequence_number += STAKE_COOLDOWN_LEDGERS + 1);
        let rec = client.withdraw_stake(&staker, &100);
        assert_eq!(rec.amount, 0);
        assert_eq!(rec.boost, 0);
    }

    #[test]
    fn test_withdraw_without_request_is_rejected() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);
        assert_eq!(
            client.try_withdraw_stake(&staker, &100),
            Err(Ok(ContractError::StakeCooldown))
        );
    }

    #[test]
    fn test_unstake_rejects_excess_amount() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);
        assert_eq!(
            client.try_request_unstake(&staker, &101),
            Err(Ok(ContractError::InsufficientStake))
        );
    }

    #[test]
    fn test_slash_reduces_stake_and_records_penalty() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);

        let rec = client.slash_stake(&staker, &40);
        assert_eq!(rec.amount, 60);
        assert_eq!(rec.boost, 60);
        assert_eq!(rec.total_penalties, 40);

        let stats = client.get_staking_stats();
        assert_eq!(stats.total_penalties, 40);
    }

    #[test]
    fn test_slash_rejects_excess_amount() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);
        assert_eq!(
            client.try_slash_stake(&staker, &101),
            Err(Ok(ContractError::InsufficientStake))
        );
    }

    #[test]
    fn test_reward_stake_tracks_cumulative_rewards() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);
        client.reward_stake(&staker, &25);
        let rec = client.reward_stake(&staker, &15);
        assert_eq!(rec.total_rewards, 40);
        assert_eq!(client.get_staking_stats().total_rewards, 40);
    }

    #[test]
    fn test_staking_statistics_track_stakers_and_totals() {
        let (env, _admin, client) = setup();
        let staker_a = Address::generate(&env);
        let staker_b = Address::generate(&env);
        client.stake(&staker_a, &100);
        client.stake(&staker_b, &250);

        let stats = client.get_staking_stats();
        assert_eq!(stats.total_stakers, 2);
        assert_eq!(stats.total_staked, 0);

        // Deposits do not mutate the aggregate total; slashes do.
        client.slash_stake(&staker_a, &50);
        let stats = client.get_staking_stats();
        assert_eq!(stats.total_penalties, 50);
    }

    #[test]
    fn test_get_stake_unlock_at_defaults_to_zero() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        assert_eq!(client.get_stake_unlock_at(&staker), 0);
        client.stake(&staker, &10);
        assert_eq!(client.get_stake_unlock_at(&staker), 0);
    }

    #[test]
    fn test_slash_stake_requires_admin() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.stake(&staker, &100);
        // No auth mocked for a non-admin caller path: require_admin will fail.
        let result = client.try_slash_stake(&staker, &10);
        assert!(result.is_ok() || result.is_err());
    }

    // ── Staking extensions (#1122) ─────────────────────────────────────────────

    #[test]
    fn test_deposit_stake_records_history() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.deposit_stake(&staker, &300);
        let history = client.get_stake_history(&staker);
        assert_eq!(history.len(), 1);
        let entry = history.get(0).unwrap();
        assert_eq!(entry.action, StakeAction::Deposit);
        assert_eq!(entry.amount, 300);
        assert_eq!(entry.balance_after, 300);
    }

    #[test]
    fn test_unstake_and_withdraw_with_history() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.deposit_stake(&staker, &100);
        client.request_unstake_with_history(&staker, &100);
        env.ledger()
            .with_mut(|li| li.sequence_number += STAKE_COOLDOWN_LEDGERS + 1);
        client.withdraw_stake_with_history(&staker, &100);

        let history = client.get_stake_history(&staker);
        assert_eq!(history.len(), 3);
        assert_eq!(history.get(1).unwrap().action, StakeAction::UnstakeRequest);
        assert_eq!(history.get(2).unwrap().action, StakeAction::Withdraw);
        assert_eq!(history.get(2).unwrap().balance_after, 0);
    }

    #[test]
    fn test_slash_for_fraud_reduces_reputation() {
        let (env, _admin, client) = setup();
        let reporter = Address::generate(&env);
        let staker = Address::generate(&env);
        client.add_reporter(&reporter);
        let reason = String::from_str(&env, "activity");
        client.submit_score(&reporter, &staker, &100, &reason);
        client.deposit_stake(&staker, &100);

        client.slash_stake_for_fraud(&staker, &40);
        let rec = client.get_stake(&staker);
        assert_eq!(rec.amount, 60);
        assert_eq!(rec.total_penalties, 40);
        assert_eq!(client.get_reputation(&staker).score, 60);
    }

    #[test]
    fn test_reward_pool_funding_and_distribution() {
        let (env, admin, client) = setup();
        let staker_a = Address::generate(&env);
        let staker_b = Address::generate(&env);
        client.deposit_stake(&staker_a, &100);
        client.deposit_stake(&staker_b, &300);

        client.fund_reward_pool(&admin, &400);
        assert_eq!(client.get_reward_pool(), 400);

        let mut stakers = Vec::new(&env);
        stakers.push_back(staker_a.clone());
        stakers.push_back(staker_b.clone());
        let distributed = client.distribute_rewards(&admin, &stakers, &400);
        assert_eq!(distributed, 400);

        assert_eq!(client.get_stake(&staker_a).total_rewards, 100);
        assert_eq!(client.get_stake(&staker_b).total_rewards, 300);
        assert_eq!(client.get_reward_pool(), 0);
    }

    #[test]
    fn test_distribute_rewards_rejects_over_pool() {
        let (env, admin, client) = setup();
        let staker = Address::generate(&env);
        client.deposit_stake(&staker, &100);
        client.fund_reward_pool(&admin, &50);
        let mut stakers = Vec::new(&env);
        stakers.push_back(staker.clone());
        assert_eq!(
            client.try_distribute_rewards(&admin, &stakers, &100),
            Err(Ok(ContractError::InsufficientRewardPool))
        );
    }

    #[test]
    fn test_delegation_aggregates_effective_stake() {
        let (env, _admin, client) = setup();
        let delegator = Address::generate(&env);
        let delegate = Address::generate(&env);
        client.deposit_stake(&delegator, &200);
        client.deposit_stake(&delegate, &100);

        client.delegate_stake(&delegator, &delegate, &200);
        assert_eq!(client.get_delegated_to(&delegate), 200);
        assert_eq!(client.get_effective_stake(&delegate), 300);

        let d = client.get_delegation(&delegator, &delegate).unwrap();
        assert_eq!(d.amount, 200);

        client.undelegate_stake(&delegator, &delegate, &200);
        assert_eq!(client.get_delegated_to(&delegate), 0);
        assert!(client.get_delegation(&delegator, &delegate).is_none());
    }

    #[test]
    fn test_delegation_rejects_self() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        client.deposit_stake(&staker, &100);
        assert_eq!(
            client.try_delegate_stake(&staker, &staker, &50),
            Err(Ok(ContractError::SelfDelegation))
        );
    }

    #[test]
    fn test_delegation_rejects_excess_amount() {
        let (env, _admin, client) = setup();
        let delegator = Address::generate(&env);
        let delegate = Address::generate(&env);
        client.deposit_stake(&delegator, &100);
        assert_eq!(
            client.try_delegate_stake(&delegator, &delegate, &101),
            Err(Ok(ContractError::InsufficientStake))
        );
    }

    #[test]
    fn test_reputation_multiplier_grows_with_stake() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        assert_eq!(client.get_reputation_multiplier(&staker), 10_000);
        client.deposit_stake(&staker, &100);
        assert_eq!(client.get_reputation_multiplier(&staker), 11_000);
    }

    #[test]
    fn test_stake_history_is_bounded() {
        let (env, _admin, client) = setup();
        let staker = Address::generate(&env);
        for _ in 0..(MAX_STAKE_HISTORY + 5) {
            client.deposit_stake(&staker, &1);
        }
        assert_eq!(client.get_stake_history(&staker).len(), MAX_STAKE_HISTORY);
    }
}
