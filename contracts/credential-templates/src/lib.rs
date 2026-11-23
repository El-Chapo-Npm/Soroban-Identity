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
const TEMPLATE: Symbol = symbol_short!("TMPL");
const TMPL_CNT: Symbol = symbol_short!("TMPLCNT");
const CREATOR_TMPL: Symbol = symbol_short!("CRTMPL");
const TTL_MAX: u32 = 6_312_000;
const TTL_BUMP_THRESHOLD: u32 = TTL_MAX - 518_400;
const PAGE_CAP: u32 = 100;
const MAX_TEMPLATE_NAME_LEN: u32 = 256;
const MAX_TEMPLATE_DESC_LEN: u32 = 1024;
const MAX_FIELD_NAME_LEN: u32 = 128;
const MAX_FIELDS: u32 = 50;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Copy)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    TemplateNotFound = 3,
    TemplateAlreadyExists = 4,
    NotInitialized = 5,
    InvalidTemplateData = 6,
    TemplateNotOwned = 7,
    TooManyFields = 8,
    FieldNameTooLong = 9,
    TemplateNameTooLong = 10,
    TemplateDescriptionTooLong = 11,
    ContractPaused = 12,
    InvalidSchemaId = 13,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum FieldType {
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
pub struct TemplateField {
    pub name: String,
    pub field_type: FieldType,
    pub required: bool,
    pub description: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateMetadata {
    pub issuer_name: String,
    pub version: u32,
    pub tags: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTemplate {
    pub template_id: BytesN<32>,
    pub creator: Address,
    pub name: String,
    pub description: String,
    pub schema_id: BytesN<32>,
    pub fields: Vec<TemplateField>,
    pub metadata: TemplateMetadata,
    pub created_at: u64,
    pub updated_at: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplatePage {
    pub items: Vec<BytesN<32>>,
    pub next_cursor: Option<u64>,
}

#[contract]
pub struct CredentialTemplates;

#[contractimpl]
impl CredentialTemplates {
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

    /// Create a new credential template.
    ///
    /// Stores a reusable template that can be used for issuing credentials
    /// with consistent structure and fields.
    pub fn create_template(
        env: Env,
        creator: Address,
        name: String,
        description: String,
        schema_id: BytesN<32>,
        fields: Vec<TemplateField>,
        metadata: TemplateMetadata,
    ) -> Result<BytesN<32>, ContractError> {
        creator.require_auth();
        Self::require_not_paused(&env)?;

        if name.len() == 0 || name.len() > MAX_TEMPLATE_NAME_LEN {
            return Err(ContractError::TemplateNameTooLong);
        }

        if description.len() > MAX_TEMPLATE_DESC_LEN {
            return Err(ContractError::TemplateDescriptionTooLong);
        }

        if schema_id == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(ContractError::InvalidSchemaId);
        }

        if fields.len() == 0 || fields.len() > MAX_FIELDS {
            return Err(ContractError::InvalidTemplateData);
        }

        for field in fields.iter() {
            if field.name.len() > MAX_FIELD_NAME_LEN {
                return Err(ContractError::FieldNameTooLong);
            }
        }

        let template_id = Self::derive_template_id(&env, &creator, &name, &schema_id);
        let key = Self::template_key(&template_id);

        if env.storage().persistent().has(&key) {
            return Err(ContractError::TemplateAlreadyExists);
        }

        let now = env.ledger().timestamp();
        let template = CredentialTemplate {
            template_id: template_id.clone(),
            creator: creator.clone(),
            name: name.clone(),
            description: description.clone(),
            schema_id: schema_id.clone(),
            fields,
            metadata,
            created_at: now,
            updated_at: now,
            active: true,
        };

        env.storage().persistent().set(&key, &template);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);

        let mut creator_templates = Self::fetch_creator_templates(&env, &creator);
        creator_templates.push_back(template_id.clone());
        let creator_key = Self::creator_templates_key(&creator);
        env.storage().persistent().set(&creator_key, &creator_templates);
        env.storage()
            .persistent()
            .extend_ttl(&creator_key, TTL_BUMP_THRESHOLD, TTL_MAX);

        let cnt: u32 = env
            .storage()
            .instance()
            .get(&TMPL_CNT)
            .unwrap_or(0);
        env.storage().instance().set(&TMPL_CNT, &(cnt + 1));

        env.events().publish(
            (TEMPLATE, symbol_short!("created")),
            (EVENT_VERSION, template_id.clone(), creator, name, schema_id),
        );
        Ok(template_id)
    }

    /// Get a template by its ID.
    pub fn get_template(
        env: Env,
        template_id: BytesN<32>,
    ) -> Result<CredentialTemplate, ContractError> {
        let key = Self::template_key(&template_id);
        match env.storage().persistent().get::<_, CredentialTemplate>(&key) {
            None => Err(ContractError::TemplateNotFound),
            Some(template) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
                Ok(template)
            }
        }
    }

    /// Update an existing template. Only the creator can update.
    pub fn update_template(
        env: Env,
        creator: Address,
        template_id: BytesN<32>,
        name: Option<String>,
        description: Option<String>,
        fields: Option<Vec<TemplateField>>,
        metadata: Option<TemplateMetadata>,
    ) -> Result<(), ContractError> {
        creator.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::template_key(&template_id);
        let mut template: CredentialTemplate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::TemplateNotFound)?;

        if template.creator != creator {
            return Err(ContractError::Unauthorized);
        }

        if let Some(new_name) = name {
            if new_name.len() == 0 || new_name.len() > MAX_TEMPLATE_NAME_LEN {
                return Err(ContractError::TemplateNameTooLong);
            }
            template.name = new_name;
        }

        if let Some(new_desc) = description {
            if new_desc.len() > MAX_TEMPLATE_DESC_LEN {
                return Err(ContractError::TemplateDescriptionTooLong);
            }
            template.description = new_desc;
        }

        if let Some(new_fields) = fields {
            if new_fields.len() == 0 || new_fields.len() > MAX_FIELDS {
                return Err(ContractError::InvalidTemplateData);
            }
            for field in new_fields.iter() {
                if field.name.len() > MAX_FIELD_NAME_LEN {
                    return Err(ContractError::FieldNameTooLong);
                }
            }
            template.fields = new_fields;
        }

        if let Some(new_metadata) = metadata {
            template.metadata = new_metadata;
        }

        template.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &template);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);

        env.events().publish(
            (TEMPLATE, symbol_short!("updated")),
            (EVENT_VERSION, template_id, creator),
        );
        Ok(())
    }

    /// Deactivate a template. Only the creator can deactivate.
    pub fn deactivate_template(
        env: Env,
        creator: Address,
        template_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        creator.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::template_key(&template_id);
        let mut template: CredentialTemplate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::TemplateNotFound)?;

        if template.creator != creator {
            return Err(ContractError::Unauthorized);
        }

        template.active = false;
        template.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &template);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);

        env.events().publish(
            (TEMPLATE, symbol_short!("deactvtd")),
            (EVENT_VERSION, template_id, creator),
        );
        Ok(())
    }

    /// Reactivate a template. Only the creator can reactivate.
    pub fn reactivate_template(
        env: Env,
        creator: Address,
        template_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        creator.require_auth();
        Self::require_not_paused(&env)?;

        let key = Self::template_key(&template_id);
        let mut template: CredentialTemplate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::TemplateNotFound)?;

        if template.creator != creator {
            return Err(ContractError::Unauthorized);
        }

        template.active = true;
        template.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &template);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);

        env.events().publish(
            (TEMPLATE, symbol_short!("reactvtd")),
            (EVENT_VERSION, template_id, creator),
        );
        Ok(())
    }

    /// Get all templates created by a specific address.
    pub fn get_creator_templates(env: Env, creator: Address) -> Vec<BytesN<32>> {
        Self::fetch_creator_templates(&env, &creator)
    }

    /// Paginated listing of creator templates.
    pub fn list_creator_templates(
        env: Env,
        creator: Address,
        cursor: Option<u64>,
        limit: u32,
    ) -> TemplatePage {
        let all = Self::fetch_creator_templates(&env, &creator);
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
        TemplatePage {
            items,
            next_cursor,
        }
    }

    /// Get templates by schema ID.
    pub fn get_templates_by_schema(env: Env, schema_id: BytesN<32>) -> Vec<BytesN<32>> {
        let mut matching_templates: Vec<BytesN<32>> = Vec::new(&env);
        let cnt: u32 = env.storage().instance().get(&TMPL_CNT).unwrap_or(0);
        
        // Note: This is a simple implementation. For production, consider using an index.
        for _ in 0..cnt {
            // This would need proper indexing in a real implementation
            // For now, this is a placeholder structure
        }
        
        matching_templates
    }

    pub fn get_template_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&TMPL_CNT)
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

    fn derive_template_id(
        env: &Env,
        creator: &Address,
        name: &String,
        schema_id: &BytesN<32>,
    ) -> BytesN<32> {
        let mut data = soroban_sdk::Bytes::new(env);
        data.append(&creator.clone().to_xdr(env));
        data.append(&name.clone().to_xdr(env));
        data.append(&schema_id.clone().to_xdr(env));
        data.append(&env.ledger().timestamp().to_xdr(env));
        env.crypto().sha256(&data).into()
    }

    fn template_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
        (TEMPLATE, id.clone())
    }

    fn creator_templates_key(creator: &Address) -> (Symbol, Address) {
        (CREATOR_TMPL, creator.clone())
    }

    fn fetch_creator_templates(env: &Env, creator: &Address) -> Vec<BytesN<32>> {
        let key = Self::creator_templates_key(creator);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_BUMP_THRESHOLD, TTL_MAX);
        }
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        Env, String,
    };

    fn setup() -> (Env, Address, CredentialTemplatesClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CredentialTemplates);
        let client = CredentialTemplatesClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    fn make_field(env: &Env, name: &str, required: bool) -> TemplateField {
        TemplateField {
            name: String::from_str(env, name),
            field_type: FieldType::String,
            required,
            description: String::from_str(env, "test field"),
        }
    }

    fn make_metadata(env: &Env) -> TemplateMetadata {
        let mut tags: Vec<String> = Vec::new(env);
        tags.push_back(String::from_str(env, "kyc"));
        TemplateMetadata {
            issuer_name: String::from_str(env, "Test Issuer"),
            version: 1,
            tags,
        }
    }

    #[test]
    fn test_ping_returns_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, CredentialTemplates);
        let client = CredentialTemplatesClient::new(&env, &contract_id);
        assert_eq!(client.ping(), CONTRACT_VERSION);
    }

    #[test]
    fn test_initialize_and_create_template() {
        let (env, _admin, client) = setup();
        let creator = Address::generate(&env);

        let mut fields: Vec<TemplateField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));
        fields.push_back(make_field(&env, "email", false));

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let metadata = make_metadata(&env);

        let template_id = client.create_template(
            &creator,
            &String::from_str(&env, "KYC Template"),
            &String::from_str(&env, "Standard KYC verification template"),
            &schema_id,
            &fields,
            &metadata,
        );

        assert_eq!(client.get_template_count(), 1);

        let template = client.get_template(&template_id);
        assert_eq!(template.creator, creator);
        assert_eq!(template.schema_id, schema_id);
        assert!(template.active);
    }

    #[test]
    fn test_update_template() {
        let (env, _admin, client) = setup();
        let creator = Address::generate(&env);

        let mut fields: Vec<TemplateField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let metadata = make_metadata(&env);

        let template_id = client.create_template(
            &creator,
            &String::from_str(&env, "Original Name"),
            &String::from_str(&env, "Original description"),
            &schema_id,
            &fields,
            &metadata,
        );

        client.update_template(
            &creator,
            &template_id,
            &Some(String::from_str(&env, "Updated Name")),
            &Some(String::from_str(&env, "Updated description")),
            &None,
            &None,
        );

        let template = client.get_template(&template_id);
        assert_eq!(template.name, String::from_str(&env, "Updated Name"));
        assert_eq!(template.description, String::from_str(&env, "Updated description"));
    }

    #[test]
    fn test_deactivate_and_reactivate_template() {
        let (env, _admin, client) = setup();
        let creator = Address::generate(&env);

        let mut fields: Vec<TemplateField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let metadata = make_metadata(&env);

        let template_id = client.create_template(
            &creator,
            &String::from_str(&env, "Test Template"),
            &String::from_str(&env, "Description"),
            &schema_id,
            &fields,
            &metadata,
        );

        client.deactivate_template(&creator, &template_id);
        let template = client.get_template(&template_id);
        assert!(!template.active);

        client.reactivate_template(&creator, &template_id);
        let template = client.get_template(&template_id);
        assert!(template.active);
    }

    #[test]
    fn test_get_creator_templates() {
        let (env, _admin, client) = setup();
        let creator = Address::generate(&env);

        let mut fields: Vec<TemplateField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let metadata = make_metadata(&env);

        client.create_template(
            &creator,
            &String::from_str(&env, "Template 1"),
            &String::from_str(&env, "Description 1"),
            &schema_id,
            &fields,
            &metadata,
        );

        client.create_template(
            &creator,
            &String::from_str(&env, "Template 2"),
            &String::from_str(&env, "Description 2"),
            &schema_id,
            &fields,
            &metadata,
        );

        let templates = client.get_creator_templates(&creator);
        assert_eq!(templates.len(), 2);
    }

    #[test]
    fn test_list_creator_templates_pagination() {
        let (env, _admin, client) = setup();
        let creator = Address::generate(&env);

        let mut fields: Vec<TemplateField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let metadata = make_metadata(&env);

        for i in 0..5 {
            client.create_template(
                &creator,
                &String::from_str(&env, &format!("Template {}", i)),
                &String::from_str(&env, "Description"),
                &schema_id,
                &fields,
                &metadata,
            );
        }

        let page1 = client.list_creator_templates(&creator, &None, &2);
        assert_eq!(page1.items.len(), 2);
        assert!(page1.next_cursor.is_some());

        let page2 = client.list_creator_templates(&creator, &page1.next_cursor, &2);
        assert_eq!(page2.items.len(), 2);
    }

    #[test]
    fn test_unauthorized_update_fails() {
        let (env, _admin, client) = setup();
        let creator = Address::generate(&env);
        let other = Address::generate(&env);

        let mut fields: Vec<TemplateField> = Vec::new(&env);
        fields.push_back(make_field(&env, "name", true));

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let metadata = make_metadata(&env);

        let template_id = client.create_template(
            &creator,
            &String::from_str(&env, "Template"),
            &String::from_str(&env, "Description"),
            &schema_id,
            &fields,
            &metadata,
        );

        let result = client.try_update_template(
            &other,
            &template_id,
            &Some(String::from_str(&env, "Hacked")),
            &None,
            &None,
            &None,
        );
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
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
    fn test_pause_and_unpause() {
        let (env, admin, client) = setup();
        
        assert!(!client.is_paused());
        
        client.pause();
        assert!(client.is_paused());
        
        client.unpause();
        assert!(!client.is_paused());
    }
}
