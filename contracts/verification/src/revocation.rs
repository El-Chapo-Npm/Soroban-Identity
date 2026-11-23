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

/// Maximum number of indices accepted by a single `revoke_batch` call.
pub const MAX_BATCH: usize = 4;
/// Number of reason codes the contract understands (0 = unspecified).
pub const REASON_CODES: u8 = 4;
/// Depth of the revocation merkle tree over bitmap words.
pub const MERKLE_DEPTH: u32 = 2;

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
    /// Reason code attached at revocation time (0 = unspecified).
    pub reason: u8,
}

/// Statistics counters exposed by `revocation_stats`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Stats {
    /// Total revocations ever recorded (including reversed ones).
    pub total: u32,
    /// Currently active (non-reversed) revocations.
    pub active: u32,
    /// Number of batch calls performed.
    pub batches: u32,
    /// Number of indices revoked through batch calls.
    pub batch_revoked: u32,
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
    /// `REV_TOTAL`: revocations ever recorded.
    pub rev_total: u32,
    /// `REV_BATCHES`: number of batch calls performed.
    pub rev_batches: u32,
    /// `REV_BATCH_COUNT`: indices revoked through batch calls.
    pub rev_batch_count: u32,
}

impl Registry {
    pub fn well_formed(&self) -> bool {
        self.admin.map_or(true, valid_addr)
            && self.bitmaps.iter().flatten().all(|b| b.word_count <= BITMAP_WORDS)
            && self.records.iter().flatten().all(|r| valid_addr(r.issuer) && r.reason < REASON_CODES)
            && self.rev_count <= self.rev_total
            && self.rev_batch_count <= self.rev_total
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
        self.revoke_with_reason(signer, issuer, cred, index, 0)
    }

    /// `revoke_credential_with_reason`
    pub fn revoke_with_reason(
        &mut self,
        signer: Addr,
        issuer: Addr,
        cred: CredId,
        index: u32,
        reason: u8,
    ) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            if reason >= REASON_CODES {
                return Err(Abort::Error("InvalidReasonCode"));
            }
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
            s.records[cred as usize] = Some(Record { issuer, index, reversed: false, reason });
            s.rev_count += 1;
            s.rev_total += 1;
            Ok(())
        })
    }

    /// `revoke_batch`: revoke up to `MAX_BATCH` indices for one issuer.
    ///
    /// The whole batch is atomic: if any index is invalid or already revoked,
    /// nothing is applied.
    pub fn revoke_batch(
        &mut self,
        signer: Addr,
        issuer: Addr,
        creds: &[CredId],
        indices: &[u32],
        reason: u8,
    ) -> CallResult {
        atomically(self, |s| {
            require_auth(signer, issuer)?;
            s.require_not_paused()?;
            if reason >= REASON_CODES {
                return Err(Abort::Error("InvalidReasonCode"));
            }
            if creds.len() != indices.len() || creds.is_empty() || creds.len() > MAX_BATCH {
                return Err(Abort::Error("InvalidBatchSize"));
            }
            let bitmap = s.bitmaps[issuer as usize].as_mut().ok_or(Abort::Error("CredentialNotFound"))?;
            for i in 0..creds.len() {
                let index = indices[i];
                if index >= bitmap.word_count * 64 {
                    return Err(Abort::Error("InvalidBitmapIndex"));
                }
                let (word_idx, bit_idx) = (index / 64, index % 64);
                let word = bitmap.word(word_idx)?;
                if (word >> bit_idx) & 1 == 1 {
                    return Err(Abort::Error("AlreadyRevoked"));
                }
                bitmap.words[word_idx as usize] = word | (1u64 << bit_idx);
            }
            for i in 0..creds.len() {
                s.records[creds[i] as usize] =
                    Some(Record { issuer, index: indices[i], reversed: false, reason });
            }
            s.rev_count += creds.len() as u32;
            s.rev_total += creds.len() as u32;
            s.rev_batches += 1;
            s.rev_batch_count += creds.len() as u32;
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

    /// `revocation_stats(issuer)`: aggregate counters for an issuer's bitmap.
    pub fn stats(&self, issuer: Addr) -> Stats {
        let active = self
            .records
            .iter()
            .flatten()
            .filter(|r| r.issuer == issuer && !r.reversed)
            .count() as u32;
        Stats {
            total: self.rev_total,
            active,
            batches: self.rev_batches,
            batch_revoked: self.rev_batch_count,
        }
    }

    /// `revocation_proof(issuer, index)`: merkle proof over bitmap words.
    ///
    /// Returns the sibling hashes from the leaf word up to the root. The
    /// contract builds a binary tree of depth `MERKLE_DEPTH` over the bitmap
    /// words; missing words hash as zero.
    pub fn revocation_proof(&self, issuer: Addr, index: u32) -> CallResult<[u64; MERKLE_DEPTH as usize]> {
        let bitmap = self.bitmaps[issuer as usize].ok_or(Abort::Error("CredentialNotFound"))?;
        let word_idx = index / 64;
        if word_idx >= bitmap.word_count {
            return Err(Abort::Error("InvalidBitmapIndex"));
        }
        let mut proof = [0u64; MERKLE_DEPTH as usize];
        let mut node = word_idx;
        for level in 0..MERKLE_DEPTH {
            let sibling = node ^ 1;
            proof[level as usize] = if sibling < bitmap.word_count {
                bitmap.words[sibling as usize]
            } else {
                0
            };
            node /= 2;
        }
        Ok(proof)
    }

    /// `verify_revocation_proof`: recompute the root from the leaf word and
    /// compare it against the stored root.
    pub fn verify_revocation_proof(
        &self,
        issuer: Addr,
        index: u32,
        proof: &[u64; MERKLE_DEPTH as usize],
    ) -> bool {
        let bitmap = match self.bitmaps[issuer as usize] {
            Some(b) => b,
            None => return false,
        };
        let word_idx = index / 64;
        if word_idx >= bitmap.word_count {
            return false;
        }
        let mut node = word_idx;
        let mut acc = bitmap.words[word_idx as usize];
        for level in 0..MERKLE_DEPTH {
            let sibling = proof[level as usize];
            acc = if node & 1 == 0 {
                hash_pair(acc, sibling)
            } else {
                hash_pair(sibling, acc)
            };
            node /= 2;
        }
        acc == merkle_root(&bitmap)
    }
}

/// Deterministic pairing hash used by the revocation merkle tree.
fn hash_pair(left: u64, right: u64) -> u64 {
    left.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ right.rotate_left(17)
}

/// Root of the merkle tree over a bitmap's words.
pub fn merkle_root(bitmap: &Bitmap) -> u64 {
    let mut nodes = [0u64; BITMAP_WORDS as usize];
    for i in 0..BITMAP_WORDS as usize {
        nodes[i] = if (i as u32) < bitmap.word_count { bitmap.words[i] } else { 0 };
    }
    let mut width = BITMAP_WORDS as usize;
    while width > 1 {
        let mut i = 0;
        while i < width / 2 {
            nodes[i] = hash_pair(nodes[2 * i], nodes[2 * i + 1]);
            i += 1;
        }
        width /= 2;
    }
    nodes[0]
}

#[derive(Clone, Copy, Debug)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Op {
    InitBitmap { issuer: Addr, capacity: u32 },
    Revoke { issuer: Addr, cred: CredId, index: u32 },
    RevokeWithReason { issuer: Addr, cred: CredId, index: u32, reason: u8 },
    RevokeBatch { issuer: Addr, creds: [CredId; MAX_BATCH], indices: [u32; MAX_BATCH], len: u8, reason: u8 },
    Reverse { caller: Addr, cred: CredId },
}

impl Op {
    pub fn well_formed(&self) -> bool {
        match *self {
            Op::InitBitmap { issuer, .. } => valid_addr(issuer),
            Op::Revoke { issuer, cred, .. } => valid_addr(issuer) && (cred as usize) < CREDS,
            Op::RevokeWithReason { issuer, cred, reason, .. } => {
                valid_addr(issuer) && (cred as usize) < CREDS && reason < REASON_CODES
            }
            Op::RevokeBatch { issuer, creds, len, reason, .. } => {
                valid_addr(issuer)
                    && (len as usize) <= MAX_BATCH
                    && reason < REASON_CODES
                    && creds[..(len as usize)].iter().all(|c| (*c as usize) < CREDS)
            }
            Op::Reverse { caller, cred } => valid_addr(caller) && (cred as usize) < CREDS,
        }
    }

    pub fn apply(self, r: &mut Registry, signer: Addr) -> CallResult {
        match self {
            Op::InitBitmap { issuer, capacity } => r.init_bitmap(signer, issuer, capacity),
            Op::Revoke { issuer, cred, index } => r.revoke(signer, issuer, cred, index),
            Op::RevokeWithReason { issuer, cred, index, reason } => {
                r.revoke_with_reason(signer, issuer, cred, index, reason)
            }
            Op::RevokeBatch { issuer, creds, indices, len, reason } => {
                let n = len as usize;
                r.revoke_batch(signer, issuer, &creds[..n], &indices[..n], reason)
            }
            Op::Reverse { caller, cred } => r.reverse(signer, caller, cred),
        }
    }
}
