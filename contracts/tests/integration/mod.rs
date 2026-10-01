use credential_manager::{CredentialManager, CredentialManagerClient, CredentialType};
use identity_registry::{IdentityRegistry, IdentityRegistryClient};
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, Map};

#[test]
fn did_and_credential_lifecycle_cross_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let identity_id = env.register_contract(None, IdentityRegistry);
    let credential_id = env.register_contract(None, CredentialManager);
    let identity = IdentityRegistryClient::new(&env, &identity_id);
    let credentials = CredentialManagerClient::new(&env, &credential_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    identity.initialize(&admin);
    credentials.initialize(&admin, &identity_id);
    identity.create_did(&subject, &Map::new(&env));
    credentials.add_issuer(&issuer);

    let issued = credentials.issue_credential(
        &issuer, &subject, &CredentialType::Kyc, &Map::new(&env),
        &BytesN::from_array(&env, &[1; 32]), &Bytes::from_array(&env, &[0; 64]),
        &0, &0, &None, &None,
    );
    credentials.verify_credential(&issued);
    assert!(identity.has_active_did(&subject));
}
