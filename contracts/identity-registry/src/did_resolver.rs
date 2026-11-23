// contracts/identity-registry/src/did_resolver.rs

use soroban_sdk::{contracttype, Address, Bytes, Env, Map, String, Symbol, Vec};

/// Supported DID methods.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DidMethod {
    Soroban,
    Web,
    Key,
    Custom(Symbol),
}

/// A verification method entry in a DID document.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationMethod {
    pub id: String,
    pub method_type: String,
    pub controller: String,
    pub public_key: Bytes,
}

/// A service entry in a DID document.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Service {
    pub id: String,
    pub service_type: String,
    pub endpoint: String,
}

/// A resolved DID document.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DidDocument {
    pub id: String,
    pub controller: String,
    pub verification_methods: Vec<VerificationMethod>,
    pub services: Vec<Service>,
}

/// A versioned snapshot of a DID document.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DidDocumentVersion {
    /// Monotonically increasing version number, starting at 1.
    pub version: u32,
    /// Ledger timestamp at which this version was recorded.
    pub updated_at: u64,
    /// The document contents at this version.
    pub document: DidDocument,
}

/// Errors produced by the DID resolver.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DidResolverError {
    UnsupportedDidMethod,
    MalformedDid,
    DidMethodAlreadyRegistered,
    NotFound,
    /// The DID has been deactivated and can no longer be resolved.
    DidDeactivated,
}

/// Storage keys for the DID resolver.
#[contracttype]
pub enum DidResolverKey {
    /// Registered custom DID methods -> handler identifier.
    MethodRegistry(Symbol),
    /// Cached resolved documents keyed by DID string.
    ResolutionCache(String),
    /// Deactivation flag keyed by DID string.
    Deactivated(String),
    /// Latest recorded version metadata keyed by DID string.
    LatestVersion(String),
    /// Historical versions keyed by (DID string, version number).
    History(String, u32),
    /// Admin authorized to register methods.
    Admin,
    /// Stored identity documents keyed by DID string.
    IdentityDocument(String),
}

/// A stored identity record backing `resolve_identity`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityRecord {
    pub owner: Address,
    pub controller: String,
    pub metadata_hash: Bytes,
    pub verification_methods: Vec<VerificationMethod>,
    pub services: Vec<Service>,
    pub version: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

/// The universal DID resolver.
pub struct DidResolver;

impl DidResolver {
    /// Initialize the resolver with an admin.
    pub fn initialize(env: &Env, admin: Address) {
        env.storage()
            .persistent()
            .set(&DidResolverKey::Admin, &admin);
    }

    fn admin(env: &Env) -> Result<Address, DidResolverError> {
        env.storage()
            .persistent()
            .get(&DidResolverKey::Admin)
            .ok_or(DidResolverError::NotFound)
    }

    /// Register a custom DID method. Admin-gated.
    pub fn register_did_method(
        env: &Env,
        caller: Address,
        method: Symbol,
        handler: Symbol,
    ) -> Result<(), DidResolverError> {
        caller.require_auth();
        let admin = Self::admin(env)?;
        if caller != admin {
            return Err(DidResolverError::UnsupportedDidMethod);
        }

        let key = DidResolverKey::MethodRegistry(method.clone());
        if env.storage().persistent().has(&key) {
            return Err(DidResolverError::DidMethodAlreadyRegistered);
        }

        env.storage().persistent().set(&key, &handler);
        Ok(())
    }

    /// Check whether a custom method is registered.
    pub fn is_method_registered(env: &Env, method: Symbol) -> bool {
        env.storage()
            .persistent()
            .has(&DidResolverKey::MethodRegistry(method))
    }

    /// Parse the method prefix from a DID string of the form `did:<method>:<id>`.
    fn parse_method(did: &String) -> Result<(Symbol, String), DidResolverError> {
        let bytes = did.to_bytes();
        let len = bytes.len();

        // Must start with "did:"
        if len < 5 {
            return Err(DidResolverError::MalformedDid);
        }
        let prefix = [b'd', b'i', b'd', b':'];
        for (i, b) in prefix.iter().enumerate() {
            if bytes.get(i as u32) != Some(*b) {
                return Err(DidResolverError::MalformedDid);
            }
        }

        // Find the second colon separating method from id.
        let mut method_end: Option<u32> = None;
        let mut i: u32 = 4;
        while i < len {
            if bytes.get(i) == Some(b':') {
                method_end = Some(i);
                break;
            }
            i += 1;
        }

        let method_end = method_end.ok_or(DidResolverError::MalformedDid)?;
        if method_end == 4 {
            // empty method
            return Err(DidResolverError::MalformedDid);
        }
        if method_end + 1 >= len {
            // empty id
            return Err(DidResolverError::MalformedDid);
        }

        let method_bytes = bytes.slice(4..method_end);
        let id_bytes = bytes.slice(method_end + 1..len);

        let method_str = String::from_bytes(env, &method_bytes);
        let id_str = String::from_bytes(env, &id_bytes);

        // Convert method string to Symbol.
        let method_sym = Symbol::new(env, &method_str.to_string());

        Ok((method_sym, id_str))
    }

    /// Check whether a DID has been deactivated.
    pub fn is_deactivated(env: &Env, did: String) -> bool {
        env.storage()
            .persistent()
            .has(&DidResolverKey::Deactivated(did))
    }

    /// Deactivate a DID. Admin-gated. Invalidates any cached resolution so
    /// subsequent lookups observe the deactivated state.
    pub fn deactivate_did(
        env: &Env,
        caller: Address,
        did: String,
    ) -> Result<(), DidResolverError> {
        caller.require_auth();
        let admin = Self::admin(env)?;
        if caller != admin {
            return Err(DidResolverError::NotFound);
        }

        env.storage()
            .persistent()
            .set(&DidResolverKey::Deactivated(did.clone()), &true);
        // Invalidate the cache so the deactivated state is respected.
        Self::clear_cache(env, did);
        Ok(())
    }

    /// Resolve a DID string into a DID document.
    pub fn resolve_did(env: &Env, did: String) -> Result<DidDocument, DidResolverError> {
        // Deactivated DIDs can no longer be resolved.
        if Self::is_deactivated(env, did.clone()) {
            return Err(DidResolverError::DidDeactivated);
        }

        // Check cache first.
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        if let Some(cached) = env
            .storage()
            .persistent()
            .get::<DidResolverKey, DidDocument>(&cache_key)
        {
            return Ok(cached);
        }

        let (method, id) = Self::parse_method(&did)?;

        let method_str = method.to_string();
        let doc = if method_str == String::from_slice(env, "soroban") {
            Self::resolve_soroban(env, &did, &id)?
        } else if method_str == String::from_slice(env, "web") {
            Self::resolve_web(env, &did, &id)?
        } else if method_str == String::from_slice(env, "key") {
            Self::resolve_key(env, &did, &id)?
        } else {
            // Custom method: must be registered.
            if !Self::is_method_registered(env, method.clone()) {
                return Err(DidResolverError::UnsupportedDidMethod);
            }
            Self::resolve_custom(env, &did, &id, method)?
        };

        // Store in cache.
        env.storage().persistent().set(&cache_key, &doc);
        Ok(doc)
    }

    /// Native registry lookup for `did:soroban:<address>`.
    fn resolve_soroban(
        env: &Env,
        did: &String,
        id: &String,
    ) -> Result<DidDocument, DidResolverError> {
        // The id is expected to be a Stellar address string.
        let address_str = id.to_string();
        if address_str.is_empty() {
            return Err(DidResolverError::MalformedDid);
        }
        let address = Address::from_string(&String::from_slice(env, &address_str));

        let mut vms: Vec<VerificationMethod> = Vec::new(env);
        vms.push_back(VerificationMethod {
            id: String::from_slice(env, &format!("{}#controller", did.to_string())),
            method_type: String::from_slice(env, "Ed25519VerificationKey2020"),
            controller: did.clone(),
            public_key: Bytes::new(env),
        });

        Ok(DidDocument {
            id: did.clone(),
            controller: address.to_string(),
            verification_methods: vms,
            services: Vec::new(env),
        })
    }

    /// URL mapping for `did:web:<domain>`.
    fn resolve_web(
        env: &Env,
        did: &String,
        id: &String,
    ) -> Result<DidDocument, DidResolverError> {
        let domain = id.to_string();
        if domain.is_empty() {
            return Err(DidResolverError::MalformedDid);
        }

        // Map to https URL: https://<domain>/.well-known/did.json
        let url = format!("https://{}/.well-known/did.json", domain);

        let mut services: Vec<Service> = Vec::new(env);
        services.push_back(Service {
            id: String::from_slice(env, &format!("{}#resolver", did.to_string())),
            service_type: String::from_slice(env, "DIDWebResolver"),
            endpoint: String::from_slice(env, &url),
        });

        Ok(DidDocument {
            id: did.clone(),
            controller: did.clone(),
            verification_methods: Vec::new(env),
            services,
        })
    }

    /// Base58 decoding for `did:key:<multibase>`.
    fn resolve_key(
        env: &Env,
        did: &String,
        id: &String,
    ) -> Result<DidDocument, DidResolverError> {
        let encoded = id.to_string();
        if encoded.is_empty() {
            return Err(DidResolverError::MalformedDid);
        }

        // Strip multibase prefix 'z' for base58btc.
        let payload = if encoded.starts_with('z') {
            &encoded[1..]
        } else {
            &encoded[..]
        };

        let decoded = Self::base58_decode(env, payload)
            .ok_or(DidResolverError::MalformedDid)?;

        let mut vms: Vec<VerificationMethod> = Vec::new(env);
        vms.push_back(VerificationMethod {
            id: String::from_slice(env, &format!("{}#keys-1", did.to_string())),
            method_type: String::from_slice(env, "Ed25519VerificationKey2020"),
            controller: did.clone(),
            public_key: decoded,
        });

        Ok(DidDocument {
            id: did.clone(),
            controller: did.clone(),
            verification_methods: vms,
            services: Vec::new(env),
        })
    }

    /// Dispatch to a registered custom method handler.
    fn resolve_custom(
        env: &Env,
        did: &String,
        id: &String,
        method: Symbol,
    ) -> Result<DidDocument, DidResolverError> {
        let handler: Symbol = env
            .storage()
            .persistent()
            .get(&DidResolverKey::MethodRegistry(method))
            .ok_or(DidResolverError::UnsupportedDidMethod)?;

        // Custom handlers produce a minimal document referencing the handler.
        let mut services: Vec<Service> = Vec::new(env);
        services.push_back(Service {
            id: String::from_slice(env, &format!("{}#handler", did.to_string())),
            service_type: String::from_slice(env, &handler.to_string()),
            endpoint: id.clone(),
        });

        Ok(DidDocument {
            id: did.clone(),
            controller: did.clone(),
            verification_methods: Vec::new(env),
            services,
        })
    }

    /// Decode a base58btc string into bytes.
    fn base58_decode(env: &Env, input: &str) -> Option<Bytes> {
        const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

        let mut result: Vec<u8> = Vec::new();
        let bytes = input.as_bytes();

        // Count leading '1's (zero bytes).
        let mut leading_zeros = 0usize;
        for &b in bytes {
            if b == b'1' {
                leading_zeros += 1;
            } else {
                break;
            }
        }

        // Big-number base conversion.
        let mut num: Vec<u8> = Vec::new();
        for &c in bytes {
            let mut carry = ALPHABET.iter().position(|&x| x == c)? as u32;
            for byte in num.iter_mut().rev() {
                let val = (*byte as u32) * 58 + carry;
                *byte = (val & 0xff) as u8;
                carry = val >> 8;
            }
            while carry > 0 {
                num.insert(0, (carry & 0xff) as u8);
                carry >>= 8;
            }
        }

        // Prepend leading zeros.
        for _ in 0..leading_zeros {
            result.push(0u8);
        }
        result.extend_from_slice(&num);

        Some(Bytes::from_slice(env, &result))
    }

    /// Clear a cached resolution.
    pub fn clear_cache(env: &Env, did: String) {
        env.storage()
            .persistent()
            .remove(&DidResolverKey::ResolutionCache(did));
    }

    /// Record a new version of a DID document, returning the stored version.
    ///
    /// The version number is derived from the previously recorded latest
    /// version (starting at 1) and `updated_at` is taken from the ledger.
    pub fn record_version(
        env: &Env,
        did: String,
        document: DidDocument,
    ) -> Result<DidDocumentVersion, DidResolverError> {
        let latest_key = DidResolverKey::LatestVersion(did.clone());
        let previous: Option<DidDocumentVersion> = env.storage().persistent().get(&latest_key);
        let next_version = match previous {
            Some(prev) => prev.version + 1,
            None => 1,
        };

        let version = DidDocumentVersion {
            version: next_version,
            updated_at: env.ledger().timestamp(),
            document,
        };

        env.storage()
            .persistent()
            .set(&DidResolverKey::History(did.clone(), next_version), &version);
        env.storage().persistent().set(&latest_key, &version);

        Ok(version)
    }

    /// Fetch the latest recorded version metadata for a DID, if any.
    pub fn latest_version(
        env: &Env,
        did: String,
    ) -> Result<DidDocumentVersion, DidResolverError> {
        env.storage()
            .persistent()
            .get(&DidResolverKey::LatestVersion(did))
            .ok_or(DidResolverError::NotFound)
    }

    /// Fetch a specific historical revision of a DID document.
    pub fn get_version(
        env: &Env,
        did: String,
        version: u32,
    ) -> Result<DidDocumentVersion, DidResolverError> {
        env.storage()
            .persistent()
            .get(&DidResolverKey::History(did, version))
            .ok_or(DidResolverError::NotFound)
    }

    /// Fetch all recorded revisions of a DID document, oldest first.
    pub fn get_history(
        env: &Env,
        did: String,
    ) -> Result<Vec<DidDocumentVersion>, DidResolverError> {
        let latest = Self::latest_version(env, did.clone())?;
        let mut history: Vec<DidDocumentVersion> = Vec::new(env);
        let mut v: u32 = 1;
        while v <= latest.version {
            let entry: DidDocumentVersion = env
                .storage()
                .persistent()
                .get(&DidResolverKey::History(did.clone(), v))
                .ok_or(DidResolverError::NotFound)?;
            history.push_back(entry);
            v += 1;
        }
        Ok(history)
    }

    /// Persist an identity record for a DID string.
    pub fn store_identity(
        env: &Env,
        did: String,
        record: IdentityRecord,
    ) -> Result<(), DidResolverError> {
        // Validate the DID shape before storing.
        Self::parse_method(&did)?;
        env.storage()
            .persistent()
            .set(&DidResolverKey::IdentityDocument(did), &record);
        Ok(())
    }

    /// Look up the stored identity record for a DID string.
    fn lookup_identity(
        env: &Env,
        did: &String,
    ) -> Result<IdentityRecord, DidResolverError> {
        // Reject malformed DIDs before touching storage.
        Self::parse_method(did)?;
        env.storage()
            .persistent()
            .get(&DidResolverKey::IdentityDocument(did.clone()))
            .ok_or(DidResolverError::NotFound)
    }

    /// Build and validate the full DID document for an identity record.
    fn build_identity_document(
        env: &Env,
        did: &String,
        record: &IdentityRecord,
    ) -> Result<DidDocument, DidResolverError> {
        if record.controller.to_string().is_empty() {
            return Err(DidResolverError::MalformedDid);
        }
        if record.version == 0 {
            return Err(DidResolverError::MalformedDid);
        }
        if record.updated_at < record.created_at {
            return Err(DidResolverError::MalformedDid);
        }

        let mut vms: Vec<VerificationMethod> = Vec::new(env);
        for vm in record.verification_methods.iter() {
            if vm.id.to_string().is_empty() || vm.controller.to_string().is_empty() {
                return Err(DidResolverError::MalformedDid);
            }
            vms.push_back(vm);
        }

        let mut services: Vec<Service> = Vec::new(env);
        for svc in record.services.iter() {
            if svc.id.to_string().is_empty() || svc.endpoint.to_string().is_empty() {
                return Err(DidResolverError::MalformedDid);
            }
            services.push_back(svc);
        }

        Ok(DidDocument {
            id: did.clone(),
            controller: record.controller.clone(),
            verification_methods: vms,
            services,
        })
    }

    /// Resolve the full DID document for a given identifier.
    ///
    /// Returns a typed error when the DID is malformed or unknown; never panics.
    pub fn resolve_identity(
        env: &Env,
        did: String,
    ) -> Result<DidDocument, DidResolverError> {
        let record = Self::lookup_identity(env, &did)?;
        Self::build_identity_document(env, &did, &record)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        DidResolver::initialize(&env, admin.clone());
        (env, admin)
    }

    #[test]
    fn test_resolve_soroban() {
        let (env, _admin) = setup();
        let addr = Address::generate(&env);
        let did = String::from_slice(&env, &format!("did:soroban:{}", addr.to_string()));
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert_eq!(doc.verification_methods.len(), 1);
    }

    #[test]
    fn test_resolve_web() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert_eq!(doc.services.len(), 1);
        let endpoint = doc.services.get(0).unwrap().endpoint.to_string();
        assert!(endpoint.contains("example.com"));
    }

    #[test]
    fn test_resolve_key() {
        let (env, _admin) = setup();
        // "z6Mk..." style; use a valid base58 payload.
        let did = String::from_slice(&env, "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert_eq!(doc.verification_methods.len(), 1);
        assert!(doc.verification_methods.get(0).unwrap().public_key.len() > 0);
    }

    #[test]
    fn test_resolve_custom_registered() {
        let (env, admin) = setup();
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        DidResolver::register_did_method(&env, admin, method, handler).unwrap();

        let did = String::from_slice(&env, "did:example:12345");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
    }

    #[test]
    fn test_unsupported_method() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:unknown:12345");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::UnsupportedDidMethod));
    }

    #[test]
    fn test_unknown_did_does_not_panic() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:unknown:12345");
        // Must return an Err rather than panicking.
        let res = DidResolver::resolve_did(&env, did);
        assert!(res.is_err());
    }

    #[test]
    fn test_uninitialized_admin_returns_err() {
        let env = Env::default();
        env.mock_all_auths();
        let caller = Address::generate(&env);
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        let res = DidResolver::register_did_method(&env, caller, method, handler);
        assert_eq!(res, Err(DidResolverError::NotFound));
    }

    #[test]
    fn test_malformed_no_prefix() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "notadid");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_malformed_missing_id() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_malformed_missing_method() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did::12345");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_duplicate_method_registration() {
        let (env, admin) = setup();
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        DidResolver::register_did_method(&env, admin.clone(), method.clone(), handler.clone())
            .unwrap();
        let res = DidResolver::register_did_method(&env, admin, method, handler);
        assert_eq!(res, Err(DidResolverError::DidMethodAlreadyRegistered));
    }

    #[test]
    fn test_cache() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let _ = DidResolver::resolve_did(&env, did.clone()).unwrap();
        // Second call should hit cache.
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        DidResolver::clear_cache(&env, did.clone());
        let doc2 = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc2.id, did);
    }

    // --- Additional negative / edge cases for resolve_did ---

    #[test]
    fn test_malformed_empty_did() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_malformed_too_short() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_malformed_wrong_prefix() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "dix:web:example.com");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_malformed_no_second_colon() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_malformed_empty_method_and_id() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did::");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_unsupported_custom_method_not_registered() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:custom:abc");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::UnsupportedDidMethod));
    }

    #[test]
    fn test_unsupported_method_does_not_cache() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:unknown:12345");
        let _ = DidResolver::resolve_did(&env, did.clone());
        // A failed resolution must not populate the cache.
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        assert!(!env.storage().persistent().has(&cache_key));
    }

    #[test]
    fn test_malformed_does_not_cache() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "notadid");
        let _ = DidResolver::resolve_did(&env, did.clone());
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        assert!(!env.storage().persistent().has(&cache_key));
    }

    #[test]
    fn test_cache_populated_after_resolve() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        assert!(!env.storage().persistent().has(&cache_key));
        let _ = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert!(env.storage().persistent().has(&cache_key));
    }

    #[test]
    fn test_cache_returns_same_document() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let first = DidResolver::resolve_did(&env, did.clone()).unwrap();
        let second = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn test_clear_cache_removes_entry() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let _ = DidResolver::resolve_did(&env, did.clone()).unwrap();
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        assert!(env.storage().persistent().has(&cache_key));
        DidResolver::clear_cache(&env, did.clone());
        assert!(!env.storage().persistent().has(&cache_key));
    }

    #[test]
    fn test_clear_cache_unknown_did_is_noop() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:never-resolved.com");
        // Clearing a non-existent cache entry must not panic.
        DidResolver::clear_cache(&env, did.clone());
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        assert!(!env.storage().persistent().has(&cache_key));
    }

    #[test]
    fn test_resolve_after_clear_repopulates_cache() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let _ = DidResolver::resolve_did(&env, did.clone()).unwrap();
        DidResolver::clear_cache(&env, did.clone());
        let cache_key = DidResolverKey::ResolutionCache(did.clone());
        assert!(!env.storage().persistent().has(&cache_key));
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert!(env.storage().persistent().has(&cache_key));
    }

    #[test]
    fn test_resolve_soroban_document_fields() {
        let (env, _admin) = setup();
        let addr = Address::generate(&env);
        let did = String::from_slice(&env, &format!("did:soroban:{}", addr.to_string()));
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert_eq!(doc.controller, addr.to_string());
        assert_eq!(doc.services.len(), 0);
        let vm = doc.verification_methods.get(0).unwrap();
        assert_eq!(vm.controller, did);
        assert_eq!(
            vm.method_type.to_string(),
            String::from_slice(&env, "Ed25519VerificationKey2020").to_string()
        );
    }

    #[test]
    fn test_resolve_web_document_fields() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.controller, did);
        assert_eq!(doc.verification_methods.len(), 0);
        let service = doc.services.get(0).unwrap();
        assert_eq!(
            service.endpoint.to_string(),
            String::from_slice(&env, "https://example.com/.well-known/did.json").to_string()
        );
    }

    #[test]
    fn test_resolve_key_invalid_base58() {
        let (env, _admin) = setup();
        // '0' and 'O' are not in the base58 alphabet.
        let did = String::from_slice(&env, "did:key:z0OIl");
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_deactivated_did_cannot_resolve() {
        let (env, admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        // Prime the cache.
        let _ = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert!(!DidResolver::is_deactivated(&env, did.clone()));

        DidResolver::deactivate_did(&env, admin, did.clone()).unwrap();
        assert!(DidResolver::is_deactivated(&env, did.clone()));

        // Cache must be invalidated and resolution must fail.
        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::DidDeactivated));
    }

    #[test]
    fn test_deactivate_requires_admin() {
        let (env, _admin) = setup();
        let caller = Address::generate(&env);
        let did = String::from_slice(&env, "did:web:example.com");
        let res = DidResolver::deactivate_did(&env, caller, did.clone());
        assert!(res.is_err());
        assert!(!DidResolver::is_deactivated(&env, did));
    }

    #[test]
    fn test_record_and_get_history() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();

        let v1 = DidResolver::record_version(&env, did.clone(), doc.clone()).unwrap();
        assert_eq!(v1.version, 1);
        let v2 = DidResolver::record_version(&env, did.clone(), doc.clone()).unwrap();
        assert_eq!(v2.version, 2);

        let latest = DidResolver::latest_version(&env, did.clone()).unwrap();
        assert_eq!(latest.version, 2);

        let history = DidResolver::get_history(&env, did.clone()).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history.get(0).unwrap().version, 1);
        assert_eq!(history.get(1).unwrap().version, 2);

        let fetched = DidResolver::get_version(&env, did.clone(), 1).unwrap();
        assert_eq!(fetched.document.id, did);
    }

    #[test]
    fn test_history_not_found() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let res = DidResolver::get_history(&env, did.clone());
        assert_eq!(res, Err(DidResolverError::NotFound));
        let res2 = DidResolver::get_version(&env, did, 1);
        assert_eq!(res2, Err(DidResolverError::NotFound));
    }

    fn sample_record(env: &Env, did: &String) -> IdentityRecord {
        let mut vms: Vec<VerificationMethod> = Vec::new(env);
        vms.push_back(VerificationMethod {
            id: String::from_slice(env, &format!("{}#keys-1", did.to_string())),
            method_type: String::from_slice(env, "Ed25519VerificationKey2020"),
            controller: did.clone(),
            public_key: Bytes::from_slice(env, &[1u8, 2, 3]),
        });
        let mut services: Vec<Service> = Vec::new(env);
        services.push_back(Service {
            id: String::from_slice(env, &format!("{}#svc", did.to_string())),
            service_type: String::from_slice(env, "Messaging"),
            endpoint: String::from_slice(env, "https://example.com"),
        });
        IdentityRecord {
            owner: Address::generate(env),
            controller: did.clone(),
            metadata_hash: Bytes::from_slice(env, &[9u8; 32]),
            verification_methods: vms,
            services,
            version: 1,
            created_at: 100,
            updated_at: 200,
        }
    }

    #[test]
    fn test_resolve_identity_ok() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let record = sample_record(&env, &did);
        DidResolver::store_identity(&env, did.clone(), record).unwrap();

        let doc = DidResolver::resolve_identity(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert_eq!(doc.controller, did);
        assert_eq!(doc.verification_methods.len(), 1);
        assert_eq!(doc.services.len(), 1);
    }

    #[test]
    fn test_resolve_identity_unknown() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:unknown.com");
        let res = DidResolver::resolve_identity(&env, did);
        assert_eq!(res, Err(DidResolverError::NotFound));
    }

    #[test]
    fn test_resolve_identity_malformed() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "notadid");
        let res = DidResolver::resolve_identity(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }

    #[test]
    fn test_resolve_key_without_multibase_prefix() {
        let (env, _admin) = setup();
        // No 'z' prefix: payload is decoded as-is.
        let did = String::from_slice(&env, "did:key:6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);
        assert_eq!(doc.verification_methods.len(), 1);
    }

    #[test]
    fn test_resolve_custom_document_fields() {
        let (env, admin) = setup();
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        DidResolver::register_did_method(&env, admin, method, handler.clone()).unwrap();

        let did = String::from_slice(&env, "did:example:12345");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.controller, did);
        assert_eq!(doc.verification_methods.len(), 0);
        let service = doc.services.get(0).unwrap();
        assert_eq!(service.service_type.to_string(), handler.to_string());
        assert_eq!(
            service.endpoint.to_string(),
            String::from_slice(&env, "12345").to_string()
        );
    }

    #[test]
    fn test_register_method_non_admin_rejected() {
        let (env, _admin) = setup();
        let non_admin = Address::generate(&env);
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        let res = DidResolver::register_did_method(&env, non_admin, method.clone(), handler);
        assert_eq!(res, Err(DidResolverError::UnsupportedDidMethod));
        assert!(!DidResolver::is_method_registered(&env, method));
    }

    #[test]
    fn test_is_method_registered_reflects_registration() {
        let (env, admin) = setup();
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        assert!(!DidResolver::is_method_registered(&env, method.clone()));
        DidResolver::register_did_method(&env, admin, method.clone(), handler).unwrap();
        assert!(DidResolver::is_method_registered(&env, method));
    }

    #[test]
    fn test_resolve_after_deactivation_returns_err() {
        // Simulates resolution after a DID has been deactivated: the method
        // registration backing the DID is removed, so resolution must fail
        // rather than returning a stale document.
        let (env, admin) = setup();
        let method = Symbol::new(&env, "example");
        let handler = Symbol::new(&env, "example_handler");
        DidResolver::register_did_method(&env, admin, method.clone(), handler).unwrap();

        let did = String::from_slice(&env, "did:example:12345");
        let doc = DidResolver::resolve_did(&env, did.clone()).unwrap();
        assert_eq!(doc.id, did);

        // Deactivate: drop the cached document and the method registration.
        DidResolver::clear_cache(&env, did.clone());
        env.storage()
            .persistent()
            .remove(&DidResolverKey::MethodRegistry(method.clone()));
        assert!(!DidResolver::is_method_registered(&env, method));

        let res = DidResolver::resolve_did(&env, did);
        assert_eq!(res, Err(DidResolverError::UnsupportedDidMethod));
    }

    #[test]
    fn test_resolve_identity_invalid_record() {
        let (env, _admin) = setup();
        let did = String::from_slice(&env, "did:web:example.com");
        let mut record = sample_record(&env, &did);
        record.version = 0;
        DidResolver::store_identity(&env, did.clone(), record).unwrap();
        let res = DidResolver::resolve_identity(&env, did);
        assert_eq!(res, Err(DidResolverError::MalformedDid));
    }
}