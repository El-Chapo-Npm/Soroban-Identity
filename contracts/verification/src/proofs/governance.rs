use super::{any_addr, any_time};
use crate::governance::{Governance, VOTING_PERIOD};
use crate::ADDRS;

fn any_governance() -> Governance {
    let g: Governance = kani::any();
    kani::assume(g.well_formed());
    g
}

/// Bounds that keep the arithmetic out of overflow territory, for the
/// harnesses that are *not* about overflow. GOV-3 covers overflow.
fn assume_small(g: &Governance) {
    for w in g.weights.iter().flatten() {
        kani::assume(*w < 1 << 32);
    }
    kani::assume(g.timelock_seconds < 1 << 32);
    if let Some(p) = g.proposal {
        kani::assume(p.yes_votes < 1 << 40 && p.no_votes < 1 << 40);
        kani::assume(p.voting_ends_at < 1 << 62 && p.timelock_seconds < 1 << 32);
    }
}

/// S-GOV-1: `execute_proposal` never divides by zero. This holds because
/// quorum_pct >= 1 (INV-GOV-1), and a proposal with zero votes therefore fails
/// the quorum check before the threshold division.
#[kani::proof]
fn gov_execute_never_divides_by_zero() {
    let mut g = any_governance();
    assume_small(&g);
    let caller = any_addr();
    let _ = g.execute(caller, caller, any_time());
}

/// S-GOV-2: an address votes at most once per proposal.
#[kani::proof]
fn gov_single_vote_per_address() {
    let mut g = any_governance();
    assume_small(&g);
    let voter = any_addr();
    let now = any_time();
    let first = g.vote(voter, voter, kani::any(), now);
    if first.is_ok() {
        let tally = g.proposal.map(|p| (p.yes_votes, p.no_votes));
        assert!(g.vote(voter, voter, kani::any(), now).is_err());
        assert_eq!(tally, g.proposal.map(|p| (p.yes_votes, p.no_votes)));
    }
}

/// S-GOV-3: a proposal executes at most once, and never before the end of
/// voting plus its timelock.
#[kani::proof]
fn gov_execution_once_and_after_timelock() {
    let mut g = any_governance();
    assume_small(&g);
    let caller = any_addr();
    let now = any_time();
    let was_executed = g.proposal.map_or(false, |p| p.executed);
    if g.execute(caller, caller, now).is_ok() {
        assert!(!was_executed);
        let p = g.proposal.unwrap();
        assert!(p.executed);
        assert!(now >= p.voting_ends_at + p.timelock_seconds);
        assert!(g.execute(caller, caller, now).is_err());
    }
}

/// S-GOV-4: a proposal can never count more votes than the total voting
/// power. EXPECTED FAIL (finding GOV-1): an address missing from the weight
/// map votes with weight 1, which `total_voting_power` does not include. With
/// an empty map, one vote meets 100% quorum.
#[kani::proof]
fn gov_tally_bounded_by_total_power() {
    let mut g = any_governance();
    assume_small(&g);
    g.delegations = [None; ADDRS];
    let t0 = any_time();
    g.propose(0, 0, kani::any(), t0).unwrap();
    for voter in 0..ADDRS as u8 {
        let _ = g.vote(voter, voter, kani::any(), t0);
    }
    let p = g.proposal.unwrap();
    assert!(p.yes_votes + p.no_votes <= g.total_voting_power());
}

/// S-GOV-5: after delegating, the delegator's own vote adds nothing, and the
/// delegate carries the delegated weight. EXPECTED FAIL (finding GOV-2):
/// delegations are stored but never read, so the delegator keeps voting in
/// full.
#[kani::proof]
fn gov_delegation_moves_voting_power() {
    let mut g = any_governance();
    assume_small(&g);
    g.delegations = [None; ADDRS];
    let (a, b) = (any_addr(), any_addr());
    kani::assume(a != b);
    // Both parties are registered voters, so GOV-1 cannot interfere.
    let (wa, wb) = (g.weights[a as usize], g.weights[b as usize]);
    kani::assume(wa.is_some() && wb.is_some());
    let t0 = any_time();
    g.propose(a, a, kani::any(), t0).unwrap();
    g.delegate(a, a, b).unwrap();
    let _ = g.vote(a, a, true, t0);
    assert_eq!(g.proposal.unwrap().yes_votes, 0);
    g.vote(b, b, true, t0).unwrap();
    assert_eq!(g.proposal.unwrap().yes_votes, wa.unwrap() + wb.unwrap());
}

/// S-GOV-6: tallying and execution never overflow, for any weight table the
/// admin can set. EXPECTED FAIL (finding GOV-3): weights are unbounded, so
/// `yes_votes + power`, the weight sum and `total_votes * 100` can all
/// overflow.
#[kani::proof]
fn gov_no_arithmetic_overflow() {
    let mut g = any_governance();
    g.delegations = [None; ADDRS];
    g.proposal = None;
    kani::assume(g.timelock_seconds < 1 << 32);
    let admin = g.admin.unwrap_or(0);
    g.admin = Some(admin);
    let _ = g.set_voting_weights(admin, admin, kani::any());
    let t0 = any_time();
    g.propose(0, 0, false, t0).unwrap();
    for voter in 0..ADDRS as u8 {
        let _ = g.vote(voter, voter, kani::any(), t0);
    }
    let _ = g.execute(0, 0, t0 + VOTING_PERIOD + g.timelock_seconds);
}
