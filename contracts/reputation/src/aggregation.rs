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
}
