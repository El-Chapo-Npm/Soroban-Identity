#![no_std]
#![deny(clippy::all)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, String, Symbol, Vec,
};

pub const CONTRACT_VERSION: u32 = 1;
const EVENT_VERSION: u32 = 1;

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const PENDING_ADMIN: Symbol = symbol_short!("PADMIN");
const REV_MAP: Symbol = symbol_short!("REVMAP");
const REV_BITMAP: Symbol = symbol_short!("REVBM");
const REV_REASON: Symbol = symbol_short!("REVRSN");
const REV_COUNT: Symbol = symbol_short!("REVCNT");
const TOTAL_REV: Symbol = symbol_short!("TOTREV");
const TTL_MAX: u32 = 6_312_000;
const TTL_MIN: u32 = 17_280;
const PAGE_CAP: u32 = 100;
const BITMAP_WORDS: u32 = 16;
const MAX_BATCH_SIZE: u32 = 100;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    CredentialNotFound = 3,
    AlreadyRevoked = 4,
    NotInitialized = 5,
    InvalidBitmapIndex = 6,
    BatchTooLarge = 7,
    NotRevoked = 8,
    RevocationNotFound = 9,
    CredentialNotRevoked = 10,
    RevokeReasonTooLong = 11,
    ContractPaused = 12,
    RevocationReversalUnauthorized = 13,
    CredentialAlreadyExists = 14,
}

/// Bitmap-based revocation storage. Each issuer gets a bitmap where each bit
/// represents the revocation status of a credential. The bitmap is stored as
/// an array of u64 words for efficient storage and batch operations.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationBitmap {
    /// Number of u64 words in the bitmap (max 16 = 1024 credential slots).
    pub word_count: u32,
    /// Bitmap words, each representing 64 credential slots.
    pub words: Vec<u64>,
}

/// A single revocation record with reason and timestamp.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationRecord {
    pub credential_id: BytesN<32>,
    pub issuer: Address,
    /// Bitmap index where this credential's revocation bit lives.
    pub credential_index: u32,
    pub reason: String,
    pub reason_code: u32,
    pub revoked_at: u64,
    pub reversed: bool,
    /// 0 when never reversed.
    pub reversed_at: u64,
}

/// Result of a batch revocation check.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationStatus {
    pub credential_id: BytesN<32>,
    pub revoked: bool,
    pub reason_code: u32,
}

/// Page of revocation records.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationPage {
    pub items: Vec<RevocationRecord>,
    pub next_cursor: Option<u64>,
}

/// Revocation reason codes (W3C VC Data Integrity aligned).
pub const REASON_UNspecified: u32 = 0;
pub const REASON_KEY_COMPROMISE: u32 = 1;
pub const REASON_CA_COMPROMISE: u32 = 2;
pub const REASON_AFFILIATION_CHANGED: u32 = 3;
pub const REASON_SUPERSEDED: u32 = 4;
pub const REASON_ASSERTION_REVOKED: u32 = 5;
pub const REASON_TEMPORARY_HOLD: u32 = 6;

#[contract]
pub struct RevocationRegistry;

#[contractimpl]
impl RevocationRegistry {
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

    /// Initialize a revocation bitmap for an issuer with a given capacity.
    ///
    /// The capacity is rounded up to the nearest multiple of 64. Each bit in
    /// the bitmap represents the revocation status of a credential slot.
    pub fn init_bitmap(
        env: Env,
        issuer: Address,
        capacity: u32,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::bitmap_key(&issuer);
        if env.storage().persistent().has(&key) {
            return Err(ContractError::CredentialAlreadyExists);
        }

        let word_count = (capacity + 63) / 64;
        if word_count > BITMAP_WORDS {
            return Err(ContractError::InvalidBitmapIndex);
        }

        let mut words: Vec<u64> = Vec::new(&env);
        for _ in 0..word_count {
            words.push_back(0u64);
        }

        let bitmap = RevocationBitmap {
            word_count,
            words,
        };
        env.storage().persistent().set(&key, &bitmap);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        env.events().publish(
            (REV_MAP, symbol_short!("init")),
            (EVENT_VERSION, issuer, word_count * 64),
        );
        Ok(())
    }

    /// Revoke a single credential by setting its bit in the bitmap.
    ///
    /// The credential_index determines the bit position in the bitmap. Returns
    /// `AlreadyRevoked` if the bit is already set.
    pub fn revoke_credential(
        env: Env,
        issuer: Address,
        credential_id: BytesN<32>,
        credential_index: u32,
        reason_code: u32,
        reason: Option<String>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::bitmap_key(&issuer);
        let mut bitmap: RevocationBitmap = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;

        if credential_index >= bitmap.word_count * 64 {
            return Err(ContractError::InvalidBitmapIndex);
        }

        let word_idx = credential_index / 64;
        let bit_idx = credential_index % 64;
        let word = bitmap.words.get(word_idx).unwrap();

        if (word >> bit_idx) & 1 == 1 {
            return Err(ContractError::AlreadyRevoked);
        }

        bitmap.words.set(word_idx, word | (1u64 << bit_idx));
        env.storage().persistent().set(&key, &bitmap);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        let now = env.ledger().timestamp();
        let record = RevocationRecord {
            credential_id: credential_id.clone(),
            issuer: issuer.clone(),
            credential_index,
            reason: reason.unwrap_or_else(|| String::from_str(&env, "")),
            reason_code,
            revoked_at: now,
            reversed: false,
            reversed_at: 0,
        };

        let record_key = Self::revocation_record_key(&credential_id);
        env.storage().persistent().set(&record_key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&record_key, TTL_MAX, TTL_MAX);

        let cnt: u32 = env
            .storage()
            .instance()
            .get(&REV_COUNT)
            .unwrap_or(0);
        env.storage().instance().set(&REV_COUNT, &(cnt + 1));
        let total: u32 = env
            .storage()
            .instance()
            .get(&TOTAL_REV)
            .unwrap_or(0);
        env.storage().instance().set(&TOTAL_REV, &(total + 1));

        env.events().publish(
            (REV_MAP, symbol_short!("revoked")),
            (
                EVENT_VERSION,
                credential_id,
                issuer,
                credential_index,
                reason_code,
            ),
        );
        Ok(())
    }

    /// Batch revoke multiple credentials in a single transaction.
    ///
    /// Each entry specifies the credential_id, bitmap index, and reason.
    /// All revocations are atomic — if any fails, none are applied.
    pub fn revoke_credentials_batch(
        env: Env,
        issuer: Address,
        credential_ids: Vec<BytesN<32>>,
        credential_indices: Vec<u32>,
        reason_code: u32,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        if credential_ids.len() != credential_indices.len()
            || credential_ids.len() > MAX_BATCH_SIZE
        {
            return Err(ContractError::BatchTooLarge);
        }

        let key = Self::bitmap_key(&issuer);
        let mut bitmap: RevocationBitmap = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;

        for i in 0..credential_ids.len() {
            let idx = credential_indices.get(i).unwrap();
            if idx >= bitmap.word_count * 64 {
                return Err(ContractError::InvalidBitmapIndex);
            }
            let word_idx = idx / 64;
            let bit_idx = idx % 64;
            let word = bitmap.words.get(word_idx).unwrap();
            if (word >> bit_idx) & 1 == 1 {
                return Err(ContractError::AlreadyRevoked);
            }
        }

        for i in 0..credential_ids.len() {
            let idx = credential_indices.get(i).unwrap();
            let cred_id = credential_ids.get(i).unwrap();
            let word_idx = idx / 64;
            let bit_idx = idx % 64;
            let word = bitmap.words.get(word_idx).unwrap();
            bitmap.words.set(word_idx, word | (1u64 << bit_idx));

            let now = env.ledger().timestamp();
            let record = RevocationRecord {
                credential_id: cred_id.clone(),
                issuer: issuer.clone(),
                credential_index: idx,
                reason: String::from_str(&env, ""),
                reason_code,
                revoked_at: now,
                reversed: false,
                reversed_at: 0,
            };
            let record_key = Self::revocation_record_key(&cred_id);
            env.storage().persistent().set(&record_key, &record);
            env.storage()
                .persistent()
                .extend_ttl(&record_key, TTL_MAX, TTL_MAX);
        }

        env.storage().persistent().set(&key, &bitmap);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        let cnt: u32 = env
            .storage()
            .instance()
            .get(&REV_COUNT)
            .unwrap_or(0);
        env
            .storage()
            .instance()
            .set(&REV_COUNT, &(cnt + credential_ids.len()));
        let total: u32 = env
            .storage()
            .instance()
            .get(&TOTAL_REV)
            .unwrap_or(0);
        env
            .storage()
            .instance()
            .set(&TOTAL_REV, &(total + credential_ids.len()));

        env.events().publish(
            (REV_MAP, symbol_short!("batch_rev")),
            (
                EVENT_VERSION,
                issuer,
                credential_ids.len() as u32,
                reason_code,
            ),
        );
        Ok(())
    }

    /// Check if a credential is revoked by querying its bitmap bit.
    pub fn is_revoked(
        env: Env,
        issuer: Address,
        credential_index: u32,
    ) -> bool {
        let key = Self::bitmap_key(&issuer);
        match env
            .storage()
            .persistent()
            .get::<_, RevocationBitmap>(&key)
        {
            None => false,
            Some(bitmap) => {
                if credential_index >= bitmap.word_count * 64 {
                    return false;
                }
                let word_idx = credential_index / 64;
                let bit_idx = credential_index % 64;
                let word = bitmap.words.get(word_idx).unwrap();
                (word >> bit_idx) & 1 == 1
            }
        }
    }

    /// Batch check revocation status for multiple credential indices.
    pub fn check_revocation_batch(
        env: Env,
        issuer: Address,
        credential_ids: Vec<BytesN<32>>,
        credential_indices: Vec<u32>,
    ) -> Vec<RevocationStatus> {
        let key = Self::bitmap_key(&issuer);
        let bitmap: RevocationBitmap = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(RevocationBitmap {
                word_count: 0,
                words: Vec::new(&env),
            });

        let mut results: Vec<RevocationStatus> = Vec::new(&env);
        for i in 0..credential_ids.len() {
            let idx = credential_indices.get(i).unwrap_or(0);
            let cred_id = credential_ids.get(i).unwrap();
            let revoked = if idx < bitmap.word_count * 64 {
                let word_idx = idx / 64;
                let bit_idx = idx % 64;
                let word = bitmap.words.get(word_idx).unwrap_or(0);
                (word >> bit_idx) & 1 == 1
            } else {
                false
            };
            let reason_code = if revoked {
                let record_key = Self::revocation_record_key(&cred_id);
                if let Some(record) =
                    env.storage().persistent().get::<_, RevocationRecord>(&record_key)
                {
                    record.reason_code
                } else {
                    REASON_UNspecified
                }
            } else {
                0
            };
            results.push_back(RevocationStatus {
                credential_id: cred_id,
                revoked,
                reason_code,
            });
        }
        results
    }

    /// Reverse (undo) a revocation. Only the original issuer or contract admin
    /// may call this. The bitmap bit is cleared and the record is updated.
    pub fn reverse_revocation(
        env: Env,
        caller: Address,
        credential_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;

        let record_key = Self::revocation_record_key(&credential_id);
        let mut record: RevocationRecord = env
            .storage()
            .persistent()
            .get(&record_key)
            .ok_or(ContractError::RevocationNotFound)?;

        if record.reversed {
            return Err(ContractError::CredentialNotRevoked);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(ContractError::NotInitialized)?;
        if caller != record.issuer && caller != admin {
            return Err(ContractError::RevocationReversalUnauthorized);
        }

        let bitmap_key = Self::bitmap_key(&record.issuer);
        let mut bitmap: RevocationBitmap = env
            .storage()
            .persistent()
            .get(&bitmap_key)
            .ok_or(ContractError::CredentialNotFound)?;

        let idx = record.credential_index;

        let word_idx = idx / 64;
        let bit_idx = idx % 64;
        let word = bitmap.words.get(word_idx).unwrap();
        bitmap.words.set(word_idx, word & !(1u64 << bit_idx));
        env.storage().persistent().set(&bitmap_key, &bitmap);
        env.storage()
            .persistent()
            .extend_ttl(&bitmap_key, TTL_MAX, TTL_MAX);

        let now = env.ledger().timestamp();
        record.reversed = true;
        record.reversed_at = now;
        env.storage().persistent().set(&record_key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&record_key, TTL_MAX, TTL_MAX);

        let cnt: u32 = env
            .storage()
            .instance()
            .get(&REV_COUNT)
            .unwrap_or(0);
        if cnt > 0 {
            env.storage().instance().set(&REV_COUNT, &(cnt - 1));
        }

        env.events().publish(
            (REV_MAP, symbol_short!("reversed")),
            (EVENT_VERSION, credential_id, caller),
        );
        Ok(())
    }

    /// Get the full revocation record for a credential.
    pub fn get_revocation_record(
        env: Env,
        credential_id: BytesN<32>,
    ) -> Result<RevocationRecord, ContractError> {
        let key = Self::revocation_record_key(&credential_id);
        match env
            .storage()
            .persistent()
            .get::<_, RevocationRecord>(&key)
        {
            None => Err(ContractError::RevocationNotFound),
            Some(record) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_MAX, TTL_MAX);
                Ok(record)
            }
        }
    }

    /// Get the bitmap for an issuer (for off-chain proof generation).
    pub fn get_bitmap(env: Env, issuer: Address) -> Option<RevocationBitmap> {
        let key = Self::bitmap_key(&issuer);
        match env
            .storage()
            .persistent()
            .get::<_, RevocationBitmap>(&key)
        {
            None => None,
            Some(bitmap) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_MAX, TTL_MAX);
                Some(bitmap)
            }
        }
    }

    /// Get total revocation count.
    pub fn get_revocation_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&REV_COUNT)
            .unwrap_or(0)
    }

    /// Compute a simple Merkle root of the revocation bitmap for a given issuer.
    ///
    /// This provides a compact proof that can be used for on/off-chain
    /// revocation status verification. The root is computed as
    /// SHA-256(word_0 || word_1 || ... || word_n).
    pub fn compute_bitmap_root(
        env: Env,
        issuer: Address,
    ) -> Result<BytesN<32>, ContractError> {
        let key = Self::bitmap_key(&issuer);
        let bitmap: RevocationBitmap = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::CredentialNotFound)?;

        let mut data = Bytes::new(&env);
        for i in 0..bitmap.word_count {
            let word = bitmap.words.get(i).unwrap();
            data.extend_from_array(&word.to_be_bytes());
        }
        Ok(env.crypto().sha256(&data).into())
    }

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

    fn bitmap_key(issuer: &Address) -> (Symbol, Address) {
        (REV_BITMAP, issuer.clone())
    }

    fn revocation_record_key(
        credential_id: &BytesN<32>,
    ) -> (Symbol, BytesN<32>) {
        (REV_REASON, credential_id.clone())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        Env, String,
    };

    fn setup() -> (Env, Address, RevocationRegistryClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, RevocationRegistry);
        let client = RevocationRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RevocationRegistry);
        let client = RevocationRegistryClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_init_bitmap_and_revoke() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);

        client.init_bitmap(&issuer, &128);

        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        client.revoke_credential(&issuer, &cred_id, &0, &REASON_KEY_COMPROMISE, &None);

        assert!(client.is_revoked(&issuer, &0));
        assert!(!client.is_revoked(&issuer, &1));
    }

    #[test]
    fn test_batch_revoke() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);

        client.init_bitmap(&issuer, &128);

        let mut ids: Vec<BytesN<32>> = Vec::new(&env);
        let mut indices: Vec<u32> = Vec::new(&env);
        for i in 0..3u32 {
            ids.push_back(BytesN::from_array(&env, &[i as u8; 32]));
            indices.push_back(i);
        }

        client.revoke_credentials_batch(&issuer, &ids, &indices, &REASON_SUPERSEDED);

        for i in 0..3 {
            assert!(client.is_revoked(&issuer, &i));
        }
        assert!(!client.is_revoked(&issuer, &3));
    }

    #[test]
    fn test_reverse_revocation() {
        let (env, admin, client) = setup();
        let issuer = Address::generate(&env);

        client.init_bitmap(&issuer, &128);

        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        client.revoke_credential(&issuer, &cred_id, &0, &REASON_KEY_COMPROMISE, &None);
        assert!(client.is_revoked(&issuer, &0));

        client.reverse_revocation(&admin, &cred_id);
        assert!(!client.is_revoked(&issuer, &0));
    }

    #[test]
    fn test_compute_bitmap_root() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);

        client.init_bitmap(&issuer, &64);
        let root1 = client.compute_bitmap_root(&issuer);

        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        client.revoke_credential(&issuer, &cred_id, &0, &REASON_KEY_COMPROMISE, &None);
        let root2 = client.compute_bitmap_root(&issuer);

        assert_ne!(root1, root2);
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
    fn test_already_revoked_returns_error() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);
        client.init_bitmap(&issuer, &64);

        let cred_id = BytesN::from_array(&env, &[1u8; 32]);
        client.revoke_credential(&issuer, &cred_id, &0, &REASON_KEY_COMPROMISE, &None);

        let result = client.try_revoke_credential(&issuer, &cred_id, &0, &REASON_KEY_COMPROMISE, &None);
        assert_eq!(result, Err(Ok(ContractError::AlreadyRevoked)));
    }
}
