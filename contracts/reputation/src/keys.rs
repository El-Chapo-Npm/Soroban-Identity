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
