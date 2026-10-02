use super::{any_addr, any_time};
use crate::credential::{Manager, Op, CREDS};

fn any_manager() -> Manager {
    let m: Manager = kani::any();
    kani::assume(m.well_formed());
    m
}

fn any_op() -> Op {
    let op: Op = kani::any();
    kani::assume(op.well_formed());
    op
}

fn any_id() -> usize {
    let id: usize = kani::any();
    kani::assume(id < CREDS);
    id
}

/// S-CM-1: a credential comes into existence only through a call signed by
/// its issuer, while that issuer is registered and the contract is unpaused.
#[kani::proof]
fn cm_issuance_requires_registered_issuer() {
    let mut m = any_manager();
    let before = m.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut m, signer, any_time());
    let id = any_id();
    if let (None, Some(c)) = (before.creds[id], m.creds[id]) {
        assert_eq!(signer, c.issuer);
        assert!(before.issuers[c.issuer as usize]);
        assert!(!before.paused);
        assert!(!c.revoked);
    }
}

/// S-CM-2: revocation is permanent. No call un-revokes a credential or
/// deletes one.
#[kani::proof]
fn cm_revocation_is_permanent() {
    let mut m = any_manager();
    let before = m.clone();
    let _ = any_op().apply(&mut m, any_addr(), any_time());
    let id = any_id();
    if let Some(old) = before.creds[id] {
        let new = m.creds[id].expect("credentials are never deleted");
        assert!(!old.revoked || new.revoked);
        assert_eq!((old.issuer, old.subject), (new.issuer, new.subject));
    }
}

/// S-CM-3: only the issuer revokes a credential early, and anyone else can
/// only mark it revoked after its expiry has passed.
#[kani::proof]
fn cm_revocation_is_authorised() {
    let mut m = any_manager();
    let before = m.clone();
    let (signer, now) = (any_addr(), any_time());
    let _ = any_op().apply(&mut m, signer, now);
    let id = any_id();
    if let (Some(old), Some(new)) = (before.creds[id], m.creds[id]) {
        if !old.revoked && new.revoked {
            assert!(signer == old.issuer || (old.expires_at != 0 && now > old.expires_at));
        }
    }
}

/// S-CM-4: only the issuer changes a credential's expiry, and only forwards.
#[kani::proof]
fn cm_renewal_is_authorised_and_monotonic() {
    let mut m = any_manager();
    let before = m.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut m, signer, any_time());
    let id = any_id();
    if let (Some(old), Some(new)) = (before.creds[id], m.creds[id]) {
        if old.expires_at != new.expires_at {
            assert_eq!(signer, old.issuer);
            assert!(new.expires_at > old.expires_at);
            assert!(!old.revoked);
        }
    }
}

/// S-CM-5: a de-registered issuer can no longer extend the validity of any
/// credential. EXPECTED FAIL (finding CM-1): `renew_credential` does not call
/// `require_issuer`.
#[kani::proof]
fn cm_deregistered_issuer_cannot_extend_validity() {
    let mut m = any_manager();
    let before = m.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut m, signer, any_time());
    let id = any_id();
    if let (Some(old), Some(new)) = (before.creds[id], m.creds[id]) {
        if new.expires_at != old.expires_at {
            assert!(before.issuers[signer as usize]);
        }
    }
}

/// S-CM-6: `verify_credential` succeeds only for an existing, unrevoked,
/// unexpired credential.
#[kani::proof]
fn cm_verify_is_sound() {
    let m = any_manager();
    let (id, now) = (any_id(), any_time());
    if m.verify(id as u8, now).is_ok() {
        let c = m.creds[id].unwrap();
        assert!(!c.revoked);
        assert!(c.expires_at == 0 || now <= c.expires_at);
    }
}

/// S-CM-7: while paused, no credential changes.
#[kani::proof]
fn cm_pause_freezes_credentials() {
    let mut m = any_manager();
    kani::assume(m.paused);
    let before = m.clone();
    let _ = any_op().apply(&mut m, any_addr(), any_time());
    assert_eq!(m.creds, before.creds);
}

/// S-CM-8 (INV-CM-1): REVOKED_CNT equals the number of revoked credentials.
#[kani::proof]
fn cm_revoked_count_matches() {
    let mut m = any_manager();
    kani::assume(m.revoked_cnt == m.revoked_total());
    let _ = any_op().apply(&mut m, any_addr(), any_time());
    assert_eq!(m.revoked_cnt, m.revoked_total());
}

/// S-CM-9: only the admin changes the issuer set or the pause flag.
#[kani::proof]
fn cm_admin_controls_are_admin_only() {
    let mut m = any_manager();
    let before = m.clone();
    let signer = any_addr();
    let _ = any_op().apply(&mut m, signer, any_time());
    if m.issuers != before.issuers || m.paused != before.paused {
        assert_eq!(Some(signer), before.admin);
    }
}
