//! Credential dependency (prerequisite chain) support.
//!
//! Allows credentials to declare prerequisite credentials that must exist and
//! be valid before the dependent credential can be issued. Supports recursive
//! chain verification, circular dependency detection, and a maximum depth
//! limit of [`MAX_DEPENDENCY_DEPTH`] levels.

use std::collections::{HashMap, HashSet};

/// Maximum number of prerequisite levels allowed in a dependency chain.
pub const MAX_DEPENDENCY_DEPTH: usize = 5;

/// A credential identifier.
pub type CredentialId = u64;

/// Minimal view of a credential needed for dependency resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub id: CredentialId,
    /// Credentials that must be valid before this credential can be issued.
    pub prerequisite_credentials: Vec<CredentialId>,
    /// Whether the credential is currently valid (issued and not revoked).
    pub valid: bool,
}

/// Errors produced while validating credential dependencies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyError {
    /// A referenced prerequisite credential does not exist.
    MissingPrerequisite(CredentialId),
    /// A referenced prerequisite credential exists but is not valid.
    InvalidPrerequisite(CredentialId),
    /// A circular dependency was detected in the chain.
    CircularDependency(CredentialId),
    /// The dependency chain exceeds [`MAX_DEPENDENCY_DEPTH`].
    MaxDepthExceeded(CredentialId),
}

/// Events emitted during dependency validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyEvent {
    /// Dependency validation started for a credential.
    ValidationStarted(CredentialId),
    /// A prerequisite was verified as valid.
    PrerequisiteVerified { credential: CredentialId, prerequisite: CredentialId },
    /// Dependency validation succeeded for a credential.
    ValidationSucceeded(CredentialId),
    /// Dependency validation failed for a credential.
    ValidationFailed { credential: CredentialId, error: DependencyError },
}

/// Registry of credentials used to resolve dependency chains.
#[derive(Debug, Default, Clone)]
pub struct CredentialRegistry {
    credentials: HashMap<CredentialId, Credential>,
}

impl CredentialRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self { credentials: HashMap::new() }
    }

    /// Insert or replace a credential.
    pub fn insert(&mut self, credential: Credential) {
        self.credentials.insert(credential.id, credential);
    }

    /// Look up a credential by id.
    pub fn get(&self, id: CredentialId) -> Option<&Credential> {
        self.credentials.get(&id)
    }

    /// Validate that all prerequisites of `credential_id` exist and are valid,
    /// recursively walking the entire dependency chain.
    ///
    /// Returns the emitted events on success, or the first error encountered.
    pub fn validate_dependencies(
        &self,
        credential_id: CredentialId,
    ) -> Result<Vec<DependencyEvent>, DependencyError> {
        let mut events = Vec::new();
        let mut visiting = HashSet::new();
        let mut verified = HashSet::new();
        events.push(DependencyEvent::ValidationStarted(credential_id));

        match self.walk(credential_id, 0, &mut visiting, &mut verified, &mut events) {
            Ok(()) => {
                events.push(DependencyEvent::ValidationSucceeded(credential_id));
                Ok(events)
            }
            Err(err) => {
                events.push(DependencyEvent::ValidationFailed {
                    credential: credential_id,
                    error: err.clone(),
                });
                Err(err)
            }
        }
    }

    fn walk(
        &self,
        credential_id: CredentialId,
        depth: usize,
        visiting: &mut HashSet<CredentialId>,
        verified: &mut HashSet<CredentialId>,
        events: &mut Vec<DependencyEvent>,
    ) -> Result<(), DependencyError> {
        if depth > MAX_DEPENDENCY_DEPTH {
            return Err(DependencyError::MaxDepthExceeded(credential_id));
        }
        if verified.contains(&credential_id) {
            return Ok(());
        }
        if !visiting.insert(credential_id) {
            return Err(DependencyError::CircularDependency(credential_id));
        }

        let credential = self
            .credentials
            .get(&credential_id)
            .ok_or(DependencyError::MissingPrerequisite(credential_id))?;

        if !credential.valid {
            return Err(DependencyError::InvalidPrerequisite(credential_id));
        }

        for &prereq in &credential.prerequisite_credentials {
            let prereq_credential = self
                .credentials
                .get(&prereq)
                .ok_or(DependencyError::MissingPrerequisite(prereq))?;
            if !prereq_credential.valid {
                return Err(DependencyError::InvalidPrerequisite(prereq));
            }
            self.walk(prereq, depth + 1, visiting, verified, events)?;
            events.push(DependencyEvent::PrerequisiteVerified {
                credential: credential_id,
                prerequisite: prereq,
            });
        }

        visiting.remove(&credential_id);
        verified.insert(credential_id);
        Ok(())
    }

    /// Return the full dependency chain for `credential_id`, ordered from the
    /// credential itself down to its deepest prerequisites.
    pub fn get_credential_chain(
        &self,
        credential_id: CredentialId,
    ) -> Result<Vec<CredentialId>, DependencyError> {
        let mut chain = Vec::new();
        let mut visiting = HashSet::new();
        self.collect_chain(credential_id, 0, &mut visiting, &mut chain)?;
        Ok(chain)
    }

    fn collect_chain(
        &self,
        credential_id: CredentialId,
        depth: usize,
        visiting: &mut HashSet<CredentialId>,
        chain: &mut Vec<CredentialId>,
    ) -> Result<(), DependencyError> {
        if depth > MAX_DEPENDENCY_DEPTH {
            return Err(DependencyError::MaxDepthExceeded(credential_id));
        }
        if !visiting.insert(credential_id) {
            return Err(DependencyError::CircularDependency(credential_id));
        }
        let credential = self
            .credentials
            .get(&credential_id)
            .ok_or(DependencyError::MissingPrerequisite(credential_id))?;
        chain.push(credential_id);
        for &prereq in &credential.prerequisite_credentials {
            self.collect_chain(prereq, depth + 1, visiting, chain)?;
        }
        visiting.remove(&credential_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cred(id: CredentialId, prereqs: &[CredentialId], valid: bool) -> Credential {
        Credential {
            id,
            prerequisite_credentials: prereqs.to_vec(),
            valid,
        }
    }

    #[test]
    fn valid_chain_passes() {
        let mut registry = CredentialRegistry::new();
        registry.insert(cred(1, &[], true));
        registry.insert(cred(2, &[1], true));
        registry.insert(cred(3, &[2], true));
        assert!(registry.validate_dependencies(3).is_ok());
    }

    #[test]
    fn missing_prerequisite_fails() {
        let mut registry = CredentialRegistry::new();
        registry.insert(cred(2, &[1], true));
        assert_eq!(
            registry.validate_dependencies(2),
            Err(DependencyError::MissingPrerequisite(1))
        );
    }

    #[test]
    fn invalid_prerequisite_fails() {
        let mut registry = CredentialRegistry::new();
        registry.insert(cred(1, &[], false));
        registry.insert(cred(2, &[1], true));
        assert_eq!(
            registry.validate_dependencies(2),
            Err(DependencyError::InvalidPrerequisite(1))
        );
    }

    #[test]
    fn circular_dependency_detected() {
        let mut registry = CredentialRegistry::new();
        registry.insert(cred(1, &[2], true));
        registry.insert(cred(2, &[1], true));
        assert_eq!(
            registry.validate_dependencies(1),
            Err(DependencyError::CircularDependency(1))
        );
    }

    #[test]
    fn max_depth_enforced() {
        let mut registry = CredentialRegistry::new();
        for id in 1..=7 {
            let prereq = if id == 1 { vec![] } else { vec![id - 1] };
            registry.insert(cred(id, &prereq, true));
        }
        assert_eq!(
            registry.validate_dependencies(7),
            Err(DependencyError::MaxDepthExceeded(7))
        );
    }

    #[test]
    fn chain_query_returns_full_chain() {
        let mut registry = CredentialRegistry::new();
        registry.insert(cred(1, &[], true));
        registry.insert(cred(2, &[1], true));
        registry.insert(cred(3, &[2], true));
        assert_eq!(registry.get_credential_chain(3).unwrap(), vec![3, 2, 1]);
    }

    #[test]
    fn events_emitted_on_success() {
        let mut registry = CredentialRegistry::new();
        registry.insert(cred(1, &[], true));
        registry.insert(cred(2, &[1], true));
        let events = registry.validate_dependencies(2).unwrap();
        assert!(events.contains(&DependencyEvent::ValidationStarted(2)));
        assert!(events.contains(&DependencyEvent::PrerequisiteVerified {
            credential: 2,
            prerequisite: 1,
        }));
        assert!(events.contains(&DependencyEvent::ValidationSucceeded(2)));
    }
}
