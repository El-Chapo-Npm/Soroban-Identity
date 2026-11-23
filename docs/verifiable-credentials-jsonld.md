# Verifiable Credentials (JSON-LD)

The server stores credentials in a compact internal shape that is convenient
for this codebase and meaningless to anyone else. The [W3C Verifiable
Credentials Data Model][vc-data-model] is the interchange format: expressing a
credential in it lets any conforming wallet or verifier consume one of ours
without bespoke code.

[vc-data-model]: https://www.w3.org/TR/vc-data-model/

Both representations exist side by side:

```jsonc
// internal — the storage format, unchanged
{
  "id": "cred-123",
  "subject": "GABC...",
  "issuer": "GISSUER...",
  "type": "KycCredential",
  "claims": { "level": "full", "country": "NG" },
  "issuedAt": 1700000000,
  "expiresAt": 1800000000,
  "revoked": false
}
```

```jsonc
// JSON-LD — the interchange format
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "id": "urn:credential:cred-123",
  "type": ["VerifiableCredential", "KycCredential"],
  "issuer": "did:stellar:GISSUER...",
  "issuanceDate": "2023-11-14T22:13:20.000Z",
  "expirationDate": "2027-01-15T08:00:00.000Z",
  "credentialSubject": {
    "id": "did:stellar:GABC...",
    "level": "full",
    "country": "NG"
  },
  "credentialStatus": {
    "id": "urn:credential:cred-123/status",
    "type": "SorobanCredentialStatus2024"
  }
}
```

## Requesting the JSON-LD form

It is **opt-in**, so existing clients keep receiving the compact shape they
already parse. Ask for it either way:

```console
$ curl -H 'Accept: application/ld+json' https://api.example.org/credentials/cred-123
$ curl 'https://api.example.org/credentials/cred-123?format=jsonld'
```

`Accept` is the correct mechanism; the query parameter exists because a browser
address bar cannot set a header. Both are honoured on `GET /credentials`,
`GET /credentials/:id`, and on the `201` response from `POST /credentials`.

Responses are served as `application/ld+json`.

## Identifiers

The data model requires `issuer` and `credentialSubject.id` to be URIs, and a
bare Stellar account is not one. Accounts are therefore expressed as
`did:stellar:<account>`; a value that is already a DID is passed through
unchanged.

Credential `id`s default to `urn:credential:<id>`. Set `VC_BASE_URL` to make
them resolvable instead:

```
VC_BASE_URL=https://api.example.org
→ "id": "https://api.example.org/credentials/cred-123"
```

A resolvable id is worth setting in production: it lets a verifier fetch the
credential — and its status — from the issuer rather than trusting the copy it
was handed.

## Credential status

Every credential carries a `credentialStatus` entry pointing back at the
issuer, and the endpoint behind it is public:

```console
$ curl https://api.example.org/credentials/cred-123/status
```

```json
{
  "id": "/credentials/cred-123/status",
  "type": "SorobanCredentialStatus2024",
  "credentialId": "cred-123",
  "status": "active",
  "revoked": false,
  "expired": false,
  "expiresAt": 1800000000,
  "checkedAt": "2026-08-27T12:00:00.000Z"
}
```

`status` is one of `active`, `expired` or `revoked`. **Revocation takes
precedence over expiry**: a credential that was revoked and has since expired
reports `revoked`, because that is the fact a verifier needs to act on.

A credential with `expiresAt` of `0` never expires.

## Proofs

Proofs use `DataIntegrityProof` with the **`eddsa-jcs-2022`** cryptosuite:

```json
"proof": {
  "type": "DataIntegrityProof",
  "cryptosuite": "eddsa-jcs-2022",
  "created": "2026-08-27T12:00:00.000Z",
  "verificationMethod": "did:stellar:GISSUER...#key-1",
  "proofPurpose": "assertionMethod",
  "proofValue": "z3MvGcVxzRzzpKF1H..."
}
```

### Why this cryptosuite

A signature is over bytes, but a credential is an object, and two encoders can
serialize the same object differently — key order, whitespace, how a number is
rendered. Any of those differences breaks the signature, so the document has to
be canonicalized first.

The two registered options canonicalize differently. `eddsa-rdfc-2022` uses
JSON-LD's URDNA2015, which requires a full JSON-LD processor and resolves
`@context` documents over the network. `eddsa-jcs-2022` uses JCS
([RFC 8785][rfc8785]), which is self-contained and deterministic.

[rfc8785]: https://www.rfc-editor.org/rfc/rfc8785

This server implements the JCS suite. Both are W3C-registered, but only one is
implementable correctly here without a dependency — and a wrong
canonicalization is worse than no proof at all, because it produces signatures
that silently fail to verify elsewhere.

The signature covers `SHA256(canonical proof options) || SHA256(canonical
document)`. Hashing the proof's own metadata separately is what binds it to the
document: neither the credential nor the proof's purpose or verification method
can be swapped after signing.

### Signing key

Set `VC_PROOF_PRIVATE_KEY` to a 32-byte Ed25519 seed, hex or base64:

```bash
# generate one
$ openssl genpkey -algorithm ed25519 -outform DER \
    | tail -c 32 | xxd -p -c 64
```

Without a key, credentials are emitted **unsigned**. They remain anchored
on-chain, which is the project's primary integrity mechanism, and that is a
more honest outcome than attaching a fabricated proof. An invalid key is
logged at startup and degrades to the same unsigned mode rather than taking the
deployment down over an optional feature.

`verificationMethod` defaults to `<issuer DID>#key-1`. Override it with
`VC_PROOF_VERIFICATION_METHOD` when the key is published somewhere else.

## Multiple contexts

The base context always comes first — the ordering is normative, since a
context appearing before it could redefine its terms. Additional contexts are
appended from two places, and de-duplicated:

- **Deployment-wide** — `VC_EXTRA_CONTEXTS`, a comma-separated list.
- **Per credential** — a `metadata.["@context"]` array on the stored record.

Both apply together, so a house vocabulary and a credential-specific one can
coexist.

To emit v2 credentials, set `VC_BASE_CONTEXT` to
`https://www.w3.org/ns/credentials/v2`. The date properties change with it:
v2 uses `validFrom`/`validUntil` where v1 uses `issuanceDate`/`expirationDate`,
and emitting the wrong pair for the declared context makes the credential
invalid against its own schema.

## Expansion and compaction

`expandCredential` rewrites terms to their full IRIs and `compactCredential`
reverses it, which is what lets two credentials be compared for semantic
equality regardless of which context aliases they were written with.

> **Scope.** These are deliberately narrow: they cover the closed set of terms
> this server emits, using a fixed term table. They do **not** fetch remote
> contexts, and are not a general JSON-LD processor. Terms outside the table
> are left under their original key rather than silently dropped. For full
> JSON-LD processing, run the output through a library such as `jsonld.js`.

## Validation

`validateVerifiableCredential` checks a credential against the structural
requirements of the data model and returns **every** problem rather than the
first, so a hand-written credential can be fixed in one pass:

```js
const { valid, errors } = validateVerifiableCredential(credential);
```

It checks that the base context comes first, that `type` includes
`VerifiableCredential`, that `issuer` is a URI (or an object with one), that
the context-appropriate date property is present and parseable, that
`credentialSubject` carries at least one claim, and that any `proof` names its
type, purpose and verification method.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VC_BASE_CONTEXT` | `https://www.w3.org/2018/credentials/v1` | Base context; set to the v2 URI for v2 credentials |
| `VC_EXTRA_CONTEXTS` | — | Extra contexts appended to every credential, comma-separated |
| `VC_BASE_URL` | — | Makes credential and status ids resolvable https URLs |
| `VC_PROOF_PRIVATE_KEY` | — | 32-byte Ed25519 seed (hex or base64). Unset means unsigned |
| `VC_PROOF_VERIFICATION_METHOD` | `<issuer DID>#key-1` | Where the public key can be found |

## Verifying a credential elsewhere

1. Check the structure — see [Validation](#validation).
2. Fetch `credentialStatus.id` and confirm `status` is `active`.
3. Verify the proof: canonicalize the credential without its `proof`, and the
   proof options without `proofValue`, SHA-256 each, concatenate in that order,
   and check the Ed25519 signature (`proofValue`, base58btc after the leading
   `z`) against the key named by `verificationMethod`.

Steps 1 and 2 matter even when a proof verifies: a signature proves the issuer
authored the credential, not that the credential is still valid today.
