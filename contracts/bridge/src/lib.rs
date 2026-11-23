#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN,
    Env, String, Symbol, Vec,
};
use soroban_sdk::xdr::ToXdr;

const ADMIN: Symbol = symbol_short!("ADMIN");
const ORACLE: Symbol = symbol_short!("ORACLE");
const CHAINS: Symbol = symbol_short!("CHAINS");
const ROOT: Symbol = symbol_short!("ROOT");
const CACHE: Symbol = symbol_short!("CACHE");
const RATE: Symbol = symbol_short!("RATE");
const EVENT_VERSION: u32 = 1;
const MAX_PROOF_DEPTH: u32 = 32;
const MAX_CACHE_TTL: u64 = 86_400;
const RATE_WINDOW_SECS: u64 = 60;
const MAX_CALLS_PER_WINDOW: u32 = 20;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BridgeError {
    NotInitialized = 1,
    Unauthorized = 2,
    ChainNotSupported = 3,
    InvalidProof = 4,
    ProofTooDeep = 5,
    RateLimited = 6,
    RootExpired = 7,
    CacheMiss = 8,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ChainConfig {
    pub chain_id: u32,
    pub name: String,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StateRoot {
    pub root: BytesN<32>,
    pub valid_until: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CachedDid {
    pub document: Bytes,
    pub cached_until: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RateWindow {
    pub started_at: u64,
    pub calls: u32,
}

#[contract]
pub struct DidBridge;

#[contractimpl]
impl DidBridge {
    pub fn initialize(env: Env, admin: Address, oracle: Address) -> Result<(), BridgeError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(BridgeError::Unauthorized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&ORACLE, &oracle);
        env.storage().instance().set(&CHAINS, &Vec::<u32>::new(&env));
        Ok(())
    }

    pub fn set_chain(env: Env, admin: Address, chain_id: u32, name: String, active: bool) -> Result<(), BridgeError> {
        Self::require_admin(&env, &admin)?;
        // Ethereum mainnet and Polygon mainnet only. Other ids are rejected
        // so a misconfigured oracle cannot invent a chain label.
        if chain_id != 1 && chain_id != 137 {
            return Err(BridgeError::ChainNotSupported);
        }
        let key = (CHAINS, chain_id);
        let existing: Option<ChainConfig> = env.storage().persistent().get(&key);
        if existing.is_none() {
            let mut ids: Vec<u32> = env.storage().instance().get(&CHAINS).unwrap_or_else(|| Vec::new(&env));
            ids.push_back(chain_id);
            env.storage().instance().set(&CHAINS, &ids);
        }
        env.storage().persistent().set(&key, &ChainConfig { chain_id, name, active });
        Ok(())
    }

    /// Oracle-published roots are explicitly time bounded. Production adapters
    /// must publish roots only after validating source-chain finality.
    pub fn publish_state_root(env: Env, oracle: Address, chain_id: u32, root: BytesN<32>, valid_until: u64) -> Result<(), BridgeError> {
        oracle.require_auth();
        let configured: Address = env.storage().instance().get(&ORACLE).ok_or(BridgeError::NotInitialized)?;
        if configured != oracle { return Err(BridgeError::Unauthorized); }
        Self::require_chain(&env, chain_id)?;
        if valid_until <= env.ledger().timestamp() { return Err(BridgeError::RootExpired); }
        env.storage().persistent().set(&(ROOT, chain_id), &StateRoot { root, valid_until });
        Ok(())
    }

    /// Resolves a proof against an oracle-published SHA-256 Merkle root. This
    /// primitive does not implement Ethereum/Polygon consensus or Keccak proof
    /// adapters; callers must not treat it as source-chain finality verification.
    pub fn resolve_external_did(
        env: Env,
        resolver: Address,
        chain_id: u32,
        did_identifier: String,
        document: Bytes,
        siblings: Vec<BytesN<32>>,
        sibling_on_left: Vec<bool>,
    ) -> Result<Bytes, BridgeError> {
        resolver.require_auth();
        Self::require_chain(&env, chain_id)?;
        if siblings.len() > MAX_PROOF_DEPTH || siblings.len() != sibling_on_left.len() {
            return Err(BridgeError::ProofTooDeep);
        }
        Self::check_rate(&env, &resolver)?;
        let cache_key = (CACHE, chain_id, did_identifier.clone());
        if let Some(cached) = env.storage().persistent().get::<_, CachedDid>(&cache_key) {
            if cached.cached_until > env.ledger().timestamp() {
                return Ok(cached.document);
            }
        }
        let root: StateRoot = env.storage().persistent().get(&(ROOT, chain_id)).ok_or(BridgeError::RootExpired)?;
        let now = env.ledger().timestamp();
        if root.valid_until <= now { return Err(BridgeError::RootExpired); }
        let mut leaf_data = did_identifier.clone().to_xdr(&env);
        leaf_data.append(&document.clone().to_xdr(&env));
        let mut node: BytesN<32> = env.crypto().sha256(&leaf_data).into();
        for i in 0..siblings.len() {
            let sibling = siblings.get(i).unwrap();
            let mut pair = Bytes::new(&env);
            if sibling_on_left.get(i).unwrap() { pair.append(&Bytes::from_array(&env, &sibling.to_array())); pair.append(&Bytes::from_array(&env, &node.to_array())); }
            else { pair.append(&Bytes::from_array(&env, &node.to_array())); pair.append(&Bytes::from_array(&env, &sibling.to_array())); }
            node = env.crypto().sha256(&pair).into();
        }
        if node != root.root { return Err(BridgeError::InvalidProof); }
        let cached_until = core::cmp::min(now + MAX_CACHE_TTL, root.valid_until);
        env.storage().persistent().set(&cache_key, &CachedDid { document: document.clone(), cached_until });
        env.events().publish((symbol_short!("bridge"), symbol_short!("resolved")), (EVENT_VERSION, resolver, chain_id, did_identifier));
        Ok(document)
    }

    /// Fresh cache entry for `did_identifier`, if one is still inside its TTL.
    pub fn get_cached_did(env: Env, chain_id: u32, did_identifier: String) -> Option<CachedDid> {
        let cached: CachedDid = env.storage().persistent().get(&(CACHE, chain_id, did_identifier))?;
        if cached.cached_until <= env.ledger().timestamp() {
            return None;
        }
        Some(cached)
    }

    pub fn get_chain(env: Env, chain_id: u32) -> Result<ChainConfig, BridgeError> {
        let config: ChainConfig = env.storage().persistent().get(&(CHAINS, chain_id)).ok_or(BridgeError::ChainNotSupported)?;
        if !config.active { return Err(BridgeError::ChainNotSupported); }
        Ok(config)
    }

    fn require_admin(env: &Env, admin: &Address) -> Result<(), BridgeError> {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&ADMIN).ok_or(BridgeError::NotInitialized)?;
        if stored != *admin { return Err(BridgeError::Unauthorized); }
        Ok(())
    }

    fn require_chain(env: &Env, chain_id: u32) -> Result<(), BridgeError> {
        let config: ChainConfig = env.storage().persistent().get(&(CHAINS, chain_id)).ok_or(BridgeError::ChainNotSupported)?;
        if !config.active { return Err(BridgeError::ChainNotSupported); }
        Ok(())
    }

    fn check_rate(env: &Env, resolver: &Address) -> Result<(), BridgeError> {
        let key = (RATE, resolver.clone());
        let now = env.ledger().timestamp();
        // Persistent, not temporary: temporary entries expire at the current
        // ledger unless a TTL is bumped, so a counter stored there never
        // survived into the next call and the limit could not trip.
        let mut window: RateWindow = env.storage().persistent().get(&key).unwrap_or(RateWindow { started_at: now, calls: 0 });
        if now.saturating_sub(window.started_at) >= RATE_WINDOW_SECS {
            window = RateWindow { started_at: now, calls: 0 };
        }
        if window.calls >= MAX_CALLS_PER_WINDOW { return Err(BridgeError::RateLimited); }
        window.calls += 1;
        env.storage().persistent().set(&key, &window);
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn initialization_and_chain_registry() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register_contract(None, DidBridge);
        let client = DidBridgeClient::new(&env, &id);
        client.initialize(&admin, &oracle);
        client.set_chain(&admin, &1, &String::from_str(&env, "Ethereum"), &true);
        client.set_chain(&admin, &137, &String::from_str(&env, "Polygon"), &true);
        assert_eq!(client.get_chain(&1).name, String::from_str(&env, "Ethereum"));
        assert_eq!(client.get_chain(&137).name, String::from_str(&env, "Polygon"));
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_set_chain(&stranger, &1, &String::from_str(&env, "Ethereum"), &true),
            Err(Ok(BridgeError::Unauthorized))
        );
        assert_eq!(
            client.try_set_chain(&admin, &56, &String::from_str(&env, "BSC"), &true),
            Err(Ok(BridgeError::ChainNotSupported))
        );
    }

    fn leaf(env: &Env, did: &String, document: &Bytes) -> BytesN<32> {
        let mut data = did.clone().to_xdr(env);
        data.append(&document.clone().to_xdr(env));
        env.crypto().sha256(&data).into()
    }

    #[test]
    fn valid_proof_caches_and_invalid_proof_does_not() {
        use soroban_sdk::testutils::{Events, Ledger as _};
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let resolver = Address::generate(&env);
        let id = env.register_contract(None, DidBridge);
        let client = DidBridgeClient::new(&env, &id);
        client.initialize(&admin, &oracle);
        client.set_chain(&admin, &1, &String::from_str(&env, "Ethereum"), &true);

        let did = String::from_str(&env, "did:ethr:0xabc");
        let document = Bytes::from_slice(&env, b"{\"id\":\"did:ethr:0xabc\"}");
        let leaf = leaf(&env, &did, &document);
        let sibling = BytesN::from_array(&env, &[4u8; 32]);
        let mut pair = Bytes::new(&env);
        pair.append(&Bytes::from_array(&env, &leaf.to_array()));
        pair.append(&Bytes::from_array(&env, &sibling.to_array()));
        let root: BytesN<32> = env.crypto().sha256(&pair).into();
        client.publish_state_root(&oracle, &1, &root, &5_000);

        let mut siblings = Vec::new(&env);
        siblings.push_back(sibling);
        let mut on_left = Vec::new(&env);
        on_left.push_back(false);
        let resolved = client.resolve_external_did(&resolver, &1, &did, &document, &siblings, &on_left);
        assert_eq!(resolved, document);
        assert_eq!(client.get_cached_did(&1, &did).unwrap().document, document);
        assert!(!env.events().all().is_empty());

        let tampered = Bytes::from_slice(&env, b"nope");
        assert_eq!(
            client.try_resolve_external_did(&resolver, &1, &String::from_str(&env, "did:ethr:0xother"), &tampered, &Vec::new(&env), &Vec::new(&env)),
            Err(Ok(BridgeError::InvalidProof))
        );
        assert!(client.get_cached_did(&1, &String::from_str(&env, "did:ethr:0xother")).is_none());

        // Cache hit returns the original document even if the new proof is empty.
        let again = client.resolve_external_did(&resolver, &1, &did, &tampered, &Vec::new(&env), &Vec::new(&env));
        assert_eq!(again, document);
    }

    #[test]
    fn rate_limit_blocks_the_window() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let resolver = Address::generate(&env);
        let id = env.register_contract(None, DidBridge);
        let client = DidBridgeClient::new(&env, &id);
        client.initialize(&admin, &oracle);
        client.set_chain(&admin, &137, &String::from_str(&env, "Polygon"), &true);
        let did = String::from_str(&env, "did:pkh:polygon:0x1");
        let document = Bytes::from_slice(&env, b"doc");
        let root = leaf(&env, &did, &document);
        client.publish_state_root(&oracle, &137, &root, &50_000);
        // A failed proof reverts, so it cannot consume the budget. Successful
        // calls, including cache hits, do.
        for _ in 0..20 {
            client.resolve_external_did(&resolver, &137, &did, &document, &Vec::new(&env), &Vec::new(&env));
        }
        assert_eq!(
            client.try_resolve_external_did(&resolver, &137, &did, &document, &Vec::new(&env), &Vec::new(&env)),
            Err(Ok(BridgeError::RateLimited))
        );
    }
}
