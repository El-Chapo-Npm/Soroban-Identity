//! Model of `governance` (contracts/governance/src/lib.rs): weighted voting,
//! delegation, and timelocked execution of a single proposal.
//!
//! One proposal is enough, because proposals share no state apart from the
//! weight table and the delegation table, and no function reads or writes
//! more than one proposal.

use crate::{atomically, require_auth, valid_addr, Abort, Addr, CallResult, ADDRS};

pub const VOTING_PERIOD: u64 = 86_400;
pub const EMERGENCY_QUORUM: u32 = 60;
pub const EMERGENCY_THRESHOLD: u32 = 75;
/// Proposed cap on the summed voting weight, so `total * 100` cannot overflow.
pub const MAX_TOTAL_WEIGHT: u64 = u64::MAX / 100;

/// Sum of the registered weights, or `None` on overflow.
pub fn weight_sum(weights: &[Option<u64>; ADDRS]) -> Option<u64> {
    weights.iter().flatten().try_fold(0u64, |acc, w| acc.checked_add(*w))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Proposal {
    pub emergency: bool,
    pub voting_ends_at: u64,
    pub timelock_seconds: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub executed: bool,
    pub voters: [bool; ADDRS],
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Governance {
    pub admin: Option<Addr>,
    pub quorum_pct: u32,
    pub threshold_pct: u32,
    pub timelock_seconds: u64,
    /// `VOTING_POWER` map. `None` means "not in the map", which the contract
    /// counts as weight 1.
    pub weights: [Option<u64>; ADDRS],
    /// `(DELEGATIONS, voter)`
    pub delegations: [Option<Addr>; ADDRS],
    pub proposal: Option<Proposal>,
}

impl Governance {
    /// Invariants established by `initialize` and preserved because nothing
    /// else writes QUORUM, THRESHOLD or TIMELOCK.
    pub fn well_formed(&self) -> bool {
        self.admin.map_or(true, valid_addr)
            && (1..=100).contains(&self.quorum_pct)
            && (1..=100).contains(&self.threshold_pct)
            && self.delegations.iter().flatten().all(|d| valid_addr(*d))
            && (!cfg!(feature = "patched") || weight_sum(&self.weights).map_or(false, |t| t <= MAX_TOTAL_WEIGHT))
    }

    /// `voting_power`: absent voters get 1.
    pub fn voting_power(&self, voter: Addr) -> u64 {
        if cfg!(feature = "patched") {
            // Proposed: only registered voters have power, and delegators
            // lose theirs to the delegate.
            if self.delegations[voter as usize].is_some() {
                return 0;
            }
            let own = self.weights[voter as usize].unwrap_or(0);
            let delegated: u64 = (0..ADDRS)
                .filter(|&d| self.delegations[d] == Some(voter))
                .map(|d| self.weights[d].unwrap_or(0))
                .sum();
            return own + delegated;
        }
        self.weights[voter as usize].unwrap_or(1)
    }

    /// `total_voting_power`: the sum over the map, or 1 when that sum is 0.
    pub fn total_voting_power(&self) -> u64 {
        let total: u64 = self.weights.iter().flatten().sum();
        if total == 0 { 1 } else { total }
    }

    /// `set_voting_weights` (restricted to a whole-table replacement).
    pub fn set_voting_weights(&mut self, signer: Addr, admin: Addr, weights: [Option<u64>; ADDRS]) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, admin)?;
            if s.admin.ok_or(Abort::Error("NotInitialized"))? != admin {
                return Err(Abort::Error("Unauthorized"));
            }
            // Contract: weights are stored unchecked (finding GOV-3).
            if cfg!(feature = "patched") && weight_sum(&weights).map_or(true, |t| t > MAX_TOTAL_WEIGHT) {
                return Err(Abort::Error("InvalidParameter"));
            }
            s.weights = weights;
            Ok(())
        })
    }

    /// `propose`: any address may propose.
    pub fn propose(&mut self, signer: Addr, proposer: Addr, emergency: bool, now: u64) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, proposer)?;
            s.proposal = Some(Proposal {
                emergency,
                voting_ends_at: now + VOTING_PERIOD,
                timelock_seconds: s.timelock_seconds,
                yes_votes: 0,
                no_votes: 0,
                executed: false,
                voters: [false; ADDRS],
            });
            Ok(())
        })
    }

    /// `vote`
    pub fn vote(&mut self, signer: Addr, voter: Addr, yes: bool, now: u64) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, voter)?;
            let power = s.voting_power(voter);
            let p = s.proposal.as_mut().ok_or(Abort::Error("ProposalNotFound"))?;
            if p.executed {
                return Err(Abort::Error("ProposalExecuted"));
            }
            if p.voters[voter as usize] {
                return Err(Abort::Error("AlreadyVoted"));
            }
            if now > p.voting_ends_at {
                return Err(Abort::Error("VotingClosed"));
            }
            if yes {
                p.yes_votes += power;
            } else {
                p.no_votes += power;
            }
            p.voters[voter as usize] = true;
            Ok(())
        })
    }

    /// `delegate_vote`
    pub fn delegate(&mut self, signer: Addr, voter: Addr, delegate: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, voter)?;
            if voter == delegate {
                return Err(Abort::Error("VoteDelegationForbidden"));
            }
            s.delegations[voter as usize] = Some(delegate);
            Ok(())
        })
    }

    /// `execute_proposal`
    pub fn execute(&mut self, signer: Addr, caller: Addr, now: u64) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, caller)?;
            let total_power = s.total_voting_power();
            let (quorum_pct, threshold_pct) = (s.quorum_pct, s.threshold_pct);
            let p = s.proposal.as_mut().ok_or(Abort::Error("ProposalNotFound"))?;
            if p.executed {
                return Err(Abort::Error("ProposalExecuted"));
            }
            if now < p.voting_ends_at {
                return Err(Abort::Error("VotingClosed"));
            }
            let total_votes = p.yes_votes + p.no_votes;
            let quorum = if p.emergency { EMERGENCY_QUORUM } else { quorum_pct };
            let threshold = if p.emergency { EMERGENCY_THRESHOLD } else { threshold_pct };
            if total_votes * 100 / total_power < quorum as u64 {
                return Err(Abort::Error("QuorumNotMet"));
            }
            // Division is safe only because quorum >= 1 forces total_votes > 0
            // on this path (property S-GOV-1).
            if p.yes_votes * 100 / total_votes < threshold as u64 {
                return Err(Abort::Error("ThresholdNotMet"));
            }
            if now < p.voting_ends_at + p.timelock_seconds {
                return Err(Abort::Error("TimelockActive"));
            }
            p.executed = true;
            Ok(())
        })
    }
}
