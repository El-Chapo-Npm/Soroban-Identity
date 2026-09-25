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

impl Credential {
    /// Returns `true` when the credential is currently active at `now`.
    ///
    /// A credential is active when it has not been revoked, its pending
    /// activation has not been cancelled, it has already reached its
    /// `activation_time` (or has no time-lock), and it has not yet expired.
    ///
    /// This is the single source of truth for the time-lock/expiry checks
    /// exercised by the `fuzz_issue_credential` target. It is written with
    /// saturating arithmetic and explicit ordering so that arbitrary fuzzer
    /// inputs (including `expires_at == 0`, `activation_time > expires_at`,
    /// and `u64::MAX` timestamps) can never panic or overflow. #781
    pub fn is_active_at(&self, now: u64) -> bool {
        if self.revoked || self.activation_cancelled {
            return false;
        }

        // `0` means "no time-lock": active immediately.
        if self.activation_time != 0 && now < self.activation_time {
            return false;
        }

        // `0` means "never expires".
        if self.expires_at != 0 && now >= self.expires_at {
            return false;
        }

        true
    }
}
