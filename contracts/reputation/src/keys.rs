use soroban_sdk::{symbol_short, Address, Symbol};

pub const REC: Symbol = symbol_short!("rec");
pub const HIST: Symbol = symbol_short!("h");
pub const STAKE: Symbol = symbol_short!("stake");
pub const TOTSTK: Symbol = symbol_short!("totstk");
pub const DELEG: Symbol = symbol_short!("deleg");
pub const REWARD: Symbol = symbol_short!("reward");
pub const STKHIST: Symbol = symbol_short!("stkhist");

pub fn record_key(subject: &Address) -> (Symbol, Address) {
    (REC, subject.clone())
}

pub fn history_key(subject: &Address, reporter: &Address) -> (Symbol, Address, Address) {
    (HIST, subject.clone(), reporter.clone())
}

/// Storage key for a subject's staking record.
pub fn stake_key(subject: &Address) -> (Symbol, Address) {
    (STAKE, subject.clone())
}

/// Storage key for the aggregate amount currently staked across all subjects.
pub fn total_staked_key() -> Symbol {
    TOTSTK
}

/// Storage key for a delegation of stake from `delegator` to `delegatee`.
pub fn delegation_key(delegator: &Address, delegatee: &Address) -> (Symbol, Address, Address) {
    (DELEG, delegator.clone(), delegatee.clone())
}

/// Storage key for the aggregate amount delegated to `delegatee`.
pub fn delegated_total_key(delegatee: &Address) -> (Symbol, Address) {
    (DELEG, delegatee.clone())
}

/// Storage key for the staking rewards pool.
pub fn reward_pool_key() -> Symbol {
    REWARD
}

/// Storage key for a subject's accrued (unclaimed) staking rewards.
pub fn reward_key(subject: &Address) -> (Symbol, Address) {
    (REWARD, subject.clone())
}

/// Storage key for a subject's staking history entry at `index`.
pub fn staking_history_key(subject: &Address, index: u32) -> (Symbol, Address, u32) {
    (STKHIST, subject.clone(), index)
}

/// Number of ledgers a subject must wait after requesting an unstake before
/// the staked tokens can be withdrawn.
pub const UNSTAKE_COOLDOWN_LEDGERS: u32 = 17_280;

/// Maximum reputation boost (in score points) a subject can earn from staking.
pub const MAX_STAKE_BOOST: i128 = 50;

/// Amount of stake (in base token units) required to earn the full
/// [`MAX_STAKE_BOOST`]. Stakes beyond this amount do not increase the boost.
pub const STAKE_BOOST_FULL_AMOUNT: i128 = 1_000_000;

/// Maximum fraction of a subject's stake that can be slashed, expressed in
/// basis points (1 bp = 0.01%). Bounds slashing to 100% of the stake.
pub const MAX_SLASH_BPS: u32 = 10_000;

/// Computes the reputation boost earned by staking `amount` tokens.
///
/// The boost scales linearly from zero up to [`MAX_STAKE_BOOST`] as the stake
/// reaches [`STAKE_BOOST_FULL_AMOUNT`], and is capped thereafter. Non-positive
/// amounts yield no boost.
pub fn stake_boost(amount: i128) -> i128 {
    if amount <= 0 {
        return 0;
    }
    if amount >= STAKE_BOOST_FULL_AMOUNT {
        return MAX_STAKE_BOOST;
    }
    (amount * MAX_STAKE_BOOST) / STAKE_BOOST_FULL_AMOUNT
}

/// Computes the amount slashed from `amount` given a slash rate in basis
/// points, clamping the rate to [`MAX_SLASH_BPS`].
pub fn slash_amount(amount: i128, bps: u32) -> i128 {
    if amount <= 0 {
        return 0;
    }
    let clamped = if bps > MAX_SLASH_BPS { MAX_SLASH_BPS } else { bps };
    (amount * clamped as i128) / MAX_SLASH_BPS as i128
}

/// Reputation multiplier applied to a subject's score, expressed in basis
/// points where [`MULTIPLIER_BASE_BPS`] represents a 1.0x multiplier.
///
/// The multiplier grows linearly with the stake boost so that a stake earning
/// the full [`MAX_STAKE_BOOST`] yields a [`MAX_STAKE_MULTIPLIER_BPS`] (1.5x)
/// multiplier. Non-positive amounts yield the base multiplier.
pub const MULTIPLIER_BASE_BPS: u32 = 10_000;
pub const MAX_STAKE_MULTIPLIER_BPS: u32 = 15_000;

/// Computes the reputation multiplier (in basis points) for a stake `amount`.
pub fn stake_multiplier_bps(amount: i128) -> u32 {
    let boost = stake_boost(amount);
    if boost <= 0 {
        return MULTIPLIER_BASE_BPS;
    }
    let extra = ((MAX_STAKE_MULTIPLIER_BPS - MULTIPLIER_BASE_BPS) as i128 * boost)
        / MAX_STAKE_BOOST;
    MULTIPLIER_BASE_BPS + extra as u32
}

/// Applies the stake multiplier to `score`, rounding down.
pub fn apply_stake_multiplier(score: i128, amount: i128) -> i128 {
    if score <= 0 {
        return 0;
    }
    (score * stake_multiplier_bps(amount) as i128) / MULTIPLIER_BASE_BPS as i128
}

/// Returns the effective stake for `subject`, combining its own stake with the
/// total delegated to it. Used when computing the reputation multiplier.
pub fn effective_stake(own_stake: i128, delegated_total: i128) -> i128 {
    let own = if own_stake < 0 { 0 } else { own_stake };
    let delegated = if delegated_total < 0 { 0 } else { delegated_total };
    own + delegated
}

/// Returns `true` when an unstake requested at `requested_ledger` has passed
/// the [`UNSTAKE_COOLDOWN_LEDGERS`] cooldown as of `current_ledger`.
pub fn is_unstake_ready(requested_ledger: u32, current_ledger: u32) -> bool {
    current_ledger >= requested_ledger.saturating_add(UNSTAKE_COOLDOWN_LEDGERS)
}

/// Splits a slashed `amount` between the reward pool and the burned remainder.
///
/// A fixed fraction of slashed stake is redistributed to stakers via the
/// reward pool; the rest is burned. Returns `(to_reward_pool, burned)`.
pub const SLASH_REWARD_SHARE_BPS: u32 = 5_000;

pub fn split_slash(amount: i128) -> (i128, i128) {
    if amount <= 0 {
        return (0, 0);
    }
    let to_pool = (amount * SLASH_REWARD_SHARE_BPS as i128) / MAX_SLASH_BPS as i128;
    (to_pool, amount - to_pool)
}

/// Valid inclusive bounds for a submitted reputation score.
pub const MIN_SCORE: i128 = 0;
pub const MAX_SCORE: i128 = 100;

/// Returns `true` when `score` is within the accepted range.
///
/// Used by the contract entrypoints to reject out-of-range input with a
/// contract error instead of allowing panicking arithmetic downstream.
pub fn is_valid_score(score: i128) -> bool {
    score >= MIN_SCORE && score <= MAX_SCORE
}

/// Number of score buckets used by the aggregation helpers.
///
/// Scores are integers in `[MIN_SCORE, MAX_SCORE]`, so a fixed-size histogram
/// lets the aggregation queries compute averages and percentiles in a single
/// pass without repeatedly scanning the full record set.
pub const SCORE_BUCKETS: usize = (MAX_SCORE - MIN_SCORE + 1) as usize;

/// Maps a valid `score` to its histogram bucket index.
///
/// Returns `None` for out-of-range scores so callers can skip malformed
/// entries instead of panicking on the subtraction below.
pub fn score_bucket(score: i128) -> Option<usize> {
    if !is_valid_score(score) {
        return None;
    }
    Some((score - MIN_SCORE) as usize)
}

/// Converts a histogram bucket index back into the score it represents.
pub fn bucket_score(bucket: usize) -> i128 {
    MIN_SCORE + bucket as i128
}
