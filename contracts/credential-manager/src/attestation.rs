use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, Map, String, Symbol};

const ATTESTATION: Symbol = symbol_short!("ATTEST");
const ATTESTATION_ISSUED: Symbol = symbol_short!("ATISSUE");
const ATTESTATION_REVOKED: Symbol = symbol_short!("ATREVOKE");
const ATTESTATION_KEY: Symbol = symbol_short!("ATTKEY");
const TTL_EXTEND: u32 = 17_280;
const TTL_LIFETIME: u32 = 6_312_000;

#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    pub id: BytesN<32>,
    pub subject: Address,
    pub issuer: Address,
    pub claims: Map<String, String>,
    pub issued_at_ledger: u32,
    pub expires_at_ledger: u32,
    pub revoked: bool,
    pub revoked_at_ledger: u32,
    pub revoked_by: Option<Address>,
}

fn storage_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (ATTESTATION, id.clone())
}

fn claim_key(
    did: &Address,
    claim_type: &String,
    issuer: &Address,
) -> (Symbol, Address, String, Address) {
    (
        ATTESTATION_KEY,
        did.clone(),
        claim_type.clone(),
        issuer.clone(),
    )
}

fn derive_id(env: &Env, did: &Address, claim_type: &String, issuer: &Address) -> BytesN<32> {
    let mut data = [0u8; 32];
    let did_bytes = did.to_string();
    let issuer_bytes = issuer.to_string();
    let mut cursor = 0usize;
    for byte in did_bytes.to_bytes().iter() {
        if cursor >= 32 {
            break;
        }
        data[cursor] = byte;
        cursor += 1;
    }
    for byte in claim_type.to_bytes().iter() {
        if cursor >= 32 {
            break;
        }
        data[cursor] = byte;
        cursor += 1;
    }
    for byte in issuer_bytes.to_bytes().iter() {
        if cursor >= 32 {
            break;
        }
        data[cursor] = byte;
        cursor += 1;
    }
    let _ = env;
    BytesN::<32>::from_array(env, &data)
}

pub fn store(env: &Env, attestation: &Attestation) {
    let key = storage_key(&attestation.id);
    env.storage().persistent().set(&key, attestation);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND, TTL_LIFETIME);
}

pub fn get(env: &Env, id: &BytesN<32>) -> Option<Attestation> {
    env.storage()
        .persistent()
        .get::<(Symbol, BytesN<32>), Attestation>(&storage_key(id))
}

pub fn is_expired(env: &Env, attestation: &Attestation) -> bool {
    attestation.expires_at_ledger != 0
        && env.ledger().sequence() > attestation.expires_at_ledger
}

pub fn verify_attestation(env: &Env, id: &BytesN<32>) -> bool {
    match get(env, id) {
        None => false,
        Some(attestation) => {
            if attestation.revoked || is_expired(env, &attestation) {
                return false;
            }
            env.storage()
                .persistent()
                .extend_ttl(&storage_key(id), TTL_EXTEND, TTL_LIFETIME);
            true
        }
    }
}

pub fn revoke_attestation(env: &Env, caller: &Address, id: &BytesN<32>) -> bool {
    caller.require_auth();
    let mut attestation = match get(env, id) {
        Some(value) => value,
        None => return false,
    };
    if attestation.issuer != caller.clone() {
        return false;
    }
    if attestation.revoked {
        return false;
    }
    attestation.revoked = true;
    attestation.revoked_at_ledger = env.ledger().sequence();
    attestation.revoked_by = Some(caller.clone());
    store(env, &attestation);
    env.events()
        .publish((ATTESTATION, ATTESTATION_REVOKED), id.clone());
    true
}

pub fn issue_attestation(
    env: &Env,
    issuer: &Address,
    id: BytesN<32>,
    subject: Address,
    claims: Map<String, String>,
    expires_at_ledger: u32,
) -> bool {
    if get(env, &id).is_some() {
        return false;
    }
    let attestation = Attestation {
        id: id.clone(),
        subject,
        issuer: issuer.clone(),
        claims,
        issued_at_ledger: env.ledger().sequence(),
        expires_at_ledger,
        revoked: false,
        revoked_at_ledger: 0,
        revoked_by: None,
    };
    store(env, &attestation);
    env.events()
        .publish((ATTESTATION, ATTESTATION_ISSUED), id);
    true
}

/// Issues an attestation for `did` on behalf of a trusted `issuer`.
///
/// Requires the issuer's authorization, validates the claim payload and
/// expiry, stores the attestation keyed by `(did, claim_type, issuer)` and
/// returns the generated attestation id.
pub fn issue_attestation_for_claim(
    env: &Env,
    issuer: &Address,
    did: &Address,
    claim_type: &String,
    value: &String,
    expiry: u32,
) -> Result<BytesN<32>, u32> {
    issuer.require_auth();

    if !crate::issuer::is_trusted_issuer(env, issuer) {
        return Err(1);
    }
    if claim_type.is_empty() || value.is_empty() {
        return Err(2);
    }
    let current = env.ledger().sequence();
    if expiry != 0 && expiry <= current {
        return Err(3);
    }

    let key = claim_key(did, claim_type, issuer);
    if env
        .storage()
        .persistent()
        .has::<(Symbol, Address, String, Address)>(&key)
    {
        return Err(4);
    }

    let id = derive_id(env, did, claim_type, issuer);
    let mut claims = Map::new(env);
    claims.set(claim_type.clone(), value.clone());
    let attestation = Attestation {
        id: id.clone(),
        subject: did.clone(),
        issuer: issuer.clone(),
        claims,
        issued_at_ledger: current,
        expires_at_ledger: expiry,
        revoked: false,
    };
    store(env, &attestation);
    env.storage()
        .persistent()
        .set(&key, &id);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND, TTL_LIFETIME);

    env.events().publish(
        (ATTESTATION, ATTESTATION_ISSUED),
        (id.clone(), did.clone(), claim_type.clone(), issuer.clone(), expiry),
    );
    Ok(id)
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    fn setup() -> (Env, Address, Address, BytesN<32>) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.sequence_number = 100);
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let id = BytesN::<32>::from_array(&env, &[7u8; 32]);
        (env, issuer, subject, id)
    }

    fn claims(env: &Env) -> Map<String, String> {
        let mut claims = Map::new(env);
        claims.set(String::from_str(env, "role"), String::from_str(env, "verified"));
        claims
    }

    #[test]
    fn verify_fails_when_attestation_is_missing() {
        let (env, _issuer, _subject, id) = setup();
        assert!(!verify_attestation(&env, &id));
    }

    #[test]
    fn verify_succeeds_before_the_expiry_ledger() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn verify_fails_once_the_expiry_ledger_is_passed() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        env.ledger().with_mut(|li| li.sequence_number = 151);
        assert!(!verify_attestation(&env, &id));
    }

    #[test]
    fn expiry_is_enforced_by_expiry_ledger_not_timestamp() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        env.ledger().with_mut(|li| {
            li.sequence_number = 151;
            li.timestamp = 10;
        });
        assert!(is_expired(&env, &get(&env, &id).unwrap()));
        assert!(!verify_attestation(&env, &id));
    }

    #[test]
    fn zero_expiry_means_no_expiry() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 0));
        env.ledger().with_mut(|li| li.sequence_number = 10_000);
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn revoked_attestation_fails_verification() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        assert!(revoke_attestation(&env, &issuer, &id));
        assert!(!verify_attestation(&env, &id));
    }

    #[test]
    fn only_the_issuer_can_revoke_an_attestation() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        let other = Address::generate(&env);
        assert!(!revoke_attestation(&env, &other, &id));
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn successful_revocation_records_metadata() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        env.ledger().with_mut(|li| li.sequence_number = 120);
        assert!(revoke_attestation(&env, &issuer, &id));
        let stored = get(&env, &id).unwrap();
        assert!(stored.revoked);
        assert_eq!(stored.revoked_at_ledger, 120);
        assert_eq!(stored.revoked_by, Some(issuer));
    }

    #[test]
    fn double_revocation_is_rejected() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject, claims(&env), 150));
        assert!(revoke_attestation(&env, &issuer, &id));
        assert!(!revoke_attestation(&env, &issuer, &id));
    }

    #[test]
    fn revoking_a_missing_attestation_fails() {
        let (env, issuer, _subject, id) = setup();
        assert!(!revoke_attestation(&env, &issuer, &id));
    }

    #[test]
    fn duplicate_attestation_ids_are_rejected() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(&env, &issuer, id.clone(), subject.clone(), claims(&env), 150));
        assert!(!issue_attestation(&env, &issuer, id, subject, claims(&env), 150));
    }

    fn register_issuer(env: &Env, issuer: &Address) {
        crate::issuer::add_trusted_issuer(env, issuer);
    }

    #[test]
    fn issue_for_claim_requires_issuer_authorization() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        env.mock_auths(&[]);
        let result = issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 150);
        assert!(result.is_err());
    }

    #[test]
    fn issue_for_claim_rejects_untrusted_issuer() {
        let (env, issuer, subject, _id) = setup();
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        let result = issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 150);
        assert!(result.is_err());
    }

    #[test]
    fn issue_for_claim_rejects_empty_claim_type_or_value() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let empty = String::from_str(&env, "");
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        assert!(issue_attestation_for_claim(&env, &issuer, &subject, &empty, &value, 150).is_err());
        assert!(issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &empty, 150).is_err());
    }

    #[test]
    fn issue_for_claim_rejects_past_expiry() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        assert!(issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 100).is_err());
        assert!(issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 50).is_err());
    }

    #[test]
    fn issue_for_claim_accepts_zero_expiry_and_stores_attestation() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        let id = issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 0).unwrap();
        let stored = get(&env, &id).unwrap();
        assert_eq!(stored.subject, subject);
        assert_eq!(stored.issuer, issuer);
        assert_eq!(stored.expires_at_ledger, 0);
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn issue_for_claim_rejects_duplicate_claim() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        assert!(issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 150).is_ok());
        assert!(issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 150).is_err());
    }
}
