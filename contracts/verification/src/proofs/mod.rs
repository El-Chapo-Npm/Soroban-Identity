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
mod governance;
mod identity;
mod revocation;

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
