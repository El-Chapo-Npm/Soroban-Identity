use soroban_sdk::{symbol_short, Address, Symbol};

pub const REC: Symbol = symbol_short!("rec");
pub const HIST: Symbol = symbol_short!("h");
pub const STAKE: Symbol = symbol_short!("stake");
pub const TOTSTK: Symbol = symbol_short!("totstk");

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
