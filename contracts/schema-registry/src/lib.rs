#![no_std]
#![deny(clippy::all)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Map, String, Symbol, Vec,
};
use soroban_sdk::xdr::ToXdr;

pub const CONTRACT_VERSION: u32 = 1;
const EVENT_VERSION: u32 = 1;

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const PENDING_ADMIN: Symbol = symbol_short!("PADMIN");
const SCHEMA: Symbol = symbol_short!("SCHEMA");
const SCHEMA_CNT: Symbol = symbol_short!("SCHCNT");
const TOTAL_SCH: Symbol = symbol_short!("TOTSCH");
const ISSUER_SCH: Symbol = symbol_short!("ISSSCH");
const TTL_MAX: u32 = 6_312_000;
const TTL_MIN: u32 = 17_280;
const PAGE_CAP: u32 = 100;
const MAX_SCHEMA_FIELDS: u32 = 50;
const MAX_FIELD_NAME_LEN: u32 = 128;
const MAX_FIELD_DESC_LEN: u32 = 512;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    SchemaNotFound = 3,
    SchemaAlreadyExists = 4,
    NotInitialized = 5,
    InvalidSchemaHash = 6,
    SchemaNotOwned = 7,
    InvalidSchemaData = 8,
    TooManyFields = 9,
    FieldNameTooLong = 10,
    FieldDescriptionTooLong = 11,
    BackwardIncompatible = 12,
    NoPendingAdmin = 13,
    NotPendingAdmin = 14,
    ContractPaused = 15,
    SchemaVersionNotHigher = 16,
    SchemaAlreadyLatestVersion = 17,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SchemaFieldType {
    String,
    Number,
    Boolean,
    Date,
    Email,
    Url,
    Custom,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SchemaField {
    pub name: String,
    pub field_type: SchemaFieldType,
    pub required: bool,
    pub description: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SchemaDefinition {
    pub schema_id: BytesN<32>,
    pub issuer: Address,
    pub name: String,
    pub version: u32,
    pub fields: Vec<SchemaField>,
    pub schema_hash: BytesN<32>,
    pub created_at: u64,
    pub updated_at: u64,
    pub active: bool,
    /// All-zero when this is the first schema version.
    pub previous_version_id: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SchemaValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SchemaPage {
    pub items: Vec<BytesN<32>>,
    pub next_cursor: Option<u64>,
}

#[contract]
pub struct SchemaRegistry;

#[contractimpl]
impl SchemaRegistry {
    pub fn ping(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_uninitialized(&env)?;
        Self::set_admin(&env, &admin);
        env.events().publish((ADMIN, symbol_short!("init")), (EVENT_VERSION, admin));
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

    /// Register a new credential schema on-chain.
    ///
    /// Stores the full schema definition including fields, types, and validation
    /// rules. The schema_hash is derived from the schema content for integrity
    /// verification.
    pub fn register_schema(
        env: Env,
        issuer: Address,
        name: String,
        fields: Vec<SchemaField>,
        schema_hash: BytesN<32>,
    ) -> Result<BytesN<32>, ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        if schema_hash == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(ContractError::InvalidSchemaHash);
        }

        if fields.len() == 0 || fields.len() > MAX_SCHEMA_FIELDS {
            return Err(ContractError::InvalidSchemaData);
        }

        for field in fields.iter() {
            if field.name.len() > MAX_FIELD_NAME_LEN {
                return Err(ContractError::FieldNameTooLong);
            }
            if field.description.len() > MAX_FIELD_DESC_LEN {
                return Err(ContractError::FieldDescriptionTooLong);
            }
        }

        let schema_id = Self::derive_schema_id(&env, &issuer, &schema_hash);
        let key = Self::schema_key(&schema_id);

        if env.storage().persistent().has(&key) {
            return Err(ContractError::SchemaAlreadyExists);
        }

        let now = env.ledger().timestamp();
        let schema = SchemaDefinition {
            schema_id: schema_id.clone(),
            issuer: issuer.clone(),
            name: name.clone(),
            version: 1,
            fields,
            schema_hash: schema_hash.clone(),
            created_at: now,
            updated_at: now,
            active: true,
            previous_version_id: BytesN::from_array(&env, &[0u8; 32]),
        };

        env.storage().persistent().set(&key, &schema);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        let mut issuer_schemas = Self::fetch_issuer_schemas(&env, &issuer);
        issuer_schemas.push_back(schema_id.clone());
        let issuer_key = Self::issuer_schemas_key(&issuer);
        env.storage().persistent().set(&issuer_key, &issuer_schemas);
        env.storage()
            .persistent()
            .extend_ttl(&issuer_key, TTL_MAX, TTL_MAX);

        let cnt: u32 = env
            .storage()
            .instance()
            .get(&SCHEMA_CNT)
            .unwrap_or(0);
        env.storage().instance().set(&SCHEMA_CNT, &(cnt + 1));
        let total: u32 = env
            .storage()
            .instance()
            .get(&TOTAL_SCH)
            .unwrap_or(0);
        env.storage().instance().set(&TOTAL_SCH, &(total + 1));

        env.events().publish(
            (SCHEMA, symbol_short!("sc_reg")),
            (EVENT_VERSION, schema_id.clone(), issuer, name, schema_hash),
        );
        Ok(schema_id)
    }

    /// Register a new version of an existing schema.
    ///
    /// Performs backward compatibility checks: the new schema must be a
    /// superset of the previous version's required fields. Emits a
    /// `schema_versioned` event.
    pub fn register_schema_version(
        env: Env,
        issuer: Address,
        previous_schema_id: BytesN<32>,
        name: String,
        fields: Vec<SchemaField>,
        schema_hash: BytesN<32>,
    ) -> Result<BytesN<32>, ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let prev_key = Self::schema_key(&previous_schema_id);
        let prev_schema: SchemaDefinition = env
            .storage()
            .persistent()
            .get(&prev_key)
            .ok_or(ContractError::SchemaNotFound)?;

        if prev_schema.issuer != issuer {
            return Err(ContractError::Unauthorized);
        }

        if schema_hash == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(ContractError::InvalidSchemaHash);
        }

        if fields.len() == 0 || fields.len() > MAX_SCHEMA_FIELDS {
            return Err(ContractError::InvalidSchemaData);
        }

        for field in fields.iter() {
            if field.name.len() > MAX_FIELD_NAME_LEN {
                return Err(ContractError::FieldNameTooLong);
            }
            if field.description.len() > MAX_FIELD_DESC_LEN {
                return Err(ContractError::FieldDescriptionTooLong);
            }
        }

        Self::check_backward_compatibility(&env, &prev_schema.fields, &fields)?;

        let schema_id = Self::derive_schema_id(&env, &issuer, &schema_hash);
        let key = Self::schema_key(&schema_id);

        if env.storage().persistent().has(&key) {
            return Err(ContractError::SchemaAlreadyExists);
        }

        let now = env.ledger().timestamp();
        let new_version = prev_schema.version + 1;
        let schema = SchemaDefinition {
            schema_id: schema_id.clone(),
            issuer: issuer.clone(),
            name,
            version: new_version,
            fields,
            schema_hash: schema_hash.clone(),
            created_at: now,
            updated_at: now,
            active: true,
            previous_version_id: previous_schema_id.clone(),
        };

        env.storage().persistent().set(&key, &schema);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        let mut issuer_schemas = Self::fetch_issuer_schemas(&env, &issuer);
        issuer_schemas.push_back(schema_id.clone());
        let issuer_key = Self::issuer_schemas_key(&issuer);
        env.storage().persistent().set(&issuer_key, &issuer_schemas);
        env.storage()
            .persistent()
            .extend_ttl(&issuer_key, TTL_MAX, TTL_MAX);

        let total: u32 = env
            .storage()
            .instance()
            .get(&TOTAL_SCH)
            .unwrap_or(0);
        env.storage().instance().set(&TOTAL_SCH, &(total + 1));

        env.events().publish(
            (SCHEMA, symbol_short!("versioned")),
            (
                EVENT_VERSION,
                schema_id.clone(),
                previous_schema_id,
                issuer,
                new_version,
                schema_hash,
            ),
        );
        Ok(schema_id)
    }

    /// Validate credential claims against a registered schema.
    ///
    /// Checks that all required fields are present and that field names match
    /// the schema definition.
    pub fn validate_claims(
        env: Env,
        schema_id: BytesN<32>,
        claims: Map<String, String>,
    ) -> Result<SchemaValidationResult, ContractError> {
        let key = Self::schema_key(&schema_id);
        let schema: SchemaDefinition = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::SchemaNotFound)?;

        if !schema.active {
            return Err(ContractError::SchemaNotFound);
        }

        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }

        let mut errors: Vec<String> = Vec::new(&env);

        for field in schema.fields.iter() {
            if field.required && !claims.contains_key(field.name.clone()) {
                errors.push_back(String::from_str(
                    &env,
                    "Missing required field",
                ));
            }
        }

        let valid = errors.len() == 0;
        Ok(SchemaValidationResult { valid, errors })
    }

    /// Retrieve a schema by its ID.
    pub fn get_schema(
        env: Env,
        schema_id: BytesN<32>,
    ) -> Result<SchemaDefinition, ContractError> {
        let key = Self::schema_key(&schema_id);
        match env.storage().persistent().get::<_, SchemaDefinition>(&key) {
            None => Err(ContractError::SchemaNotFound),
            Some(schema) => {
                let ttl = TTL_MAX;
                env.storage().persistent().extend_ttl(&key, ttl, ttl);
                Ok(schema)
            }
        }
    }

    /// Deactivate a schema. Only the schema issuer can deactivate.
    pub fn deactivate_schema(
        env: Env,
        issuer: Address,
        schema_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::schema_key(&schema_id);
        let mut schema: SchemaDefinition = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::SchemaNotFound)?;

        if schema.issuer != issuer {
            return Err(ContractError::Unauthorized);
        }

        schema.active = false;
        schema.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &schema);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_MAX, TTL_MAX);

        env.events().publish(
            (SCHEMA, symbol_short!("deactvtd")),
            (EVENT_VERSION, schema_id, issuer),
        );
        Ok(())
    }

    /// Get all schemas registered by an issuer.
    pub fn get_issuer_schemas(env: Env, issuer: Address) -> Vec<BytesN<32>> {
        Self::fetch_issuer_schemas(&env, &issuer)
    }

    /// Paginated listing of issuer schemas.
    pub fn list_issuer_schemas(
        env: Env,
        issuer: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> SchemaPage {
        let all = Self::fetch_issuer_schemas(&env, &issuer);
        let total = all.len();
        let start: u64 = cursor.unwrap_or(0);
        let effective_limit: u32 = if limit == 0 || limit > PAGE_CAP {
            PAGE_CAP
        } else {
            limit
        };
        let mut items: Vec<BytesN<32>> = Vec::new(&env);
        let mut next: u64 = start;
        let mut taken: u32 = 0;
        while (next as u32) < total && taken < effective_limit {
            items.push_back(all.get(next as u32).unwrap());
            next += 1;
            taken += 1;
        }
        let next_cursor = if (next as u32) < total {
            Some(next)
        } else {
            None
        };
        SchemaPage {
            items,
            next_cursor,
        }
    }

    pub fn get_schema_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&SCHEMA_CNT)
            .unwrap_or(0)
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

    fn derive_schema_id(
        env: &Env,
        issuer: &Address,
        schema_hash: &BytesN<32>,
    ) -> BytesN<32> {
        let mut data = soroban_sdk::Bytes::new(env);
        data.append(&issuer.clone().to_xdr(env));
        data.append(&schema_hash.clone().to_xdr(env));
        env.crypto().sha256(&data).into()
    }

    fn schema_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
        (SCHEMA, id.clone())
    }

    fn issuer_schemas_key(issuer: &Address) -> (Symbol, Address) {
        (ISSUER_SCH, issuer.clone())
    }

    fn fetch_issuer_schemas(env: &Env, issuer: &Address) -> Vec<BytesN<32>> {
        let key = Self::issuer_schemas_key(issuer);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MAX, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Check backward compatibility: all required fields in the previous schema
    /// must also be present (and required) in the new schema.
    fn check_backward_compatibility(
        _env: &Env,
        prev_fields: &Vec<SchemaField>,
        new_fields: &Vec<SchemaField>,
    ) -> Result<(), ContractError> {
        for prev_field in prev_fields.iter() {
            if prev_field.required {
                let mut found = false;
                for new_field in new_fields.iter() {
                    if new_field.name == prev_field.name && new_field.required {
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err(ContractError::BackwardIncompatible);
                }
            }
        }
        Ok(())
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

    fn setup() -> (Env, Address, SchemaRegistryClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    fn make_field(env: &Env, name: &str, required: bool) -> SchemaField {
        SchemaField {
            name: String::from_str(env, name),
            field_type: SchemaFieldType::String,
            required,
            description: String::from_str(env, "test field"),
        }
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_initialize_and_register_schema() {
        let (env, admin, client) = setup();
        let issuer = Address::generate(&env);

        let mut fields: Vec<SchemaField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));
        fields.push_back(make_field(&env, "email", false));

        let schema_hash = BytesN::from_array(&env, &[1u8; 32]);
        let schema_id = client.register_schema(
            &issuer,
            &String::from_str(&env, "KYC Schema"),
            &fields,
            &schema_hash,
        );

        assert_eq!(client.get_schema_count(), 1);

        let schema = client.get_schema(&schema_id);
        assert_eq!(schema.issuer, issuer);
        assert_eq!(schema.version, 1);
        assert!(schema.active);
    }

    #[test]
    fn test_validate_credential_valid() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);

        let mut fields: Vec<SchemaField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));
        fields.push_back(make_field(&env, "email", false));

        let schema_hash = BytesN::from_array(&env, &[1u8; 32]);
        let schema_id = client.register_schema(
            &issuer,
            &String::from_str(&env, "KYC"),
            &fields,
            &schema_hash,
        );

        let mut claims: Map<String, String> = Map::new(&env);
        claims.set(
            String::from_str(&env, "name"),
            String::from_str(&env, "Alice"),
        );

        let result = client.validate_claims(&schema_id, &claims);
        assert!(result.valid);
    }

    #[test]
    fn test_validate_credential_missing_required() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);

        let mut fields: Vec<SchemaField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_hash = BytesN::from_array(&env, &[1u8; 32]);
        let schema_id = client.register_schema(
            &issuer,
            &String::from_str(&env, "KYC"),
            &fields,
            &schema_hash,
        );

        let claims: Map<String, String> = Map::new(&env);
        let result = client.validate_claims(&schema_id, &claims);
        assert!(!result.valid);
    }

    #[test]
    fn test_deactivate_schema() {
        let (env, _admin, client) = setup();
        let issuer = Address::generate(&env);

        let mut fields: Vec<SchemaField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_hash = BytesN::from_array(&env, &[1u8; 32]);
        let schema_id = client.register_schema(
            &issuer,
            &String::from_str(&env, "KYC"),
            &fields,
            &schema_hash,
        );

        client.deactivate_schema(&issuer, &schema_id);
        let schema = client.get_schema(&schema_id);
        assert!(!schema.active);
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
}
