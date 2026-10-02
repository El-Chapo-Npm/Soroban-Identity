use soroban_sdk::{symbol_short, Address, Symbol};

pub const REC: Symbol = symbol_short!("rec");
pub const HIST: Symbol = symbol_short!("h");

pub fn record_key(subject: &Address) -> (Symbol, Address) {
    (REC, subject.clone())
}

pub fn history_key(subject: &Address, reporter: &Address) -> (Symbol, Address, Address) {
    (HIST, subject.clone(), reporter.clone())
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
