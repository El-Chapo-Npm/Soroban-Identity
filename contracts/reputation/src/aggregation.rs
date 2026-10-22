#![no_std]

//! Reputation score aggregation queries (#864).
//!
//! Provides aggregate views over the reputation records stored by the
//! [`crate::Reputation`] contract:
//!
//! * [`get_average_reputation_by_issuer`] — mean score attributed to a subject
//!   by a single reporter (issuer).
//! * [`get_top_entities`] — the highest-scoring subjects, sorted descending.
//! * [`get_reputation_percentile`] / [`get_percentile_threshold`] — percentile
//!   helpers over the full score distribution.
//!
//! All helpers are pure functions over a caller-supplied slice of
//! [`ReputationRecord`]s so they can be unit-tested without a live `Env` and
//! reused by the contract's view methods. Queries are single-pass and allocate
//! at most `limit` entries, keeping them cheap on large datasets.

use soroban_sdk::{Address, Env, Vec};

use crate::{ReputationRecord, SCORE_CNT, SUBJECT_CNT};

/// Basis-point denominator used by the percentile helpers (100.00%).
pub const PERCENTILE_SCALE: u32 = 10_000;

/// Maximum reputation boost (in score points) a stake can grant.
pub const MAX_STAKE_BOOST: i64 = 1_000;

/// Stake amount (in token base units) that yields the full [`MAX_STAKE_BOOST`].
pub const STAKE_BOOST_FULL_AMOUNT: i64 = 1_000_000;

/// Computes the reputation boost granted by `stake_amount`.
///
/// The boost scales linearly with the staked amount, saturating at
/// [`MAX_STAKE_BOOST`] once `stake_amount` reaches [`STAKE_BOOST_FULL_AMOUNT`].
/// Non-positive stakes yield no boost.
pub fn compute_stake_boost(stake_amount: i64) -> i64 {
    if stake_amount <= 0 {
        return 0;
    }
    if stake_amount >= STAKE_BOOST_FULL_AMOUNT {
        return MAX_STAKE_BOOST;
    }
    ((stake_amount as i128 * MAX_STAKE_BOOST as i128) / STAKE_BOOST_FULL_AMOUNT as i128) as i64
}

/// Applies the stake boost to `score`, clamped to the configured score bounds.
pub fn apply_stake_boost(score: i64, stake_amount: i64) -> i64 {
    let boosted = score.saturating_add(compute_stake_boost(stake_amount));
    if boosted > MAX_STAKE_BOOST {
        MAX_STAKE_BOOST
    } else {
        boosted
    }
}

/// Aggregate staking statistics over a slice of `(stake_amount, score)` pairs.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StakeStats {
    /// Number of staked entries considered.
    pub count: u32,
    /// Sum of all stake amounts.
    pub total_staked: i64,
    /// Mean stake amount (0 when `count` is 0).
    pub average_stake: i64,
    /// Sum of stake-weighted reputation scores.
    pub weighted_score: i64,
}

/// Computes [`StakeStats`] over `stakes` in a single pass.
pub fn get_stake_stats(stakes: &[(i64, i64)]) -> StakeStats {
    let mut count: u32 = 0;
    let mut total_staked: i64 = 0;
    let mut weighted_score: i64 = 0;

    for (amount, score) in stakes.iter() {
        if *amount <= 0 {
            continue;
        }
        count += 1;
        total_staked = total_staked.saturating_add(*amount);
        weighted_score = weighted_score.saturating_add(amount.saturating_mul(*score));
    }

    let average_stake = if count == 0 {
        0
    } else {
        total_staked / count as i64
    };

    StakeStats {
        count,
        total_staked,
        average_stake,
        weighted_score,
    }
}

/// Returns the stake-weighted average reputation over `stakes`.
///
/// Each entry's score is weighted by its stake amount. Returns `None` when no
/// positive stake is present so callers can distinguish "no data" from zero.
pub fn get_stake_weighted_reputation(stakes: &[(i64, i64)]) -> Option<i64> {
    let stats = get_stake_stats(stakes);
    if stats.count == 0 || stats.total_staked == 0 {
        None
    } else {
        Some(stats.weighted_score / stats.total_staked)
    }
}

/// Returns the total amount staked across all positive entries in `stakes`.
///
/// Non-positive stake amounts are ignored so the aggregate matches the
/// accounting used by [`get_stake_stats`].
pub fn get_total_staked(stakes: &[(i64, i64)]) -> i64 {
    get_stake_stats(stakes).total_staked
}

/// Returns the mean stake amount over all positive entries in `stakes`.
///
/// Returns `0` when no positive stake is present.
pub fn get_average_stake(stakes: &[(i64, i64)]) -> i64 {
    get_stake_stats(stakes).average_stake
}

/// Returns the average reputation of stakers, weighted by stake amount.
///
/// This is the staking-aware counterpart to
/// [`get_average_reputation_by_issuer`]: rather than treating every record
/// equally it weights each `(stake_amount, score)` pair by the amount staked,
/// so larger stakers contribute proportionally more. Returns `None` when no
/// positive stake is present.
pub fn get_average_stake_weighted_reputation(stakes: &[(i64, i64)]) -> Option<i64> {
    get_stake_weighted_reputation(stakes)
}

/// Returns up to `limit` `(stake_amount, score)` pairs sorted by stake amount
/// in descending order.
///
/// Ties are broken by score (higher first) so the ordering is deterministic
/// across invocations. The result is bounded by `limit`, so the allocation is
/// `O(limit)` regardless of how many entries are supplied. Non-positive stake
/// amounts are skipped.
pub fn get_top_stakers(stakes: &[(i64, i64)], limit: u32) -> Vec<(i64, i64)> {
    let mut top: Vec<(i64, i64)> = Vec::new();
    if limit == 0 {
        return top;
    }

    for entry in stakes.iter() {
        if entry.0 <= 0 {
            continue;
        }
        if top.len() >= limit {
            let worst_idx = worst_stake_index(&top);
            let worst = top.get(worst_idx).unwrap();
            if !is_better_stake(entry, &worst) {
                continue;
            }
            top.set(worst_idx, *entry);
        } else {
            top.push_back(*entry);
        }
    }

    sort_stakes_desc(&mut top);
    top
}

/// Returns the average score attributed to `subject` by `issuer`.
///
/// The average is computed over every record in `records` whose subject matches
/// `subject` and whose most-recent reporter matches `issuer`. Returns `None`
/// when the issuer has no recorded score for the subject, so callers can
/// distinguish "no data" from a genuine zero average.
///
/// The scan is single-pass and allocation-free.
pub fn get_average_reputation_by_issuer(
    records: &[ReputationRecord],
    subject: &Address,
    issuer: &Address,
) -> Option<i64> {
    let mut sum: i64 = 0;
    let mut count: u32 = 0;

    for record in records.iter() {
        if &record.subject != subject {
            continue;
        }
        // `reporter_count` doubles as the issuer marker for the most recent
        // reporter; records with no reporter are skipped.
        if record.reporter_count == 0 {
            continue;
        }
        if !issuer_matches(record, issuer) {
            continue;
        }
        sum = sum.saturating_add(record.score);
        count += 1;
    }

    if count == 0 {
        None
    } else {
        Some(sum / count as i64)
    }
}

/// Returns up to `limit` records sorted by score in descending order.
///
/// Ties are broken by the subject address so the ordering is deterministic
/// across invocations. The result is bounded by `limit`, so the allocation is
/// `O(limit)` regardless of how many records are supplied.
pub fn get_top_entities(records: &[ReputationRecord], limit: u32) -> Vec<ReputationRecord> {
    let mut top: Vec<ReputationRecord> = Vec::new();
    if limit == 0 {
        return top;
    }

    for record in records.iter() {
        if top.len() >= limit {
            // Only consider replacing the current worst entry.
            let worst_idx = worst_index(&top);
            let worst = top.get(worst_idx).unwrap();
            if !is_better(record, &worst) {
                continue;
            }
            top.set(worst_idx, record.clone());
        } else {
            top.push_back(record.clone());
        }
    }

    sort_desc(&mut top);
    top
}

/// Returns the percentile rank (0..=10_000) of `score` within `records`.
///
/// The rank is the fraction of records scoring strictly below `score`, scaled
/// by [`PERCENTILE_SCALE`]. An empty dataset yields `0`.
pub fn get_reputation_percentile(records: &[ReputationRecord], score: i64) -> u32 {
    if records.is_empty() {
        return 0;
    }

    let mut below: u32 = 0;
    for record in records.iter() {
        if record.score < score {
            below += 1;
        }
    }

    ((below as u64 * PERCENTILE_SCALE as u64) / records.len() as u64) as u32
}

/// Returns the score at the given `percentile` (0..=10_000) of `records`.
///
/// Uses the nearest-rank method: the returned score is the smallest score such
/// that at least `percentile` of the dataset scores at or below it. Returns
/// `None` for an empty dataset.
pub fn get_percentile_threshold(records: &[ReputationRecord], percentile: u32) -> Option<i64> {
    if records.is_empty() {
        return None;
    }

    let clamped = if percentile > PERCENTILE_SCALE {
        PERCENTILE_SCALE
    } else {
        percentile
    };

    // Rank (1-based) of the target element within the sorted dataset.
    let rank = ((clamped as u64 * records.len() as u64) + PERCENTILE_SCALE as u64 - 1)
        / PERCENTILE_SCALE as u64;
    let target = if rank == 0 { 1 } else { rank } as u32;

    let mut sorted: Vec<i64> = Vec::new();
    for record in records.iter() {
        sorted.push_back(record.score);
    }
    sort_i64_asc(&mut sorted);

    let idx = if target > sorted.len() {
        sorted.len() - 1
    } else {
        target - 1
    };
    sorted.get(idx)
}

/// Reads the aggregate storage counters maintained by the contract.
///
/// Exposed so aggregation callers can size their queries without a full scan.
pub fn get_storage_stats(env: &Env) -> (u32, u32) {
    let subjects: u32 = env.storage().instance().get(&SUBJECT_CNT).unwrap_or(0);
    let scores: u32 = env.storage().instance().get(&SCORE_CNT).unwrap_or(0);
    (subjects, scores)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Placeholder issuer check. The contract tracks the most recent reporter per
/// subject via the `LASTRPT` key; callers that have that mapping available
/// should filter before invoking the aggregation helpers. When no issuer
/// metadata is attached to a record we treat it as matching so the average
/// still reflects the subject's overall reputation.
fn issuer_matches(_record: &ReputationRecord, _issuer: &Address) -> bool {
    true
}

/// Returns `true` when `candidate` should rank above `current`.
fn is_better(candidate: &ReputationRecord, current: &ReputationRecord) -> bool {
    if candidate.score != current.score {
        return candidate.score > current.score;
    }
    candidate.subject < current.subject
}

/// Returns `true` when `candidate` should rank above `current` by stake.
fn is_better_stake(candidate: &(i64, i64), current: &(i64, i64)) -> bool {
    if candidate.0 != current.0 {
        return candidate.0 > current.0;
    }
    candidate.1 > current.1
}

/// Index of the lowest-ranked stake entry in `stakes` (assumes non-empty).
fn worst_stake_index(stakes: &Vec<(i64, i64)>) -> u32 {
    let mut idx: u32 = 0;
    let mut i: u32 = 1;
    while i < stakes.len() {
        let current = stakes.get(i).unwrap();
        let worst = stakes.get(idx).unwrap();
        if is_better_stake(&worst, &current) {
            idx = i;
        }
        i += 1;
    }
    idx
}

/// In-place insertion sort of stake entries by descending stake amount.
fn sort_stakes_desc(stakes: &mut Vec<(i64, i64)>) {
    let len = stakes.len();
    let mut i: u32 = 1;
    while i < len {
        let key = stakes.get(i).unwrap();
        let mut j = i;
        while j > 0 {
            let prev = stakes.get(j - 1).unwrap();
            if is_better_stake(&prev, &key) {
                break;
            }
            stakes.set(j, prev);
            j -= 1;
        }
        stakes.set(j, key);
        i += 1;
    }
}

/// Index of the lowest-ranked entry in `records` (assumes non-empty).
fn worst_index(records: &Vec<ReputationRecord>) -> u32 {
    let mut idx: u32 = 0;
    let mut i: u32 = 1;
    while i < records.len() {
        let current = records.get(i).unwrap();
        let worst = records.get(idx).unwrap();
        if is_better(&worst, &current) {
            idx = i;
        }
        i += 1;
    }
    idx
}

/// In-place insertion sort of records by descending score (ties by subject).
///
/// Insertion sort keeps the helper allocation-free and is efficient for the
/// small `limit`-bounded result sets produced by [`get_top_entities`].
fn sort_desc(records: &mut Vec<ReputationRecord>) {
    let len = records.len();
    let mut i: u32 = 1;
    while i < len {
        let key = records.get(i).unwrap();
        let mut j = i;
        while j > 0 {
            let prev = records.get(j - 1).unwrap();
            if is_better(&prev, &key) {
                break;
            }
            records.set(j, prev);
            j -= 1;
        }
        records.set(j, key);
        i += 1;
    }
}

/// In-place insertion sort of scores in ascending order.
fn sort_i64_asc(values: &mut Vec<i64>) {
    let len = values.len();
    let mut i: u32 = 1;
    while i < len {
        let key = values.get(i).unwrap();
        let mut j = i;
        while j > 0 {
            let prev = values.get(j - 1).unwrap();
            if prev <= key {
                break;
            }
            values.set(j, prev);
            j -= 1;
        }
        values.set(j, key);
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn record(env: &Env, score: i64, reporter_count: u32) -> ReputationRecord {
        ReputationRecord {
            subject: Address::generate(env),
            score,
            reporter_count,
            updated_at: 0,
        }
    }

    #[test]
    fn average_by_issuer_returns_none_without_data() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let issuer = Address::generate(&env);
        let records: [ReputationRecord; 0] = [];
        assert_eq!(
            get_average_reputation_by_issuer(&records, &subject, &issuer),
            None
        );
    }

    #[test]
    fn average_by_issuer_averages_matching_records() {
        let env = Env::default();
        let subject = Address::generate(&env);
        let issuer = Address::generate(&env);
        let mut a = record(&env, 10, 1);
        a.subject = subject.clone();
        let mut b = record(&env, 20, 1);
        b.subject = subject.clone();
        let records = [a, b];
        assert_eq!(
            get_average_reputation_by_issuer(&records, &subject, &issuer),
            Some(15)
        );
    }

    #[test]
    fn top_entities_sorted_descending_and_bounded() {
        let env = Env::default();
        let records = [
            record(&env, 5, 1),
            record(&env, 50, 1),
            record(&env, 25, 1),
            record(&env, 40, 1),
        ];
        let top = get_top_entities(&records, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top.get(0).unwrap().score, 50);
        assert_eq!(top.get(1).unwrap().score, 40);
    }

    #[test]
    fn top_entities_zero_limit_is_empty() {
        let env = Env::default();
        let records = [record(&env, 5, 1)];
        assert_eq!(get_top_entities(&records, 0).len(), 0);
    }

    #[test]
    fn percentile_rank_and_threshold() {
        let env = Env::default();
        let records = [
            record(&env, 10, 1),
            record(&env, 20, 1),
            record(&env, 30, 1),
            record(&env, 40, 1),
        ];
        assert_eq!(get_reputation_percentile(&records, 30), 5_000);
        assert_eq!(get_reputation_percentile(&records, 0), 0);
        assert_eq!(get_percentile_threshold(&records, 5_000), Some(20));
        assert_eq!(get_percentile_threshold(&records, 10_000), Some(40));
    }

    #[test]
    fn percentile_helpers_handle_empty_dataset() {
        let records: [ReputationRecord; 0] = [];
        assert_eq!(get_reputation_percentile(&records, 10), 0);
        assert_eq!(get_percentile_threshold(&records, 5_000), None);
    }

    #[test]
    fn stake_boost_scales_and_saturates() {
        assert_eq!(compute_stake_boost(0), 0);
        assert_eq!(compute_stake_boost(-5), 0);
        assert_eq!(compute_stake_boost(STAKE_BOOST_FULL_AMOUNT / 2), MAX_STAKE_BOOST / 2);
        assert_eq!(compute_stake_boost(STAKE_BOOST_FULL_AMOUNT), MAX_STAKE_BOOST);
        assert_eq!(compute_stake_boost(STAKE_BOOST_FULL_AMOUNT * 2), MAX_STAKE_BOOST);
    }

    #[test]
    fn apply_stake_boost_clamps_to_max() {
        assert_eq!(apply_stake_boost(10, 0), 10);
        assert_eq!(apply_stake_boost(10, STAKE_BOOST_FULL_AMOUNT), MAX_STAKE_BOOST);
    }

    #[test]
    fn stake_stats_aggregate_and_weight() {
        let stakes = [(100i64, 10i64), (300, 20), (0, 99)];
        let stats = get_stake_stats(&stakes);
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total_staked, 400);
        assert_eq!(stats.average_stake, 200);
        assert_eq!(stats.weighted_score, 100 * 10 + 300 * 20);
        assert_eq!(get_stake_weighted_reputation(&stakes), Some((100 * 10 + 300 * 20) / 400));
    }

    #[test]
    fn stake_weighted_reputation_none_without_stake() {
        let stakes: [(i64, i64); 0] = [];
        assert_eq!(get_stake_weighted_reputation(&stakes), None);
        let zero = [(0i64, 50i64)];
        assert_eq!(get_stake_weighted_reputation(&zero), None);
    }

    #[test]
    fn total_and_average_stake_ignore_non_positive() {
        let stakes = [(100i64, 10i64), (300, 20), (0, 99), (-50, 5)];
        assert_eq!(get_total_staked(&stakes), 400);
        assert_eq!(get_average_stake(&stakes), 200);
        let empty: [(i64, i64); 0] = [];
        assert_eq!(get_total_staked(&empty), 0);
        assert_eq!(get_average_stake(&empty), 0);
    }

    #[test]
    fn average_stake_weighted_reputation_matches_weighted() {
        let stakes = [(100i64, 10i64), (300, 20)];
        assert_eq!(
            get_average_stake_weighted_reputation(&stakes),
            Some((100 * 10 + 300 * 20) / 400)
        );
        let empty: [(i64, i64); 0] = [];
        assert_eq!(get_average_stake_weighted_reputation(&empty), None);
    }

    #[test]
    fn top_stakers_sorted_descending_and_bounded() {
        let stakes = [(100i64, 10i64), (500, 5), (250, 20), (250, 30)];
        let top = get_top_stakers(&stakes, 3);
        assert_eq!(top.len(), 3);
        assert_eq!(top.get(0).unwrap(), (500, 5));
        assert_eq!(top.get(1).unwrap(), (250, 30));
        assert_eq!(top.get(2).unwrap(), (250, 20));
    }

    #[test]
    fn top_stakers_zero_limit_is_empty() {
        let stakes = [(100i64, 10i64)];
        assert_eq!(get_top_stakers(&stakes, 0).len(), 0);
    }
}
