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
#[derive(Clone, PartialEq, Debug)]
pub struct RenewalPolicy {
    pub enabled: bool,
    pub renewal_period: u64,
    pub renewal_count: u32,
}

impl RenewalPolicy {
    pub const PERIOD_30_DAYS: u64 = 30 * 24 * 60 * 60;
    pub const PERIOD_60_DAYS: u64 = 60 * 24 * 60 * 60;
    pub const PERIOD_90_DAYS: u64 = 90 * 24 * 60 * 60;

    pub fn is_supported_period(period: u64) -> bool {
        period == Self::PERIOD_30_DAYS
            || period == Self::PERIOD_60_DAYS
            || period == Self::PERIOD_90_DAYS
    }

    pub fn should_renew_at(&self, expires_at: u64, now: u64) -> bool {
        if !self.enabled || expires_at == 0 {
            return false;
        }
        let window_start = expires_at.saturating_sub(self.renewal_period);
        now >= window_start
    }
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
    pub version: u32,
    pub last_modified_at: u64,
    pub activation_time: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub activation_cancelled: bool,
    pub renewal_policy: Option<RenewalPolicy>,
}

pub const MAX_DEPENDENCY_DEPTH: u32 = 5;

impl Credential {
    pub fn is_active_at(&self, now: u64) -> bool {
        if self.revoked || self.activation_cancelled {
            return false;
        }
        if self.activation_time != 0 && now < self.activation_time {
            return false;
        }
        if self.expires_at != 0 && now >= self.expires_at {
            return false;
        }
        true
    }

    pub fn should_auto_renew_at(&self, now: u64) -> bool {
        match &self.renewal_policy {
            Some(policy) => policy.should_renew_at(self.expires_at, now),
            None => false,
        }
    }
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum RevocationReason {
    Unspecified = 0,
    Compromised = 1,
    Expired = 2,
    Superseded = 3,
    IssuerRevoked = 4,
    SubjectRequest = 5,
    Lost = 6,
    AdminRevoked = 7,
    PolicyViolation = 8,
    DependencyRevoked = 9,
    KeyCompromise = 10,
    IssuerCompromise = 11,
    AffiliationChanged = 12,
    CessationOfOperation = 13,
    PrivilegeWithdrawn = 14,
    Fraudulent = 15,
}

impl RevocationReason {
    pub const ALL: [RevocationReason; 9] = [
        RevocationReason::Compromised,
        RevocationReason::Expired,
        RevocationReason::Superseded,
        RevocationReason::IssuerRevoked,
        RevocationReason::SubjectRequest,
        RevocationReason::Lost,
        RevocationReason::AdminRevoked,
        RevocationReason::PolicyViolation,
        RevocationReason::DependencyRevoked,
    ];
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RevocationRecord {
    pub credential_id: BytesN<32>,
    pub issuer: Address,
    pub subject: Address,
    pub reason: RevocationReason,
    pub revoked_at: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum TransferStatus {
    Pending = 0,
    Accepted = 1,
    Rejected = 2,
    Cancelled = 3,
    Expired = 4,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTransferRequest {
    pub credential_id: BytesN<32>,
    pub from: Address,
    pub to: Address,
    pub initiated_at: u64,
    pub expires_at: u64,
    pub fee_paid: i128,
    pub status: TransferStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CredentialTransferRecord {
    pub credential_id: BytesN<32>,
    pub from: Address,
    pub to: Address,
    pub initiated_at: u64,
    pub completed_at: u64,
    pub fee_paid: i128,
    pub status: TransferStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TransferFeeConfig {
    pub enabled: bool,
    pub fee: i128,
    pub fee_recipient: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TransferPolicy {
    pub credential_type: CredentialType,
    pub transferable: bool,
    pub requires_issuer_consent: bool,
    pub requires_subject_consent: bool,
    pub max_transfers: u32,
}

impl TransferPolicy {
    pub fn default_for(credential_type: CredentialType) -> Self {
        let transferable = matches!(
            credential_type,
            CredentialType::Reputation | CredentialType::Achievement | CredentialType::Custom
        );
        TransferPolicy {
            credential_type,
            transferable,
            requires_issuer_consent: false,
            requires_subject_consent: true,
            max_transfers: 0,
        }
    }

    pub fn is_transferable(&self) -> bool {
        self.transferable
    }
}

pub const TRANSFER_REQUEST_TTL: u64 = 7 * 24 * 60 * 60;

pub mod transfer_keys {
    use soroban_sdk::{contracttype, BytesN};

    #[contracttype]
    #[derive(Clone, Debug, PartialEq)]
    pub enum TransferKey {
        Request(BytesN<32>),
        History(BytesN<32>),
        FeeConfig,
        Policy(u32),
    }
}
