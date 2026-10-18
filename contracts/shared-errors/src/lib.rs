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
}
