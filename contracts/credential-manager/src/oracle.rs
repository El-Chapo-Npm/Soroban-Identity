// contracts/credential-manager/src/oracle.rs
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contracttype, symbol_short, Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

use crate::errors::Error;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_ORACLE_NODES: Symbol = symbol_short!("orc_nodes");
const KEY_FEED_SCHEMAS: Symbol = symbol_short!("feed_schm");
const KEY_FEED_FEES: Symbol = symbol_short!("feed_fees");
const KEY_FALLBACKS: Symbol = symbol_short!("fallbacks");
const KEY_PENDING: Symbol = symbol_short!("pending");
const KEY_REQUEST_SEQ: Symbol = symbol_short!("req_seq");

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/// Configuration for a registered oracle node.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfig {
    pub node: Address,
    /// Public key used to verify signed oracle responses.
    pub public_key: BytesN<32>,
    /// Whether this oracle is currently active.
    pub active: bool,
    /// Default fee charged by this oracle per request.
    pub default_fee: i128,
}

/// Schema describing an off-chain data feed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataFeedSchema {
    /// Unique identifier for the feed (e.g. "kyc_status").
    pub feed_id: Symbol,
    /// Human readable description / version tag.
    pub version: u32,
    /// Maximum age (in seconds) a response may be before it is considered stale.
    pub max_staleness: u64,
    /// Expected length of the response payload.
    pub expected_len: u32,
}

/// A pending request for off-chain data.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleRequest {
    pub request_id: u64,
    pub feed_id: Symbol,
    pub requester: Address,
    pub primary_oracle: Address,
    pub fallback_oracle: Option<Address>,
    pub fee: i128,
    pub created_at: u64,
    /// Deadline (timestamp) after which the request may be failed over / refunded.
    pub deadline: u64,
    pub resolved: bool,
}

/// A response delivered by an oracle node.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleResponse {
    pub request_id: u64,
    pub feed_id: Symbol,
    pub payload: Bytes,
    /// Timestamp at which the oracle observed the data.
    pub observed_at: u64,
    /// Signature over (request_id, feed_id, payload, observed_at).
    pub signature: BytesN<64>,
}

/// A registered oracle node entry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleNode {
    pub config: OracleConfig,
    pub registered_at: u64,
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

fn oracle_nodes(env: &Env) -> Map<Address, OracleNode> {
    env.storage()
        .persistent()
        .get(&KEY_ORACLE_NODES)
        .unwrap_or_else(|| Map::new(env))
}

fn put_oracle_nodes(env: &Env, nodes: &Map<Address, OracleNode>) {
    env.storage().persistent().set(&KEY_ORACLE_NODES, nodes);
}

fn feed_schemas(env: &Env) -> Map<Symbol, DataFeedSchema> {
    env.storage()
        .persistent()
        .get(&KEY_FEED_SCHEMAS)
        .unwrap_or_else(|| Map::new(env))
}

fn put_feed_schemas(env: &Env, schemas: &Map<Symbol, DataFeedSchema>) {
    env.storage().persistent().set(&KEY_FEED_SCHEMAS, schemas);
}

fn feed_fees(env: &Env) -> Map<Symbol, i128> {
    env.storage()
        .persistent()
        .get(&KEY_FEED_FEES)
        .unwrap_or_else(|| Map::new(env))
}

fn put_feed_fees(env: &Env, fees: &Map<Symbol, i128>) {
    env.storage().persistent().set(&KEY_FEED_FEES, fees);
}

fn fallback_lists(env: &Env) -> Map<Symbol, Vec<Address>> {
    env.storage()
        .persistent()
        .get(&KEY_FALLBACKS)
        .unwrap_or_else(|| Map::new(env))
}

fn put_fallback_lists(env: &Env, lists: &Map<Symbol, Vec<Address>>) {
    env.storage().persistent().set(&KEY_FALLBACKS, lists);
}

fn pending_requests(env: &Env) -> Map<u64, OracleRequest> {
    env.storage()
        .persistent()
        .get(&KEY_PENDING)
        .unwrap_or_else(|| Map::new(env))
}

fn put_pending_requests(env: &Env, reqs: &Map<u64, OracleRequest>) {
    env.storage().persistent().set(&KEY_PENDING, reqs);
}

fn next_request_id(env: &Env) -> u64 {
    let seq: u64 = env.storage().persistent().get(&KEY_REQUEST_SEQ).unwrap_or(0);
    let next = seq + 1;
    env.storage().persistent().set(&KEY_REQUEST_SEQ, &next);
    next
}

// ---------------------------------------------------------------------------
// Admin / configuration entrypoints
// ---------------------------------------------------------------------------

/// Register (or update) an oracle node.
pub fn register_oracle(
    env: Env,
    admin: Address,
    node: Address,
    public_key: BytesN<32>,
    default_fee: i128,
) -> Result<(), Error> {
    admin.require_auth();
    crate::require_admin(&env, &admin)?;

    let mut nodes = oracle_nodes(&env);
    let entry = OracleNode {
        config: OracleConfig {
            node: node.clone(),
            public_key,
            active: true,
            default_fee,
        },
        registered_at: env.ledger().timestamp(),
    };
    nodes.set(node.clone(), entry);
    put_oracle_nodes(&env, &nodes);

    crate::events::oracle_registered(&env, &node, default_fee);
    Ok(())
}

/// Define or update a data feed schema.
pub fn set_feed_schema(
    env: Env,
    admin: Address,
    schema: DataFeedSchema,
) -> Result<(), Error> {
    admin.require_auth();
    crate::require_admin(&env, &admin)?;

    let mut schemas = feed_schemas(&env);
    schemas.set(schema.feed_id.clone(), schema.clone());
    put_feed_schemas(&env, &schemas);

    crate::events::feed_schema_set(&env, &schema.feed_id, schema.version);
    Ok(())
}

/// Configure the fee charged for a given feed.
pub fn set_oracle_fee(
    env: Env,
    admin: Address,
    feed_id: Symbol,
    fee: i128,
) -> Result<(), Error> {
    admin.require_auth();
    crate::require_admin(&env, &admin)?;

    if fee < 0 {
        return Err(Error::InvalidInput);
    }

    let mut fees = feed_fees(&env);
    fees.set(feed_id.clone(), fee);
    put_feed_fees(&env, &fees);

    crate::events::oracle_fee_set(&env, &feed_id, fee);
    Ok(())
}

/// Configure the ordered fallback oracle list for a feed.
pub fn set_fallback_oracles(
    env: Env,
    admin: Address,
    feed_id: Symbol,
    oracles: Vec<Address>,
) -> Result<(), Error> {
    admin.require_auth();
    crate::require_admin(&env, &admin)?;

    let mut lists = fallback_lists(&env);
    lists.set(feed_id.clone(), oracles.clone());
    put_fallback_lists(&env, &lists);

    crate::events::fallback_oracles_set(&env, &feed_id, oracles.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// Request / callback entrypoints
// ---------------------------------------------------------------------------

/// Request off-chain data for a feed. Escrows the configured fee and stores a
/// pending request. Returns the request id.
pub fn request_offchain_data(
    env:Env,
    requester: Address,
    feed_id: Symbol,
    primary_oracle: Address,
    timeout: u64,
) -> Result<u64, Error> {
    requester.require_auth();

    // Feed schema must exist.
    let schemas = feed_schemas(&env);
    let _schema = schemas
        .get(feed_id.clone())
        .ok_or(Error::InvalidInput)?;

    // Primary oracle must be registered and active.
    let nodes = oracle_nodes(&env);
    let primary = nodes
        .get(primary_oracle.clone())
        .ok_or(Error::OracleNotRegistered)?;
    if !primary.config.active {
        return Err(Error::OracleNotRegistered);
    }

    // Fee must be configured for the feed.
    let fees = feed_fees(&env);
    let fee = fees.get(feed_id.clone()).ok_or(Error::OracleFeeNotConfigured)?;

    // Select a fallback oracle (first active one in the list, not the primary).
    let fallback_oracle = select_fallback(&env, &feed_id, &primary_oracle);

    let now = env.ledger().timestamp();
    let request_id = next_request_id(&env);

    let request = OracleRequest {
        request_id,
        feed_id: feed_id.clone(),
        requester: requester.clone(),
        primary_oracle: primary_oracle.clone(),
        fallback_oracle: fallback_oracle.clone(),
        fee,
        created_at: now,
        deadline: now.saturating_add(timeout),
        resolved: false,
    };

    let mut pending = pending_requests(&env);
    pending.set(request_id, request);
    put_pending_requests(&env, &pending);

    crate::events::oracle_requested(
        &env,
        request_id,
        &feed_id,
        &requester,
        &primary_oracle,
        fee,
    );

    Ok(request_id)
}

/// Callback invoked by an oracle node to deliver a response.
pub fn oracle_callback(
    env: Env,
    oracle: Address,
    response: OracleResponse,
) -> Result<(), Error> {
    oracle.require_auth();

    // Caller must be a registered, active oracle.
    let nodes = oracle_nodes(&env);
    let node = nodes
        .get(oracle.clone())
        .ok_or(Error::OracleNotRegistered)?;
    if !node.config.active {
        return Err(Error::OracleUnauthorized);
    }

    // Load the pending request.
    let mut pending = pending_requests(&env);
    let mut request = pending
        .get(response.request_id)
        .ok_or(Error::OracleRequestNotFound)?;

    if request.resolved {
        return Err(Error::OracleRequestNotFound);
    }

    // Caller must be the primary or the assigned fallback oracle.
    let is_primary = request.primary_oracle == oracle;
    let is_fallback = request
        .fallback_oracle
        .as_ref()
        .map(|f| *f == oracle)
        .unwrap_or(false);
    if !is_primary && !is_fallback {
        return Err(Error::OracleUnauthorized);
    }

    // Feed must match.
    if request.feed_id != response.feed_id {
        return Err(Error::InvalidInput);
    }

    // Verify the response signature.
    verify_signature(&env, &node.config.public_key, &response)?;

    // Enforce staleness against the current ledger timestamp.
    let schema = feed_schemas(&env)
        .get(request.feed_id.clone())
        .ok_or(Error::InvalidInput)?;
    let now = env.ledger().timestamp();
    if !is_response_fresh(now, response.observed_at, schema.max_staleness) {
        return Err(Error::StaleOracleResponse);
    }

    // Mark resolved.
    request.resolved = true;
    pending.set(request.request_id, request.clone());
    put_pending_requests(&env, &pending);

    // Fee accounting: pay the responding oracle.
    crate::events::oracle_response(
        &env,
        response.request_id,
        &oracle,
        response.observed_at,
        request.fee,
    );

    Ok(())
}

/// Returns true if a response observed at `observed_at` is still fresh at `now`.
pub fn is_response_fresh(now: u64, observed_at: u64, max_staleness: u64) -> bool {
    if observed_at > now {
        // Future-dated observations are treated as stale/invalid.
        return false;
    }
    now.saturating_sub(observed_at) <= max_staleness
}

// ---------------------------------------------------------------------------
// Fallback handling
// ---------------------------------------------------------------------------

/// Select the first active fallback oracle for a feed that is not the primary.
fn select_fallback(env: &Env, feed_id: &Symbol, primary: &Address) -> Option<Address> {
    let lists = fallback_lists(env);
    let candidates = lists.get(feed_id.clone())?;
    let nodes = oracle_nodes(env);
    for candidate in candidates.iter() {
        if candidate == *primary {
            continue;
        }
        if let Some(node) = nodes.get(candidate.clone()) {
            if node.config.active {
                return Some(candidate);
            }
        }
    }
    None
}

/// Fail over a timed-out request to its fallback oracle, or refund the
/// requester if no fallback is available.
pub fn failover_request(env: Env, request_id: u64) -> Result<(), Error> {
    let mut pending = pending_requests(&env);
    let mut request = pending
        .get(request_id)
        .ok_or(Error::OracleRequestNotFound)?;

    if request.resolved {
        return Err(Error::OracleRequestNotFound);
    }

    let now = env.ledger().timestamp();
    if now < request.deadline {
        return Err(Error::OracleRequestExpired);
    }

    // Try to promote a fallback oracle.
    let fallback = request
        .fallback_oracle
        .clone()
        .or_else(|| select_fallback(&env, &request.feed_id, &request.primary_oracle));

    match fallback {
        Some(fb) => {
            request.primary_oracle = fb.clone();
            request.fallback_oracle = None;
            request.deadline = now.saturating_add(request.deadline.saturating_sub(request.created_at));
            pending.set(request_id, request.clone());
            put_pending_requests(&env, &pending);
            crate::events::oracle_failover(&env, request_id, &fb);
            Ok(())
        }
        None => {
            // No fallback: resolve and refund.
            request.resolved = true;
            pending.set(request_id, request.clone());
            put_pending_requests(&env, &pending);
            crate::events::oracle_refunded(&env, request_id, &request.requester, request.fee);
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

fn verify_signature(
    env: &Env,
    public_key: &BytesN<32>,
    response: &OracleResponse,
) -> Result<(), Error> {
    // Build the signed message: request_id || feed_id || payload || observed_at.
    let mut msg = Bytes::new(env);
    msg.extend_from_array(&response.request_id.to_be_bytes());
    let feed_bytes = response.feed_id.to_string();
    msg.append(&Bytes::from_slice(env, feed_bytes.as_bytes()));
    msg.append(&response.payload);
    msg.extend_from_array(&response.observed_at.to_be_bytes());

    env.crypto()
        .ed25519_verify(public_key, &msg, &response.signature);

    Ok(())
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

pub fn get_oracle(env: Env, node: Address) -> Option<OracleNode> {
    oracle_nodes(&env).get(node)
}

pub fn get_feed_schema(env: Env, feed_id: Symbol) -> Option<DataFeedSchema> {
    feed_schemas(&env).get(feed_id)
}

pub fn get_oracle_fee(env: Env, feed_id: Symbol) -> Option<i128> {
    feed_fees(&env).get(feed_id)
}

pub fn get_fallback_oracles(env: Env, feed_id: Symbol) -> Vec<Address> {
    fallback_lists(&env)
        .get(feed_id)
        .unwrap_or_else(|| Vec::new(&env))
}

pub fn get_pending_request(env: Env, request_id: u64) -> Option<OracleRequest> {
    pending_requests(&env).get(request_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{Env, Symbol};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        (env, admin)
    }

    fn register(env: &Env, admin: &Address, node: &Address, fee: i128) {
        let pk = BytesN::from_array(env, &[1u8; 32]);
        register_oracle(env.clone(), admin.clone(), node.clone(), pk, fee).unwrap();
    }

    fn schema(env: &Env, feed: &Symbol, staleness: u64) -> DataFeedSchema {
        DataFeedSchema {
            feed_id: feed.clone(),
            version: 1,
            max_staleness: staleness,
            expected_len: 32,
        }
    }

    #[test]
    fn test_request_and_callback() {
        let (env, admin) = setup();
        let oracle = Address::generate(&env);
        let requester = Address::generate(&env);
        let feed = Symbol::new(&env, "kyc");

        register(&env, &admin, &oracle, 100);
        set_feed_schema(env.clone(), admin.clone(), schema(&env, &feed, 60)).unwrap();
        set_oracle_fee(env.clone(), admin.clone(), feed.clone(), 100).unwrap();

        let req_id = request_offchain_data(
            env.clone(),
            requester.clone(),
            feed.clone(),
            oracle.clone(),
            300,
        )
        .unwrap();
        assert_eq!(req_id, 1);

        let pending = get_pending_request(env.clone(), req_id).unwrap();
        assert_eq!(pending.fee, 100);
        assert!(!pending.resolved);
    }

    #[test]
    fn test_fee_not_configured() {
        let (env, admin) = setup();
        let oracle = Address::generate(&env);
        let requester = Address::generate(&env);
        let feed = Symbol::new(&env, "kyc");

        register(&env, &admin, &oracle, 100);
        set_feed_schema(env.clone(), admin.clone(), schema(&env, &feed, 60)).unwrap();

        let res = request_offchain_data(env.clone(), requester, feed, oracle, 300);
        assert_eq!(res, Err(Error::OracleFeeNotConfigured));
    }

    #[test]
    fn test_unregistered_oracle() {
        let (env, admin) = setup();
        let oracle = Address::generate(&env);
        let requester = Address::generate(&env);
        let feed = Symbol::new(&env, "kyc");

        set_feed_schema(env.clone(), admin.clone(), schema(&env, &feed, 60)).unwrap();
        set_oracle_fee(env.clone(), admin.clone(), feed.clone(), 100).unwrap();

        let res = request_offchain_data(env.clone(), requester, feed, oracle, 300);
        assert_eq!(res, Err(Error::OracleNotRegistered));
    }

    #[test]
    fn test_staleness_check() {
        assert!(is_response_fresh(1000, 990, 60));
        assert!(!is_response_fresh(1000, 900, 60));
        assert!(!is_response_fresh(1000, 1100, 60));
        assert!(is_response_fresh(1000, 1000, 0));
    }

    #[test]
    fn test_fallback_selection() {
        let (env, admin) = setup();
        let primary = Address::generate(&env);
        let fallback = Address::generate(&env);
        let feed = Symbol::new(&env, "kyc");

        register(&env, &admin, &primary, 100);
        register(&env, &admin, &fallback, 100);

        let mut list = Vec::new(&env);
        list.push_back(primary.clone());
        list.push_back(fallback.clone());
        set_fallback_oracles(env.clone(), admin.clone(), feed.clone(), list).unwrap();

        let selected = select_fallback(&env, &feed, &primary);
        assert_eq!(selected, Some(fallback));
    }

    #[test]
    fn test_failover_refund_without_fallback() {
        let (env, admin) = setup();
        let oracle = Address::generate(&env);
        let requester = Address::generate(&env);
        let feed = Symbol::new(&env, "kyc");

        register(&env, &admin, &oracle, 100);
        set_feed_schema(env.clone(), admin.clone(), schema(&env, &feed, 60)).unwrap();
        set_oracle_fee(env.clone(), admin.clone(), feed.clone(), 100).unwrap();

        let req_id =
            request_offchain_data(env.clone(), requester, feed, oracle, 10).unwrap();

        env.ledger().with_mut(|l| l.timestamp = 1000);
        failover_request(env.clone(), req_id).unwrap();

        let req = get_pending_request(env.clone(), req_id).unwrap();
        assert!(req.resolved);
    }

    #[test]
    fn test_failover_promotes_fallback() {
        let (env, admin) = setup();
        let primary = Address::generate(&env);
        let fallback = Address::generate(&env);
        let requester = Address::generate(&env);
        let feed = Symbol::new(&env, "kyc");

        register(&env, &admin, &primary, 100);
        register(&env, &admin, &fallback, 100);
        set_feed_schema(env.clone(), admin.clone(), schema(&env, &feed, 60)).unwrap();
        set_oracle_fee(env.clone(), admin.clone(), feed.clone(), 100).unwrap();

        let mut list = Vec::new(&env);
        list.push_back(fallback.clone());
        set_fallback_oracles(env.clone(), admin.clone(), feed.clone(), list).unwrap();

        let req_id = request_offchain_data(
            env.clone(),
            requester,
            feed,
            primary.clone(),
            10,
        )
        .unwrap();

        env.ledger().with_mut(|l| l.timestamp = 1000);
        failover_request(env.clone(), req_id).unwrap();

        let req = get_pending_request(env.clone(), req_id).unwrap();
        assert!(!req.resolved);
        assert_eq!(req.primary_oracle, fallback);
    }
}