# HMAC Request Signing

An API key proves *who* is calling. It does not prove that the request arrived
as it was sent, and it does not stop someone who captured a request from
sending it again. Request signing closes both gaps: every signed request
carries an HMAC-SHA256 digest over its method, path, timestamp, nonce and body,
so tampering invalidates the signature and a replay is refused as a duplicate.

Signing is **disabled by default**. Turning it on rejects unsigned requests, so
existing clients must be given their signing secrets first — see
[Rollout](#rollout).

## The canonical string

Both sides build the same string and HMAC it with the client's signing secret.
The five components are joined with newlines (`\n`), in this order:

```
<METHOD>\n<PATH_WITH_QUERY>\n<TIMESTAMP>\n<NONCE>\n<SHA256_HEX(body)>
```

| Component | Notes |
| --- | --- |
| `METHOD` | Uppercase, e.g. `POST` |
| `PATH_WITH_QUERY` | Path *and* query string exactly as sent, e.g. `/credentials?limit=10` |
| `TIMESTAMP` | Unix time in **seconds** |
| `NONCE` | Unique per request; 128 bits of randomness is plenty |
| `SHA256_HEX(body)` | Lowercase hex SHA-256 of the raw body; an empty body hashes the empty string |

The body is hashed rather than concatenated so the canonical string stays small
and binary-safe, and so a `GET` is signed exactly like a `POST`.

Every component is covered by the digest. Changing the method, retargeting the
path, editing one byte of the body, or reusing the signature with a fresh
timestamp all produce a different HMAC.

## Headers

```http
X-Signature:           v1=<hex hmac-sha256>
X-Signature-Timestamp: 1700000000
X-Signature-Nonce:     3f0a1c...
X-Signature-Key-Id:    key_abc123      # optional
```

`X-Signature-Key-Id` tells the server which signing secret to use. Omit it and
the server uses the secret belonging to the API key the request authenticated
with — which is what most clients want. Send it only when signing with a key
you are not simultaneously authenticating with.

The `v1=` prefix names the scheme. A future scheme can be introduced without
ambiguity: this verifier rejects a `v2=` signature rather than silently
comparing it against a v1 digest.

## Obtaining a signing secret

A signing secret is generated alongside every API key and returned **once**, at
issue and at rotation:

```console
$ curl -X POST https://api.example.org/admin/api-keys \
    -H 'X-API-Key: <admin key>' \
    -H 'Content-Type: application/json' \
    -d '{"name": "billing-service", "scopes": ["credentials:write"]}'
```

```json
{
  "id": "key_abc123",
  "apiKey": "sk_9f86d081...",
  "signingSecret": "ss_2c26b46b...",
  "scopes": ["credentials:write"],
  "tier": "free"
}
```

Store `signingSecret` with the same care as the API key. It is not returned by
`GET /admin/api-keys` or `GET /admin/api-keys/:id`; those report only
`hasSigningSecret`. If it is lost, rotate the key:

```console
$ curl -X POST https://api.example.org/admin/api-keys/key_abc123/rotate \
    -H 'X-API-Key: <admin key>'
```

Rotation replaces the API key **and** the signing secret, so a rotation
prompted by a suspected leak does not keep honouring signatures made with the
compromised material.

> The signing secret is stored in the clear on the server, unlike the API key,
> which is stored hashed. Verifying an HMAC requires recomputing it, which a
> one-way hash cannot do. Protect the key store accordingly.

## Signing a request

### TypeScript / JavaScript (SDK)

The SDK ships the client half of this scheme. It is built on Web Crypto, so the
same code runs in a browser and in Node 18+.

```ts
import { signRequest } from "@soroban-identity/sdk";

const body = JSON.stringify({ subject: "did:stellar:GABC..." });

const signatureHeaders = await signRequest({
  signingSecret: process.env.SOROBAN_SIGNING_SECRET!,
  method: "POST",
  path: "/credentials",
  body,
});

await fetch("https://api.example.org/credentials", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.SOROBAN_API_KEY!,
    ...signatureHeaders,
  },
  body,
});
```

To sign every call to the identity server without touching your other traffic,
wrap `fetch` once:

```ts
import { createSignedFetch } from "@soroban-identity/sdk";

const api = createSignedFetch({
  signingSecret: process.env.SOROBAN_SIGNING_SECRET!,
  baseUrl: "https://api.example.org",
});

const res = await api("/credentials", {
  method: "POST",
  headers: { "X-API-Key": process.env.SOROBAN_API_KEY!, "Content-Type": "application/json" },
  body: JSON.stringify({ subject: "did:stellar:GABC..." }),
});
```

`createSignedFetch` generates a fresh nonce per call, so a retry is a new
request rather than a replay.

### Node (no SDK)

```js
import crypto from "node:crypto";

function sign({ secret, method, path, body = "" }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");

  const canonical = [
    method.toUpperCase(),
    path,
    String(timestamp),
    nonce,
    crypto.createHash("sha256").update(body).digest("hex"),
  ].join("\n");

  const digest = crypto.createHmac("sha256", secret).update(canonical).digest("hex");

  return {
    "X-Signature": `v1=${digest}`,
    "X-Signature-Timestamp": String(timestamp),
    "X-Signature-Nonce": nonce,
  };
}
```

### Python

```python
import hashlib, hmac, os, time

def sign(secret: str, method: str, path: str, body: str = "") -> dict:
    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    body_hash = hashlib.sha256(body.encode()).hexdigest()

    canonical = "\n".join([method.upper(), path, timestamp, nonce, body_hash])
    digest = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

    return {
        "X-Signature": f"v1={digest}",
        "X-Signature-Timestamp": timestamp,
        "X-Signature-Nonce": nonce,
    }
```

### curl (shell)

```bash
SECRET='ss_2c26b46b...'
METHOD='POST'
PATH_WITH_QUERY='/credentials'
BODY='{"subject":"did:stellar:GABC..."}'

TS=$(date +%s)
NONCE=$(openssl rand -hex 16)
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $NF}')

CANONICAL=$(printf '%s\n%s\n%s\n%s\n%s' "$METHOD" "$PATH_WITH_QUERY" "$TS" "$NONCE" "$BODY_HASH")
SIG=$(printf '%s' "$CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -X "$METHOD" "https://api.example.org$PATH_WITH_QUERY" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SOROBAN_API_KEY" \
  -H "X-Signature: v1=$SIG" \
  -H "X-Signature-Timestamp: $TS" \
  -H "X-Signature-Nonce: $NONCE" \
  -d "$BODY"
```

Note the `printf '%s'` — a trailing newline from `echo` would be part of the
body and change its hash.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REQUEST_SIGNING_ENABLED` | `false` | Master switch. While `false`, signature headers are ignored. |
| `REQUEST_SIGNING_ENFORCE` | `mutations` | `mutations` requires a signature on `POST`/`PUT`/`PATCH`/`DELETE`; `all` also requires one on reads. |
| `REQUEST_SIGNING_MAX_AGE_SECONDS` | `300` | Clock-skew allowance in both directions. |

`/info`, `/health`, `/ready`, `/live` and `/metrics` never require a signature.
A load-balancer probe has no client credentials, so requiring one would pull a
healthy deployment out of rotation the moment signing was enabled.

## Rejection codes

Failures return the HTTP status below with a machine-readable `code`, so a
client can tell a clock problem apart from a bad secret.

| Code | Status | Cause |
| --- | --- | --- |
| `SIGNATURE_REQUIRED` | 401 | One of the three required headers is missing |
| `SIGNING_KEY_UNKNOWN` | 401 | No active signing secret for that key |
| `SIGNATURE_VERSION_UNSUPPORTED` | 400 | Signature is not `v1=` |
| `SIGNATURE_TIMESTAMP_INVALID` | 400 | Timestamp is not an integer |
| `SIGNATURE_EXPIRED` | 401 | Timestamp is outside the permitted window |
| `SIGNATURE_INVALID` | 401 | Digest does not match |
| `SIGNATURE_REPLAYED` | 409 | Nonce has already been used |

### Debugging a mismatch

`SIGNATURE_INVALID` almost always means the two sides built different canonical
strings. In order of likelihood:

1. **The body differs.** Sign the exact bytes you send. Re-serializing JSON
   after signing (or a shell adding a trailing newline) changes the hash.
2. **The query string is missing.** `PATH_WITH_QUERY` includes `?limit=10`.
3. **Timestamp in milliseconds.** It is seconds.
4. **The path was signed against the full URL.** Sign `/credentials`, not
   `https://api.example.org/credentials`.

Print the canonical string on the client and compare it line by line with the
table at the top of this document.

## Replay protection

The server remembers each nonce for the length of the freshness window,
namespaced per key so two clients choosing the same nonce do not collide.
Within the window a repeated nonce is refused with `SIGNATURE_REPLAYED`; past
it the timestamp check alone rejects the request, so the nonce no longer needs
remembering. That keeps the store bounded by request rate rather than uptime.

Two properties are worth knowing:

- A **failed** signature does not consume its nonce. Otherwise an attacker
  could burn a client's nonces with garbage signatures and lock out the
  requests that follow.
- If the nonce store is at capacity with live entries, further requests are
  refused rather than evicting a live nonce — evicting one would reopen the
  replay window it exists to close.

Clients must therefore use a fresh nonce per attempt, including retries.

## Rollout

Enabling signing rejects unsigned requests immediately, so sequence it:

1. Deploy the server with `REQUEST_SIGNING_ENABLED=false` (the default). The
   signing secrets now exist on every newly issued key.
2. Rotate existing keys to generate their signing secrets, and distribute them
   to each client.
3. Update clients to sign. With signing still disabled, the headers are
   ignored, so this can be rolled out gradually and safely.
4. Confirm no client is left unsigned, then set
   `REQUEST_SIGNING_ENABLED=true`, starting with `REQUEST_SIGNING_ENFORCE=mutations`.
5. Once stable, consider `all` to cover reads too.

If clients are spread across time zones or VMs with drifting clocks, widen
`REQUEST_SIGNING_MAX_AGE_SECONDS` before step 4 rather than after complaints —
but keep it as small as your fleet tolerates, since it is exactly how long a
captured request stays replayable against a fresh nonce.
