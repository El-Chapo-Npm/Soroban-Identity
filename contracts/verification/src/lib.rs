//! Formal models of the Soroban Identity contracts' critical state machines
//! (#957).
//!
//! Each module is a small, pure-Rust model of one contract. It mirrors the
//! contract's access-control checks and state transitions line for line, and
//! abstracts away storage, events, TTLs and metadata, none of which affect the
//! properties being proved. The comments on each model function cite the
//! contract function they model. The model and the contract must change
//! together; see `README.md`.
//!
//! The Kani harnesses in [`proofs`] check the invariants in `INVARIANTS.md`
//! over *all* reachable inputs within the model bounds, rather than over the
//! hand-picked cases a unit test covers.
//!
//! Soroban semantics that the models encode:
//!
//! - **Atomicity:** a call that returns `Err` or panics reverts every write.
//!   [`atomically`] commits a model call's writes only on `Ok`.
//! - **Authorisation:** `Address::require_auth()` traps unless the address
//!   authorised the invocation. Each call has a single `signer`, and
//!   [`require_auth`] fails for any other address.
//! - **Overflow:** the models use plain arithmetic, so Kani flags every
//!   overflow the contract would hit. What that overflow does in production
//!   depends on the build profile; see finding X-1 in `RESULTS.md`.

pub mod credential;
pub mod governance;
pub mod identity;
pub mod revocation;

#[cfg(kani)]
mod proofs;

/// A Stellar address, abstracted to a small integer so that Kani can
/// enumerate every distinct address in a bounded universe.
pub type Addr = u8;

/// Number of distinct addresses in the model universe. Four is enough to give
/// an admin, a pending admin, an attacker and a bystander.
pub const ADDRS: usize = 4;

/// A contract call aborted. The contracts' typed errors are collapsed where
/// the distinction does not matter for any property.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Abort {
    /// `require_auth` failed: the address did not sign.
    AuthFailed,
    /// A typed `ContractError` / `GovernanceError`, named by its variant.
    Error(&'static str),
    /// A `panic!` / `expect` / `unwrap` in contract code.
    Panic(&'static str),
}

pub type CallResult<T = ()> = Result<T, Abort>;

/// Models `Address::require_auth()` for a call signed by `signer`.
pub fn require_auth(signer: Addr, who: Addr) -> CallResult {
    if signer == who {
        Ok(())
    } else {
        Err(Abort::AuthFailed)
    }
}

/// Soroban transaction semantics: `f` runs against a copy of the state, and
/// the copy is committed only when `f` succeeds.
pub fn atomically<S: Clone, T>(state: &mut S, f: impl FnOnce(&mut S) -> CallResult<T>) -> CallResult<T> {
    let mut next = state.clone();
    let result = f(&mut next);
    if result.is_ok() {
        *state = next;
    }
    result
}

pub(crate) fn valid_addr(a: Addr) -> bool {
    (a as usize) < ADDRS
}
