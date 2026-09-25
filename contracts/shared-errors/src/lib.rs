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
