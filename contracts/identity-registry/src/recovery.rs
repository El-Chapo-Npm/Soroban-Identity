use soroban_sdk::{
    contracttype, symbol_short, xdr::ToXdr, Address, BytesN, Env, Symbol, Vec,
};

use crate::ContractError;

pub(crate) const RECOVERY_ADDR: Symbol = symbol_short!("REC_ADDR");
pub(crate) const RECOVERY_PEND: Symbol = symbol_short!("REC_PEND");
pub(crate) const SIGNER_ROT_PEND: Symbol = symbol_short!("SIG_ROT");

/// ~24 hours in ledgers at 5-second close time.
pub(crate) const RECOVERY_TIMELOCK_LEDGERS: u32 = 17_280;

/// ~12 hours in ledgers at 5-second close time.
pub(crate) const SIGNER_ROTATION_TIMELOCK_LEDGERS: u32 = 8_640;

/// Stored on-chain while a recovery is pending (after challenge, before completion).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryRequest {
    pub recovery_addr: Address,
    pub new_controller: Address,
    /// Ledger sequence number at which `initiate_recovery` was called.
    pub initiated_at: u32,
}

/// Stored on-chain while a guardian-approved signer rotation is pending.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SignerRotationRequest {
    /// Controller whose signer set is being rotated.
    pub controller: Address,
    /// The proposed replacement signer set.
    pub new_signers: Vec<Address>,
    /// Guardians that have approved the rotation so far.
    pub approvals: Vec<Address>,
    /// Number of distinct guardian approvals required to complete.
    pub threshold: u32,
    /// Ledger sequence number at which `initiate_signer_rotation` was called.
    pub initiated_at: u32,
}

// ── Key helpers ───────────────────────────────────────────────────────────────

pub(crate) fn recovery_addr_key(env: &Env, controller: &Address) -> (Symbol, BytesN<32>) {
    let hash = env.crypto().sha256(&controller.clone().to_xdr(env));
    (RECOVERY_ADDR, hash.into())
}

pub(crate) fn recovery_pending_key(env: &Env, controller: &Address) -> (Symbol, BytesN<32>) {
    let hash = env.crypto().sha256(&controller.clone().to_xdr(env));
    (RECOVERY_PEND, hash.into())
}

pub(crate) fn signer_rotation_key(env: &Env, controller: &Address) -> (Symbol, BytesN<32>) {
    let hash = env.crypto().sha256(&controller.clone().to_xdr(env));
    (SIGNER_ROT_PEND, hash.into())
}

// ── Storage helpers ───────────────────────────────────────────────────────────

pub(crate) fn store_recovery_address(env: &Env, controller: &Address, recovery_addr: &Address) {
    let key = recovery_addr_key(env, controller);
    env.storage().persistent().set(&key, recovery_addr);
    env.events().publish(
        (symbol_short!("recovery"), symbol_short!("set")),
        (1u32, controller.clone(), recovery_addr.clone()),
    );
}

pub(crate) fn load_recovery_address(env: &Env, controller: &Address) -> Option<Address> {
    let key = recovery_addr_key(env, controller);
    env.storage().persistent().get(&key)
}

pub(crate) fn remove_recovery_address(env: &Env, controller: &Address) {
    let key = recovery_addr_key(env, controller);
    env.storage().persistent().remove(&key);
}

// ── Recovery flow ─────────────────────────────────────────────────────────────

/// Phase 1 – recovery address calls this to start the recovery challenge.
/// Emits `(recovery, init)` so off-chain monitors can alert the original owner.
pub(crate) fn initiate(
    env: &Env,
    recovery_addr: &Address,
    controller: &Address,
    new_controller: &Address,
) -> Result<(), ContractError> {
    let stored = load_recovery_address(env, controller)
        .ok_or(ContractError::RecoveryNotSet)?;
    if stored != *recovery_addr {
        return Err(ContractError::RecoveryNotAuthorized);
    }
    let pending_key = recovery_pending_key(env, controller);
    if env.storage().persistent().has(&pending_key) {
        return Err(ContractError::RecoveryPending);
    }
    let request = RecoveryRequest {
        recovery_addr: recovery_addr.clone(),
        new_controller: new_controller.clone(),
        initiated_at: env.ledger().sequence(),
    };
    env.storage().persistent().set(&pending_key, &request);
    env.events().publish(
        (symbol_short!("recovery"), symbol_short!("init")),
        (1u32, controller.clone(), recovery_addr.clone(), env.ledger().sequence()),
    );
    Ok(())
}

/// Phase 1b – original owner responds to the challenge to cancel the recovery.
pub(crate) fn cancel(env: &Env, controller: &Address) -> Result<(), ContractError> {
    let pending_key = recovery_pending_key(env, controller);
    if !env.storage().persistent().has(&pending_key) {
        return Err(ContractError::NoPendingRecovery);
    }
    env.storage().persistent().remove(&pending_key);
    env.events().publish(
        (symbol_short!("recovery"), symbol_short!("cancel")),
        (1u32, controller.clone(), env.ledger().sequence()),
    );
    Ok(())
}

/// Phase 2 – recovery address calls `recover_did` after the timelock expires.
/// Returns the new controller address so the caller can update the DID document.
pub(crate) fn finalize(
    env: &Env,
    recovery_addr: &Address,
    controller: &Address,
) -> Result<Address, ContractError> {
    let pending_key = recovery_pending_key(env, controller);
    let request: RecoveryRequest = env
        .storage()
        .persistent()
        .get(&pending_key)
        .ok_or(ContractError::NoPendingRecovery)?;
    if request.recovery_addr != *recovery_addr {
        return Err(ContractError::RecoveryNotAuthorized);
    }
    let current = env.ledger().sequence();
    if current < request.initiated_at + RECOVERY_TIMELOCK_LEDGERS {
        return Err(ContractError::RecoveryTimelockActive);
    }
    env.storage().persistent().remove(&pending_key);
    // Clean up old recovery address — it no longer applies to the transferred DID.
    remove_recovery_address(env, controller);
    env.events().publish(
        (symbol_short!("recovery"), symbol_short!("done")),
        (1u32, controller.clone(), request.new_controller.clone(), current),
    );
    Ok(request.new_controller)
}

/// Read-only: return pending recovery request for `controller`, if any.
pub(crate) fn get_pending(env: &Env, controller: &Address) -> Option<RecoveryRequest> {
    let key = recovery_pending_key(env, controller);
    env.storage().persistent().get(&key)
}

// ── Guardian-based signer rotation ────────────────────────────────────────────

/// Phase 1 – a guardian (or the controller itself) proposes a new signer set.
/// `guardians` is the current guardian set; `threshold` is the number of
/// distinct guardian approvals required to complete the rotation.
pub(crate) fn initiate_signer_rotation(
    env: &Env,
    caller: &Address,
    controller: &Address,
    new_signers: Vec<Address>,
    guardians: &Vec<Address>,
    threshold: u32,
) -> Result<(), ContractError> {
    if threshold == 0 || threshold > guardians.len() {
        return Err(ContractError::InsufficientGuardianApprovals);
    }
    if *caller != *controller && !guardians.contains(caller) {
        return Err(ContractError::SignerRotationNotAuthorized);
    }
    let key = signer_rotation_key(env, controller);
    if env.storage().persistent().has(&key) {
        return Err(ContractError::RecoveryPending);
    }
    let mut approvals = Vec::new(env);
    if guardians.contains(caller) {
        approvals.push_back(caller.clone());
    }
    let request = SignerRotationRequest {
        controller: controller.clone(),
        new_signers,
        approvals,
        threshold,
        initiated_at: env.ledger().sequence(),
    };
    env.storage().persistent().set(&key, &request);
    env.events().publish(
        (symbol_short!("signer"), symbol_short!("init")),
        (1u32, controller.clone(), caller.clone(), env.ledger().sequence()),
    );
    Ok(())
}

/// Phase 2 – a guardian approves the pending signer rotation.
pub(crate) fn approve_signer_rotation(
    env: &Env,
    guardian: &Address,
    controller: &Address,
    guardians: &Vec<Address>,
) -> Result<(), ContractError> {
    if !guardians.contains(guardian) {
        return Err(ContractError::SignerRotationNotAuthorized);
    }
    let key = signer_rotation_key(env, controller);
    let mut request: SignerRotationRequest = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::NoPendingSignerRotation)?;
    if request.approvals.contains(guardian) {
        return Err(ContractError::SignerRotationNotAuthorized);
    }
    request.approvals.push_back(guardian.clone());
    env.storage().persistent().set(&key, &request);
    env.events().publish(
        (symbol_short!("signer"), symbol_short!("apprv")),
        (1u32, controller.clone(), guardian.clone(), request.approvals.len()),
    );
    Ok(())
}

/// Phase 3 – after the timelock expires and the guardian threshold is met,
/// finalize the rotation. Returns the new signer set so the caller can apply it.
pub(crate) fn complete_signer_rotation(
    env: &Env,
    caller: &Address,
    controller: &Address,
    guardians: &Vec<Address>,
) -> Result<Vec<Address>, ContractError> {
    if *caller != *controller && !guardians.contains(caller) {
        return Err(ContractError::SignerRotationNotAuthorized);
    }
    let key = signer_rotation_key(env, controller);
    let request: SignerRotationRequest = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::NoPendingSignerRotation)?;
    if request.approvals.len() < request.threshold {
        return Err(ContractError::InsufficientGuardianApprovals);
    }
    let current = env.ledger().sequence();
    if current < request.initiated_at + SIGNER_ROTATION_TIMELOCK_LEDGERS {
        return Err(ContractError::SignerRotationTimelockActive);
    }
    env.storage().persistent().remove(&key);
    env.events().publish(
        (symbol_short!("signer"), symbol_short!("done")),
        (1u32, controller.clone(), request.new_signers.len(), current),
    );
    Ok(request.new_signers)
}

/// Read-only: return the pending signer rotation for `controller`, if any.
pub(crate) fn get_pending_signer_rotation(
    env: &Env,
    controller: &Address,
) -> Option<SignerRotationRequest> {
    let key = signer_rotation_key(env, controller);
    env.storage().persistent().get(&key)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IdentityRegistry, IdentityRegistryClient};
    use soroban_sdk::{testutils::Address as _, Env, Map, Vec};
    extern crate std;

    fn setup() -> (Env, IdentityRegistryClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client)
    }

    #[test]
    fn test_set_and_get_recovery_address() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        assert!(client.get_recovery_address(&user).is_none());

        client.set_recovery_address(&user, &recovery);
        assert_eq!(client.get_recovery_address(&user), Some(recovery));
    }

    #[test]
    fn test_initiate_recovery_stores_pending_request() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);
        client.initiate_recovery(&recovery, &user, &new_owner);

        let pending = client.get_pending_recovery(&user);
        assert!(pending.is_some());
        let req = pending.unwrap();
        assert_eq!(req.new_controller, new_owner);
        assert_eq!(req.recovery_addr, recovery);
    }

    #[test]
    fn test_cancel_recovery_removes_pending() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);
        client.initiate_recovery(&recovery, &user, &new_owner);
        assert!(client.get_pending_recovery(&user).is_some());

        client.cancel_recovery(&user);
        assert!(client.get_pending_recovery(&user).is_none());
    }

    #[test]
    fn test_recover_did_after_timelock_transfers_ownership() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);
        client.initiate_recovery(&recovery, &user, &new_owner);

        env.ledger().with_mut(|li| {
            li.sequence_number += RECOVERY_TIMELOCK_LEDGERS + 1;
        });

        client.recover_did(&recovery, &user);

        assert!(client.has_active_did(&new_owner));
        assert!(!client.has_active_did(&user));
        // Recovery address is cleared after successful recovery.
        assert!(client.get_recovery_address(&new_owner).is_none());
    }

    #[test]
    fn test_recover_did_before_timelock_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);
        client.initiate_recovery(&recovery, &user, &new_owner);

        assert_eq!(
            client.try_recover_did(&recovery, &user),
            Err(Ok(crate::ContractError::RecoveryTimelockActive)),
        );
    }

    #[test]
    fn test_initiate_recovery_unauthorized_caller_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);

        assert_eq!(
            client.try_initiate_recovery(&attacker, &user, &new_owner),
            Err(Ok(crate::ContractError::RecoveryNotAuthorized)),
        );
    }

    #[test]
    fn test_initiate_recovery_no_recovery_address_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));

        assert_eq!(
            client.try_initiate_recovery(&recovery, &user, &new_owner),
            Err(Ok(crate::ContractError::RecoveryNotSet)),
        );
    }

    #[test]
    fn test_double_initiate_recovery_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);
        client.initiate_recovery(&recovery, &user, &new_owner);

        assert_eq!(
            client.try_initiate_recovery(&recovery, &user, &new_owner),
            Err(Ok(crate::ContractError::RecoveryPending)),
        );
    }

    #[test]
    fn test_signer_rotation_full_flow() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let new_signer = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(new_signer.clone());

        client.initiate_signer_rotation(&g1, &user, &new_signers, &guardians, &2);
        assert!(client.get_pending_signer_rotation(&user).is_some());

        client.approve_signer_rotation(&g2, &user, &guardians);

        env.ledger().with_mut(|li| {
            li.sequence_number += SIGNER_ROTATION_TIMELOCK_LEDGERS + 1;
        });

        let applied = client.complete_signer_rotation(&user, &user, &guardians);
        assert_eq!(applied, new_signers);
        assert!(client.get_pending_signer_rotation(&user).is_none());
    }

    #[test]
    fn test_signer_rotation_insufficient_approvals_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        let new_signers = Vec::new(&env);

        client.initiate_signer_rotation(&g1, &user, &new_signers, &guardians, &2);

        env.ledger().with_mut(|li| {
            li.sequence_number += SIGNER_ROTATION_TIMELOCK_LEDGERS + 1;
        });

        assert_eq!(
            client.try_complete_signer_rotation(&user, &user, &guardians),
            Err(Ok(crate::ContractError::InsufficientGuardianApprovals)),
        );
    }

    #[test]
    fn test_signer_rotation_timelock_active_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let g1 = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        let new_signers = Vec::new(&env);

        client.initiate_signer_rotation(&g1, &user, &new_signers, &guardians, &1);

        assert_eq!(
            client.try_complete_signer_rotation(&user, &user, &guardians),
            Err(Ok(crate::ContractError::SignerRotationTimelockActive)),
        );
    }

    #[test]
    fn test_signer_rotation_unauthorized_guardian_fails() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let g1 = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        let new_signers = Vec::new(&env);

        assert_eq!(
            client.try_initiate_signer_rotation(&attacker, &user, &new_signers, &guardians, &1),
            Err(Ok(crate::ContractError::SignerRotationNotAuthorized)),
        );
    }

    #[test]
    fn test_cancel_then_reinitiate_recovery() {
        let (env, client) = setup();
        let user = Address::generate(&env);
        let recovery = Address::generate(&env);
        let new_owner = Address::generate(&env);

        client.create_did(&user, &Map::new(&env));
        client.set_recovery_address(&user, &recovery);
        client.initiate_recovery(&recovery, &user, &new_owner);
        client.cancel_recovery(&user);

        // Can initiate again after cancel.
        client.initiate_recovery(&recovery, &user, &new_owner);
        assert!(client.get_pending_recovery(&user).is_some());
    }
}
