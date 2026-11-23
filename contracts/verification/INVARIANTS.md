# Invariants

An **invariant** holds in every reachable state. A **transition property**
relates the state before a call to the state after it, for every call and
every signer. Each entry is either proved inductively or shown to fail (see
[RESULTS.md](RESULTS.md)).

Notation: `signer` is the one address that authorised the call.

## identity-registry

| ID | Kind | Statement | Why it matters |
| --- | --- | --- | --- |
| INV-ID-1 | Invariant | `DID_COUNT` = the number of DIDs with `active = true` | Off-chain dashboards and `get_storage_stats` report it. Drift hides real state |
| INV-ID-2 | Invariant | If `PENDING_ADMIN` is set, the admin who proposed it is still the admin | A proposal must not outlive the authority that made it |
| TP-ID-1 | Access control | `ADMIN` changes only if `signer` = old admin, or `signer` = a pending admin nominated by the current admin | Contract ownership: upgrades, pause, reactivation |
| TP-ID-2 | Access control | A DID is created or deactivated only with `signer` = its controller, and reactivated only with `signer` = admin | Nobody can switch off another party's identity |
| TP-ID-3 | State | DID documents are never deleted | Resolvers and credential-manager rely on stable DIDs |
| TP-ID-4 | State | While `PAUSED`, the set of DIDs and their `active` flags do not change | The emergency stop really stops |
| TP-ID-5 | State | `initialize` succeeds at most once | Nobody can take over by re-initialising |

## credential-manager

| ID | Kind | Statement | Why it matters |
| --- | --- | --- | --- |
| INV-CM-1 | Invariant | `REVOKED_CNT` = the number of credentials with `revoked = true` | Reporting consistency |
| TP-CM-1 | Access control | A credential appears only if `signer` = its issuer, the issuer was registered, and the contract was unpaused | Only vetted issuers mint credentials |
| TP-CM-2 | State | `revoked` never goes from `true` to `false`, and credentials are never deleted | A revoked credential stays revoked |
| TP-CM-3 | Access control | `revoked` flips to `true` only if `signer` = issuer, or the credential has expired | Holders and third parties cannot revoke valid credentials |
| TP-CM-4 | Access control, state | `expires_at` changes only if `signer` = issuer, the credential is unrevoked, and the new value is strictly larger | Validity only moves forward, and only by its issuer |
| TP-CM-5 | Access control | `expires_at` changes only if `signer` is **currently** a registered issuer | Removing an issuer must end its power over validity |
| TP-CM-6 | Safety | `verify_credential` = Ok ⇒ the credential exists, is unrevoked, and `expires_at = 0 ∨ now ≤ expires_at` | Verifiers are never told an invalid credential is valid |
| TP-CM-7 | State | While paused, no credential changes | Emergency stop |
| TP-CM-8 | Access control | The issuer set and the pause flag change only if `signer` = admin | Only the admin governs issuers |

## revocation-registry

| ID | Kind | Statement | Why it matters |
| --- | --- | --- | --- |
| INV-RR-1 | Invariant | Every revocation record indexes inside its issuer's existing bitmap | This is what makes the `words.get(i).unwrap()` in `reverse_revocation` safe |
| INV-RR-2 | Invariant | Set bits ↔ active (non-reversed) records is a bijection, and `REV_COUNT` = the number of active records | Every revoked slot can be reversed, and the counts are truthful |
| TP-RR-1 | Safety | No call panics on bitmap indexing, and out-of-range indices return `InvalidBitmapIndex` | No trap-based denial of service |
| TP-RR-2 | Safety | `init_bitmap` has no arithmetic overflow for any `capacity` | A malformed input must not trap, or wrap with overflow checks off |
| TP-RR-3 | Access control | An active record changes only if `signer` = its issuer, or admin | Issuers cannot hijack each other's revocations |
| TP-RR-4 | Access control | A bit in issuer *I*'s bitmap is cleared only if `signer` = *I*, or admin | Un-revocation is privileged |

## governance

| ID | Kind | Statement | Why it matters |
| --- | --- | --- | --- |
| INV-GOV-1 | Invariant | `1 ≤ quorum_pct ≤ 100` and `1 ≤ threshold_pct ≤ 100` | This is what makes the threshold division safe |
| TP-GOV-1 | Safety | `execute_proposal` never divides by zero | No trap |
| TP-GOV-2 | State | Each address is counted at most once per proposal | One address, one vote |
| TP-GOV-3 | State | A proposal executes at most once, and only when `now ≥ voting_ends_at + timelock` | Timelock guarantee |
| TP-GOV-4 | Safety | The votes counted never exceed the total voting power | Quorum means what it says, and cannot be Sybil-attacked |
| TP-GOV-5 | State | After `delegate_vote(a → b)`, `a`'s vote adds nothing and `b` carries `a`'s weight | Delegation has an effect, and no weight is counted twice |
| TP-GOV-6 | Safety | Tallying and execution never overflow for any admin-settable weights | With overflow checks off, a wrap silently corrupts the tally |

## Cross-cutting

| ID | Statement |
| --- | --- |
| X-1 | Release builds of every contract compile with `overflow-checks = true`, so any overflow traps instead of wrapping. This is checked against the workspace configuration, not by Kani (see RESULTS.md) |
| X-2 | Every state-changing call is atomic: an `Err` return or a panic leaves storage untouched. This is assumed from the Soroban host and encoded as `atomically` in the models |
