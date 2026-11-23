use super::any_addr;
use crate::identity::{Op, Registry};

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

/// S-ID-1: once initialised, the contract cannot be re-initialised.
#[kani::proof]
fn id_initialize_once() {
    let mut r = any_registry();
    kani::assume(r.admin.is_some());
    let before = r.clone();
    let result = r.initialize(any_addr(), any_addr());
    assert!(result.is_err());
    assert_eq!(r, before);
}

/// S-ID-2 (INV-ID-1): DID_COUNT equals the number of active DIDs.
#[kani::proof]
fn id_did_count_matches_active() {
    let mut r = any_registry();
    kani::assume(r.did_count == r.active_dids());
    let _ = any_op().apply(&mut r, any_addr());
    assert_eq!(r.did_count, r.active_dids());
}

/// S-ID-3 (INV-ID-2): a pending admin proposal was always made by the
/// *current* admin. EXPECTED FAIL (finding ID-1): `transfer_admin` changes
/// ADMIN but leaves PENDING_ADMIN in place.
#[kani::proof]
fn id_pending_admin_nominated_by_current_admin() {
    let mut r = any_registry();
    kani::assume(r.pending_admin.is_none() || (r.pending_nominator.is_some() && r.pending_nominator == r.admin));
    let _ = any_op().apply(&mut r, any_addr());
    assert!(r.pending_admin.is_none() || r.pending_nominator == r.admin);
}

/// S-ID-3, as a concrete attack trace: A proposes B, A then transfers
/// directly to C, and B must no longer be able to take control.
/// EXPECTED FAIL (finding ID-1).
#[kani::proof]
fn id_stale_proposal_cannot_seize_admin() {
    let (a, b, c) = (any_addr(), any_addr(), any_addr());
    kani::assume(a != b && b != c && a != c);
    let mut r = Registry::new();
    r.initialize(a, a).unwrap();
    r.propose_admin(a, a, b).unwrap();
    r.transfer_admin(a, a, c).unwrap();
    let _ = r.accept_admin(b, b);
    assert_eq!(r.admin, Some(c));
}

/// S-ID-4: the admin changes only through a call signed by the current
/// admin, or by the pending admin that the current admin nominated.
#[kani::proof]
fn id_admin_change_is_authorised() {
    let mut r = any_registry();
    kani::assume(r.pending_admin.is_none() || r.pending_nominator == r.admin);
    let before = r.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut r, signer);
    if before.admin.is_some() && r.admin != before.admin {
        assert!(Some(signer) == before.admin || (Some(signer) == before.pending_admin && before.pending_nominator == before.admin));
    }
}

/// S-ID-5: while paused, no DID can be created, deactivated or reactivated.
#[kani::proof]
fn id_pause_freezes_dids() {
    let mut r = any_registry();
    kani::assume(r.paused);
    let before = r.clone();
    let _ = any_op().apply(&mut r, any_addr());
    assert_eq!(r.dids, before.dids);
    assert_eq!(r.did_count, before.did_count);
}

/// S-ID-6: only a DID's controller creates or deactivates it, and only the
/// admin reactivates it.
#[kani::proof]
fn id_did_transitions_are_authorised() {
    let mut r = any_registry();
    let before = r.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut r, signer);
    let who = any_addr() as usize;
    match (before.dids[who], r.dids[who]) {
        (None, Some(_)) => assert_eq!(signer as usize, who),
        (Some(old), Some(new)) if old.active && !new.active => assert_eq!(signer as usize, who),
        (Some(old), Some(new)) if !old.active && new.active => assert_eq!(Some(signer), before.admin),
        (Some(_), None) => panic!("DID documents are never deleted"),
        _ => {}
    }
}
