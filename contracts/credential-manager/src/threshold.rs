//! Threshold / multi-signature support for the credential manager.
//!
//! This module implements weighted multi-signature requirements for credential
//! operations. An issuer may configure a [`SignerSet`] describing the signers,
//! their weights, the required threshold, the accepted signature schemes and
//! the maximum age of a signature. Credential operations (issue, revoke,
//! update) then validate that the supplied signatures meet the threshold.

use soroban_sdk::{
    contracttype, symbol_short, Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

/// Storage key prefix for signer sets, keyed by issuer address.
const SIGNER_SET_KEY: Symbol = symbol_short!("SGN_SET");
/// Storage key prefix for recovery guardians, keyed by issuer address.
const GUARDIAN_KEY: Symbol = symbol_short!("GUARD");

/// Supported signature schemes.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignatureScheme {
    /// Ed25519 signatures.
    Ed25519 = 0,
    /// ECDSA (secp256k1) signatures.
    Ecdsa = 1,
    /// Soroban native account signatures.
    Account = 2,
}

/// A single signer with an associated weight.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    pub weight: u32,
}

/// Configuration of the signer set for an issuer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerSet {
    /// The issuer these signers authorize operations for.
    pub issuer: Address,
    /// The signers and their weights.
    pub signers: Vec<Signer>,
    /// Total weight required to authorize an operation.
    pub threshold: u32,
    /// Accepted signature schemes.
    pub schemes: Vec<SignatureScheme>,
    /// Maximum age (in ledgers) of a signature before it expires.
    pub signature_expiry_ledgers: u32,
    /// Ledger at which the signer set was last updated.
    pub updated_at: u32,
}

/// A signature over a payload by a single signer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedPayload {
    /// The signer that produced this signature.
    pub signer: Address,
    /// The scheme used to produce the signature.
    pub scheme: SignatureScheme,
    /// The raw signature bytes.
    pub signature: Bytes,
    /// Ledger at which the signature was produced.
    pub signed_at: u32,
}

/// Aggregated signature result.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregatedSignature {
    /// The payload hash that was signed.
    pub payload_hash: BytesN<32>,
    /// The combined signature bytes.
    pub signature: Bytes,
    /// The total weight of the contributing signers.
    pub total_weight: u32,
    /// The signers that contributed.
    pub signers: Vec<Address>,
}

/// Errors raised by threshold signature operations.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThresholdError {
    /// The combined weight of valid signatures did not meet the threshold.
    ThresholdNotMet = 0,
    /// A signature used a scheme not accepted by the signer set.
    InvalidSignatureScheme = 1,
    /// A signature has expired.
    SignatureExpired = 2,
    /// A signer is not part of the signer set.
    SignerNotAuthorized = 3,
    /// The signer set configuration is invalid.
    InvalidSignerSet = 4,
    /// No signer set is configured for the issuer.
    SignerSetNotFound = 5,
    /// The caller is not authorized to modify the signer set.
    Unauthorized = 6,
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

fn signer_set_key(env: &Env, issuer: &Address) -> (Symbol, Address) {
    (SIGNER_SET_KEY, issuer.clone())
}

fn guardian_key(env: &Env, issuer: &Address) -> (Symbol, Address) {
    (GUARDIAN_KEY, issuer.clone())
}

/// Load the signer set for an issuer, if any.
pub fn get_signer_set(env: &Env, issuer: &Address) -> Option<SignerSet> {
    env.storage()
        .persistent()
        .get(&signer_set_key(env, issuer))
}

fn save_signer_set(env: &Env, set: &SignerSet) {
    env.storage()
        .persistent()
        .set(&signer_set_key(env, &set.issuer), set);
}

fn load_signers(env: &Env, issuer: &Address) -> Result<SignerSet, ThresholdError> {
    get_signer_set(env, issuer).ok_or(ThresholdError::SignerSetNotFound)
}

// ---------------------------------------------------------------------------
// Signer set management
// ---------------------------------------------------------------------------

fn validate_signer_set_config(set: &SignerSet) -> Result<(), ThresholdError> {
    if set.signers.is_empty() || set.schemes.is_empty() {
        return Err(ThresholdError::InvalidSignerSet);
    }
    if set.threshold == 0 {
        return Err(ThresholdError::InvalidSignerSet);
    }
    let mut total: u32 = 0;
    for signer in set.signers.iter() {
        if signer.weight == 0 {
            return Err(ThresholdError::InvalidSignerSet);
        }
        total = total.saturating_add(signer.weight);
    }
    if set.threshold > total {
        return Err(ThresholdError::InvalidSignerSet);
    }
    Ok(())
}

/// Set the initial signer set for an issuer. Requires the issuer's auth.
pub fn set_signers(
    env: &Env,
    issuer: &Address,
    signers: Vec<Signer>,
    threshold: u32,
    schemes: Vec<SignatureScheme>,
    signature_expiry_ledgers: u32,
) -> Result<(), ThresholdError> {
    issuer.require_auth();
    let set = SignerSet {
        issuer: issuer.clone(),
        signers,
        threshold,
        schemes,
        signature_expiry_ledgers,
        updated_at: env.ledger().sequence(),
    };
    validate_signer_set_config(&set)?;
    save_signer_set(env, &set);
    env.events()
        .publish((symbol_short!("sgn_set"), issuer.clone()), set.threshold);
    Ok(())
}

/// Update an existing signer set. Requires the issuer's auth.
pub fn update_signers(
    env: &Env,
    issuer: &Address,
    signers: Vec<Signer>,
    threshold: u32,
    schemes: Vec<SignatureScheme>,
    signature_expiry_ledgers: u32,
) -> Result<(), ThresholdError> {
    issuer.require_auth();
    // Ensure a set already exists so updates are explicit.
    load_signers(env, issuer)?;
    let set = SignerSet {
        issuer: issuer.clone(),
        signers,
        threshold,
        schemes,
        signature_expiry_ledgers,
        updated_at: env.ledger().sequence(),
    };
    validate_signer_set_config(&set)?;
    save_signer_set(env, &set);
    env.events()
        .publish((symbol_short!("sgn_upd"), issuer.clone()), set.threshold);
    Ok(())
}

/// Configure recovery guardians for an issuer. Requires the issuer's auth.
pub fn set_guardians(
    env: &Env,
    issuer: &Address,
    guardians: Vec<Address>,
) -> Result<(), ThresholdError> {
    issuer.require_auth();
    if guardians.is_empty() {
        return Err(ThresholdError::InvalidSignerSet);
    }
    env.storage()
        .persistent()
        .set(&guardian_key(env, issuer), &guardians);
    Ok(())
}

fn load_guardians(env: &Env, issuer: &Address) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&guardian_key(env, issuer))
        .unwrap_or_else(|| Vec::new(env))
}

// ---------------------------------------------------------------------------
// Signature validation
// ---------------------------------------------------------------------------

/// Check whether a signature has expired relative to the current ledger.
pub fn check_signature_expiry(
    env: &Env,
    set: &SignerSet,
    signed_at: u32,
) -> Result<(), ThresholdError> {
    let current = env.ledger().sequence();
    if signed_at > current {
        // Signatures from the future are invalid.
        return Err(ThresholdError::SignatureExpired);
    }
    if set.signature_expiry_ledgers > 0 {
        let age = current.saturating_sub(signed_at);
        if age > set.signature_expiry_ledgers {
            return Err(ThresholdError::SignatureExpired);
        }
    }
    Ok(())
}

fn scheme_accepted(set: &SignerSet, scheme: SignatureScheme) -> bool {
    for s in set.schemes.iter() {
        if s == scheme {
            return true;
        }
    }
    false
}

fn signer_weight(set: &SignerSet, signer: &Address) -> Option<u32> {
    for s in set.signers.iter() {
        if &s.address == signer {
            return Some(s.weight);
        }
    }
    None
}

/// Verify a single signature against the payload hash using the given scheme.
///
/// For `Account` scheme signatures we rely on the signer's auth being present
/// in the invocation (Soroban account abstraction). For `Ed25519` and `Ecdsa`
/// we verify the raw signature bytes against the payload hash.
fn verify_signature(
    env: &Env,
    scheme: SignatureScheme,
    signer: &Address,
    payload_hash: &BytesN<32>,
    signature: &Bytes,
) -> bool {
    match scheme {
        SignatureScheme::Ed25519 => {
            if signature.len() != 64 {
                return false;
            }
            let mut sig = [0u8; 64];
            signature.copy_into_slice(&mut sig);
            let sig_bytes: BytesN<64> = BytesN::from_array(env, &sig);
            env.crypto()
                .ed25519_verify(&sig_bytes, &payload_hash.clone().into(), signer)
        }
        SignatureScheme::Ecdsa => {
            if signature.len() != 64 {
                return false;
            }
            let mut sig = [0u8; 64];
            signature.copy_into_slice(&mut sig);
            let sig_bytes: BytesN<64> = BytesN::from_array(env, &sig);
            env.crypto()
                .secp256k1_recover(&payload_hash.clone().into(), &sig_bytes)
                .is_ok()
        }
        SignatureScheme::Account => {
            // Account signatures are validated via Soroban auth; the presence
            // of the signer in the invocation is enforced by require_auth.
            signer.require_auth();
            true
        }
    }
}

/// Validate that the supplied signatures meet the signer set threshold.
///
/// Sums the weights of valid, non-expired signatures over `payload_hash` and
/// returns `Ok(())` when the total meets or exceeds the threshold.
pub fn validate_threshold(
    env: &Env,
    issuer: &Address,
    payload_hash: &BytesN<32>,
    signatures: &Vec<SignedPayload>,
) -> Result<(), ThresholdError> {
    let set = load_signers(env, issuer)?;

    let mut total_weight: u32 = 0;
    // Track which signers have already contributed to prevent double counting.
    let mut seen: Map<Address, bool> = Map::new(env);

    for sp in signatures.iter() {
        if !scheme_accepted(&set, sp.scheme) {
            return Err(ThresholdError::InvalidSignatureScheme);
        }
        let weight = match signer_weight(&set, &sp.signer) {
            Some(w) => w,
            None => return Err(ThresholdError::SignerNotAuthorized),
        };
        if seen.get(sp.signer.clone()).unwrap_or(false) {
            // Duplicate signer; ignore additional contributions.
            continue;
        }
        check_signature_expiry(env, &set, sp.signed_at)?;
        if !verify_signature(env, sp.scheme, &sp.signer, payload_hash, &sp.signature) {
            // Invalid signature does not contribute weight.
            continue;
        }
        seen.set(sp.signer.clone(), true);
        total_weight = total_weight.saturating_add(weight);
    }

    if total_weight < set.threshold {
        return Err(ThresholdError::ThresholdNotMet);
    }
    Ok(())
}

/// Combine partial signatures into a single aggregated signature.
///
/// The aggregated signature is the concatenation of the individual signature
/// bytes in the order supplied. Only valid, non-expired, authorized signatures
/// are included.
pub fn aggregate_signatures(
    env: &Env,
    issuer: &Address,
    payload_hash: &BytesN<32>,
    signatures: &Vec<SignedPayload>,
) -> Result<AggregatedSignature, ThresholdError> {
    let set = load_signers(env, issuer)?;

    let mut combined = Bytes::new(env);
    let mut total_weight: u32 = 0;
    let mut contributors: Vec<Address> = Vec::new(env);
    let mut seen: Map<Address, bool> = Map::new(env);

    for sp in signatures.iter() {
        if !scheme_accepted(&set, sp.scheme) {
            return Err(ThresholdError::InvalidSignatureScheme);
        }
        let weight = match signer_weight(&set, &sp.signer) {
            Some(w) => w,
            None => return Err(ThresholdError::SignerNotAuthorized),
        };
        if seen.get(sp.signer.clone()).unwrap_or(false) {
            continue;
        }
        check_signature_expiry(env, &set, sp.signed_at)?;
        if !verify_signature(env, sp.scheme, &sp.signer, payload_hash, &sp.signature) {
            continue;
        }
        seen.set(sp.signer.clone(), true);
        combined.extend_from_slice(&sp.signature);
        total_weight = total_weight.saturating_add(weight);
        contributors.push_back(sp.signer.clone());
    }

    if total_weight < set.threshold {
        return Err(ThresholdError::ThresholdNotMet);
    }

    Ok(AggregatedSignature {
        payload_hash: payload_hash.clone(),
        signature: combined,
        total_weight,
        signers: contributors,
    })
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/// Rotate the signer set using guardian-based recovery.
///
/// A majority of the configured guardians must authorize the rotation. The new
/// signer set replaces the existing one for the issuer.
pub fn rotate_signers_via_recovery(
    env: &Env,
    issuer: &Address,
    new_signers: Vec<Signer>,
    threshold: u32,
    schemes: Vec<SignatureScheme>,
    signature_expiry_ledgers: u32,
) -> Result<(), ThresholdError> {
    let guardians = load_guardians(env, issuer);
    if guardians.is_empty() {
        return Err(ThresholdError::Unauthorized);
    }
    // Require a majority of guardians to authorize the rotation.
    let required = guardians.len() / 2 + 1;
    let mut approvals: u32 = 0;
    for guardian in guardians.iter() {
        // Each guardian must have authorized this invocation.
        guardian.require_auth();
        approvals += 1;
    }
    if approvals < required {
        return Err(ThresholdError::Unauthorized);
    }

    let set = SignerSet {
        issuer: issuer.clone(),
        signers: new_signers,
        threshold,
        schemes,
        signature_expiry_ledgers,
        updated_at: env.ledger().sequence(),
    };
    validate_signer_set_config(&set)?;
    save_signer_set(env, &set);
    env.events()
        .publish((symbol_short!("sgn_rec"), issuer.clone()), set.threshold);
    Ok(())
}

// ---------------------------------------------------------------------------
// Operation guards
// ---------------------------------------------------------------------------

/// Enforce threshold signatures for a credential operation when a signer set
/// is configured for the issuer. If no signer set exists, the operation is
/// allowed to proceed (backwards compatible single-signer behavior).
pub fn enforce_threshold(
    env: &Env,
    issuer: &Address,
    payload_hash: &BytesN<32>,
    signatures: &Vec<SignedPayload>,
) -> Result<(), ThresholdError> {
    if get_signer_set(env, issuer).is_none() {
        return Ok(());
    }
    validate_threshold(env, issuer, payload_hash, signatures)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let issuer = Address::generate(&env);
        (env, issuer)
    }

    fn signer(env: &Env, weight: u32) -> Signer {
        Signer {
            address: Address::generate(env),
            weight,
        }
    }

    fn account_sig(env: &Env, signer: &Address, signed_at: u32) -> SignedPayload {
        SignedPayload {
            signer: signer.clone(),
            scheme: SignatureScheme::Account,
            signature: Bytes::new(env),
            signed_at,
        }
    }

    #[test]
    fn test_set_and_update_signers() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let s2 = signer(&env, 2);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);

        set_signers(&env, &issuer, signers.clone(), 2, schemes.clone(), 100).unwrap();
        let set = get_signer_set(&env, &issuer).unwrap();
        assert_eq!(set.threshold, 2);
        assert_eq!(set.signers.len(), 2);

        update_signers(&env, &issuer, signers, 3, schemes, 50).unwrap();
        let set = get_signer_set(&env, &issuer).unwrap();
        assert_eq!(set.threshold, 3);
        assert_eq!(set.signature_expiry_ledgers, 50);
    }

    #[test]
    fn test_invalid_signer_set() {
        let (env, issuer) = setup();
        let mut signers = Vec::new(&env);
        signers.push_back(signer(&env, 1));
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        // Threshold exceeds total weight.
        let res = set_signers(&env, &issuer, signers, 5, schemes, 100);
        assert_eq!(res, Err(ThresholdError::InvalidSignerSet));
    }

    #[test]
    fn test_threshold_met_account_scheme() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let s2 = signer(&env, 2);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 2, schemes, 100).unwrap();

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let mut sigs = Vec::new(&env);
        sigs.push_back(account_sig(&env, &s1.address, env.ledger().sequence()));
        sigs.push_back(account_sig(&env, &s2.address, env.ledger().sequence()));
        assert!(validate_threshold(&env, &issuer, &hash, &sigs).is_ok());
    }

    #[test]
    fn test_threshold_not_met() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let s2 = signer(&env, 2);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 3, schemes, 100).unwrap();

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let mut sigs = Vec::new(&env);
        sigs.push_back(account_sig(&env, &s1.address, env.ledger().sequence()));
        assert_eq!(
            validate_threshold(&env, &issuer, &hash, &sigs),
            Err(ThresholdError::ThresholdNotMet)
        );
    }

    #[test]
    fn test_weighted_signers() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let s2 = signer(&env, 3);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 3, schemes, 100).unwrap();

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        // Single heavy signer meets threshold.
        let mut sigs = Vec::new(&env);
        sigs.push_back(account_sig(&env, &s2.address, env.ledger().sequence()));
        assert!(validate_threshold(&env, &issuer, &hash, &sigs).is_ok());
    }

    #[test]
    fn test_invalid_scheme() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 1, schemes, 100).unwrap();

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let mut sigs = Vec::new(&env);
        sigs.push_back(SignedPayload {
            signer: s1.address.clone(),
            scheme: SignatureScheme::Ed25519,
            signature: Bytes::new(&env),
            signed_at: env.ledger().sequence(),
        });
        assert_eq!(
            validate_threshold(&env, &issuer, &hash, &sigs),
            Err(ThresholdError::InvalidSignatureScheme)
        );
    }

    #[test]
    fn test_signer_not_authorized() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 1, schemes, 100).unwrap();

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let rogue = Address::generate(&env);
        let mut sigs = Vec::new(&env);
        sigs.push_back(account_sig(&env, &rogue, env.ledger().sequence()));
        assert_eq!(
            validate_threshold(&env, &issuer, &hash, &sigs),
            Err(ThresholdError::SignerNotAuthorized)
        );
    }

    #[test]
    fn test_signature_expiry() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 1, schemes, 10).unwrap();

        env.ledger().set_sequence_number(1000);
        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let mut sigs = Vec::new(&env);
        sigs.push_back(account_sig(&env, &s1.address, 900));
        assert_eq!(
            validate_threshold(&env, &issuer, &hash, &sigs),
            Err(ThresholdError::SignatureExpired)
        );
    }

    #[test]
    fn test_aggregate_signatures() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let s2 = signer(&env, 2);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers, 2, schemes, 100).unwrap();

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let mut sigs = Vec::new(&env);
        sigs.push_back(account_sig(&env, &s1.address, env.ledger().sequence()));
        sigs.push_back(account_sig(&env, &s2.address, env.ledger().sequence()));
        let agg = aggregate_signatures(&env, &issuer, &hash, &sigs).unwrap();
        assert_eq!(agg.total_weight, 3);
        assert_eq!(agg.signers.len(), 2);
    }

    #[test]
    fn test_recovery_rotation() {
        let (env, issuer) = setup();
        let s1 = signer(&env, 1);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        set_signers(&env, &issuer, signers.clone(), 1, schemes.clone(), 100).unwrap();

        let mut guardians = Vec::new(&env);
        guardians.push_back(Address::generate(&env));
        guardians.push_back(Address::generate(&env));
        guardians.push_back(Address::generate(&env));
        set_guardians(&env, &issuer, guardians).unwrap();

        let new_signer = signer(&env, 2);
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(new_signer);
        rotate_signers_via_recovery(&env, &issuer, new_signers, 2, schemes, 200).unwrap();

        let set = get_signer_set(&env, &issuer).unwrap();
        assert_eq!(set.threshold, 2);
        assert_eq!(set.signature_expiry_ledgers, 200);
    }

    #[test]
    fn test_recovery_without_guardians_fails() {
        let (env, issuer) = setup();
        let mut schemes = Vec::new(&env);
        schemes.push_back(SignatureScheme::Account);
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(signer(&env, 1));
        let res = rotate_signers_via_recovery(&env, &issuer, new_signers, 1, schemes, 100);
        assert_eq!(res, Err(ThresholdError::Unauthorized));
    }

    #[test]
    fn test_enforce_threshold_no_set() {
        let (env, issuer) = setup();
        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let sigs = Vec::new(&env);
        // No signer set configured: operation proceeds.
        assert!(enforce_threshold(&env, &issuer, &hash, &sigs).is_ok());
    }
}