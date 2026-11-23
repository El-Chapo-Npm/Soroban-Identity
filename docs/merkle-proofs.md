# Merkle Proofs for Credential Verification

This document describes the Merkle tree structure used for efficient batch
credential verification in the credential-manager contract, including the
hashing scheme, proof format, on-chain storage layout, incremental update
semantics, and gas optimization notes.

## Overview

Merkle trees allow a batch of credentials to be committed to a single 32-byte
root stored on-chain. Individual credentials can then be verified by supplying
a short Merkle proof (a list of sibling hashes) rather than the entire batch.
This reduces on-chain storage and verification gas costs significantly for
large credential batches.

## Tree Structure

### Leaves

Each credential in a batch is represented by a single leaf. The leaf value is
derived from the credential identifier:

```
leaf = sha256(credential_id)
```

Where `credential_id` is the canonical credential identifier (or the credential
hash, if the credential is stored by hash). The leaf is always 32 bytes.

Leaves are ordered by their position in the batch. The batch ordering is
deterministic and defined by the caller when the tree is generated; the
on-chain contract does not reorder leaves.

### Internal Nodes

Internal nodes are computed by concatenating the two child hashes in
left-to-right order and hashing the result using the existing `sha256`
convention used throughout the contract:

```
parent = sha256(left || right)
```

- `left` is the hash of the left child (or leaf).
- `right` is the hash of the right child (or leaf).
- Concatenation is byte-wise: `left` bytes followed by `right` bytes, for a
  total of 64 bytes before hashing.
- The hash function is `sha256`, matching the convention already used for
  credential hashing elsewhere in the contract.

The ordering is significant: `sha256(left || right)` is **not** equal to
`sha256(right || left)`. Proof verification must preserve the left/right
ordering supplied in the proof.

### Odd-Node Handling

When a level of the tree contains an odd number of nodes, the last node is
duplicated to form a pair with itself:

```
parent = sha256(last || last)
```

This "duplicate the last node" rule is applied at every level until a single
root remains. It ensures every level has an even number of nodes and the tree
is always well-defined for any batch size `n >= 1`.

Edge cases:

- `n == 0`: no tree is generated; the root is undefined and no proofs exist.
- `n == 1`: the root is the single leaf itself (`root = leaf`).

## Root Storage Layout

Merkle roots are stored on-chain keyed by batch identifier:

```
merkle_roots: Map<batch_id, root_hash>
```

- `batch_id`: a caller-supplied identifier for the credential batch.
- `root_hash`: the 32-byte Merkle root for that batch.

Only the root is stored on-chain; leaves and intermediate nodes are kept
off-chain by the caller/SDK. Storing a single 32-byte root per batch keeps
on-chain state minimal.

## Proof Format

A Merkle proof is an ordered list of sibling hashes, from the leaf level up to
(but not including) the root:

```
proof = [sibling_0, sibling_1, ..., sibling_{h-1}]
```

Each entry is a 32-byte hash. The proof length `h` equals the height of the
tree (the number of levels above the leaves).

Verification algorithm:

```
computed = leaf
for sibling in proof:
    if sibling is on the left:
        computed = sha256(sibling || computed)
    else:
        computed = sha256(computed || sibling)
return computed == stored_root
```

Because the left/right ordering matters, each proof entry must carry its
position (left or right) relative to the current node. Implementations may
encode this either as a parallel bit-vector (one bit per level) or as a
structured entry `{hash, position}`. The SDK proof format uses a parallel
bit-vector for compactness.

## Incremental Tree Updates

The tree supports incremental updates without recomputing the entire batch:

- **Appending a credential**: add the new leaf at the next position and
  recompute only the path from that leaf to the root. The updated root is
  written to `merkle_roots[batch_id]`.
- **Updating a credential**: replace the leaf at its position and recompute
  only the affected path to the root.
- **Removing a credential**: leaves are not removed in place; instead the
  batch is re-committed with a new root (or the leaf is replaced with a
  sentinel). This preserves the deterministic ordering of remaining leaves.

In all cases, only the `O(log n)` nodes along the affected path need to be
recomputed, and only the root is written on-chain. Proofs for unaffected
leaves remain valid as long as the root is unchanged.

## Gas Optimization Notes

- **Single root per batch**: only 32 bytes of on-chain state per batch,
  regardless of batch size.
- **Short proofs**: proof length is `O(log n)`, so verification cost grows
  logarithmically with batch size.
- **Fixed-size hashing**: each verification step hashes exactly 64 bytes,
  keeping per-step gas predictable.
- **No on-chain tree storage**: leaves and intermediate nodes live off-chain;
  the contract only stores and compares roots.
- **Batch root updates**: when many credentials change, recompute the tree
  off-chain and write a single new root rather than performing many on-chain
  updates.
- **Early exit**: verification can short-circuit on the first mismatch,
  avoiding unnecessary hashing.

## SDK Proof Generation

The SDK exposes a proof generation function:

```
generateMerkleProof(leaves: bytes32[], index: number): {
    proof: bytes32[],
    positions: boolean[],  // true = sibling on the left
    root: bytes32
}
```

Given the full list of leaves and the index of the target credential, the SDK
builds the tree using the rules above and returns the sibling hashes, their
positions, and the resulting root. The root can be compared against the
on-chain `merkle_roots[batch_id]` value before submitting a proof.

## Summary of Conventions

| Aspect            | Convention                                  |
| ----------------- | ------------------------------------------- |
| Hash function     | `sha256`                                    |
| Leaf              | `sha256(credential_id)`                     |
| Internal node     | `sha256(left \|\| right)`                   |
| Odd node          | duplicate last node: `sha256(last \|\| last)` |
| Root storage      | `merkle_roots[batch_id] = root`             |
| Proof format      | ordered sibling hashes + position bits      |
| Proof length      | `O(log n)`                                  |
| Incremental update| recompute affected path only                |