//! Model of `revocation-registry` (contracts/revocation-registry/src/lib.rs):
//! per-issuer revocation bitmaps, revocation records, and reversal.
//!
//! The contract caps bitmaps at `BITMAP_WORDS` words. The model uses 2 words
//! (128 slots), which exercises word boundaries while staying tractable for
//! Kani. The index arithmetic is identical.

use crate::{atomically, require_auth, valid_addr, Abort, Addr, CallResult, ADDRS};

pub const BITMAP_WORDS: u32 = 2;
pub const CREDS: usize = 3;
pub type CredId = u8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Bitmap {
    pub word_count: u32,
    pub words: [u64; BITMAP_WORDS as usize],
}

impl Bitmap {
    /// Mirrors `bitmap.words.get(word_idx).unwrap()`: a Soroban `Vec` has
    /// `word_count` elements, so any index at or past it panics.
    fn word(&self, word_idx: u32) -> CallResult<u64> {
        if word_idx < self.word_count && word_idx < BITMAP_WORDS {
            Ok(self.words[word_idx as usize])
        } else {
            Err(Abort::Panic("words.get(word_idx).unwrap()"))
        }
    }

    pub fn is_set(&self, index: u32) -> bool {
        self.word(index / 64).map_or(false, |w| (w >> (index % 64)) & 1 == 1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Record {
    pub issuer: Addr,
    pub index: u32,
    pub reversed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Registry {
    pub admin: Option<Addr>,
    pub paused: bool,
    /// `(REV_MAP, issuer)`
    pub bitmaps: [Option<Bitmap>; ADDRS],
    /// Revocation records, keyed by credential id **alone**, as in the contract.
    pub records: [Option<Record>; CREDS],
    /// `REV_COUNT`: currently active (non-reversed) revocations.
    pub rev_count: u32,
}

impl Registry {
    pub fn well_formed(&self) -> bool {
        self.admin.map_or(true, valid_addr)
            && self.bitmaps.iter().flatten().all(|b| b.word_count <= BITMAP_WORDS)
            && self.records.iter().flatten().all(|r| valid_addr(r.issuer))
    }

    pub fn active_records(&self) -> u32 {
        self.records.iter().flatten().filter(|r| !r.reversed).count() as u32
    }

    fn require_not_paused(&self) -> CallResult {
        if self.paused {
            Err(Abort::Error("ContractPaused"))
        } else {
            Ok(())
        }
    }

    /// `init_bitmap`
    pub fn init_bitmap(&mut self, signer: Addr, issuer: Addr, capacity: u32) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            if s.bitmaps[issuer as usize].is_some() {
                return Err(Abort::Error("CredentialAlreadyExists"));
            }
            // Contract: `(capacity + 63) / 64`. This overflows for
            // capacity > u32::MAX - 63 (finding RR-3).
            let word_count = if cfg!(feature = "patched") {
                capacity / 64 + u32::from(capacity % 64 != 0)
            } else {
                (capacity + 63) / 64
            };
            if word_count > BITMAP_WORDS {
                return Err(Abort::Error("InvalidBitmapIndex"));
            }
            s.bitmaps[issuer as usize] = Some(Bitmap { word_count, words: [0; BITMAP_WORDS as usize] });
            Ok(())
        })
    }

    /// `revoke_credential`
    pub fn revoke(&mut self, signer: Addr, issuer: Addr, cred: CredId, index: u32) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            // Contract: an existing record for `cred` is overwritten without
            // any check (findings RR-1 and RR-2).
            if cfg!(feature = "patched") {
                if let Some(existing) = s.records[cred as usize] {
                    if !existing.reversed {
                        return Err(Abort::Error("AlreadyRevoked"));
                    }
                    if existing.issuer != issuer {
                        return Err(Abort::Error("Unauthorized"));
                    }
                }
            }
            let bitmap = s.bitmaps[issuer as usize].as_mut().ok_or(Abort::Error("CredentialNotFound"))?;
            if index >= bitmap.word_count * 64 {
                return Err(Abort::Error("InvalidBitmapIndex"));
            }
            let (word_idx, bit_idx) = (index / 64, index % 64);
            let word = bitmap.word(word_idx)?;
            if (word >> bit_idx) & 1 == 1 {
                return Err(Abort::Error("AlreadyRevoked"));
            }
            bitmap.words[word_idx as usize] = word | (1u64 << bit_idx);
            s.records[cred as usize] = Some(Record { issuer, index, reversed: false });
            s.rev_count += 1;
            Ok(())
        })
    }

    /// `reverse_revocation`
    pub fn reverse(&mut self, signer: Addr, caller: Addr, cred: CredId) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, caller)?;
            s.require_not_paused()?;
            let mut record = s.records[cred as usize].ok_or(Abort::Error("RevocationNotFound"))?;
            if record.reversed {
                return Err(Abort::Error("CredentialNotRevoked"));
            }
            let admin = s.admin.ok_or(Abort::Error("NotInitialized"))?;
            if caller != record.issuer && caller != admin {
                return Err(Abort::Error("RevocationReversalUnauthorized"));
            }
            let bitmap =
                s.bitmaps[record.issuer as usize].as_mut().ok_or(Abort::Error("CredentialNotFound"))?;
            let (word_idx, bit_idx) = (record.index / 64, record.index % 64);
            let word = bitmap.word(word_idx)?;
            bitmap.words[word_idx as usize] = word & !(1u64 << bit_idx);
            record.reversed = true;
            s.records[cred as usize] = Some(record);
            if s.rev_count > 0 {
                s.rev_count -= 1;
            }
            Ok(())
        })
    }

    /// `is_revoked(issuer, index)`
    pub fn is_revoked(&self, issuer: Addr, index: u32) -> bool {
        self.bitmaps[issuer as usize].map_or(false, |b| b.is_set(index))
    }
}

#[derive(Clone, Copy, Debug)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Op {
    InitBitmap { issuer: Addr, capacity: u32 },
    Revoke { issuer: Addr, cred: CredId, index: u32 },
    Reverse { caller: Addr, cred: CredId },
}

impl Op {
    pub fn well_formed(&self) -> bool {
        match *self {
            Op::InitBitmap { issuer, .. } => valid_addr(issuer),
            Op::Revoke { issuer, cred, .. } => valid_addr(issuer) && (cred as usize) < CREDS,
            Op::Reverse { caller, cred } => valid_addr(caller) && (cred as usize) < CREDS,
        }
    }

    pub fn apply(self, r: &mut Registry, signer: Addr) -> CallResult {
        match self {
            Op::InitBitmap { issuer, capacity } => r.init_bitmap(signer, issuer, capacity),
            Op::Revoke { issuer, cred, index } => r.revoke(signer, issuer, cred, index),
            Op::Reverse { caller, cred } => r.reverse(signer, caller, cred),
        }
    }
}
