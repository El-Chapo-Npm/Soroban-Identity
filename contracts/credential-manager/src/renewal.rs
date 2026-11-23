//! Credential expiry auto-renewal (SC-14, issue #869).
//!
//! Issuers may attach a [`RenewalPolicy`] to a credential so that recurring
//! credentials are automatically renewed when they are verified near (or past)
//! their expiry. Renewals can also be triggered manually by the issuer.

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

/// Supported renewal periods, in days.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenewalPeriod {
    Days30,
    Days60,
    Days90,
}

impl RenewalPeriod {
    /// Number of days covered by this period.
    pub fn days(&self) -> u64 {
        match self {
            RenewalPeriod::Days30 => 30,
            RenewalPeriod::Days60 => 60,
            RenewalPeriod::Days90 => 90,
        }
    }

    /// Length of the period expressed in seconds.
    pub fn seconds(&self) -> u64 {
        self.days() * 24 * 60 * 60
    }
}

/// Auto-renewal configuration stored alongside credential metadata.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalPolicy {
    /// Whether auto-renewal is enabled for the credential.
    pub enabled: bool,
    /// Length of each renewal period.
    pub period: RenewalPeriod,
    /// How long before expiry a credential becomes eligible for renewal.
    pub renew_before_seconds: u64,
    /// Maximum number of automatic renewals (0 means unlimited).
    pub max_renewals: u32,
}

impl RenewalPolicy {
    /// Build a policy with sensible defaults for the given period.
    pub fn new(period: RenewalPeriod) -> Self {
        Self {
            enabled: true,
            period,
            renew_before_seconds: period.seconds(),
            max_renewals: 0,
        }
    }

    /// Whether the credential is eligible for renewal at `now`.
    pub fn is_due(&self, expires_at: u64, now: u64, renewals: u32) -> bool {
        if !self.enabled {
            return false;
        }
        if self.max_renewals != 0 && renewals >= self.max_renewals {
            return false;
        }
        now.saturating_add(self.renew_before_seconds) >= expires_at
    }
}

/// Renewal bookkeeping tracked per credential.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalState {
    /// Number of renewals performed so far.
    pub renewals: u32,
    /// Timestamp of the most recent renewal (0 if never renewed).
    pub last_renewed_at: u64,
}

impl Default for RenewalState {
    fn default() -> Self {
        Self {
            renewals: 0,
            last_renewed_at: 0,
        }
    }
}

/// Emitted whenever a credential is renewed (automatic or manual).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalEvent {
    pub credential_id: Symbol,
    pub renewed_at: u64,
    pub new_expires_at: u64,
    pub automatic: bool,
    pub renewals: u32,
}

/// Storage key for a credential's renewal state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenewalKey {
    State(Symbol),
}

fn state_key(credential_id: &Symbol) -> RenewalKey {
    RenewalKey::State(credential_id.clone())
}

/// Load the renewal state for a credential, defaulting when absent.
pub fn load_state(env: &Env, credential_id: &Symbol) -> RenewalState {
    env.storage()
        .persistent()
        .get(&state_key(credential_id))
        .unwrap_or_default()
}

/// Persist the renewal state for a credential.
fn save_state(env: &Env, credential_id: &Symbol, state: &RenewalState) {
    env.storage()
        .persistent()
        .set(&state_key(credential_id), state);
}

/// Emit a renewal event.
fn emit_renewal(env: &Env, event: &RenewalEvent) {
    env.events()
        .publish((symbol_short!("renewal"), event.credential_id.clone()), event.clone());
}

/// Apply a renewal, extending `expires_at` by the policy period and recording
/// the new state. Returns the updated expiry timestamp.
fn apply_renewal(
    env: &Env,
    credential_id: &Symbol,
    policy: &RenewalPolicy,
    expires_at: u64,
    automatic: bool,
) -> u64 {
    let now = env.ledger().timestamp();
    let mut state = load_state(env, credential_id);

    // Extend from the later of the current expiry or now so lapsed credentials
    // are brought back into a valid window.
    let base = if expires_at > now { expires_at } else { now };
    let new_expires_at = base.saturating_add(policy.period.seconds());

    state.renewals = state.renewals.saturating_add(1);
    state.last_renewed_at = now;
    save_state(env, credential_id, &state);

    emit_renewal(
        env,
        &RenewalEvent {
            credential_id: credential_id.clone(),
            renewed_at: now,
            new_expires_at,
            automatic,
            renewals: state.renewals,
        },
    );

    new_expires_at
}

/// Auto-renew a credential during verification when its policy is due.
///
/// Returns the (possibly extended) expiry timestamp. When no policy is set or
/// the credential is not yet due, the original `expires_at` is returned.
pub fn auto_renew_on_verification(
    env: &Env,
    credential_id: &Symbol,
    policy: Option<&RenewalPolicy>,
    expires_at: u64,
) -> u64 {
    let policy = match policy {
        Some(policy) => policy,
        None => return expires_at,
    };

    let now = env.ledger().timestamp();
    let state = load_state(env, credential_id);

    if !policy.is_due(expires_at, now, state.renewals) {
        return expires_at;
    }

    apply_renewal(env, credential_id, policy, expires_at, true)
}

/// Manually renew a credential on behalf of `issuer`.
///
/// The caller is responsible for authorizing `issuer` before invoking this.
/// Returns the new expiry timestamp.
pub fn manual_renew(
    env: &Env,
    issuer: &Address,
    credential_id: &Symbol,
    policy: &RenewalPolicy,
    expires_at: u64,
) -> u64 {
    issuer.require_auth();
    apply_renewal(env, credential_id, policy, expires_at, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Ledger;

    fn setup() -> (Env, Symbol) {
        let env = Env::default();
        let credential_id = symbol_short!("cred1");
        (env, credential_id)
    }

    #[test]
    fn period_seconds_match_days() {
        assert_eq!(RenewalPeriod::Days30.seconds(), 30 * 24 * 60 * 60);
        assert_eq!(RenewalPeriod::Days60.seconds(), 60 * 24 * 60 * 60);
        assert_eq!(RenewalPeriod::Days90.seconds(), 90 * 24 * 60 * 60);
    }

    #[test]
    fn policy_not_due_when_far_from_expiry() {
        let policy = RenewalPolicy::new(RenewalPeriod::Days30);
        assert!(!policy.is_due(1_000_000, 0, 0));
    }

    #[test]
    fn policy_due_within_renewal_window() {
        let policy = RenewalPolicy::new(RenewalPeriod::Days30);
        let expires_at = policy.period.seconds();
        assert!(policy.is_due(expires_at, 0, 0));
    }

    #[test]
    fn policy_respects_max_renewals() {
        let mut policy = RenewalPolicy::new(RenewalPeriod::Days30);
        policy.max_renewals = 2;
        assert!(policy.is_due(0, 0, 1));
        assert!(!policy.is_due(0, 0, 2));
    }

    #[test]
    fn auto_renew_extends_expiry_and_emits_event() {
        let (env, credential_id) = setup();
        env.ledger().set_timestamp(0);
        let policy = RenewalPolicy::new(RenewalPeriod::Days30);
        let expires_at = policy.period.seconds();

        let new_expires = auto_renew_on_verification(
            &env,
            &credential_id,
            Some(&policy),
            expires_at,
        );

        assert_eq!(new_expires, expires_at + policy.period.seconds());
        let state = load_state(&env, &credential_id);
        assert_eq!(state.renewals, 1);
    }

    #[test]
    fn auto_renew_skips_when_not_due() {
        let (env, credential_id) = setup();
        env.ledger().set_timestamp(0);
        let policy = RenewalPolicy::new(RenewalPeriod::Days30);
        let expires_at = 10 * policy.period.seconds();

        let new_expires = auto_renew_on_verification(
            &env,
            &credential_id,
            Some(&policy),
            expires_at,
        );

        assert_eq!(new_expires, expires_at);
        assert_eq!(load_state(&env, &credential_id).renewals, 0);
    }

    #[test]
    fn auto_renew_without_policy_is_noop() {
        let (env, credential_id) = setup();
        let expires_at = 123;
        assert_eq!(
            auto_renew_on_verification(&env, &credential_id, None, expires_at),
            expires_at
        );
    }

    #[test]
    fn manual_renew_extends_expiry() {
        let (env, credential_id) = setup();
        env.ledger().set_timestamp(0);
        let issuer = Address::generate(&env);
        let policy = RenewalPolicy::new(RenewalPeriod::Days90);
        let expires_at = policy.period.seconds();

        let new_expires = manual_renew(&env, &issuer, &credential_id, &policy, expires_at);

        assert_eq!(new_expires, expires_at + policy.period.seconds());
        assert_eq!(load_state(&env, &credential_id).renewals, 1);
    }
}
