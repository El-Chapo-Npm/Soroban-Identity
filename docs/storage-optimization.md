# Contract storage optimization

This page records the storage audit for the Soroban contracts (#866), the changes made, the before/after measurements, and the patterns new contract code should follow.

## How Soroban storage is charged

The patterns below follow from what a transaction pays for:

- **Ledger entries touched.** Each persistent or temporary key is its own ledger entry. Every entry in the footprint costs a read, and every modified entry also costs a write. A write costs much more than a read.
- **Bytes read and written**, including the entry key.
- **Rent.** `extend_ttl` charges rent for the ledgers it adds and rewrites the entry's TTL record.
- **Host CPU instructions and memory**, including encoding and decoding every value.

**Instance storage** (`env.storage().instance()`) is a single ledger entry, the contract instance. It is loaded on every invocation, whatever the function reads. So every instance key adds bytes to every call, and packing several instance keys together doesn't reduce the number of entries touched.

## Audit

| Contract | Instance keys | Persistent entries | Findings |
|---|---|---|---|
| identity-registry | `ADMIN`, `PADMIN`, `PAUSED`, `DIDCNT`, `TOTDIDS` | `(IDENTITY, sha256(controller))` → `DidDocument` | `resolve_did` and `has_active_did` did `has()` + `extend_ttl()` + `get()` on the same key. TTL re-extended on every access. |
| schema-registry | `ADMIN`, `PADMIN`, `PAUSED`, `SCHCNT`, `TOTSCH` | `(SCHEMA, id)` → `SchemaDefinition`, `(ISSSCH, issuer)` → `Vec<id>` | `validate_claims` did `get()`, then `has()`, then `extend_ttl()`. TTL re-extended on every access. `TOTSCH` is written but never read. |
| revocation-registry | `ADMIN`, `PADMIN`, `PAUSED`, `REVCNT`, `TOTREV` | `(REVBM, issuer)` → `RevocationBitmap`, `(REVRSN, id)` → `RevocationRecord` | TTL re-extended on every access. `RevocationBitmap.word_count` duplicates `words.len()`. `TOTREV` is written but never read. |
| selective-disclosure | `ADMIN`, `PADMIN`, `PAUSED`, `DISCNT`, `TOTDISC` | `(COMMIT, id)`, `(CRED2CMT, credential_id)`, `(PROOF, id)` | TTL re-extended on every access. `TOTDISC` is written but never read. |
| credential-manager | ~15, including `CFG` (packed `max_issuers` + `is_paused`, #661) | credential, per-subject / per-issuer / per-type ID lists, revocation records, reason indexes, prerequisite graph, delegations | TTL re-extended on every access (27 call sites). Several `has()`-then-`get()` pairs. Per-issuer ID lists grow to 10 000 entries, and each issuance rewrites the whole list. **Not changed here:** the crate does not compile on `main` (see #856). |
| reputation | `ADMIN`, `PADMIN`, `REPORTER` list, `PAUSED`, counters, config | `(rec, subject)`, `(h, subject)` history | `REPORTER` is an instance-storage list read on every call. **Not changed here:** the crate does not compile on `main`. |
| governance | `ADMIN`, `QUORUM`, `THRSH`, `TIMELOCK`, `PROSEQ`, **`VPOWER` map, `(PROPOS, id)`, `(DELEG, voter)`** | none | **High priority.** Proposals, delegations and the voting-power map are all kept in *instance* storage. Every call loads all of them, the instance entry grows with each proposal, and it will eventually hit the ledger entry size limit and brick the contract. They belong in persistent storage. **Not changed here:** the crate does not compile on `main`. |

## Changes in this pass

Both changes apply to identity-registry, schema-registry, revocation-registry and selective-disclosure. They don't change any stored value or key, so no migration is needed and existing deployments keep working.

1. **One read instead of `has()` + `get()`.** `get()` already returns `None` for a missing entry, so checking `has()` first was a second lookup of the same key. The TTL is now extended only after a successful read.
2. **TTL bump threshold.** Every `extend_ttl(key, MAX, MAX)` became `extend_ttl(key, TTL_BUMP_THRESHOLD, MAX)`, where `TTL_BUMP_THRESHOLD = MAX - 518_400` (about 30 days of ledgers).
   - Before, the threshold equalled the target. Because an entry's TTL drops by one every ledger, almost every access re-extended it, paying rent and rewriting its TTL record.
   - Now an entry that is used often is extended at most about once every 30 days, and it never has less than about 11 months left.
   - New entries still start at the full TTL.

## Measurements

Soroban host budget for one invocation, measured in native test mode (soroban-sdk 21.7.7, Rust 1.85):
- Each operation runs in steady state: counters exist, and reads happen 100 ledgers after the entry was written.
- "CPU" is host CPU instructions and "memory" is host memory bytes.
- These numbers leave out wasm execution and the ledger fees for entries, bytes and rent. The TTL change mostly saves on those fees, so its real saving is larger than shown.

| Operation | CPU before | CPU after | Δ CPU | Memory before | Memory after | Δ memory |
|---|---:|---:|---:|---:|---:|---:|
| `identity/create_did` | 92,504 | 92,504 | +0.0% | 13,113 | 13,113 | +0.0% |
| `identity/update_did` | 108,192 | 106,523 | -1.5% | 13,826 | 13,334 | -3.6% |
| `identity/resolve_did` | 59,461 | 55,108 | -7.3% | 6,810 | 6,386 | -6.2% |
| `identity/has_active_did` | 53,546 | 49,193 | -8.1% | 6,295 | 5,871 | -6.7% |
| `identity/has_active_did` (no DID) | 39,330 | 34,547 | -12.2% | 5,300 | 4,876 | -8.0% |
| `identity/get_storage_stats` | 22,629 | 22,629 | +0.0% | 3,138 | 3,138 | +0.0% |
| `identity/deactivate_did` | 107,823 | 107,823 | +0.0% | 15,436 | 15,436 | +0.0% |
| `schema/register_schema` | 139,796 | 139,796 | +0.0% | 19,863 | 19,863 | +0.0% |
| `schema/validate_claims` | 61,109 | 54,508 | -10.8% | 6,758 | 5,842 | -13.6% |
| `schema/register_schema_version` | 181,751 | 179,658 | -1.2% | 24,594 | 23,966 | -2.6% |
| `schema/get_schema` | 60,242 | 60,242 | +0.0% | 6,455 | 6,455 | +0.0% |
| `schema/get_schema_count` | 18,941 | 18,941 | +0.0% | 2,894 | 2,894 | +0.0% |
| `revocation/revoke_credential` | 109,978 | 108,360 | -1.5% | 17,215 | 16,723 | -2.9% |
| `revocation/revoke_credentials_batch` (2 IDs) | 162,009 | 162,009 | +0.0% | 24,642 | 24,642 | +0.0% |
| `revocation/reverse_revocation` | 138,298 | 138,298 | +0.0% | 20,146 | 20,146 | +0.0% |
| `revocation/get_revocation_count` | 18,993 | 18,993 | +0.0% | 3,102 | 3,102 | +0.0% |
| `selective/create_commitment` | 126,660 | 126,660 | +0.0% | 19,123 | 19,123 | +0.0% |
| `selective/get_commitment` | 57,349 | 55,375 | -3.4% | 6,512 | 5,952 | -8.6% |
| `selective/get_disclosure_count` | 18,637 | 18,637 | +0.0% | 2,832 | 2,832 | +0.0% |

No operation got more expensive. The identity-registry criterion suite (`cargo bench -p identity-registry --bench registry`, run by the Benchmarks workflow) now also prints the steady-state budget for `resolve_did`, `has_active_did` and `update_did` read 100 ledgers after the write, so regressions in this path show up in CI.

### Measured and rejected: packing counters in instance storage

Each contract keeps two counters (active and total) under separate instance keys that are always written together. Packing them into one `(u32, u32)` instance entry looked like the obvious fix, so it was implemented and measured first. **It made every counter operation 1–6% more expensive in CPU**, for example `get_revocation_count` went from 18,993 to 20,111 and `create_did` from 92,504 to 94,340. It saved only about 4 bytes of the instance entry, because:

- a `u32` is a small immediate value, while a tuple is a host vector object that has to be allocated and encoded;
- all instance keys already share one ledger entry.

The change was dropped. Pack values only when that removes a *persistent* entry from the footprint.

## Patterns for new contract code

- **Read once.** Call `get()` and branch on the `Option`. Don't call `has()` before `get()` or `extend_ttl()` on the same key. Use `has()` only when you don't need the value.
- **Use a bump threshold below the target.** Write `extend_ttl(key, TTL_BUMP_THRESHOLD, TTL_MAX)`, not `extend_ttl(key, TTL_MAX, TTL_MAX)`.
- **Keep instance storage small and bounded.** Use it only for contract-wide configuration read on most calls (admin, pause flag, small config). Never put per-user or per-item data, or collections that grow, in instance storage. Use persistent keys instead.
- **Pack persistent data that is always read and written together** into one entry, to save an entry per transaction. Don't pack instance values, and don't pack data with different access patterns or lifetimes (for example a hot bitmap and a rarely-read audit record).
- **Keys:**
  - `symbol_short!` symbols (up to 9 characters) are immediate values that need no allocation, so prefer them to `Symbol::new` and to `String` keys.
  - Tuple keys like `(Symbol, Address)` or `(Symbol, BytesN<32>)` are compact.
  - Avoid hashing just to build a key when the input (such as an `Address`) is already a valid key: identity-registry spends a SHA-256 and an XDR encode on every DID lookup. Changing an existing key means migrating stored data, so treat it as a planned migration, not a refactor.
- **Changing the shape of stored data breaks decoding.** Adding or removing a field on a stored `#[contracttype]` struct makes existing entries fail to decode. Add new state as a separate entry, or ship a migration.
- **Don't store what can be derived**, such as a length next to the vector it describes, or a string built from another stored field. Removing such fields from existing types needs a migration, so get it right when a type is introduced.
- **Avoid write-only data.** A counter that nothing reads still costs a write on every call.
- **Bound per-key collections.** A `Vec` under one key is rewritten in full on every append, so a list that grows makes every append slower.

## Follow-ups not done here

These need a data migration, a redesign, or a contract that compiles on `main` first:

- **governance:** move proposals, delegations and voting power from instance storage to persistent storage.
- **credential-manager, reputation:** apply the two changes above once the crates compile (#856 restores credential-manager).
- **identity-registry:** key DIDs by `Address` instead of `sha256(xdr(address))`, and drop the derivable `DidDocument.id` string (68 bytes per DID). Both require a migration.
- **revocation-registry:** drop `RevocationBitmap.word_count` (derivable from `words.len()`). Requires a migration.
- **Write-only totals** (`TOTSCH`, `TOTREV`, `TOTDISC`): either expose them through a getter or stop writing them.
