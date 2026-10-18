//! Credential escrow service.
//!
//! Provides conditional release of credentials between a depositor and a
//! beneficiary. Release conditions may be time-based, payment-based, or
//! approval-based. Disputes can be raised and resolved, and failed conditions
//! allow the depositor to reclaim the escrowed credential.

use soroban_sdk::{contracterror, contracttype, Address, Env, Symbol, Vec};

/// Errors specific to the escrow service.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// Escrow with the given id does not exist.
    EscrowNotFound = 1,
    /// Caller is not authorized to perform this action.
    Unauthorized = 2,
    /// Escrow is not in a state that permits the requested operation.
    InvalidStatus = 3,
    /// No release conditions have been defined for the escrow.
    NoConditionsDefined = 4,
    /// One or more release conditions have not been satisfied.
    ConditionsNotMet = 5,
    /// The escrow is currently under dispute.
    EscrowDisputed = 6,
    /// A dispute has not been raised for this escrow.
    NoDispute = 7,
    /// The provided condition is invalid or malformed.
    InvalidCondition = 8,
    /// The escrow has already been released.
    AlreadyReleased = 9,
    /// The escrow has already been refunded.
    AlreadyRefunded = 10,
}

/// Status of an escrow record.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    /// Escrow created, awaiting conditions.
    Pending,
    /// Conditions defined, awaiting satisfaction.
    Active,
    /// Conditions satisfied, credential released to beneficiary.
    Released,
    /// Escrow under dispute, awaiting resolution.
    Disputed,
    /// Dispute resolved in favor of the beneficiary.
    ResolvedToBeneficiary,
    /// Dispute resolved in favor of the depositor.
    ResolvedToDepositor,
    /// Credential refunded to the depositor.
    Refunded,
}

/// A single release condition attached to an escrow.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReleaseCondition {
    /// Releases once the ledger timestamp reaches `release_at`.
    Time { release_at: u64 },
    /// Releases once `amount` has been paid by the beneficiary.
    Payment { amount: i128, paid: bool },
    /// Releases once `approver` has approved the release.
    Approval { approver: Address, approved: bool },
}

/// Core escrow record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    /// Unique escrow identifier.
    pub id: u64,
    /// Address that deposited the credential.
    pub depositor: Address,
    /// Address that will receive the credential on release.
    pub beneficiary: Address,
    /// Identifier of the escrowed credential.
    pub credential_id: u64,
    /// Conditions that must be satisfied before release.
    pub conditions: Vec<ReleaseCondition>,
    /// Current status of the escrow.
    pub status: EscrowStatus,
    /// Ledger timestamp when the escrow was created.
    pub created_at: u64,
    /// Ledger timestamp of the last status change.
    pub updated_at: u64,
    /// Ledger timestamp when the credential was released, if applicable.
    pub released_at: Option<u64>,
    /// Ledger timestamp when the credential was refunded, if applicable.
    pub refunded_at: Option<u64>,
    /// Address that raised the dispute, if any.
    pub disputed_by: Option<Address>,
    /// Reason provided when the dispute was raised.
    pub dispute_reason: Option<Symbol>,
}

/// Storage keys used by the escrow service.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowKey {
    /// Monotonic counter for escrow ids.
    Counter,
    /// Escrow record keyed by id.
    Record(u64),
}

/// Emit an escrow lifecycle event.
fn emit(env: &Env, action: Symbol, escrow_id: u64, status: EscrowStatus) {
    env.events().publish(
        (Symbol::new(env, "escrow"), action),
        (escrow_id, status),
    );
}

fn next_id(env: &Env) -> u64 {
    let key = EscrowKey::Counter;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}

fn load(env: &Env, escrow_id: u64) -> Result<EscrowRecord, EscrowError> {
    env.storage()
        .persistent()
        .get(&EscrowKey::Record(escrow_id))
        .ok_or(EscrowError::EscrowNotFound)
}

fn save(env: &Env, record: &EscrowRecord) {
    env.storage()
        .persistent()
        .set(&EscrowKey::Record(record.id), record);
}

/// Deposit a credential into escrow for a beneficiary.
///
/// Returns the newly created escrow id. The escrow starts in
/// [`EscrowStatus::Pending`] until release conditions are defined.
pub fn deposit_credential(
    env: &Env,
    depositor: Address,
    beneficiary: Address,
    credential_id: u64,
) -> Result<u64, EscrowError> {
    depositor.require_auth();

    let now = env.ledger().timestamp();
    let id = next_id(env);

    let record = EscrowRecord {
        id,
        depositor,
        beneficiary,
        credential_id,
        conditions: Vec::new(env),
        status: EscrowStatus::Pending,
        created_at: now,
        updated_at: now,
        released_at: None,
        refunded_at: None,
        disputed_by: None,
        dispute_reason: None,
    };

    save(env, &record);
    emit(env, Symbol::new(env, "deposit"), id, EscrowStatus::Pending);

    Ok(id)
}

/// Define the release conditions for an escrow.
///
/// Only the depositor may define conditions, and only while the escrow is
/// pending or active. Replaces any previously defined conditions.
pub fn define_conditions(
    env: &Env,
    escrow_id: u64,
    conditions: Vec<ReleaseCondition>,
) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    if record.status != EscrowStatus::Pending && record.status != EscrowStatus::Active {
        return Err(EscrowError::InvalidStatus);
    }

    record.depositor.require_auth();

    if conditions.is_empty() {
        return Err(EscrowError::NoConditionsDefined);
    }

    record.conditions = conditions;
    record.status = EscrowStatus::Active;
    record.updated_at = env.ledger().timestamp();

    save(env, &record);
    emit(env, Symbol::new(env, "conditions"), escrow_id, EscrowStatus::Active);

    Ok(())
}

/// Verify whether all release conditions for an escrow are satisfied.
///
/// Returns `true` when every condition is met. Does not mutate state.
pub fn verify_conditions(env: &Env, escrow_id: u64) -> Result<bool, EscrowError> {
    let record = load(env, escrow_id)?;

    if record.conditions.is_empty() {
        return Err(EscrowError::NoConditionsDefined);
    }

    let now = env.ledger().timestamp();

    for condition in record.conditions.iter() {
        let satisfied = match condition {
            ReleaseCondition::Time { release_at } => now >= release_at,
            ReleaseCondition::Payment { paid, .. } => paid,
            ReleaseCondition::Approval { approved, .. } => approved,
        };
        if !satisfied {
            return Ok(false);
        }
    }

    Ok(true)
}

/// Mark a payment condition as paid.
///
/// The beneficiary must authorize the payment. Only the first matching
/// payment condition is updated.
pub fn record_payment(
    env: &Env,
    escrow_id: u64,
    amount: i128,
) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    if record.status != EscrowStatus::Active {
        return Err(EscrowError::InvalidStatus);
    }

    record.beneficiary.require_auth();

    let mut updated = Vec::new(env);
    let mut matched = false;
    for condition in record.conditions.iter() {
        match condition {
            ReleaseCondition::Payment { amount: required, .. } if !matched && required == amount => {
                matched = true;
                updated.push_back(ReleaseCondition::Payment {
                    amount: required,
                    paid: true,
                });
            }
            other => updated.push_back(other),
        }
    }

    if !matched {
        return Err(EscrowError::InvalidCondition);
    }

    record.conditions = updated;
    record.updated_at = env.ledger().timestamp();
    save(env, &record);

    emit(env, Symbol::new(env, "payment"), escrow_id, EscrowStatus::Active);

    Ok(())
}

/// Approve an approval-based condition.
///
/// Only the designated approver may approve.
pub fn approve_condition(env: &Env, escrow_id: u64) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    if record.status != EscrowStatus::Active {
        return Err(EscrowError::InvalidStatus);
    }

    let mut updated = Vec::new(env);
    let mut matched = false;
    for condition in record.conditions.iter() {
        match condition {
            ReleaseCondition::Approval { approver, .. } if !matched => {
                approver.require_auth();
                matched = true;
                updated.push_back(ReleaseCondition::Approval {
                    approver,
                    approved: true,
                });
            }
            other => updated.push_back(other),
        }
    }

    if !matched {
        return Err(EscrowError::InvalidCondition);
    }

    record.conditions = updated;
    record.updated_at = env.ledger().timestamp();
    save(env, &record);

    emit(env, Symbol::new(env, "approval"), escrow_id, EscrowStatus::Active);

    Ok(())
}

/// Release the escrowed credential to the beneficiary.
///
/// All conditions must be satisfied and the escrow must not be under dispute.
pub fn release_escrow(env: &Env, escrow_id: u64) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    match record.status {
        EscrowStatus::Released => return Err(EscrowError::AlreadyReleased),
        EscrowStatus::Refunded => return Err(EscrowError::AlreadyRefunded),
        EscrowStatus::Disputed => return Err(EscrowError::EscrowDisputed),
        EscrowStatus::Active => {}
        _ => return Err(EscrowError::InvalidStatus),
    }

    if record.conditions.is_empty() {
        return Err(EscrowError::NoConditionsDefined);
    }

    if !verify_conditions(env, escrow_id)? {
        return Err(EscrowError::ConditionsNotMet);
    }

    let now = env.ledger().timestamp();
    record.status = EscrowStatus::Released;
    record.released_at = Some(now);
    record.updated_at = now;

    save(env, &record);
    emit(env, Symbol::new(env, "release"), escrow_id, EscrowStatus::Released);

    Ok(())
}

/// Raise a dispute on an escrow.
///
/// Either the depositor or the beneficiary may raise a dispute while the
/// escrow is active.
pub fn dispute_escrow(
    env: &Env,
    escrow_id: u64,
    caller: Address,
    reason: Symbol,
) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    if record.status != EscrowStatus::Active {
        return Err(EscrowError::InvalidStatus);
    }

    if caller != record.depositor && caller != record.beneficiary {
        return Err(EscrowError::Unauthorized);
    }

    caller.require_auth();

    let now = env.ledger().timestamp();
    record.status = EscrowStatus::Disputed;
    record.disputed_by = Some(caller);
    record.dispute_reason = Some(reason);
    record.updated_at = now;

    save(env, &record);
    emit(env, Symbol::new(env, "dispute"), escrow_id, EscrowStatus::Disputed);

    Ok(())
}

/// Resolve a dispute in favor of either the beneficiary or the depositor.
///
/// When `favor_beneficiary` is true the credential is released; otherwise it
/// is refunded to the depositor.
pub fn resolve_dispute(
    env: &Env,
    escrow_id: u64,
    resolver: Address,
    favor_beneficiary: bool,
) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    if record.status != EscrowStatus::Disputed {
        return Err(EscrowError::NoDispute);
    }

    resolver.require_auth();

    let now = env.ledger().timestamp();
    record.updated_at = now;

    if favor_beneficiary {
        record.status = EscrowStatus::ResolvedToBeneficiary;
        record.released_at = Some(now);
        save(env, &record);
        emit(
            env,
            Symbol::new(env, "resolve"),
            escrow_id,
            EscrowStatus::ResolvedToBeneficiary,
        );
    } else {
        record.status = EscrowStatus::ResolvedToDepositor;
        record.refunded_at = Some(now);
        save(env, &record);
        emit(
            env,
            Symbol::new(env, "resolve"),
            escrow_id,
            EscrowStatus::ResolvedToDepositor,
        );
    }

    Ok(())
}

/// Refund the escrowed credential to the depositor.
///
/// Permitted when conditions have failed (are not met) or when the escrow is
/// still pending. The depositor must authorize the refund.
pub fn refund_escrow(env: &Env, escrow_id: u64) -> Result<(), EscrowError> {
    let mut record = load(env, escrow_id)?;

    match record.status {
        EscrowStatus::Released => return Err(EscrowError::AlreadyReleased),
        EscrowStatus::Refunded => return Err(EscrowError::AlreadyRefunded),
        EscrowStatus::Disputed => return Err(EscrowError::EscrowDisputed),
        EscrowStatus::Pending | EscrowStatus::Active => {}
        _ => return Err(EscrowError::InvalidStatus),
    }

    record.depositor.require_auth();

    if record.status == EscrowStatus::Active
        && !record.conditions.is_empty()
        && verify_conditions(env, escrow_id)?
    {
        return Err(EscrowError::ConditionsNotMet);
    }

    let now = env.ledger().timestamp();
    record.status = EscrowStatus::Refunded;
    record.refunded_at = Some(now);
    record.updated_at = now;

    save(env, &record);
    emit(env, Symbol::new(env, "refund"), escrow_id, EscrowStatus::Refunded);

    Ok(())
}

/// Query the current status of an escrow.
pub fn get_escrow_status(env: &Env, escrow_id: u64) -> Result<EscrowStatus, EscrowError> {
    let record = load(env, escrow_id)?;
    Ok(record.status)
}

/// Query the full escrow record.
pub fn get_escrow(env: &Env, escrow_id: u64) -> Result<EscrowRecord, EscrowError> {
    load(env, escrow_id)
}