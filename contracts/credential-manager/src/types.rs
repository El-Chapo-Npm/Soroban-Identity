use soroban_sdk::{contracttype, Address, Bytes, BytesN, Map, String};

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum CredentialType {
    Kyc,
    Reputation,
    Achievement,
    Custom,
}

#[contracttype]
#[derive(Clone)]
pub struct Credential {
    pub id: BytesN<32>,
    pub subject: Address,
    pub issuer: Address,
    pub credential_type: CredentialType,
    pub claims: Map<String, String>,
    pub signature: Bytes,
    pub issued_at: u64,
    /// Unix timestamp after which the credential becomes active.
    /// `0` means the credential is active immediately (no time-lock). #731
    pub activation_time: u64,
    pub expires_at: u64,
    pub revoked: bool,
    /// When `true` the pending activation has been cancelled by the issuer.
    /// A cancelled credential can never be activated and is treated as
    /// equivalent to revoked for all verification purposes. #731
    pub activation_cancelled: bool,
}
