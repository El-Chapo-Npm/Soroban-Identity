# Specifications

Each specification pairs a contract function's pre/postconditions with the
Kani harness that checks it. The invariant IDs refer to
[INVARIANTS.md](INVARIANTS.md).

**Harness style.** *Inductive* harnesses start from an arbitrary state that
satisfies the invariant, apply one arbitrary call from an arbitrary signer,
and check that the invariant still holds. *Trace* harnesses run a fixed call
sequence with symbolic arguments.

**Model bounds.** 4 addresses, 3 credential ids, 2 bitmap words (128 slots),
1 governance proposal, and ledger time < 2⁶². A bug that needs more than 4
distinct addresses or 3 credentials would be missed, but every function
touches at most 2 addresses and 1 credential per call, so these bounds cover
all the interleavings that matter.

## identity-registry

| Spec | Function(s) | Pre → Post | Harness | Style | Invariant |
| --- | --- | --- | --- | --- | --- |
| S-ID-1 | `initialize` | `ADMIN` set → call fails, state unchanged | `id_initialize_once` | Direct | TP-ID-5 |
| S-ID-2 | all | `DID_COUNT = #active` → same after any call | `id_did_count_matches_active` | Inductive | INV-ID-1 |
| S-ID-3 | `transfer_admin`, `propose_admin`, `accept_admin` | pending ⇒ nominated by current admin, preserved by every call | `id_pending_admin_nominated_by_current_admin` | Inductive | INV-ID-2 |
| S-ID-3a | same | A proposes B; A transfers to C; B's `accept_admin` leaves `ADMIN = C` | `id_stale_proposal_cannot_seize_admin` | Trace | INV-ID-2 |
| S-ID-4 | all | `ADMIN` changed ⇒ `signer` = old admin ∨ (`signer` = pending ∧ nominator = admin) | `id_admin_change_is_authorised` | Inductive | TP-ID-1 |
| S-ID-5 | all | `PAUSED` → DIDs and count unchanged | `id_pause_freezes_dids` | Inductive | TP-ID-4 |
| S-ID-6 | `create_did`, `deactivate_did`, `reactivate_did` | None→Some or active→inactive ⇒ `signer` = controller; inactive→active ⇒ `signer` = admin; never Some→None | `id_did_transitions_are_authorised` | Inductive | TP-ID-2, TP-ID-3 |

## credential-manager

| Spec | Function(s) | Pre → Post | Harness | Style | Invariant |
| --- | --- | --- | --- | --- | --- |
| S-CM-1 | `issue_credential` | New credential ⇒ `signer` = issuer ∧ issuer registered ∧ ¬paused ∧ ¬revoked | `cm_issuance_requires_registered_issuer` | Inductive | TP-CM-1 |
| S-CM-2 | all | revoked ⇒ still revoked; issuer and subject immutable; never deleted | `cm_revocation_is_permanent` | Inductive | TP-CM-2 |
| S-CM-3 | `revoke_credential`, `expire_credential` | ¬revoked → revoked ⇒ `signer` = issuer ∨ (`expires_at` ≠ 0 ∧ `now` > `expires_at`) | `cm_revocation_is_authorised` | Inductive | TP-CM-3 |
| S-CM-4 | `renew_credential` | `expires_at` changed ⇒ `signer` = issuer ∧ new > old ∧ ¬revoked | `cm_renewal_is_authorised_and_monotonic` | Inductive | TP-CM-4 |
| S-CM-5 | `renew_credential` | `expires_at` changed ⇒ `signer` ∈ registered issuers | `cm_deregistered_issuer_cannot_extend_validity` | Inductive | TP-CM-5 |
| S-CM-6 | `verify_credential` | Ok ⇒ exists ∧ ¬revoked ∧ (`expires_at` = 0 ∨ `now` ≤ `expires_at`) | `cm_verify_is_sound` | Direct | TP-CM-6 |
| S-CM-7 | all | paused → credentials unchanged | `cm_pause_freezes_credentials` | Inductive | TP-CM-7 |
| S-CM-8 | all | `REVOKED_CNT = #revoked` preserved | `cm_revoked_count_matches` | Inductive | INV-CM-1 |
| S-CM-9 | `add_issuer`, `remove_issuer`, `pause`, `unpause` | issuers or paused changed ⇒ `signer` = admin | `cm_admin_controls_are_admin_only` | Inductive | TP-CM-8 |

## revocation-registry

| Spec | Function(s) | Pre → Post | Harness | Style | Invariant |
| --- | --- | --- | --- | --- | --- |
| S-RR-1 | all | INV-RR-1 → no `Panic` result, and INV-RR-1 still holds | `rr_no_index_panic` | Inductive | TP-RR-1, INV-RR-1 |
| S-RR-2 | `init_bitmap` | Any `capacity` → no overflow | `rr_init_bitmap_capacity_no_overflow` | Direct | TP-RR-2 |
| S-RR-3 | `revoke_credential`, `reverse_revocation` | bits ↔ active records bijection ∧ `REV_COUNT` = #active, preserved | `rr_bits_records_and_count_agree` | Inductive | INV-RR-2 |
| S-RR-4 | `revoke_credential` | Active record changed ⇒ `signer` = its issuer ∨ admin | `rr_record_owned_by_issuer` | Inductive | TP-RR-3 |
| S-RR-5 | `reverse_revocation` | Bit cleared in issuer *I*'s bitmap ⇒ `signer` = *I* ∨ admin | `rr_only_issuer_or_admin_clears` | Inductive | TP-RR-4 |

## governance

| Spec | Function(s) | Pre → Post | Harness | Style | Invariant |
| --- | --- | --- | --- | --- | --- |
| S-GOV-1 | `execute_proposal` | INV-GOV-1 → no division by zero | `gov_execute_never_divides_by_zero` | Direct | TP-GOV-1 |
| S-GOV-2 | `vote` | A successful vote → a second vote by the same address fails and leaves the tally unchanged | `gov_single_vote_per_address` | Direct | TP-GOV-2 |
| S-GOV-3 | `execute_proposal` | Ok ⇒ previously unexecuted ∧ `now` ≥ end + timelock; a second call fails | `gov_execution_once_and_after_timelock` | Direct | TP-GOV-3 |
| S-GOV-4 | `vote`, `total_voting_power` | Every address votes once → yes + no ≤ total power | `gov_tally_bounded_by_total_power` | Trace | TP-GOV-4 |
| S-GOV-5 | `delegate_vote`, `vote` | a→b delegated → a's vote adds 0, and b's vote adds w_a + w_b | `gov_delegation_moves_voting_power` | Trace | TP-GOV-5 |
| S-GOV-6 | `set_voting_weights`, `vote`, `execute_proposal` | Any settable weights → no overflow anywhere | `gov_no_arithmetic_overflow` | Trace | TP-GOV-6 |

## Assumptions

1. **The Soroban host is correct.** `require_auth` traps for an address that
   did not sign, failed calls revert all writes, and storage reads return the
   last write.
2. **The cross-contract `has_active_did` is honest.** credential-manager treats
   it as an oracle, and its correctness is S-ID-6 plus TP-ID-4 on the
   identity-registry side.
3. **Omitted features only add rejections.** Metadata limits, schemas, claims,
   proofs of possession, dependency cascades, and activation time locks can
   each make a call fail, but none can make a call succeed that the model
   rejects. The one exception is cascade revocation, which revokes *more*
   credentials, and S-CM-2 is still satisfied by it.
