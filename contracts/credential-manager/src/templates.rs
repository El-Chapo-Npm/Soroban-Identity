//! On-chain credential templates: reusable, versioned schemas that credentials
//! can be issued against for standardization.

use soroban_sdk::{
    contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, Map, String, Symbol,
    Vec,
};

use crate::{ContractError, CredentialManager, CredentialManagerClient, CredentialType};

const TMPL: Symbol = symbol_short!("TMPL");
const TMPLV: Symbol = symbol_short!("TMPLV");
const TCAT: Symbol = symbol_short!("TCAT");
const TSEQ: Symbol = symbol_short!("TSEQ");
const CTMPL: Symbol = symbol_short!("CTMPL");

/// A reusable credential template.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTemplate {
    pub id: u32,
    pub version: u32,
    pub name: String,
    pub category: Symbol,
    pub credential_type: CredentialType,
    /// Claim keys a credential must contain to conform to this template.
    pub required_claims: Vec<String>,
    pub creator: Address,
    pub created_at: u64,
}

/// Link from a credential to the template (and version) it was issued from.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateRef {
    pub template_id: u32,
    pub version: u32,
}

#[contractimpl]
impl CredentialManager {
    /// Register a new template (registered issuers only). Returns the template ID.
    pub fn register_template(
        env: Env,
        creator: Address,
        name: String,
        category: Symbol,
        credential_type: CredentialType,
        required_claims: Vec<String>,
    ) -> u32 {
        creator.require_auth();
        Self::require_issuer(&env, &creator);

        let id: u32 = env.storage().instance().get(&TSEQ).unwrap_or(0) + 1;
        env.storage().instance().set(&TSEQ, &id);

        let template = CredentialTemplate {
            id,
            version: 1,
            name,
            category: category.clone(),
            credential_type,
            required_claims,
            creator,
            created_at: env.ledger().timestamp(),
        };
        Self::store_template(&env, &template);

        let cat_key = (TCAT, category);
        let mut ids: Vec<u32> = env.storage().persistent().get(&cat_key).unwrap_or_else(|| Vec::new(&env));
        ids.push_back(id);
        env.storage().persistent().set(&cat_key, &ids);

        env.events().publish((TMPL, symbol_short!("reg")), id);
        id
    }

    /// Publish a new version of a template's required claims (creator only).
    /// Previous versions remain queryable. Returns the new version number.
    pub fn update_template(env: Env, template_id: u32, required_claims: Vec<String>) -> u32 {
        let mut template = Self::get_template(env.clone(), template_id);
        template.creator.require_auth();

        template.version += 1;
        template.required_claims = required_claims;
        template.created_at = env.ledger().timestamp();
        Self::store_template(&env, &template);

        env.events().publish((TMPL, symbol_short!("ver")), (template_id, template.version));
        template.version
    }

    /// Get the latest version of a template.
    pub fn get_template(env: Env, template_id: u32) -> CredentialTemplate {
        env.storage()
            .persistent()
            .get(&(TMPL, template_id))
            .expect("template not found")
    }

    /// Get a specific version of a template.
    pub fn get_template_version(env: Env, template_id: u32, version: u32) -> CredentialTemplate {
        env.storage()
            .persistent()
            .get(&(TMPLV, template_id, version))
            .expect("template version not found")
    }

    /// List the latest version of every template in a category.
    pub fn get_templates_by_category(env: Env, category: Symbol) -> Vec<CredentialTemplate> {
        let ids: Vec<u32> = env
            .storage()
            .persistent()
            .get(&(TCAT, category))
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            out.push_back(Self::get_template(env.clone(), id));
        }
        out
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
        for key in template.required_claims.iter() {
            if !claims.contains_key(key) {
                panic!("missing required claim");
            }
        }

        let id = Self::issue_credential(
            env.clone(),
            issuer,
            subject,
            template.credential_type,
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
        env.storage().persistent().set(&(TMPL, template.id), template);
        env.storage()
            .persistent()
            .set(&(TMPLV, template.id, template.version), template);
    }
}

#[cfg(test)]
mod tests {
    use crate::{CredentialManager, CredentialManagerClient, CredentialType};
    use soroban_sdk::{
        contract, contractimpl, symbol_short, testutils::Address as _, vec, Address, Bytes, BytesN,
        Env, Map, String,
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
    fn test_register_query_and_version() {
        let (env, issuer, client) = setup();
        let claims = vec![&env, String::from_str(&env, "name")];
        let id = client.register_template(
            &issuer, &String::from_str(&env, "Basic KYC"), &symbol_short!("kyc"), &CredentialType::Kyc, &claims,
        );

        assert_eq!(client.get_template(&id).version, 1);
        assert_eq!(client.get_templates_by_category(&symbol_short!("kyc")).len(), 1);
        assert_eq!(client.get_templates_by_category(&symbol_short!("edu")).len(), 0);

        let v2 = client.update_template(&id, &vec![&env, String::from_str(&env, "dob")]);
        assert_eq!(v2, 2);
        assert_eq!(client.get_template_version(&id, &1).required_claims, claims);
    }

    #[test]
    fn test_issue_from_template_links_credential() {
        let (env, issuer, client) = setup();
        let key = String::from_str(&env, "name");
        let id = client.register_template(
            &issuer, &String::from_str(&env, "KYC"), &symbol_short!("kyc"), &CredentialType::Kyc, &vec![&env, key.clone()],
        );
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
    #[should_panic(expected = "missing required claim")]
    fn test_issue_from_template_missing_claim() {
        let (env, issuer, client) = setup();
        let id = client.register_template(
            &issuer, &String::from_str(&env, "KYC"), &symbol_short!("kyc"), &CredentialType::Kyc,
            &vec![&env, String::from_str(&env, "name")],
        );
        client.issue_from_template(
            &issuer, &Address::generate(&env), &id, &Map::new(&env),
            &BytesN::from_array(&env, &[1u8; 32]), &Bytes::new(&env), &0,
        );
    }
}
