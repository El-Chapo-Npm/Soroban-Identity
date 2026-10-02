use super::any_addr;
use crate::revocation::{Op, Registry, BITMAP_WORDS, CREDS};
use crate::{Abort, ADDRS};

fn any_registry() -> Registry {
    let r: Registry = kani::any();
    kani::assume(r.well_formed());
    r
}

fn any_op() -> Op {
    let op: Op = kani::any();
    kani::assume(op.well_formed());
    op
}

/// INV-RR-1: every record points into its issuer's existing bitmap.
fn records_in_bounds(r: &Registry) -> bool {
    r.records.iter().flatten().all(|rec| {
        r.bitmaps[rec.issuer as usize].map_or(false, |b| rec.index < b.word_count * 64)
    })
}

/// Active records: each one's bit is set, and no two share a bit.
fn records_consistent(r: &Registry) -> bool {
    let active: Vec<_> = r.records.iter().flatten().filter(|x| !x.reversed).collect();
    active.iter().all(|x| r.is_revoked(x.issuer, x.index))
        && active.iter().enumerate().all(|(i, x)| {
            active[i + 1..].iter().all(|y| (x.issuer, x.index) != (y.issuer, y.index))
        })
}

fn set_bits(r: &Registry) -> u32 {
    r.bitmaps
        .iter()
        .flatten()
        .map(|b| b.words[..b.word_count as usize].iter().map(|w| w.count_ones()).sum::<u32>())
        .sum()
}

/// S-RR-1: no call can panic on a bitmap index. Out-of-range indices are
/// rejected with a typed error. Capacity overflow is covered separately by
/// `rr_init_bitmap_capacity_no_overflow`.
#[kani::proof]
#[kani::unwind(5)]
fn rr_no_index_panic() {
    let mut r = any_registry();
    kani::assume(records_in_bounds(&r));
    let op = any_op();
    if let Op::InitBitmap { capacity, .. } = op {
        kani::assume(capacity <= u32::MAX - 63);
    }
    let result = op.apply(&mut r, any_addr());
    assert!(!matches!(result, Err(Abort::Panic(_))));
    assert!(records_in_bounds(&r));
}

/// S-RR-2: `init_bitmap` never overflows. EXPECTED FAIL (finding RR-3):
/// `capacity + 63` overflows for capacity > u32::MAX - 63.
#[kani::proof]
fn rr_init_bitmap_capacity_no_overflow() {
    let mut r = any_registry();
    let issuer = any_addr();
    let _ = r.init_bitmap(issuer, issuer, kani::any());
}

/// S-RR-3 (INV-RR-2): active records and set bits are in one-to-one
/// correspondence, and REV_COUNT counts them. As a consequence, every
/// revoked slot can be reversed through its record. EXPECTED FAIL (finding
/// RR-1): revoking an already-revoked credential id at a new index
/// overwrites its record and orphans the old bit.
#[kani::proof]
#[kani::unwind(5)]
fn rr_bits_records_and_count_agree() {
    let mut r = any_registry();
    kani::assume(records_in_bounds(&r));
    kani::assume(records_consistent(&r));
    kani::assume(set_bits(&r) == r.active_records());
    kani::assume(r.rev_count == r.active_records());
    let op = any_op();
    if let Op::InitBitmap { capacity, .. } = op {
        kani::assume(capacity <= u32::MAX - 63);
    }
    let _ = op.apply(&mut r, any_addr());
    assert!(records_consistent(&r));
    assert_eq!(set_bits(&r), r.active_records());
    assert_eq!(r.rev_count, r.active_records());
}

/// S-RR-4: an active revocation record can only be changed by its own issuer
/// or by the admin. EXPECTED FAIL (finding RR-2): any issuer can overwrite
/// the record for another issuer's credential id.
#[kani::proof]
fn rr_record_owned_by_issuer() {
    let mut r = any_registry();
    let before = r.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut r, signer);
    let cred: usize = kani::any();
    kani::assume(cred < CREDS);
    if let Some(old) = before.records[cred] {
        if !old.reversed && r.records[cred] != Some(old) {
            assert!(signer == old.issuer || Some(signer) == before.admin);
        }
    }
}

/// S-RR-5: only a bitmap's issuer or the admin clears a bit in it.
#[kani::proof]
fn rr_only_issuer_or_admin_clears() {
    let mut r = any_registry();
    let before = r.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut r, signer);
    let issuer: usize = kani::any();
    let word: usize = kani::any();
    kani::assume(issuer < ADDRS && word < BITMAP_WORDS as usize);
    if let (Some(old), Some(new)) = (before.bitmaps[issuer], r.bitmaps[issuer]) {
        if old.words[word] & !new.words[word] != 0 {
            assert!(signer as usize == issuer || Some(signer) == before.admin);
        }
    }
}
