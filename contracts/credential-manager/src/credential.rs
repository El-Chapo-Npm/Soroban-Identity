use soroban_sdk::{symbol_short, Address, Bytes, BytesN, Env, Map, String, Vec};
use crate::types::{Credential, CredentialType};
use crate::keys::{CRED, IDSEQ, cred_key, subject_key};
use crate::issuer::require_issuer;
use crate::threshold::{self, SignedPayload};
use crate::errors::ContractError;

pub fn issue_credential(
    env: &Env,
    issuer: Address,
    subject: Address,
    credential_type: CredentialType,
    claims: Map<String, String>,
    signature: Bytes,
    expires_at: u64,
) -> BytesN<32> {
    issue_credential_signed(
        env,
        issuer,
        subject,
        credential_type,
        claims,
        signature,
        expires_at,
        None,
    )
    .expect("threshold not met")
}

pub fn issue_credential_signed(
    env: &Env,
    issuer: Address,
    subject: Address,
    credential_type: CredentialType,
    claims: Map<String, String>,
    signature: Bytes,
    expires_at: u64,
    signed_payload: Option<SignedPayload>,
) -> Result<BytesN<32>, ContractError> {
    issuer.require_auth();
    require_issuer(env, &issuer);

    // If the issuer has a configured signer set, enforce threshold validation.
    if threshold::has_signer_set(env, &issuer) {
        let payload = signed_payload.ok_or(ContractError::ThresholdNotMet)?;
        threshold::validate_threshold(env, &issuer, &payload)?;
    }

    let now = env.ledger().timestamp();
    let id = generate_id(env, now);

    let credential = Credential {
        id: id.clone(),
        subject: subject.clone(),
        issuer: issuer.clone(),
        credential_type,
        claims,
        signature,
        issued_at: now,
        version: 1,
        last_modified_at: now,
        expires_at,
        revoked: false,
    };

    env.storage().persistent().set(&cred_key(&id), &credential);

    let mut subject_creds = fetch_subject_creds(env, &subject);
    subject_creds.push_back(id.clone());
    env.storage().persistent().set(&subject_key(&subject), &subject_creds);

    env.events().publish((CRED, symbol_short!("issued")), (issuer, subject));

    Ok(id)
}

pub fn revoke_credential(
    env: &Env,
    issuer: Address,
    credential_id: BytesN<32>,
    signed_payload: Option<SignedPayload>,
) -> Result<(), ContractError> {
    issuer.require_auth();
    require_issuer(env, &issuer);

    if threshold::has_signer_set(env, &issuer) {
        let payload = signed_payload.ok_or(ContractError::ThresholdNotMet)?;
        threshold::validate_threshold(env, &issuer, &payload)?;
    }

    let mut credential = get_credential(env, credential_id.clone());
    if credential.issuer != issuer {
        return Err(ContractError::Unauthorized);
    }

    credential.revoked = true;
    credential.last_modified_at = env.ledger().timestamp();
    credential.version = credential.version.wrapping_add(1);
    env.storage().persistent().set(&cred_key(&credential_id), &credential);

    env.events().publish((CRED, symbol_short!("revoked")), (issuer, credential_id));

    Ok(())
}

pub fn update_credential(
    env: &Env,
    issuer: Address,
    credential_id: BytesN<32>,
    claims: Map<String, String>,
    signed_payload: Option<SignedPayload>,
) -> Result<(), ContractError> {
    issuer.require_auth();
    require_issuer(env, &issuer);

    if threshold::has_signer_set(env, &issuer) {
        let payload = signed_payload.ok_or(ContractError::ThresholdNotMet)?;
        threshold::validate_threshold(env, &issuer, &payload)?;
    }

    let mut credential = get_credential(env, credential_id.clone());
    if credential.issuer != issuer {
        return Err(ContractError::Unauthorized);
    }

    credential.claims = claims;
    credential.last_modified_at = env.ledger().timestamp();
    credential.version = credential.version.wrapping_add(1);
    env.storage().persistent().set(&cred_key(&credential_id), &credential);

    env.events().publish((CRED, symbol_short!("updated")), (issuer, credential_id));

    Ok(())
}

pub fn get_credential(env: &Env, credential_id: BytesN<32>) -> Credential {
    env.storage()
        .persistent()
        .get(&cred_key(&credential_id))
        .expect("credential not found")
}

pub fn get_subject_credentials(env: &Env, subject: Address) -> Vec<BytesN<32>> {
    fetch_subject_creds(env, &subject)
}

pub fn fetch_subject_creds(env: &Env, subject: &Address) -> Vec<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&subject_key(subject))
        .unwrap_or_else(|| Vec::new(env))
}

fn generate_id(env: &Env, timestamp: u64) -> BytesN<32> {
    let seq: u64 = env.storage().instance().get(&IDSEQ).unwrap_or(0);
    // Use wrapping arithmetic so a fuzzer-driven sequence counter at u64::MAX
    // cannot panic on overflow; the id remains unique per (timestamp, seq).
    let next_seq = seq.wrapping_add(1);
    env.storage().instance().set(&IDSEQ, &next_seq);

    let mut data = Bytes::new(env);
    data.extend_from_array(&timestamp.to_be_bytes());
    data.extend_from_array(&seq.to_be_bytes());
    env.crypto().sha256(&data).into()
}