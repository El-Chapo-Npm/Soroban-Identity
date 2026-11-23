//! Kani proof harnesses (#957). Each harness proves one specification from
//! `SPECIFICATIONS.md`, and its doc comment names that specification.
//!
//! Harnesses marked `EXPECTED FAIL` exercise a defect recorded in
//! `RESULTS.md`. They fail against the current contracts and pass with
//! `--features patched`.
//!
//! Two styles are used:
//!
//! - **Inductive:** start from an *arbitrary* state that satisfies the
//!   invariant, apply one *arbitrary* call from an arbitrary signer, and assert
//!   that the invariant still holds. This covers every reachable state
//!   without enumerating traces.
//! - **Trace:** a fixed call sequence with symbolic arguments, for properties
//!   that only make sense across several calls.

mod credential;
mod did_resolver;
mod governance;
mod identity;
mod presentation;
mod revocation;
mod staking;

use crate::{Addr, ADDRS};

pub(crate) fn any_addr() -> Addr {
    let a: Addr = kani::any();
    kani::assume((a as usize) < ADDRS);
    a
}

/// Ledger timestamps: bounded well below u64::MAX, so "now + period" can
/// never overflow. Real ledger times are about 2^31.
pub(crate) fn any_time() -> u64 {
    let t: u64 = kani::any();
    kani::assume(t < 1 << 62);
    t
}

/// A non-zero token amount bounded well below u64::MAX, so sums of a few
/// amounts can never overflow. Used by staking and presentation harnesses.
pub(crate) fn any_amount() -> u64 {
    let a: u64 = kani::any();
    kani::assume(a > 0);
    kani::assume(a < 1 << 62);
    a
}

/// A bounded cooldown / expiry period, small enough that "now + period"
/// stays below the timestamp bound enforced by `any_time`.
pub(crate) fn any_period() -> u64 {
    let p: u64 = kani::any();
    kani::assume(p < 1 << 61);
    p
}

/// A DID method selector covering the supported resolver methods plus the
/// custom-plugin slot. Kept in sync with the resolver's method enum.
pub(crate) fn any_did_method() -> u8 {
    let m: u8 = kani::any();
    kani::assume(m < 4);
    m
}