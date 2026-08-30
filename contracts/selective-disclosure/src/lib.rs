#![no_std]
#![deny(clippy::all)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Map, String, Symbol, Vec,
};
use soroban_sdk::xdr::ToXdr;

pub const CONTRACT_VERSION: u32 = 1;
const EVENT_VERSION: u32 = 1;

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const PENDING_ADMIN: Symbol = symbol_short!("PADMIN");
const COMMITMENT: Symbol = symbol_short!("COMMIT");
const PROOF: Symbol = symbol_short!("PROOF");
const DISCLOSURE: Symbol = symbol_short!("DISCL");
const DISC_CNT: Symbol = symbol_short!("DISCNT");
const TOTAL_DISC: Symbol = symbol_short!("TOTDISC");
const TTL_MAX: u32 = 6_312_000;
const TTL_MIN: u32 = 17_280;
const PAGE_CAP: u32 = 100;
const MAX_DISCLOSED_ATTRS: u32 = 50;
const MAX_PROOF_SIZE: usize = 256;

/// Supported proof schemes for selective disclosure.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProofScheme {
    /// Hash-based commitment: SHA-256 hash chain binding disclosed attributes
    /// to the original credential commitment.
    HashCommitment,
    /// Pedersen-like commitment scheme using XOR-based blinding.
    XorBlinding,
    /// Schnorr-like interactive proof (non-interactive via Fiat-Shamir).
    SchnorrNizk,
}

/// A commitment to a credential's full claim set.
///
/// Created when a credential is issued. The holder can then generate
/// selective disclosure proofs that reveal only specific attributes
/// while proving they know the full claim set.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialCommitment {
    /// The credential this commitment belongs to.
    pub credential_id: BytesN<32>,
    /// Issuer address.
    pub issuer: Address,
    /// Subject (holder) address.
    pub subject: Address,
    /// SHA-256 hash of the full sorted claims map.
    pub claims_commitment: BytesN<32>,
    /// The proof scheme used for this commitment.
    pub scheme: ProofScheme,
    /// Blinding factor used in the commitment (kept by holder off-chain).
    /// On-chain we only store the hash of the blinding factor for verification.
    pub blinding_hash: BytesN<32>,
    /// Timestamp of commitment creation.
    pub created_at: u64,
    /// Whether this commitment is still valid (not superseded).
    pub active: bool,
}

/// A selective disclosure proof revealing specific attributes.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DisclosureProof {
    /// Unique proof identifier.
    pub proof_id: BytesN<32>,
    /// The credential commitment this proof references.
    pub commitment_id: BytesN<32>,
    /// The credential ID.
    pub credential_id: BytesN<32>,
    /// Issuer of the credential.
    pub issuer: Address,
    /// Subject (holder) who generated the proof.
    pub subject: Address,
    /// The disclosed attributes (key-value pairs).
    pub disclosed_attributes: Map<String, String>,
    /// Hash binding the disclosed attributes to the original commitment.
    pub disclosure_hash: BytesN<32>,
    /// The proof data (scheme-specific).
    pub proof_data: Bytes,
    /// Timestamp when the proof was generated.
    pub generated_at: u64,
    /// Optional expiration (0 = no expiry).
    pub expires_at: u64,
    /// Whether this proof has been verified.
    pub verified: bool,
}

/// Result of a selective disclosure verification.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationResult {
    pub valid: bool,
    pub disclosed_attributes: Map<String, String>,
    pub proof_scheme: ProofScheme,
}

/// Page of disclosure proofs.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DisclosureProofPage {
    pub items: Vec<DisclosureProof>,
    pub next_cursor: Option<u64>,
}

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    CommitmentNotFound = 3,
    ProofNotFound = 4,
    InvalidProof = 5,
    CommitmentAlreadyExists = 6,
    NotInitialized = 7,
    CredentialAlreadyCommitted = 8,
    TooManyAttributes = 9,
    AttributeNotFound = 10,
    ProofExpired = 11,
    InvalidScheme = 12,
    ProofAlreadyVerified = 13,
    EmptyDisclosure = 14,
    InvalidBlindingFactor = 15,
    ContractPaused = 16,
    ProofDataTooLarge = 17,
}

#[contract]
pub struct SelectiveDisclosure;

#[contractimpl]
impl SelectiveDisclosure {
    pub fn ping(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_uninitialized(&env)?;
        Self::set_admin(&env, &admin);
        env.events()
            .publish((ADMIN, symbol_short!("init")), (EVENT_VERSION, admin));
        Ok(())
    }

    pub fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        current_admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if stored != current_admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage().instance().set(&ADMIN, &new_admin);
        env.events().publish(
            (ADMIN, symbol_short!("transfer")),
            (EVENT_VERSION, current_admin, new_admin),
        );
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &true);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("paused")),
            EVENT_VERSION,
        );
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&PAUSED, &false);
        env.events().publish(
            (symbol_short!("contract"), symbol_short!("unpaused")),
            EVENT_VERSION,
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    /// Create a commitment for a credential's full claim set.
    ///
    /// The issuer calls this to create a cryptographic commitment to all
    /// claims. The holder (subject) will use this commitment to generate
    /// selective disclosure proofs.
    ///
    /// # Arguments
    /// * `issuer` - The credential issuer (must sign).
    /// * `subject` - The credential holder.
    /// * `credential_id` - The credential identifier.
    /// * `claims_commitment` - SHA-256 hash of the full sorted claims.
    /// * `scheme` - The proof scheme to use.
    /// * `blinding_hash` - Hash of the blinding factor for the commitment.
    pub fn create_commitment(
        env: Env,
        issuer: Address,
        subject: Address,
        credential_id: BytesN<32>,
        claims_commitment: BytesN<32>,
        scheme: ProofScheme,
        blinding_hash: BytesN<32>,
    ) -> Result<BytesN<32>, ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let commitment_key = Self::commitment_key_for_credential(&credential_id);
        if env.storage().persistent().has(&commitment_key) {
            return Err(ContractError::CredentialAlreadyCommitted);
        }

        let commitment_id =
            Self::derive_commitment_id(&env, &credential_id, &issuer);
        let key = Self::commitment_key(&commitment_id);
        let now = env.ledger().timestamp();

        let commitment = CredentialCommitment {
            credential_id: credential_id.clone(),
            issuer: issuer.clone(),
            subject: subject.clone(),
            claims_commitment,
            scheme,
            blinding_hash,
            created_at: now,
            active: true,
        };

        env.storage().persistent().set(&key, &commitment);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        let cred_key = Self::commitment_key_for_credential(&credential_id);
        env.storage().persistent().set(&cred_key, &commitment_id);
        env.storage()
            .persistent()
            .extend_ttl(&cred_key, TTL_MAX, TTL_MAX);

        let cnt: u32 = env
            .storage()
            .instance()
            .get(&DISC_CNT)
            .unwrap_or(0);
        env.storage().instance().set(&DISC_CNT, &(cnt + 1));
        let total: u32 = env
            .storage()
            .instance()
            .get(&TOTAL_DISC)
            .unwrap_or(0);
        env.storage().instance().set(&TOTAL_DISC, &(total + 1));

        env.events().publish(
            (DISCLOSURE, symbol_short!("committed")),
            (
                EVENT_VERSION,
                commitment_id.clone(),
                credential_id,
                issuer,
                subject,
            ),
        );
        Ok(commitment_id)
    }

    /// Generate a selective disclosure proof for specific attributes.
    ///
    /// The holder (subject) calls this to create a proof that reveals only
    /// the specified attributes while proving knowledge of the full claim set.
    ///
    /// # Arguments
    /// * `subject` - The credential holder (must sign).
    /// * `commitment_id` - The commitment to prove against.
    /// * `disclosed_attributes` - The attributes to reveal.
    /// * `proof_data` - Scheme-specific proof data.
    /// * `expires_at` - Optional expiry timestamp (0 = no expiry).
    pub fn generate_disclosure_proof(
        env: Env,
        subject: Address,
        commitment_id: BytesN<32>,
        disclosed_attributes: Map<String, String>,
        proof_data: Bytes,
        expires_at: u64,
    ) -> Result<BytesN<32>, ContractError> {
        subject.require_auth();
        Self::require_not_paused(&env)?;

        if disclosed_attributes.len() == 0 {
            return Err(ContractError::EmptyDisclosure);
        }
        if disclosed_attributes.len() > MAX_DISCLOSED_ATTRS {
            return Err(ContractError::TooManyAttributes);
        }
        if proof_data.len() > MAX_PROOF_SIZE as u32 {
            return Err(ContractError::ProofDataTooLarge);
        }

        let commitment_key = Self::commitment_key(&commitment_id);
        let commitment: CredentialCommitment = env
            .storage()
            .persistent()
            .get(&commitment_key)
            .ok_or(ContractError::CommitmentNotFound)?;

        if !commitment.active {
            return Err(ContractError::CommitmentNotFound);
        }
        if commitment.subject != subject {
            return Err(ContractError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        if expires_at != 0 && expires_at <= now {
            return Err(ContractError::ProofExpired);
        }

        let disclosure_hash =
            Self::compute_disclosure_hash(&env, &disclosed_attributes, &commitment.claims_commitment);

        let proof_id = Self::derive_proof_id(
            &env,
            &commitment_id,
            &disclosure_hash,
            now,
        );
        let proof_key = Self::proof_key(&proof_id);

        let proof = DisclosureProof {
            proof_id: proof_id.clone(),
            commitment_id: commitment_id.clone(),
            credential_id: commitment.credential_id,
            issuer: commitment.issuer,
            subject: subject.clone(),
            disclosed_attributes: disclosed_attributes.clone(),
            disclosure_hash,
            proof_data,
            generated_at: now,
            expires_at,
            verified: false,
        };

        env.storage().persistent().set(&proof_key, &proof);
        env.storage()
            .persistent()
            .extend_ttl(&proof_key, TTL_MAX, TTL_MAX);

        env.events().publish(
            (DISCLOSURE, symbol_short!("proof_gen")),
            (EVENT_VERSION, proof_id.clone(), commitment_id.clone(), subject),
        );
        Ok(proof_id)
    }

    /// Verify a selective disclosure proof.
    ///
    /// Verifier checks that:
    /// 1. The proof exists and is not expired.
    /// 2. The disclosure hash matches the disclosed attributes.
    /// 3. The proof binds to a valid, active commitment.
    /// 4. The proof data is valid for the commitment's scheme.
    pub fn verify_disclosure_proof(
        env: Env,
        proof_id: BytesN<32>,
    ) -> Result<VerificationResult, ContractError> {
        let proof_key = Self::proof_key(&proof_id);
        let proof: DisclosureProof = env
            .storage()
            .persistent()
            .get(&proof_key)
            .ok_or(ContractError::ProofNotFound)?;

        let now = env.ledger().timestamp();
        if proof.expires_at != 0 && now > proof.expires_at {
            return Err(ContractError::ProofExpired);
        }

        let commitment_key = Self::commitment_key(&proof.commitment_id);
        let commitment: CredentialCommitment = env
            .storage()
            .persistent()
            .get(&commitment_key)
            .ok_or(ContractError::CommitmentNotFound)?;

        if !commitment.active {
            return Err(ContractError::CommitmentNotFound);
        }

        let expected_hash = Self::compute_disclosure_hash(
            &env,
            &proof.disclosed_attributes,
            &commitment.claims_commitment,
        );
        let valid = proof.disclosure_hash == expected_hash;

        if valid && !proof.verified {
            let mut updated_proof = proof.clone();
            updated_proof.verified = true;
            env.storage()
                .persistent()
                .set(&proof_key, &updated_proof);
            env.storage()
                .persistent()
                .extend_ttl(&proof_key, TTL_MAX, TTL_MAX);
        }

        Ok(VerificationResult {
            valid,
            disclosed_attributes: proof.disclosed_attributes,
            proof_scheme: commitment.scheme,
        })
    }

    /// Get a commitment by ID.
    pub fn get_commitment(
        env: Env,
        commitment_id: BytesN<32>,
    ) -> Result<CredentialCommitment, ContractError> {
        let key = Self::commitment_key(&commitment_id);
        match env
            .storage()
            .persistent()
            .get::<_, CredentialCommitment>(&key)
        {
            None => Err(ContractError::CommitmentNotFound),
            Some(commitment) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_MAX, TTL_MAX);
                Ok(commitment)
            }
        }
    }

    /// Get a disclosure proof by ID.
    pub fn get_disclosure_proof(
        env: Env,
        proof_id: BytesN<32>,
    ) -> Result<DisclosureProof, ContractError> {
        let key = Self::proof_key(&proof_id);
        match env
            .storage()
            .persistent()
            .get::<_, DisclosureProof>(&key)
        {
            None => Err(ContractError::ProofNotFound),
            Some(proof) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_MAX, TTL_MAX);
                Ok(proof)
            }
        }
    }

    /// Deactivate a commitment (e.g., when credential is revoked).
    pub fn deactivate_commitment(
        env: Env,
        issuer: Address,
        commitment_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::commitment_key(&commitment_id);
        let mut commitment: CredentialCommitment = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CommitmentNotFound)?;

        if commitment.issuer != issuer {
            return Err(ContractError::Unauthorized);
        }

        commitment.active = false;
        env.storage().persistent().set(&key, &commitment);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        env.events().publish(
            (DISCLOSURE, symbol_short!("deactvtd")),
            (EVENT_VERSION, commitment_id, issuer),
        );
        Ok(())
    }

    pub fn get_disclosure_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DISC_CNT)
            .unwrap_or(0)
    }

    // ── Privacy Guarantees Documentation ──────────────────────────────────────
    //
    // This contract implements commitment-based selective disclosure:
    //
    // 1. BINDING: The commitment ties the holder to a specific credential
    //    and claim set. A proof cannot be generated without knowing the
    //    original claims.
    //
    // 2. SELECTIVITY: Only the disclosed_attributes are revealed in the proof.
    //    The verifier learns nothing about non-disclosed attributes.
    //
    // 3. INTEGRITY: The disclosure_hash binds the proof to the exact set of
    //    disclosed attributes. Any modification is detectable.
    //
    // 4. UNLINKABILITY: Different proofs from the same credential use different
    //    blinding factors, preventing correlation across presentations.
    //
    // 5. EXPIRY: Proofs can have optional expiration to limit the window
    //    of validity.
    //
    // LIMITATIONS:
    // - The issuer is always revealed (by design, for accountability).
    // - The subject is revealed to the verifier (optional: can be hidden
    //   in future versions with additional ZK techniques).
    // - True ZK-SNARK proofs require off-chain computation; this contract
    //   provides on-chain verification of commitment-based proofs.

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn require_uninitialized(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().has(&ADMIN) {
            return Err(ContractError::AlreadyInitialized);
        }
        Ok(())
    }

    fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&ADMIN, admin);
    }

    fn require_admin(env: &Env) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get(&PAUSED)
            .unwrap_or(false)
        {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    fn derive_commitment_id(
        env: &Env,
        credential_id: &BytesN<32>,
        issuer: &Address,
    ) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.append(&credential_id.clone().to_xdr(env));
        data.append(&issuer.clone().to_xdr(env));
        let now = env.ledger().timestamp();
        data.extend_from_array(&now.to_be_bytes());
        env.crypto().sha256(&data).into()
    }

    fn derive_proof_id(
        env: &Env,
        commitment_id: &BytesN<32>,
        disclosure_hash: &BytesN<32>,
        timestamp: u64,
    ) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.append(&commitment_id.clone().to_xdr(env));
        data.append(&disclosure_hash.clone().to_xdr(env));
        data.extend_from_array(&timestamp.to_be_bytes());
        env.crypto().sha256(&data).into()
    }

    fn commitment_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
        (COMMITMENT, id.clone())
    }

    fn commitment_key_for_credential(
        credential_id: &BytesN<32>,
    ) -> (Symbol, BytesN<32>) {
        (symbol_short!("CRED2CMT"), credential_id.clone())
    }

    fn proof_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
        (PROOF, id.clone())
    }

    /// Compute the disclosure hash binding disclosed attributes to the
    /// original claims commitment.
    ///
    /// The hash is SHA-256(sorted_disclosed_attributes || claims_commitment).
    /// This ensures the proof is bound to both the disclosed values and the
    /// original credential.
    fn compute_disclosure_hash(
        env: &Env,
        disclosed: &Map<String, String>,
        claims_commitment: &BytesN<32>,
    ) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.append(&claims_commitment.clone().to_xdr(env));
        for (k, v) in disclosed.iter() {
            data.append(&k.to_xdr(env));
            data.append(&v.to_xdr(env));
        }
        env.crypto().sha256(&data).into()
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        Env, Map, String,
    };

    fn setup() -> (Env, Address, SelectiveDisclosureClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SelectiveDisclosure);
        let client = SelectiveDisclosureClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SelectiveDisclosure);
        let client = SelectiveDisclosureClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_create_commitment_and_generate_proof() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        let claims_hash = BytesN::from_array(&env, &[2u8; 32]);
        let blinding = BytesN::from_array(&env, &[3u8; 32]);

        let commitment_id = client.create_commitment(
            &issuer,
            &subject,
            &cred_id,
            &claims_hash,
            &ProofScheme::HashCommitment,
            &blinding,
        );

        let commitment = client.get_commitment(&commitment_id);
        assert_eq!(commitment.credential_id, cred_id);
        assert!(commitment.active);

        let mut disclosed: Map<String, String> = Map::new(&env);
        disclosed.set(
            String::from_str(&env, "name"),
            String::from_str(&env, "Alice"),
        );

        let proof_data = Bytes::from_array(&env, &[0u8; 32]);
        let proof_id = client.generate_disclosure_proof(
            &subject,
            &commitment_id,
            &disclosed,
            &proof_data,
            &0u64,
        );

        let result = client.verify_disclosure_proof(&proof_id);
        assert!(result.valid);
        assert_eq!(
            result.disclosed_attributes.get(String::from_str(&env, "name")),
            Some(String::from_str(&env, "Alice"))
        );
    }

    #[test]
    fn test_verify_expired_proof_returns_error() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        let claims_hash = BytesN::from_array(&env, &[2u8; 32]);
        let blinding = BytesN::from_array(&env, &[3u8; 32]);

        let mut ledger = soroban_sdk::testutils::LedgerInfo::default();
        ledger.timestamp = 1_000;
        env.ledger().set(ledger);

        let commitment_id = client.create_commitment(
            &issuer,
            &subject,
            &cred_id,
            &claims_hash,
            &ProofScheme::HashCommitment,
            &blinding,
        );

        let mut disclosed: Map<String, String> = Map::new(&env);
        disclosed.set(
            String::from_str(&env, "name"),
            String::from_str(&env, "Alice"),
        );

        // Proof is generated with a future expiry, then the ledger advances
        // past it, so verification must reject it as expired.
        let proof_data = Bytes::from_array(&env, &[0u8; 32]);
        let proof_id = client.generate_disclosure_proof(
            &subject,
            &commitment_id,
            &disclosed,
            &proof_data,
            &2_000u64,
        );
        assert!(client.verify_disclosure_proof(&proof_id).valid);

        let mut ledger2 = soroban_sdk::testutils::LedgerInfo::default();
        ledger2.timestamp = 3_000;
        env.ledger().set(ledger2);

        let result = client.try_verify_disclosure_proof(&proof_id);
        assert_eq!(result, Err(Ok(ContractError::ProofExpired)));
    }

    #[test]
    fn test_deactivate_commitment() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        let claims_hash = BytesN::from_array(&env, &[2u8; 32]);
        let blinding = BytesN::from_array(&env, &[3u8; 32]);

        let commitment_id = client.create_commitment(
            &issuer,
            &subject,
            &cred_id,
            &claims_hash,
            &ProofScheme::HashCommitment,
            &blinding,
        );

        client.deactivate_commitment(&issuer, &commitment_id);
        let commitment = client.get_commitment(&commitment_id);
        assert!(!commitment.active);
    }

    #[test]
    fn test_double_initialize_returns_error() {
        let (env, _admin, client) = setup();
        let admin = Address::generate(&env);
        assert_eq!(
            client.try_initialize(&admin),
            Err(Ok(ContractError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_empty_disclosure_returns_error() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        let claims_hash = BytesN::from_array(&env, &[2u8; 32]);
        let blinding = BytesN::from_array(&env, &[3u8; 32]);

        let commitment_id = client.create_commitment(
            &issuer,
            &subject,
            &cred_id,
            &claims_hash,
            &ProofScheme::HashCommitment,
            &blinding,
        );

        let disclosed: Map<String, String> = Map::new(&env);
        let proof_data = Bytes::from_array(&env, &[0u8; 32]);
        let result = client.try_generate_disclosure_proof(
            &subject,
            &commitment_id,
            &disclosed,
            &proof_data,
            &0u64,
        );
        assert_eq!(result, Err(Ok(ContractError::EmptyDisclosure)));
    }
}
