#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Map, String, Symbol, Vec,
};

const EVENT_VERSION: u32 = 1;
const ADMIN: Symbol = symbol_short!("ADMIN");
const PROPOSAL: Symbol = symbol_short!("PROPOS");
const PROPOSAL_SEQ: Symbol = symbol_short!("PROSEQ");
const QUORUM: Symbol = symbol_short!("QUORUM");
const THRESHOLD: Symbol = symbol_short!("THRSH");
const TIMELOCK: Symbol = symbol_short!("TIMELOCK");
const VOTING_POWER: Symbol = symbol_short!("VPOWER");
const DELEGATIONS: Symbol = symbol_short!("DELEG");

const TTL_MAX: u32 = 6_312_000;
const TTL_BUMP_THRESHOLD: u32 = TTL_MAX - 518_400;

const DEFAULT_QUORUM: u32 = 30;
const DEFAULT_THRESHOLD: u32 = 60;
const DEFAULT_TIMELOCK_SECONDS: u64 = 48 * 60 * 60;
const DEFAULT_EMERGENCY_THRESHOLD: u32 = 75;
const DEFAULT_EMERGENCY_QUORUM: u32 = 60;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum GovernanceError {
    NotInitialized = 1,
    Unauthorized = 2,
    ProposalNotFound = 3,
    AlreadyVoted = 4,
    VotingClosed = 5,
    QuorumNotMet = 6,
    ThresholdNotMet = 7,
    TimelockActive = 8,
    ProposalExecuted = 9,
    InvalidProposalType = 10,
    InvalidParameter = 11,
    VoteDelegationForbidden = 12,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalType {
    UpgradeContract,
    ChangeAdmin,
    AdjustParameters,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum VoteOption {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GovernanceConfig {
    pub quorum_pct: u32,
    pub threshold_pct: u32,
    pub timelock_seconds: u64,
    pub emergency_quorum_pct: u32,
    pub emergency_threshold_pct: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub proposal_type: ProposalType,
    pub target: Address,
    pub payload: BytesN<32>,
    pub description: String,
    pub emergency: bool,
    pub created_at: u64,
    pub voting_ends_at: u64,
    pub timelock_seconds: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub executed: bool,
    pub voters: Vec<Address>,
}

fn get_proposal(env: &Env, proposal_id: u64) -> Option<Proposal> {
    let key = (PROPOSAL, proposal_id);
    if let Some(proposal) = env.storage().persistent().get::<_, Proposal>(&key) {
        env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
        return Some(proposal);
    }
    let legacy = env.storage().instance().get::<_, Proposal>(&key);
    if let Some(ref proposal) = legacy {
        env.storage().persistent().set(&key, proposal);
        env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
    }
    legacy
}

fn put_proposal(env: &Env, proposal_id: u64, proposal: &Proposal) {
    let key = (PROPOSAL, proposal_id);
    env.storage().persistent().set(&key, proposal);
    env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
}

fn get_voting_weights(env: &Env) -> Map<Address, u64> {
    if let Some(weights) = env.storage().persistent().get::<_, Map<Address, u64>>(&VOTING_POWER) {
        env.storage().persistent().extend_ttl(&VOTING_POWER, TTL_BUMP_THRESHOLD, TTL_MAX);
        return weights;
    }
    match env.storage().instance().get::<_, Map<Address, u64>>(&VOTING_POWER) {
        Some(weights) => {
            env.storage().persistent().set(&VOTING_POWER, &weights);
            env.storage().persistent().extend_ttl(&VOTING_POWER, TTL_BUMP_THRESHOLD, TTL_MAX);
            weights
        }
        None => Map::new(env),
    }
}

fn put_voting_weights(env: &Env, weights: &Map<Address, u64>) {
    env.storage().persistent().set(&VOTING_POWER, weights);
    env.storage().persistent().extend_ttl(&VOTING_POWER, TTL_BUMP_THRESHOLD, TTL_MAX);
}

fn get_delegate(env: &Env, voter: &Address) -> Option<Address> {
    let key = (DELEGATIONS, voter.clone());
    if let Some(delegate) = env.storage().persistent().get::<_, Address>(&key) {
        env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
        return Some(delegate);
    }
    let legacy = env.storage().instance().get::<_, Address>(&key);
    if let Some(ref delegate) = legacy {
        env.storage().persistent().set(&key, delegate);
        env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
    }
    legacy
}

fn put_delegate(env: &Env, voter: &Address, delegate: &Address) {
    let key = (DELEGATIONS, voter.clone());
    env.storage().persistent().set(&key, delegate);
    env.storage().persistent().extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
}

fn remove_delegate(env: &Env, voter: &Address) {
    let key = (DELEGATIONS, voter.clone());
    env.storage().persistent().remove(&key);
    env.storage().instance().remove(&key);
}

#[contract]
pub struct Governance;

#[contractimpl]
impl Governance {
    pub fn initialize(
        env: Env,
        admin: Address,
        quorum_pct: u32,
        threshold_pct: u32,
    ) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(GovernanceError::NotInitialized);
        }
        if quorum_pct == 0 || quorum_pct > 100 || threshold_pct == 0 || threshold_pct > 100 {
            return Err(GovernanceError::InvalidParameter);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&QUORUM, &quorum_pct);
        env.storage().instance().set(&THRESHOLD, &threshold_pct);
        env.storage().instance().set(&TIMELOCK, &DEFAULT_TIMELOCK_SECONDS);
        env.storage().instance().set(&PROPOSAL_SEQ, &0u64);
        env.events().publish(
            (ADMIN, symbol_short!("init")),
            (EVENT_VERSION, admin, quorum_pct, threshold_pct),
        );
        Ok(())
    }

    pub fn set_voting_weights(
        env: Env,
        admin: Address,
        weights: Map<Address, u64>,
    ) -> Result<(), GovernanceError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(GovernanceError::NotInitialized)?;
        if stored_admin != admin {
            return Err(GovernanceError::Unauthorized);
        }
        put_voting_weights(&env, &weights);
        env.events().publish(
            (ADMIN, symbol_short!("weights")),
            (EVENT_VERSION, admin, weights.len() as u32),
        );
        Ok(())
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        proposal_type: ProposalType,
        target: Address,
        description: String,
        payload: BytesN<32>,
        emergency: bool,
    ) -> Result<u64, GovernanceError> {
        proposer.require_auth();
        let seq: u64 = env.storage().instance().get(&PROPOSAL_SEQ).unwrap_or(0);
        let proposal_id = seq + 1;
        env.storage().instance().set(&PROPOSAL_SEQ, &proposal_id);

        let now = env.ledger().timestamp();
        let quorum = Self::config(&env).quorum_pct;
        let threshold = Self::config(&env).threshold_pct;
        let timelock = Self::config(&env).timelock_seconds;
        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            proposal_type: proposal_type.clone(),
            target: target.clone(),
            payload,
            description: description.clone(),
            emergency,
            created_at: now,
            voting_ends_at: now + 86_400,
            timelock_seconds: timelock,
            yes_votes: 0,
            no_votes: 0,
            executed: false,
            voters: Vec::new(&env),
        };
        put_proposal(&env, proposal_id, &proposal);
        env.events().publish(
            (PROPOSAL, symbol_short!("create")),
            (EVENT_VERSION, proposal_id, proposal_type, target, proposer, quorum, threshold, emergency),
        );
        Ok(proposal_id)
    }

    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        support: VoteOption,
    ) -> Result<(), GovernanceError> {
        voter.require_auth();
        let mut proposal: Proposal = get_proposal(&env, proposal_id).ok_or(GovernanceError::ProposalNotFound)?;
        if proposal.executed {
            return Err(GovernanceError::ProposalExecuted);
        }
        if proposal.voters.contains(&voter) {
            return Err(GovernanceError::AlreadyVoted);
        }
        if env.ledger().timestamp() > proposal.voting_ends_at {
            return Err(GovernanceError::VotingClosed);
        }

        let power = Self::voting_power(&env, &voter);
        match support {
            VoteOption::Yes => proposal.yes_votes += power,
            VoteOption::No => proposal.no_votes += power,
        }
        proposal.voters.push_back(voter.clone());
        put_proposal(&env, proposal_id, &proposal);
        env.events().publish(
            (PROPOSAL, symbol_short!("vote")),
            (EVENT_VERSION, proposal_id, voter, support, power),
        );
        Ok(())
    }

    pub fn delegate_vote(env: Env, voter: Address, delegate: Address) -> Result<(), GovernanceError> {
        voter.require_auth();
        if voter == delegate {
            return Err(GovernanceError::VoteDelegationForbidden);
        }
        put_delegate(&env, &voter, &delegate);
        env.events().publish(
            (PROPOSAL, symbol_short!("delegate")),
            (EVENT_VERSION, voter, delegate),
        );
        Ok(())
    }

    pub fn revoke_vote_delegation(env: Env, voter: Address) -> Result<(), GovernanceError> {
        voter.require_auth();
        remove_delegate(&env, &voter);
        env.events().publish(
            (PROPOSAL, symbol_short!("undelg")),
            (EVENT_VERSION, voter),
        );
        Ok(())
    }

    pub fn execute_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), GovernanceError> {
        caller.require_auth();
        let mut proposal: Proposal = get_proposal(&env, proposal_id).ok_or(GovernanceError::ProposalNotFound)?;
        if proposal.executed {
            return Err(GovernanceError::ProposalExecuted);
        }
        if env.ledger().timestamp() < proposal.voting_ends_at {
            return Err(GovernanceError::VotingClosed);
        }

        let total_votes = proposal.yes_votes + proposal.no_votes;
        let config = Self::config(&env);
        let quorum_required = if proposal.emergency {
            config.emergency_quorum_pct
        } else {
            config.quorum_pct
        };
        let threshold_required = if proposal.emergency {
            config.emergency_threshold_pct
        } else {
            config.threshold_pct
        };

        if total_votes * 100 / Self::total_voting_power(&env) < quorum_required as u64 {
            return Err(GovernanceError::QuorumNotMet);
        }
        if proposal.yes_votes * 100 / total_votes < threshold_required as u64 {
            return Err(GovernanceError::ThresholdNotMet);
        }
        if env.ledger().timestamp() < proposal.voting_ends_at + proposal.timelock_seconds {
            return Err(GovernanceError::TimelockActive);
        }

        proposal.executed = true;
        put_proposal(&env, proposal_id, &proposal);
        env.events().publish(
            (PROPOSAL, symbol_short!("exec")),
            (EVENT_VERSION, proposal_id, proposal.proposal_type, proposal.target, caller),
        );
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        get_proposal(&env, proposal_id)
    }

    pub fn get_governance_config(env: Env) -> GovernanceConfig {
        let quorum = env.storage().instance().get(&QUORUM).unwrap_or(DEFAULT_QUORUM);
        let threshold = env.storage().instance().get(&THRESHOLD).unwrap_or(DEFAULT_THRESHOLD);
        let timelock = env.storage().instance().get(&TIMELOCK).unwrap_or(DEFAULT_TIMELOCK_SECONDS);
        GovernanceConfig {
            quorum_pct: quorum,
            threshold_pct: threshold,
            timelock_seconds: timelock,
            emergency_quorum_pct: DEFAULT_EMERGENCY_QUORUM,
            emergency_threshold_pct: DEFAULT_EMERGENCY_THRESHOLD,
        }
    }

    fn config(env: &Env) -> GovernanceConfig {
        Self::get_governance_config(env.clone())
    }

    fn total_voting_power(env: &Env) -> u64 {
        let weights = get_voting_weights(env);
        let mut total: u64 = 0;
        for (_, weight) in weights.iter() {
            total += weight;
        }
        if total == 0 { 1 } else { total }
    }

    fn voting_power(env: &Env, voter: &Address) -> u64 {
        let weights = get_voting_weights(env);
        let effective = get_delegate(env, voter).unwrap_or_else(|| voter.clone());
        weights.get(effective).unwrap_or(1)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::storage::Persistent as _, testutils::Address as _, Env};

    #[test]
    fn governance_profile_smoke() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, Governance);
        let client = GovernanceClient::new(&env, &contract_id);
        client.initialize(&admin, &DEFAULT_QUORUM, &DEFAULT_THRESHOLD);
        let p = client.propose(
            &admin,
            &ProposalType::UpgradeContract,
            &admin,
            &String::from_str(&env, "upgrade to v2"),
            &BytesN::from_array(&env, &[9u8; 32]),
            &false,
        );
        assert!(p > 0);
    }

    #[test]
    fn per_item_state_is_stored_in_persistent_storage() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let delegate = Address::generate(&env);
        let contract_id = env.register_contract(None, Governance);
        let client = GovernanceClient::new(&env, &contract_id);

        client.initialize(&admin, &DEFAULT_QUORUM, &DEFAULT_THRESHOLD);
        let mut weights = Map::new(&env);
        weights.set(admin.clone(), 10);
        client.set_voting_weights(&admin, &weights);
        client.delegate_vote(&admin, &delegate);
        let proposal_id = client.propose(
            &admin,
            &ProposalType::UpgradeContract,
            &admin,
            &String::from_str(&env, "upgrade to v3"),
            &BytesN::from_array(&env, &[8u8; 32]),
            &false,
        );

        env.as_contract(&contract_id, || {
            assert!(env.storage().persistent().has(&(PROPOSAL, proposal_id)));
            assert!(env.storage().persistent().has(&VOTING_POWER));
            assert!(env.storage().persistent().has(&(DELEGATIONS, admin.clone())));
            assert!(!env.storage().instance().has(&(PROPOSAL, proposal_id)));
            assert!(!env.storage().instance().has(&(DELEGATIONS, admin.clone())));
            assert!(env.storage().persistent().get_ttl(&(PROPOSAL, proposal_id)) > TTL_BUMP_THRESHOLD);
        });
        assert_eq!(client.get_proposal(&proposal_id).unwrap().id, proposal_id);
    }
}
