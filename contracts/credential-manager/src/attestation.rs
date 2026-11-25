use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contracttype, symbol_short, Address, Bytes, BytesN, Env, Map, String, Symbol, Vec,
};

const ATTESTATION: Symbol = symbol_short!("ATTEST");
const ATTESTATION_ISSUED: Symbol = symbol_short!("ATISSUE");
const ATTESTATION_REVOKED: Symbol = symbol_short!("ATREVOKE");
const ATTESTATION_KEY: Symbol = symbol_short!("ATTKEY");
const ATTESTATION_EXPIRY: Symbol = symbol_short!("ATTEXP");
const ATTESTATION_ACCOUNT: Symbol = symbol_short!("ATTACC");
const TTL_EXTEND: u32 = 17_280;
const TTL_LIFETIME: u32 = 6_312_000;
const EVENT_VERSION: u32 = 1;
pub const MAX_ATTESTATION_BATCH: u32 = 50;

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

/// A claim-based attestation request accepted by `issue_attestations_batch`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AttestationInput {
    pub subject: Address,
    pub claim_type: String,
    pub value: String,
    /// Unix timestamp in seconds; zero means no expiry.
    pub expiry: u64,
}

/// Stable claim-oriented view returned by `get_attestation`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AttestationRecord {
    pub id: BytesN<32>,
    pub subject: Address,
    pub issuer: Address,
    pub claims: Map<String, String>,
    pub expiry: u64,
    pub revoked: bool,
    pub revoked_at: u64,
    pub revoked_by: Option<Address>,
}

fn storage_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (ATTESTATION, id.clone())
}

fn expiry_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (ATTESTATION_EXPIRY, id.clone())
}

fn account_key(account: &Address) -> (Symbol, Address) {
    (ATTESTATION_ACCOUNT, account.clone())
}

fn expiry(env: &Env, attestation: &Attestation) -> u64 {
    env.storage()
        .persistent()
        .get(&expiry_key(&attestation.id))
        .unwrap_or(u64::from(attestation.expires_at_ledger))
}

fn claim_key(
    subject: &Address,
    claim_type: &String,
    issuer: &Address,
) -> (Symbol, Address, String, Address) {
    (
        ATTESTATION_KEY,
        subject.clone(),
        claim_type.clone(),
        issuer.clone(),
    )
}

fn derive_id(env: &Env, subject: &Address, claim_type: &String, issuer: &Address) -> BytesN<32> {
    // Hash length-delimited XDR encodings rather than truncating concatenated
    // strings, so different claims cannot alias through a 32-byte prefix.
    let mut data = Bytes::new(env);
    data.append(&subject.clone().to_xdr(env));
    data.append(&claim_type.clone().to_xdr(env));
    data.append(&issuer.clone().to_xdr(env));
    env.crypto().sha256(&data).into()
}

pub fn store(env: &Env, attestation: &Attestation) {
    let key = storage_key(&attestation.id);
    env.storage().persistent().set(&key, attestation);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND, TTL_LIFETIME);
    index_account(env, &attestation.subject, &attestation.id);
    if attestation.issuer != attestation.subject {
        index_account(env, &attestation.issuer, &attestation.id);
    }
}

fn index_account(env: &Env, account: &Address, id: &BytesN<32>) {
    let key = account_key(account);
    let mut ids = env
        .storage()
        .persistent()
        .get::<_, Vec<BytesN<32>>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut exists = false;
    for existing in ids.iter() {
        if existing == id.clone() {
            exists = true;
            break;
        }
    }
    if !exists {
        ids.push_back(id.clone());
        env.storage().persistent().set(&key, &ids);
    }
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND, TTL_LIFETIME);
}

pub fn get(env: &Env, id: &BytesN<32>) -> Option<Attestation> {
    env.storage()
        .persistent()
        .get::<(Symbol, BytesN<32>), Attestation>(&storage_key(id))
}

pub fn get_record(env: &Env, id: &BytesN<32>) -> Option<AttestationRecord> {
    let attestation = get(env, id)?;
    let record_expiry = expiry(env, &attestation);
    let revoked_at = u64::from(attestation.revoked_at_ledger);
    Some(AttestationRecord {
        id: attestation.id,
        subject: attestation.subject,
        issuer: attestation.issuer,
        claims: attestation.claims,
        expiry: record_expiry,
        revoked: attestation.revoked,
        revoked_at,
        revoked_by: attestation.revoked_by,
    })
}

pub fn get_records_for_account(env: &Env, account: &Address) -> Vec<AttestationRecord> {
    let ids = env
        .storage()
        .persistent()
        .get::<_, Vec<BytesN<32>>>(&account_key(account))
        .unwrap_or_else(|| Vec::new(env));
    let mut records = Vec::new(env);
    for id in ids.iter() {
        if let Some(record) = get_record(env, &id) {
            records.push_back(record);
        }
    }
    records
}

pub fn is_expired(env: &Env, attestation: &Attestation) -> bool {
    if let Some(expiry) = env
        .storage()
        .persistent()
        .get::<_, u64>(&expiry_key(&attestation.id))
    {
        expiry != 0 && env.ledger().timestamp() > expiry
    } else {
        attestation.expires_at_ledger != 0
            && env.ledger().sequence() > attestation.expires_at_ledger
    }
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
            let expiry_key = expiry_key(id);
            if env.storage().persistent().has(&expiry_key) {
                env.storage()
                    .persistent()
                    .extend_ttl(&expiry_key, TTL_EXTEND, TTL_LIFETIME);
            }
            // Account indexes have an independent TTL. Reinsert/refresh both
            // indexes so they cannot expire while this attestation is kept live.
            index_account(env, &attestation.subject, id);
            if attestation.issuer != attestation.subject {
                index_account(env, &attestation.issuer, id);
            }
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
    if attestation.issuer != caller.clone() || attestation.revoked {
        return false;
    }
    attestation.revoked = true;
    attestation.revoked_at_ledger = env.ledger().sequence();
    attestation.revoked_by = Some(caller.clone());
    store(env, &attestation);
    let expires_at = expiry(env, &attestation);
    env.events().publish(
        (ATTESTATION, ATTESTATION_REVOKED),
        (
            EVENT_VERSION,
            attestation.id,
            attestation.subject,
            attestation.issuer,
            attestation.claims,
            expires_at,
            attestation.revoked,
            attestation.revoked_at_ledger,
            attestation.revoked_by,
        ),
    );
    true
}

/// Legacy low-level issuance API retained for existing callers and tests.
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
        id,
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
    publish_issued(env, &attestation, u64::from(expires_at_ledger));
    true
}

fn publish_issued(env: &Env, attestation: &Attestation, expires_at: u64) {
    env.events().publish(
        (ATTESTATION, ATTESTATION_ISSUED),
        (
            EVENT_VERSION,
            attestation.id.clone(),
            attestation.subject.clone(),
            attestation.issuer.clone(),
            attestation.claims.clone(),
            expires_at,
            attestation.issued_at_ledger,
            attestation.revoked,
        ),
    );
}

fn validate_claim_batch(
    env: &Env,
    issuer: &Address,
    inputs: &Vec<AttestationInput>,
) -> Result<(), u32> {
    if inputs.len() == 0 {
        return Err(5);
    }
    if inputs.len() > MAX_ATTESTATION_BATCH {
        return Err(6);
    }
    if !crate::issuer::is_trusted_issuer(env, issuer) {
        return Err(1);
    }
    let now = env
        .ledger()
        .timestamp()
        .max(u64::from(env.ledger().sequence()));
    for i in 0..inputs.len() {
        let input = inputs.get(i).unwrap();
        if input.claim_type.is_empty() || input.value.is_empty() {
            return Err(2);
        }
        if input.expiry != 0 && input.expiry <= now {
            return Err(3);
        }
        let index_key = claim_key(&input.subject, &input.claim_type, issuer);
        if env
            .storage()
            .persistent()
            .has::<(Symbol, Address, String, Address)>(&index_key)
        {
            return Err(4);
        }
        let id = derive_id(env, &input.subject, &input.claim_type, issuer);
        if get(env, &id).is_some() {
            return Err(4);
        }
        for j in 0..i {
            let previous = inputs.get(j).unwrap();
            if input.subject == previous.subject && input.claim_type == previous.claim_type {
                return Err(4);
            }
            if id == derive_id(env, &previous.subject, &previous.claim_type, issuer) {
                return Err(4);
            }
        }
    }
    Ok(())
}

/// Validates the complete request before persisting any record, then emits one
/// versioned event per issuance in input order.
pub fn issue_attestations_batch(
    env: &Env,
    issuer: &Address,
    inputs: &Vec<AttestationInput>,
) -> Result<Vec<BytesN<32>>, u32> {
    issuer.require_auth();
    validate_claim_batch(env, issuer, inputs)?;
    let mut ids = Vec::new(env);
    for input in inputs.iter() {
        let id = derive_id(env, &input.subject, &input.claim_type, issuer);
        let mut claims = Map::new(env);
        claims.set(input.claim_type.clone(), input.value.clone());
        let attestation = Attestation {
            id: id.clone(),
            subject: input.subject.clone(),
            issuer: issuer.clone(),
            claims,
            issued_at_ledger: env.ledger().sequence(),
            expires_at_ledger: 0,
            revoked: false,
            revoked_at_ledger: 0,
            revoked_by: None,
        };
        let index_key = claim_key(&input.subject, &input.claim_type, issuer);
        store(env, &attestation);
        env.storage()
            .persistent()
            .set(&expiry_key(&id), &input.expiry);
        env.storage()
            .persistent()
            .extend_ttl(&expiry_key(&id), TTL_EXTEND, TTL_LIFETIME);
        env.storage().persistent().set(&index_key, &id);
        env.storage()
            .persistent()
            .extend_ttl(&index_key, TTL_EXTEND, TTL_LIFETIME);
        publish_issued(env, &attestation, input.expiry);
        ids.push_back(id);
    }
    Ok(ids)
}

/// Compatibility helper for existing tests/callers of the earlier claim API.
pub fn issue_attestation_for_claim(
    env: &Env,
    issuer: &Address,
    subject: &Address,
    claim_type: &String,
    value: &String,
    expiry: u64,
) -> Result<BytesN<32>, u32> {
    let mut inputs = Vec::new(env);
    inputs.push_back(AttestationInput {
        subject: subject.clone(),
        claim_type: claim_type.clone(),
        value: value.clone(),
        expiry,
    });
    issue_attestations_batch(env, issuer, &inputs).map(|ids| ids.get(0).unwrap())
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
        claims.set(
            String::from_str(env, "role"),
            String::from_str(env, "verified"),
        );
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
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn verify_repairs_missing_account_indexes_for_live_records() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject.clone(),
            claims(&env),
            150
        ));
        env.storage().persistent().remove(&account_key(&subject));
        env.storage().persistent().remove(&account_key(&issuer));

        assert!(get_records_for_account(&env, &subject).is_empty());
        assert!(verify_attestation(&env, &id));
        assert_eq!(get_records_for_account(&env, &subject).len(), 1);
        assert_eq!(get_records_for_account(&env, &issuer).len(), 1);
    }

    #[test]
    fn verify_fails_once_the_expiry_ledger_is_passed() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
        env.ledger().with_mut(|li| li.sequence_number = 151);
        assert!(!verify_attestation(&env, &id));
    }

    #[test]
    fn expiry_is_enforced_by_expiry_ledger_not_timestamp() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
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
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            0
        ));
        env.ledger().with_mut(|li| li.sequence_number = 10_000);
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn revoked_attestation_fails_verification() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
        assert!(revoke_attestation(&env, &issuer, &id));
        assert!(!verify_attestation(&env, &id));
    }

    #[test]
    fn only_the_issuer_can_revoke_an_attestation() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
        let other = Address::generate(&env);
        assert!(!revoke_attestation(&env, &other, &id));
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn successful_revocation_records_metadata() {
        let (env, issuer, subject, id) = setup();
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
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
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject,
            claims(&env),
            150
        ));
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
        assert!(issue_attestation(
            &env,
            &issuer,
            id.clone(),
            subject.clone(),
            claims(&env),
            150
        ));
        assert!(!issue_attestation(
            &env,
            &issuer,
            id,
            subject,
            claims(&env),
            150
        ));
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
        assert!(
            issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &empty, 150).is_err()
        );
    }

    #[test]
    fn issue_for_claim_rejects_past_expiry() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        assert!(
            issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 100).is_err()
        );
        assert!(
            issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 50).is_err()
        );
    }

    #[test]
    fn issue_for_claim_accepts_zero_expiry_and_stores_attestation() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        let id =
            issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 0).unwrap();
        let stored = get(&env, &id).unwrap();
        assert_eq!(stored.subject, subject);
        assert_eq!(stored.issuer, issuer);
        assert_eq!(expiry(&env, &stored), 0);
        assert!(verify_attestation(&env, &id));
    }

    #[test]
    fn issue_for_claim_rejects_duplicate_claim() {
        let (env, issuer, subject, _id) = setup();
        register_issuer(&env, &issuer);
        let claim_type = String::from_str(&env, "role");
        let value = String::from_str(&env, "verified");
        assert!(
            issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 150).is_ok()
        );
        assert!(
            issue_attestation_for_claim(&env, &issuer, &subject, &claim_type, &value, 150).is_err()
        );
    }

    #[test]
    fn batch_validates_every_item_before_writing() {
        let (env, issuer, subject, _) = setup();
        register_issuer(&env, &issuer);
        let mut inputs = Vec::new(&env);
        inputs.push_back(AttestationInput {
            subject: subject.clone(),
            claim_type: String::from_str(&env, "role"),
            value: String::from_str(&env, "member"),
            expiry: 0,
        });
        inputs.push_back(AttestationInput {
            subject: subject.clone(),
            claim_type: String::from_str(&env, ""),
            value: String::from_str(&env, "bad"),
            expiry: 0,
        });
        assert!(issue_attestations_batch(&env, &issuer, &inputs).is_err());
        assert!(env
            .storage()
            .persistent()
            .get::<_, BytesN<32>>(&claim_key(
                &subject,
                &String::from_str(&env, "role"),
                &issuer,
            ))
            .is_none());
    }
}
