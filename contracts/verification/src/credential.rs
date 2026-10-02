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
}

impl Manager {
    pub fn well_formed(&self) -> bool {
        self.admin.map_or(true, valid_addr)
            && self
                .creds
                .iter()
                .flatten()
                .all(|c| valid_addr(c.issuer) && valid_addr(c.subject))
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
        }
    }
}
