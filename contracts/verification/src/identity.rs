//! Model of `identity-registry` (contracts/identity-registry/src/lib.rs):
//! the admin handover, the pause switch, and the DID lifecycle.

use crate::{atomically, require_auth, valid_addr, Abort, Addr, CallResult, ADDRS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Did {
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Registry {
    /// `ADMIN` in instance storage.
    pub admin: Option<Addr>,
    /// `PENDING_ADMIN` in instance storage.
    pub pending_admin: Option<Addr>,
    /// Ghost state, not present in the contract: the admin who created the
    /// current pending proposal. Specification S-ID-3 is stated over it.
    pub pending_nominator: Option<Addr>,
    /// `PAUSED` in instance storage.
    pub paused: bool,
    /// Persistent DID documents, indexed by controller address.
    pub dids: [Option<Did>; ADDRS],
    /// `DID_COUNT`: the number of *active* DIDs.
    pub did_count: u32,
}

impl Registry {
    pub fn new() -> Self {
        Registry {
            admin: None,
            pending_admin: None,
            pending_nominator: None,
            paused: false,
            dids: [None; ADDRS],
            did_count: 0,
        }
    }

    /// Well-formedness of the model state itself: addresses in range.
    pub fn well_formed(&self) -> bool {
        self.admin.map_or(true, valid_addr)
            && self.pending_admin.map_or(true, valid_addr)
            && self.pending_nominator.map_or(true, valid_addr)
    }

    pub fn active_dids(&self) -> u32 {
        self.dids.iter().filter(|d| matches!(d, Some(Did { active: true }))).count() as u32
    }

    fn stored_admin(&self) -> CallResult<Addr> {
        self.admin.ok_or(Abort::Error("NotInitialized"))
    }

    fn require_admin(&self, admin: Addr) -> CallResult {
        if self.stored_admin()? != admin {
            return Err(Abort::Error("Unauthorized"));
        }
        Ok(())
    }

    fn require_not_paused(&self) -> CallResult {
        if self.paused {
            Err(Abort::Error("ContractPaused"))
        } else {
            Ok(())
        }
    }

    /// `initialize`. It takes no `require_auth`, so whoever calls it first
    /// becomes admin (finding ID-2).
    pub fn initialize(&mut self, _signer: Addr, admin: Addr) -> CallResult {
        atomically(self, |s| {
            if s.admin.is_some() {
                return Err(Abort::Error("AlreadyInitialized"));
            }
            s.admin = Some(admin);
            Ok(())
        })
    }

    /// `transfer_admin`: a single-step transfer that panics on a mismatch.
    pub fn transfer_admin(&mut self, signer: Addr, current: Addr, new_admin: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, current)?;
            let stored = s.admin.ok_or(Abort::Panic("not initialized"))?;
            if stored != current {
                return Err(Abort::Panic("not the admin"));
            }
            s.admin = Some(new_admin);
            // Contract: PENDING_ADMIN is left untouched (finding ID-1).
            if cfg!(feature = "patched") {
                s.pending_admin = None;
                s.pending_nominator = None;
            }
            Ok(())
        })
    }

    /// `propose_admin`
    pub fn propose_admin(&mut self, signer: Addr, current: Addr, proposed: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, current)?;
            s.require_admin(current)?;
            s.pending_admin = Some(proposed);
            s.pending_nominator = Some(current);
            Ok(())
        })
    }

    /// `accept_admin`
    pub fn accept_admin(&mut self, signer: Addr, new_admin: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, new_admin)?;
            let pending = s.pending_admin.ok_or(Abort::Error("NotInitialized"))?;
            if pending != new_admin {
                return Err(Abort::Error("Unauthorized"));
            }
            s.stored_admin()?;
            s.admin = Some(new_admin);
            s.pending_admin = None;
            s.pending_nominator = None;
            Ok(())
        })
    }

    /// `pause`
    pub fn pause(&mut self, signer: Addr, admin: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, admin)?;
            s.require_admin(admin)?;
            s.paused = true;
            Ok(())
        })
    }

    /// `unpause`
    pub fn unpause(&mut self, signer: Addr, admin: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, admin)?;
            s.require_admin(admin)?;
            s.paused = false;
            Ok(())
        })
    }

    /// `create_did` → `create_did_unchecked`. Metadata validation is omitted
    /// because it only adds more ways for the call to fail.
    pub fn create_did(&mut self, signer: Addr, controller: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, controller)?;
            s.require_not_paused()?;
            let slot = &mut s.dids[controller as usize];
            if slot.is_some() {
                return Err(Abort::Error("DidAlreadyExists"));
            }
            *slot = Some(Did { active: true });
            s.did_count += 1;
            Ok(())
        })
    }

    /// `deactivate_did`
    pub fn deactivate_did(&mut self, signer: Addr, controller: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, controller)?;
            s.require_not_paused()?;
            let doc = s.dids[controller as usize].as_mut().ok_or(Abort::Error("DidNotFound"))?;
            if !doc.active {
                return Err(Abort::Error("DidDeactivated"));
            }
            doc.active = false;
            if s.did_count > 0 {
                s.did_count -= 1;
            }
            Ok(())
        })
    }

    /// `reactivate_did`
    pub fn reactivate_did(&mut self, signer: Addr, admin: Addr, controller: Addr) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, admin)?;
            s.require_not_paused()?;
            s.require_admin(admin)?;
            let doc = s.dids[controller as usize].as_mut().ok_or(Abort::Error("DidNotFound"))?;
            if doc.active {
                return Ok(());
            }
            doc.active = true;
            s.did_count += 1;
            Ok(())
        })
    }

    /// `has_active_did`: the gate that credential-manager calls before issuing.
    pub fn has_active_did(&self, controller: Addr) -> bool {
        matches!(self.dids[controller as usize], Some(Did { active: true }))
    }
}

impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

/// Every state-changing entry point, used to quantify over "any call".
#[derive(Clone, Copy, Debug)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Op {
    Initialize { admin: Addr },
    TransferAdmin { current: Addr, new_admin: Addr },
    ProposeAdmin { current: Addr, proposed: Addr },
    AcceptAdmin { new_admin: Addr },
    Pause { admin: Addr },
    Unpause { admin: Addr },
    CreateDid { controller: Addr },
    DeactivateDid { controller: Addr },
    ReactivateDid { admin: Addr, controller: Addr },
}

impl Op {
    pub fn well_formed(&self) -> bool {
        match *self {
            Op::Initialize { admin } | Op::Pause { admin } | Op::Unpause { admin } => valid_addr(admin),
            Op::TransferAdmin { current, new_admin } => valid_addr(current) && valid_addr(new_admin),
            Op::ProposeAdmin { current, proposed } => valid_addr(current) && valid_addr(proposed),
            Op::AcceptAdmin { new_admin } => valid_addr(new_admin),
            Op::CreateDid { controller } | Op::DeactivateDid { controller } => valid_addr(controller),
            Op::ReactivateDid { admin, controller } => valid_addr(admin) && valid_addr(controller),
        }
    }

    pub fn apply(self, r: &mut Registry, signer: Addr) -> CallResult {
        match self {
            Op::Initialize { admin } => r.initialize(signer, admin),
            Op::TransferAdmin { current, new_admin } => r.transfer_admin(signer, current, new_admin),
            Op::ProposeAdmin { current, proposed } => r.propose_admin(signer, current, proposed),
            Op::AcceptAdmin { new_admin } => r.accept_admin(signer, new_admin),
            Op::Pause { admin } => r.pause(signer, admin),
            Op::Unpause { admin } => r.unpause(signer, admin),
            Op::CreateDid { controller } => r.create_did(signer, controller),
            Op::DeactivateDid { controller } => r.deactivate_did(signer, controller),
            Op::ReactivateDid { admin, controller } => r.reactivate_did(signer, admin, controller),
        }
    }
}
