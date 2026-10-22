//! Shared error types for Soroban Identity contracts.
//!
//! These errors are used across the identity-registry and credential-manager
//! contracts so that callers can rely on a stable, typed error surface even
//! when untrusted (e.g. fuzzed) input is supplied.

use soroban_sdk::contracterror;

/// Errors returned by the identity-registry contract.
///
/// The variants are intentionally explicit so that malformed or adversarial
/// input never results in a panic: callers receive a typed error instead.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum IdentityRegistryError {
    /// The supplied DID string is empty or otherwise malformed.
    InvalidDid = 1,
    /// The supplied DID already exists in the registry.
    DidAlreadyExists = 2,
    /// The requested DID was not found in the registry.
    DidNotFound = 3,
    /// The caller is not authorized to perform the operation.
    Unauthorized = 4,
    /// A numeric conversion or arithmetic operation overflowed.
    Overflow = 5,
    /// The contract has not been initialized.
    NotInitialized = 6,
    /// The contract has already been initialized.
    AlreadyInitialized = 7,
    /// The supplied input failed validation.
    InvalidInput = 8,
    /// The requested escrow was not found.
    EscrowNotFound = 9,
    /// The escrow has already been funded.
    EscrowAlreadyFunded = 10,
    /// The escrow is not in a state that permits the operation.
    InvalidEscrowStatus = 11,
    /// The escrow release conditions have not been satisfied.
    ConditionsNotMet = 12,
    /// The escrow release conditions have expired.
    ConditionsExpired = 13,
    /// The escrow is currently under dispute.
    EscrowDisputed = 14,
    /// The escrow dispute has already been resolved.
    DisputeAlreadyResolved = 15,
    /// The escrow amount is invalid (e.g. zero or negative).
    InvalidEscrowAmount = 16,
    /// The DID method is not supported by the resolver.
    UnsupportedDidMethod = 17,
    /// The supplied DID is malformed for its method.
    MalformedDid = 18,
    /// The DID method has already been registered.
    DidMethodAlreadyRegistered = 19,
    /// There is no pending signer rotation to act on.
    NoPendingSignerRotation = 20,
    /// The caller is not authorized to perform the signer rotation.
    SignerRotationNotAuthorized = 21,
    /// The signer rotation timelock has not yet elapsed.
    SignerRotationTimelockActive = 22,
    /// The guardian approvals are insufficient for the operation.
    InsufficientGuardianApprovals = 23,
    /// The DID method in the supplied DID is not supported.
    UnknownDidMethod = 24,
    /// The resolved DID document failed validation.
    InvalidDidDocument = 25,
    /// The requested resolver plugin was not found.
    ResolverPluginNotFound = 26,
    /// The resolver fallback chain was exhausted without a result.
    FallbackChainExhausted = 27,
    /// The requested DID was not present in the resolver cache.
    CacheMiss = 28,
}

/// Errors returned by the credential-manager contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CredentialManagerError {
    /// The supplied credential is malformed.
    InvalidCredential = 1,
    /// The credential already exists.
    CredentialAlreadyExists = 2,
    /// The requested credential was not found.
    CredentialNotFound = 3,
    /// The caller is not authorized to perform the operation.
    Unauthorized = 4,
    /// A numeric conversion or arithmetic operation overflowed.
    Overflow = 5,
    /// The contract has not been initialized.
    NotInitialized = 6,
    /// The contract has already been initialized.
    AlreadyInitialized = 7,
    /// The supplied input failed validation.
    InvalidInput = 8,
    /// The oracle is not registered.
    OracleNotRegistered = 9,
    /// The caller is not authorized to act for the oracle.
    OracleUnauthorized = 10,
    /// The oracle response is older than the allowed staleness window.
    StaleOracleResponse = 11,
    /// The oracle fee has not been configured.
    OracleFeeNotConfigured = 12,
    /// The requested oracle request was not found.
    OracleRequestNotFound = 13,
    /// The oracle request has expired.
    OracleRequestExpired = 14,
    /// The supplied credential template is invalid.
    InvalidTemplate = 15,
    /// The requested template was not found.
    TemplateNotFound = 16,
    /// The template inheritance graph contains a cycle.
    TemplateCycle = 17,
    /// The template usage fee has not been paid.
    TemplateFeeUnpaid = 18,
    /// The threshold signature requirement was not met.
    ThresholdNotMet = 19,
    /// The signature scheme is not supported.
    InvalidSignatureScheme = 20,
    /// The signature has expired.
    SignatureExpired = 21,
    /// The signer is not authorized for the operation.
    SignerNotAuthorized = 22,
    /// The configured signer set is invalid.
    InvalidSignerSet = 23,
    /// The supplied bitmap index is out of range.
    InvalidBitmapIndex = 24,
    /// The supplied batch exceeds the maximum allowed size.
    BatchTooLarge = 25,
    /// The supplied revocation proof is invalid.
    RevocationProofInvalid = 26,
    /// The supplied merkle proof is invalid.
    MerkleProofInvalid = 27,
    /// The supplied stake is insufficient for the operation.
    InsufficientStake = 28,
    /// The unstake cooldown period is still active.
    UnstakeCooldownActive = 29,
    /// The slash amount exceeds the maximum allowed.
    SlashExceedsMax = 30,
    /// The requested delegation was not found.
    DelegationNotFound = 31,
    /// The staking reward pool is empty.
    RewardPoolEmpty = 32,
    /// The supplied presentation is malformed.
    InvalidPresentation = 33,
    /// The presentation challenge does not match.
    ChallengeMismatch = 34,
    /// The presentation has expired.
    PresentationExpired = 35,
    /// The presentation proof format is not supported.
    UnsupportedProofFormat = 36,
}
