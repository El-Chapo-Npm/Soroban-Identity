//! Model of `credential-manager` (contracts/credential-manager/src/lib.rs):
//! the issuer registry, the credential lifecycle (issue → renew → revoke or
//! expire), and `verify_credential`.
//!
//! Not modelled: claims, schemas, proofs of possession, dependency cascades,
//! amendments and scheduled issuance. Each of those only adds failure paths or
//! further revocations, and none of them weakens any property below.

use crate::{atomically, require_auth, valid_addr, Abort, Addr, CallResult, ADDRS};

/// Credential ids in the model universe.
pub const CREDS: usize = 3;
pub type CredId = u8;

/// Number of signers in the threshold-signature model universe.
pub const SIGNERS: usize = 3;
pub type SignerId = u8;

/// Number of oracle responses in the staleness model universe.
pub const ORACLE_RESPONSES: usize = 3;
pub type ResponseId = u8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Credential {
    pub issuer: Addr,
    pub subject: Addr,
    /// `0` means no expiry.
    pub expires_at: u64,
    pub revoked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Manager {
    pub admin: Option<Addr>,
    /// `ContractConfig::is_paused`
    pub paused: bool,
    /// Membership in the `ISSUER` vector.
    pub issuers: [bool; ADDRS],
    pub creds: [Option<Credential>; CREDS],
    /// `REVOKED_CNT`
    pub revoked_cnt: u32,
    /// Threshold-signature policy for credential operations.
    pub threshold: ThresholdConfig,
    /// Oracle data feed used for off-chain credential verification.
    pub oracle: OracleFeed,
}

impl Manager {
    pub fn well_formed(&self) -> bool {
        self.admin.map_or(true, valid_addr)
            && self
                .creds
                .iter()
                .flatten()
                .all(|c| valid_addr(c.issuer) && valid_addr(c.subject))
            && self.threshold.threshold > 0
    }

    pub fn revoked_total(&self) -> u32 {
        self.creds.iter().flatten().filter(|c| c.revoked).count() as u32
    }

    /// `require_admin`: loads ADMIN and calls `admin.require_auth()`.
    fn require_admin(&self, signer: Addr) -> CallResult {
        let admin = self.admin.ok_or(Abort::Error("NotInitialized"))?;
        require_auth(signer, admin)
    }

    fn require_not_paused(&self) -> CallResult {
        if self.paused {
            Err(Abort::Error("ContractPaused"))
        } else {
            Ok(())
        }
    }

    fn require_issuer(&self, issuer: Addr) -> CallResult {
        if self.issuers[issuer as usize] {
            Ok(())
        } else {
            Err(Abort::Error("UnauthorizedIssuer"))
        }
    }

    fn cred_mut(&mut self, id: CredId) -> CallResult<&mut Credential> {
        self.creds[id as usize].as_mut().ok_or(Abort::Error("CredentialNotFound"))
    }

    /// `add_issuer`
    pub fn add_issuer(&mut self, signer: Addr, issuer: Addr) -> CallResult {
        atomically(self, |s| {
            s.require_admin(signer)?;
            s.issuers[issuer as usize] = true;
            Ok(())
        })
    }

    /// `remove_issuer`
    pub fn remove_issuer(&mut self, signer: Addr, issuer: Addr) -> CallResult {
        atomically(self, |s| {
            s.require_admin(signer)?;
            s.issuers[issuer as usize] = false;
            Ok(())
        })
    }

    /// `pause`
    pub fn pause(&mut self, signer: Addr) -> CallResult {
        atomically(self, |s| {
            s.require_admin(signer)?;
            s.paused = true;
            Ok(())
        })
    }

    /// `unpause`
    pub fn unpause(&mut self, signer: Addr) -> CallResult {
        atomically(self, |s| {
            s.require_admin(signer)?;
            s.paused = false;
            Ok(())
        })
    }

    /// `issue_credential`. `subject_has_did` is the result of the
    /// cross-contract `has_active_did` call. `id` stands for the derived
    /// `(issuer, subject, type, nonce)` id: the nonce guarantees that a new
    /// issuance never overwrites an existing record, which the model enforces
    /// by requiring an empty slot.
    pub fn issue(
        &mut self,
        signer: Addr,
        issuer: Addr,
        subject: Addr,
        id: CredId,
        expires_at: u64,
        now: u64,
        subject_has_did: bool,
    ) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            s.require_issuer(issuer)?;
            if !subject_has_did {
                return Err(Abort::Error("SubjectHasNoDid"));
            }
            if expires_at != 0 && expires_at <= now {
                return Err(Abort::Error("CredentialExpired"));
            }
            let slot = &mut s.creds[id as usize];
            if slot.is_some() {
                return Err(Abort::Error("CredentialAlreadyExists"));
            }
            *slot = Some(Credential { issuer, subject, expires_at, revoked: false });
            Ok(())
        })
    }

    /// `revoke_credential`
    pub fn revoke(&mut self, signer: Addr, issuer: Addr, id: CredId) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            let cred = s.cred_mut(id)?;
            if cred.issuer != issuer {
                return Err(Abort::Error("UnauthorizedIssuer"));
            }
            if cred.revoked {
                return Err(Abort::Error("CredentialRevoked"));
            }
            cred.revoked = true;
            s.revoked_cnt += 1;
            Ok(())
        })
    }

    /// `expire_credential`: anyone may call it once the expiry has passed.
    pub fn expire(&mut self, signer: Addr, caller: Addr, id: CredId, now: u64) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, caller)?;
            s.require_not_paused()?;
            let cred = s.cred_mut(id)?;
            if cred.revoked {
                return Err(Abort::Error("CredentialRevoked"));
            }
            if cred.expires_at == 0 || now <= cred.expires_at {
                return Err(Abort::Error("CredentialNotExpiredYet"));
            }
            cred.revoked = true;
            s.revoked_cnt += 1;
            Ok(())
        })
    }

    /// `renew_credential`
    pub fn renew(&mut self, signer: Addr, issuer: Addr, id: CredId, new_expires_at: u64) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            // Contract: no registered-issuer check here (finding CM-1).
            if cfg!(feature = "patched") {
                s.require_issuer(issuer)?;
            }
            let cred = s.cred_mut(id)?;
            if cred.issuer != issuer {
                return Err(Abort::Error("UnauthorizedIssuer"));
            }
            if cred.revoked {
                return Err(Abort::Error("CredentialRevoked"));
            }
            if new_expires_at == 0 || new_expires_at <= cred.expires_at {
                return Err(Abort::Error("NewExpiryNotLater"));
            }
            cred.expires_at = new_expires_at;
            Ok(())
        })
    }

    /// `verify_credential`, read-only. Activation time and prerequisites are
    /// omitted because they only add further rejections.
    pub fn verify(&self, id: CredId, now: u64) -> CallResult {
        let cred = self.creds[id as usize].ok_or(Abort::Error("CredentialNotFound"))?;
        if cred.revoked {
            return Err(Abort::Error("CredentialRevoked"));
        }
        if cred.expires_at > 0 && now > cred.expires_at {
            return Err(Abort::Error("CredentialExpired"));
        }
        Ok(())
    }
}

/// Model of the threshold-signature configuration used to authorise
/// credential operations (issue #1126).
///
/// A signer set is a fixed-size vector of `(weight, enabled)` entries plus a
/// `threshold`. A signature bundle carries, per signer, whether that signer
/// signed and the timestamp at which the signature was produced. Validation
/// must reject bundles whose aggregate weight is below the threshold, whose
/// signatures have expired, or that reference disabled signers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct ThresholdConfig {
    /// Per-signer weight; `0` means the signer is disabled.
    pub weights: [u16; SIGNERS],
    /// Minimum aggregate weight required to authorise an operation.
    pub threshold: u16,
    /// Signatures older than `now - max_age` are rejected. `0` disables expiry.
    pub max_age: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct SignatureBundle {
    /// Whether each signer produced a signature.
    pub signed: [bool; SIGNERS],
    /// Timestamp of each signature (only meaningful when `signed[i]`).
    pub signed_at: [u64; SIGNERS],
}

impl ThresholdConfig {
    /// Aggregate weight of the signers that signed and are still enabled.
    pub fn aggregate_weight(&self, bundle: &SignatureBundle) -> u16 {
        let mut total: u16 = 0;
        let mut i = 0;
        while i < SIGNERS {
            if bundle.signed[i] && self.weights[i] > 0 {
                total = total.saturating_add(self.weights[i]);
            }
            i += 1;
        }
        total
    }

    /// `validate_threshold_signatures`: returns `Ok` only when the aggregate
    /// weight meets the threshold and every counted signature is fresh.
    pub fn validate(&self, bundle: &SignatureBundle, now: u64) -> CallResult {
        // A zero threshold would let an empty bundle authorise anything.
        if self.threshold == 0 {
            return Err(Abort::Error("InvalidThreshold"));
        }
        let mut total: u16 = 0;
        let mut i = 0;
        while i < SIGNERS {
            if bundle.signed[i] {
                if self.weights[i] == 0 {
                    return Err(Abort::Error("SignerDisabled"));
                }
                if self.max_age != 0 {
                    let signed_at = bundle.signed_at[i];
                    // Reject future-dated signatures and expired ones.
                    if signed_at > now {
                        return Err(Abort::Error("SignatureFromFuture"));
                    }
                    if now - signed_at > self.max_age {
                        return Err(Abort::Error("SignatureExpired"));
                    }
                }
                total = total.saturating_add(self.weights[i]);
            }
            i += 1;
        }
        if total < self.threshold {
            return Err(Abort::Error("ThresholdNotMet"));
        }
        Ok(())
    }
}

/// Model of an oracle data feed and its staleness checks (issue #1124).
///
/// Each response records the value reported by the oracle, the round it was
/// reported in, and the timestamp at which it was observed. Consumers must
/// reject responses that are stale, from the future, or from an older round
/// than the latest one already observed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct OracleResponse {
    pub value: u64,
    pub round: u32,
    pub observed_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct OracleFeed {
    /// Maximum permitted age of a response. `0` disables the staleness check.
    pub max_staleness: u64,
    /// Highest round observed so far; `0` means none.
    pub latest_round: u32,
    pub responses: [Option<OracleResponse>; ORACLE_RESPONSES],
}

impl OracleFeed {
    /// `read_oracle`: returns the value of a fresh, monotonic response.
    pub fn read(&self, id: ResponseId, now: u64) -> CallResult<u64> {
        let resp = self.responses[id as usize].ok_or(Abort::Error("OracleResponseMissing"))?;
        if resp.round <= self.latest_round {
            return Err(Abort::Error("StaleRound"));
        }
        if resp.observed_at > now {
            return Err(Abort::Error("ResponseFromFuture"));
        }
        if self.max_staleness != 0 && now - resp.observed_at > self.max_staleness {
            return Err(Abort::Error("StaleResponse"));
        }
        Ok(resp.value)
    }
}

#[derive(Clone, Copy, Debug)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Op {
    AddIssuer { issuer: Addr },
    RemoveIssuer { issuer: Addr },
    Pause,
    Unpause,
    Issue { issuer: Addr, subject: Addr, id: CredId, expires_at: u64, subject_has_did: bool },
    Revoke { issuer: Addr, id: CredId },
    Expire { caller: Addr, id: CredId },
    Renew { issuer: Addr, id: CredId, new_expires_at: u64 },
    /// Threshold-signature authorisation of a credential operation.
    ValidateThreshold { bundle: SignatureBundle },
    /// Oracle read with staleness checks.
    ReadOracle { id: ResponseId },
}

impl Op {
    pub fn well_formed(&self) -> bool {
        let id_ok = |id: CredId| (id as usize) < CREDS;
        match *self {
            Op::AddIssuer { issuer } | Op::RemoveIssuer { issuer } => valid_addr(issuer),
            Op::Pause | Op::Unpause => true,
            Op::Issue { issuer, subject, id, .. } => valid_addr(issuer) && valid_addr(subject) && id_ok(id),
            Op::Revoke { issuer, id } | Op::Renew { issuer, id, .. } => valid_addr(issuer) && id_ok(id),
            Op::Expire { caller, id } => valid_addr(caller) && id_ok(id),
            Op::ValidateThreshold { .. } => true,
            Op::ReadOracle { id } => (id as usize) < ORACLE_RESPONSES,
        }
    }

    pub fn apply(self, m: &mut Manager, signer: Addr, now: u64) -> CallResult {
        match self {
            Op::AddIssuer { issuer } => m.add_issuer(signer, issuer),
            Op::RemoveIssuer { issuer } => m.remove_issuer(signer, issuer),
            Op::Pause => m.pause(signer),
            Op::Unpause => m.unpause(signer),
            Op::Issue { issuer, subject, id, expires_at, subject_has_did } => {
                m.issue(signer, issuer, subject, id, expires_at, now, subject_has_did)
            }
            Op::Revoke { issuer, id } => m.revoke(signer, issuer, id),
            Op::Expire { caller, id } => m.expire(signer, caller, id, now),
            Op::Renew { issuer, id, new_expires_at } => m.renew(signer, issuer, id, new_expires_at),
            // Threshold and oracle checks are validated against the manager's
            // configured policy; they never mutate credential state.
            Op::ValidateThreshold { bundle } => m
                .threshold
                .validate(&bundle, now)
                .map(|_| ()),
            Op::ReadOracle { id } => m.oracle.read(id, now).map(|_| ()),
        }
    }
}
