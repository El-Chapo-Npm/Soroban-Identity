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
    /// Registered DID methods, in registration order.
    pub did_methods: Vec<DidMethod>,
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
            did_methods: Vec::new(),
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

    /// `register_did_method`: admin-gated registration of a supported DID
    /// method (e.g. `"did:stellar"`). Re-registering is idempotent.
    pub fn register_did_method(&mut self, signer: Addr, admin: Addr, method: DidMethod) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, admin)?;
            s.require_admin(admin)?;
            s.require_not_paused()?;
            if !method.is_well_formed() {
                return Err(Abort::Error("InvalidDidMethod"));
            }
            if !s.did_methods.contains(&method) {
                if s.did_methods.len() >= DID_METHODS {
                    return Err(Abort::Error("TooManyDidMethods"));
                }
                s.did_methods.push(method);
            }
            Ok(())
        })
    }

    /// `resolve_did_string`: universal resolver dispatch. Parses the DID
    /// string, checks the method is registered, and returns the controller
    /// address of the (active) DID document. Unsupported methods and
    /// malformed DIDs yield typed errors; this never panics.
    pub fn resolve_did_string(&self, did: &DidString) -> CallResult<Addr> {
        let (method, controller) = parse_did(did)?;
        if !self.did_methods.contains(&method) {
            return Err(Abort::Error("UnsupportedDidMethod"));
        }
        match self.dids[controller as usize] {
            Some(Did { active: true }) => Ok(controller),
            Some(Did { active: false }) => Err(Abort::Error("DidDeactivated")),
            None => Err(Abort::Error("DidNotFound")),
        }
    }
}

/// Maximum number of registered DID methods.
pub const DID_METHODS: usize = 8;

/// Maximum length of a DID method name, in bytes.
pub const DID_METHOD_MAX_LEN: usize = 16;

/// A DID method name, e.g. `"stellar"` in `did:stellar:<id>`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct DidMethod {
    pub len: u8,
    pub bytes: [u8; DID_METHOD_MAX_LEN],
}

impl DidMethod {
    pub fn from_bytes(src: &[u8]) -> Self {
        let mut bytes = [0u8; DID_METHOD_MAX_LEN];
        let n = if src.len() > DID_METHOD_MAX_LEN { DID_METHOD_MAX_LEN } else { src.len() };
        bytes[..n].copy_from_slice(&src[..n]);
        DidMethod { len: n as u8, bytes }
    }

    pub fn as_bytes(&self) -> &[u8] {
        let n = if self.len as usize > DID_METHOD_MAX_LEN { DID_METHOD_MAX_LEN } else { self.len as usize };
        &self.bytes[..n]
    }

    /// A method name is `1*(ALPHA / DIGIT)` per the DID core grammar.
    pub fn is_well_formed(&self) -> bool {
        let b = self.as_bytes();
        !b.is_empty() && b.iter().all(|c| c.is_ascii_alphanumeric())
    }
}

/// A DID string, e.g. `did:stellar:42`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct DidString {
    pub len: u8,
    pub bytes: [u8; DID_STRING_MAX_LEN],
}

/// Maximum length of a DID string, in bytes.
pub const DID_STRING_MAX_LEN: usize = 64;

impl DidString {
    pub fn from_bytes(src: &[u8]) -> Self {
        let mut bytes = [0u8; DID_STRING_MAX_LEN];
        let n = if src.len() > DID_STRING_MAX_LEN { DID_STRING_MAX_LEN } else { src.len() };
        bytes[..n].copy_from_slice(&src[..n]);
        DidString { len: n as u8, bytes }
    }

    pub fn as_bytes(&self) -> &[u8] {
        let n = if self.len as usize > DID_STRING_MAX_LEN { DID_STRING_MAX_LEN } else { self.len as usize };
        &self.bytes[..n]
    }
}

/// Parse `did:<method>:<id>` into the method and the controller address.
/// Returns typed errors for malformed input; never panics.
pub fn parse_did(did: &DidString) -> CallResult<(DidMethod, Addr)> {
    let s = did.as_bytes();
    if s.len() < 4 || &s[..4] != b"did:" {
        return Err(Abort::Error("InvalidDid"));
    }
    let rest = &s[4..];
    let colon = rest.iter().position(|&c| c == b':').ok_or(Abort::Error("InvalidDid"))?;
    let method = DidMethod::from_bytes(&rest[..colon]);
    if !method.is_well_formed() {
        return Err(Abort::Error("InvalidDid"));
    }
    let id = &rest[colon + 1..];
    if id.is_empty() || !id.iter().all(|c| c.is_ascii_digit()) {
        return Err(Abort::Error("InvalidDid"));
    }
    let mut value: u32 = 0;
    for &c in id {
        value = value.saturating_mul(10).saturating_add((c - b'0') as u32);
    }
    if !valid_addr(value) {
        return Err(Abort::Error("InvalidDid"));
    }
    Ok((method, value))
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
    RegisterDidMethod { admin: Addr, method: DidMethod },
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
            Op::RegisterDidMethod { admin, .. } => valid_addr(admin),
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
            Op::RegisterDidMethod { admin, method } => r.register_did_method(signer, admin, method),
        }
    }
}
