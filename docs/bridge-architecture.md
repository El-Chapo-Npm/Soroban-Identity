# Cross-chain DID bridge

Issue #818. `contracts/bridge` lets a Stellar contract check a DID document
committed for Ethereum or Polygon without embedding a light client.

## Trust model

Soroban cannot verify Ethereum or Polygon consensus, account proofs, or
Patricia-Merkle state. This contract does not do that. An authorized oracle
publishes a SHA-256 Merkle root for chain id `1` (Ethereum) or `137`
(Polygon). A caller then proves that
`sha256(xdr(did) || xdr(document))` sits under that root.

The oracle is the trust anchor. A dishonest oracle can publish a root for
documents the source chain never produced. There is no on-chain challenge
period. `publish_state_root` takes a `valid_until` timestamp so a root cannot
be used after the oracle's stated expiry. Production adapters must publish a
root only after they have checked source-chain finality themselves.

The hash is SHA-256 because that is the hash the Soroban host exposes for
this proof. It is not keccak and it is not an Ethereum MPT proof. Callers
must not treat a successful `resolve_external_did` as source-chain finality.

## Calls

- `initialize(admin, oracle)` — once. A second call returns `Unauthorized`.
- `set_chain(admin, chain_id, name, active)` — admin. Only chain ids `1` and `137`.
- `publish_state_root(oracle, chain_id, root, valid_until)` — oracle auth. `valid_until` must be in the future.
- `resolve_external_did(resolver, chain_id, did_identifier, document, siblings, sibling_on_left)` — resolver auth.
- `get_cached_did(chain_id, did_identifier)` — `None` when missing or expired.
- `get_chain(chain_id)` — errors when the chain was not registered or is inactive.

A cache hit returns the stored document and does not re-check the proof.
Cache lifetime is the earlier of 24 hours and the root's `valid_until`.
A failed proof does not write a cache entry.

## Rate limit

Each resolver may complete 20 resolutions per 60 seconds. Cache hits count.
A call that returns an error reverts, so a rejected proof does not consume
the budget. The counter is persistent storage.

## Events

`bridge/resolved` carries the event version, resolver, chain id, and DID
identifier. The document body is not an event topic.

## Tests

`cargo test -p did-bridge` uses `mock_all_auths` as the oracle and the
resolver. Nothing in the suite dials Ethereum or Polygon.
