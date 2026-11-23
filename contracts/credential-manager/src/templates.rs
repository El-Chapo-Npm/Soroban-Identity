//! On-chain credential templates: reusable, versioned schemas that credentials
//! can be issued against for standardization.

use soroban_sdk::{
    contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env, Map, String,
    Symbol, Vec,
};

use crate::{ContractError, CredentialManager, CredentialManagerClient, CredentialType};

const TMPL: Symbol = symbol_short!("TMPL");
const TMPLV: Symbol = symbol_short!("TMPLV");
const TMPLL: Symbol = symbol_short!("TMPLL");
const TCAT: Symbol = symbol_short!("TCAT");
const TSEQ: Symbol = symbol_short!("TSEQ");
const CTMPL: Symbol = symbol_short!("CTMPL");
const TSALE: Symbol = symbol_short!("TSALE");
const TPAID: Symbol = symbol_short!("TPAID");

/// Maximum depth of a template inheritance chain.
const MAX_INHERITANCE_DEPTH: u32 = 8;

/// A reusable credential template.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTemplate {
    pub id: u32,
    pub version: u32,
    /// Parent template this one inherits from, if any.
    pub parent_id: Option<u32>,
    /// Claim keys a credential must contain to conform to this template.
    pub schema: Vec<String>,
    /// Validation rules applied to claims (e.g. `name:required`).
    pub validation_rules: Vec<String>,
    pub owner: Address,
    /// Fee (in token base units) charged per use; 0 means free.
    pub usage_fee: i128,
    pub published: bool,
    pub created_at: u64,
}

/// Link from a credential to the template (and version) it was issued from.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateRef {
    pub template_id: u32,
    pub version: u32,
}

/// Marketplace listing for a template.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateListing {
    pub template_id: u32,
    pub price: i128,
    pub seller: Address,
}

#[contractimpl]
impl CredentialManager {
    /// Register a new template (registered issuers only). Returns the template ID.
    #[allow(clippy::too_many_arguments)]
    pub fn register_template(
        env: Env,
        owner: Address,
        parent_id: Option<u32>,
        schema: Vec<String>,
        validation_rules: Vec<String>,
        usage_fee: i128,
    ) -> Result<u32, ContractError> {
        owner.require_auth();
        Self::require_issuer(&env, &owner);

        if usage_fee < 0 {
            return Err(ContractError::InvalidTemplateRules);
        }
        Self::validate_rules(&env, &validation_rules)?;

        if let Some(parent) = parent_id {
            if !env.storage().persistent().has(&(TMPL, parent)) {
                return Err(ContractError::TemplateParentNotFound);
            }
        }

        let id: u32 = env.storage().instance().get(&TSEQ).unwrap_or(0) + 1;
        env.storage().instance().set(&TSEQ, &id);

        let template = CredentialTemplate {
            id,
            version: 1,
            parent_id,
            schema,
            validation_rules,
            owner,
            usage_fee,
            published: false,
            created_at: env.ledger().timestamp(),
        };
        Self::store_template(&env, &template);

        env.events().publish((TMPL, symbol_short!("reg")), id);
        Ok(id)
    }

    /// Publish a new version of a template (owner only). Previous versions
    /// remain queryable. Returns the new version number.
    #[allow(clippy::too_many_arguments)]
    pub fn publish_template_version(
        env: Env,
        template_id: u32,
        schema: Vec<String>,
        validation_rules: Vec<String>,
        usage_fee: i128,
    ) -> Result<u32, ContractError> {
        let mut template = Self::get_template(env.clone(), template_id);
        template.owner.require_auth();

        if usage_fee < 0 {
            return Err(ContractError::InvalidTemplateRules);
        }
        Self::validate_rules(&env, &validation_rules)?;

        template.version += 1;
        template.schema = schema;
        template.validation_rules = validation_rules;
        template.usage_fee = usage_fee;
        template.published = true;
        template.created_at = env.ledger().timestamp();
        Self::store_template(&env, &template);

        env.events()
            .publish((TMPL, symbol_short!("ver")), (template_id, template.version));
        Ok(template.version)
    }

    /// Get the latest version of a template.
    pub fn get_template(env: Env, template_id: u32) -> CredentialTemplate {
        let version: u32 = env
            .storage()
            .persistent()
            .get(&(TMPLL, template_id))
            .expect("template not found");
        env.storage()
            .persistent()
            .get(&(TMPLV, template_id, version))
            .expect("template version not found")
    }

    /// Get a specific version of a template.
    pub fn get_template_version(env: Env, template_id: u32, version: u32) -> CredentialTemplate {
        env.storage()
            .persistent()
            .get(&(TMPLV, template_id, version))
            .expect("template version not found")
    }

    /// Validate a claim set against the latest version of a template,
    /// resolving the inheritance chain. Returns Ok(()) when conformant.
    pub fn validate_against_template(
        env: Env,
        template_id: u32,
        claims: Map<String, String>,
    ) -> Result<(), ContractError> {
        let template = Self::get_template(env.clone(), template_id);
        Self::validate_chain(&env, &template, &claims, 0)
    }

    /// List a template for sale on the marketplace (owner only).
    pub fn list_template_for_sale(
        env: Env,
        template_id: u32,
        price: i128,
    ) -> Result<(), ContractError> {
        let template = Self::get_template(env.clone(), template_id);
        template.owner.require_auth();
        if price < 0 {
            return Err(ContractError::InvalidTemplateRules);
        }
        let listing = TemplateListing {
            template_id,
            price,
            seller: template.owner,
        };
        env.storage().persistent().set(&(TSALE, template_id), &listing);
        env.events()
            .publish((TMPL, symbol_short!("list")), (template_id, price));
        Ok(())
    }

    /// Buy a template listing, transferring the price to the seller.
    pub fn buy_template(
        env: Env,
        buyer: Address,
        template_id: u32,
        token: Address,
    ) -> Result<(), ContractError> {
        buyer.require_auth();
        let listing: TemplateListing = env
            .storage()
            .persistent()
            .get(&(TSALE, template_id))
            .ok_or(ContractError::TemplateNotListed)?;

        token::Client::new(&env, &token).transfer(
            &buyer,
            &listing.seller,
            &listing.price,
        );
        env.storage()
            .persistent()
            .set(&(TPAID, template_id, buyer.clone()), &true);
        env.events()
            .publish((TMPL, symbol_short!("buy")), (template_id, buyer));
        Ok(())
    }

    /// Charge the usage fee for a template (if any) to the payer.
    pub fn use_template(
        env: Env,
        payer: Address,
        template_id: u32,
        token: Address,
    ) -> Result<(), ContractError> {
        payer.require_auth();
        let template = Self::get_template(env.clone(), template_id);
        if template.usage_fee > 0 {
            token::Client::new(&env, &token).transfer(
                &payer,
                &template.owner,
                &template.usage_fee,
            );
        }
        env.events()
            .publish((TMPL, symbol_short!("use")), (template_id, payer));
        Ok(())
    }

    /// Issue a credential conforming to the latest version of a template.
    /// Panics if any required claim is missing.
    #[allow(clippy::too_many_arguments)]
    pub fn issue_from_template(
        env: Env,
        issuer: Address,
        subject: Address,
        template_id: u32,
        claims: Map<String, String>,
        claims_hash: BytesN<32>,
        signature: Bytes,
        expires_at: u64,
    ) -> Result<BytesN<32>, ContractError> {
        let template = Self::get_template(env.clone(), template_id);
        Self::validate_chain(&env, &template, &claims, 0)?;

        let id = Self::issue_credential(
            env.clone(),
            issuer,
            subject,
            CredentialType::Custom(symbol_short!("tmpl")),
            claims,
            claims_hash,
            signature,
            expires_at,
            0,
            None,
            None,
        )?;
        let link = TemplateRef { template_id, version: template.version };
        env.storage().persistent().set(&(CTMPL, id.clone()), &link);
        Ok(id)
    }

    /// Get the template a credential was issued from, if any.
    pub fn get_credential_template(env: Env, credential_id: BytesN<32>) -> Option<TemplateRef> {
        env.storage().persistent().get(&(CTMPL, credential_id))
    }
}

impl CredentialManager {
    fn store_template(env: &Env, template: &CredentialTemplate) {
        env.storage()
            .persistent()
            .set(&(TMPLV, template.id, template.version), template);
        env.storage()
            .persistent()
            .set(&(TMPLL, template.id), &template.version);
    }

    fn validate_rules(env: &Env, rules: &Vec<String>) -> Result<(), ContractError> {
        for rule in rules.iter() {
            let s = rule.to_string();
            if s.is_empty() || !s.contains(':') {
                return Err(ContractError::InvalidTemplateRules);
            }
        }
        let _ = env;
        Ok(())
    }

    fn validate_chain(
        env: &Env,
        template: &CredentialTemplate,
        claims: &Map<String, String>,
        depth: u32,
    ) -> Result<(), ContractError> {
        if depth > MAX_INHERITANCE_DEPTH {
            return Err(ContractError::TemplateInheritanceCycle);
        }
        for key in template.schema.iter() {
            if !claims.contains_key(key) {
                return Err(ContractError::TemplateValidationFailed);
            }
        }
        for rule in template.validation_rules.iter() {
            let s = rule.to_string();
            let (key, kind) = s.split_once(':').ok_or(ContractError::InvalidTemplateRules)?;
            if kind == "required" && !claims.contains_key(&String::from_str(env, key)) {
                return Err(ContractError::TemplateValidationFailed);
            }
        }
        if let Some(parent_id) = template.parent_id {
            let parent: CredentialTemplate = env
                .storage()
                .persistent()
                .get(&(TMPL, parent_id))
                .ok_or(ContractError::TemplateParentNotFound)?;
            if parent.id == template.id {
                return Err(ContractError::TemplateInheritanceCycle);
            }
            Self::validate_chain(env, &parent, claims, depth + 1)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{ContractError, CredentialManager, CredentialManagerClient};
    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, token, vec, Address, Bytes, BytesN, Env,
        Map, String,
    };

    #[contract]
    struct MockIdentityRegistry;
    #[contractimpl]
    impl MockIdentityRegistry {
        pub fn has_active_did(_env: Env, _controller: Address) -> bool {
            true
        }
    }

    fn setup() -> (Env, Address, CredentialManagerClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let registry_id = env.register_contract(None, MockIdentityRegistry);
        let client = CredentialManagerClient::new(&env, &env.register_contract(None, CredentialManager));
        client.initialize(&Address::generate(&env), &registry_id);
        let issuer = Address::generate(&env);
        client.add_issuer(&issuer);
        (env, issuer, client)
    }

    #[test]
    fn test_register_and_version() {
        let (env, issuer, client) = setup();
        let schema = vec![&env, String::from_str(&env, "name")];
        let rules = vec![&env, String::from_str(&env, "name:required")];
        let id = client
            .register_template(&issuer, &None, &schema, &rules, &0)
            .unwrap();

        assert_eq!(client.get_template(&id).version, 1);
        assert!(!client.get_template(&id).published);

        let v2 = client
            .publish_template_version(&id, &schema, &rules, &0)
            .unwrap();
        assert_eq!(v2, 2);
        assert_eq!(client.get_template(&id).version, 2);
        assert_eq!(client.get_template_version(&id, &1).schema, schema);
    }

    #[test]
    fn test_invalid_rules_rejected() {
        let (env, issuer, client) = setup();
        let res = client.register_template(
            &issuer,
            &None,
            &vec![&env],
            &vec![&env, String::from_str(&env, "badrule")],
            &0,
        );
        assert_eq!(res, Err(Ok(ContractError::InvalidTemplateRules)));
    }

    #[test]
    fn test_inheritance_validation() {
        let (env, issuer, client) = setup();
        let parent = client
            .register_template(
                &issuer,
                &None,
                &vec![&env, String::from_str(&env, "name")],
                &vec![&env],
                &0,
            )
            .unwrap();
        let child = client
            .register_template(
                &issuer,
                &Some(parent),
                &vec![&env, String::from_str(&env, "dob")],
                &vec![&env],
                &0,
            )
            .unwrap();

        let mut claims = Map::new(&env);
        claims.set(String::from_str(&env, "name"), String::from_str(&env, "Alice"));
        claims.set(String::from_str(&env, "dob"), String::from_str(&env, "2000"));
        assert!(client.validate_against_template(&child, &claims).is_ok());

        let mut missing = Map::new(&env);
        missing.set(String::from_str(&env, "dob"), String::from_str(&env, "2000"));
        assert_eq!(
            client.validate_against_template(&child, &missing),
            Err(Ok(ContractError::TemplateValidationFailed))
        );
    }

    #[test]
    fn test_missing_parent_rejected() {
        let (env, issuer, client) = setup();
        let res = client.register_template(&issuer, &Some(999), &vec![&env], &vec![&env], &0);
        assert_eq!(res, Err(Ok(ContractError::TemplateParentNotFound)));
    }

    #[test]
    fn test_marketplace_and_fees() {
        let (env, issuer, client) = setup();
        let id = client
            .register_template(
                &issuer,
                &None,
                &vec![&env, String::from_str(&env, "name")],
                &vec![&env],
                &100,
            )
            .unwrap();
        client.list_template_for_sale(&id, &500).unwrap();

        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin);
        let buyer = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token).mint(&buyer, &1000);
        client.buy_template(&buyer, &id, &token).unwrap();
        assert_eq!(token::Client::new(&env, &token).balance(&buyer), 500);

        let payer = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token).mint(&payer, &1000);
        client.use_template(&payer, &id, &token).unwrap();
        assert_eq!(token::Client::new(&env, &token).balance(&payer), 900);
    }

    #[test]
    fn test_issue_from_template_links_credential() {
        let (env, issuer, client) = setup();
        let key = String::from_str(&env, "name");
        let id = client
            .register_template(
                &issuer,
                &None,
                &vec![&env, key.clone()],
                &vec![&env],
                &0,
            )
            .unwrap();
        let mut claims = Map::new(&env);
        claims.set(key, String::from_str(&env, "Alice"));

        let cred = client.issue_from_template(
            &issuer, &Address::generate(&env), &id, &claims, &BytesN::from_array(&env, &[1u8; 32]),
            &Bytes::new(&env), &0,
        );
        let link = client.get_credential_template(&cred).unwrap();
        assert_eq!((link.template_id, link.version), (id, 1));
        client.verify_credential(&cred);
    }

    #[test]
    fn test_issue_from_template_missing_claim() {
        let (env, issuer, client) = setup();
        let id = client
            .register_template(
                &issuer,
                &None,
                &vec![&env, String::from_str(&env, "name")],
                &vec![&env],
                &0,
            )
            .unwrap();
        let res = client.issue_from_template(
            &issuer, &Address::generate(&env), &id, &Map::new(&env),
            &BytesN::from_array(&env, &[1u8; 32]), &Bytes::new(&env), &0,
        );
        assert_eq!(res, Err(Ok(ContractError::TemplateValidationFailed)));
    }
}
