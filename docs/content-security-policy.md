# Content Security Policy

CSP is the browser's last line of defence against injected markup. Even if an
attacker manages to get a `<script>` into a response, the browser refuses to
run it unless the policy allows it.

That guarantee only holds if the policy is strict enough to be worth enforcing.
A policy containing `'unsafe-inline'` in `script-src` permits exactly the
injection it is meant to stop, which is why the policies here avoid it in
production and use nonces instead.

Two surfaces are covered, and they work differently:

| Surface | Who sets the header | Inline scripts |
| --- | --- | --- |
| **API server** (`server/`) | The server, per response | Allowed via a per-response nonce |
| **Frontend SPA** (`frontend/`) | The static host, from a build-time `_headers` file | None — everything is an external bundle |

## Rolling it out

Enforcing a policy that is even slightly too tight breaks the page for every
visitor at once. Both surfaces therefore default to **report-only**, which
reports violations without blocking anything.

1. Deploy with the defaults (`CSP_REPORT_ONLY=true`, `VITE_CSP_REPORT_ONLY=true`).
2. Watch the reports — see [Monitoring](#monitoring). Expect some noise from
   browser extensions injecting into the page; those are not yours to fix.
3. For each *legitimate* violation, add the origin to the relevant directive
   (see [Configuration](#configuration)). Never widen `script-src` with
   `'unsafe-inline'` to silence a report — that defeats the policy.
4. When reports are clean for a representative period, switch to enforcing:
   `CSP_REPORT_ONLY=false` and `VITE_CSP_REPORT_ONLY=false`.
5. Keep watching. Reports continue in enforcing mode, and now every one of
   them is something the browser actually blocked.

## API server

The server sets a policy on every response and generates a fresh nonce for
each one. It renders one HTML page — the GraphQL playground — whose inline
`<style>` and `<script>` carry that nonce, so they run under a policy that does
not allow `'unsafe-inline'`. An injected script cannot guess the nonce because
it is never reused.

Baseline directives:

```
default-src 'self'
script-src 'self' 'nonce-<per-response>'
style-src 'self' 'nonce-<per-response>'
connect-src 'self'
img-src 'self' data:
font-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
upgrade-insecure-requests        # production only
report-uri /csp-report
report-to csp-endpoint
```

`object-src 'none'` removes a legacy plugin-based XSS vector with no modern
use. `base-uri 'self'` stops an injected `<base>` from silently repointing
every relative URL on the page, and `form-action 'self'` stops an injected
`<form>` from posting credentials to another origin — both are commonly
forgotten and both are free.

Alongside CSP the server always sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` (for browsers predating `frame-ancestors`),
`Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy`
denying camera, microphone and geolocation. In production it adds
`Strict-Transport-Security`.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CSP_ENABLED` | `true` | Master switch. Companion headers are set either way. |
| `CSP_REPORT_ONLY` | `true` | Report violations without blocking them. |
| `CSP_REPORT_URI` | `/csp-report` | Where the browser posts reports. |
| `CSP_SCRIPT_SRC` | — | Extra script origins, comma-separated. |
| `CSP_STYLE_SRC` | — | Extra style origins. |
| `CSP_CONNECT_SRC` | — | Extra XHR/WebSocket origins. |
| `CSP_IMG_SRC` | — | Extra image origins. |
| `CSP_FONT_SRC` | — | Extra font origins. |
| `CSP_FORM_ACTION` | — | Extra form targets. |
| `CSP_FRAME_ANCESTORS` | — | Origins permitted to frame the page. Replaces the `'none'` default. |

Each list is merged into its directive's baseline; a value already present is
not duplicated. For example:

```bash
CSP_CONNECT_SRC=https://soroban-testnet.stellar.org,wss://relay.walletconnect.com
CSP_STYLE_SRC=https://fonts.googleapis.com
CSP_FONT_SRC=https://fonts.gstatic.com
```

## Frontend

The SPA is a static bundle, so there is no server to mint a per-response nonce.
It does not need one: Vite emits every script as an external file, so
`script-src 'self'` is sufficient in production.

Development is different — Vite's dev server rewrites modules on the fly and
injects an inline bootstrap script, which genuinely requires `'unsafe-inline'`
and `'unsafe-eval'`. The two policies are therefore derived separately in
`frontend/csp.config.ts`. Shipping the development policy to production is the
usual way a CSP ends up providing no protection at all, and the test suite
asserts that the production `script-src` is exactly `'self'`.

`style-src` keeps `'unsafe-inline'` in both modes because CSS-in-JS libraries
inject `<style>` at runtime. This is far less dangerous than the `script-src`
equivalent: injected CSS cannot execute.

### Deploying the policy

A static host applies no headers of its own, so the build emits them. Building
the frontend writes `dist/_headers`, in the format Netlify and Cloudflare Pages
read:

```
/*
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; ...
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  ...
```

Keeping the policy in the repository, rather than in a hosting dashboard, means
it is versioned with the code that depends on it and reviewed alongside it.

Other hosts need the same headers configured their own way:

**Vercel** — `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; ..." },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
```

**nginx**:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; ..." always;
add_header X-Content-Type-Options "nosniff" always;
```

Copy the value from a built `dist/_headers` rather than retyping it, so the
deployed policy cannot drift from the tested one.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_CSP_REPORT_URI` | — | Where violations are posted; point it at the API server's `/csp-report`. |
| `VITE_CSP_REPORT_ONLY` | `true` | Set to `false` to enforce. |

Origins the app is allowed to reach — the Soroban RPC endpoints and the
WalletConnect relay — are listed in `frontend/csp.config.ts`. Add deployment
specific origins there, or pass them through the `extra*Src` options.

## Monitoring

The server accepts violation reports at `POST /csp-report`. The endpoint is
deliberately unauthenticated and exempt from request signing: the browser posts
these on its own behalf, with no API key and no signing secret, so requiring
either would mean never receiving a report. The handler only logs and counts;
it never trusts the contents.

Browsers disagree about the envelope — the legacy `report-uri` mechanism posts
`{"csp-report": {...}}` with hyphenated keys, while the Reporting API posts an
array of `{type, body}` with camelCase keys. Both are accepted, so reports are
not silently lost depending on the visitor's browser.

Each report is logged at `warn` with the directive, blocked URI, document URI
and source location, and increments a Prometheus counter:

```
csp_violations_total{directive="script-src"}
```

The `directive` label is what makes this actionable. A spike in `script-src`
is a possible injection and deserves investigation. A steady trickle from
`img-src` or `connect-src` usually means the policy needs widening for a
legitimate resource.

A useful alert is a sustained non-zero rate on `script-src` once the policy is
enforced:

```promql
sum(rate(csp_violations_total{directive=~"script-src.*"}[5m])) > 0
```

Before enforcement, treat the same signal as a to-do list rather than an alert.

## Troubleshooting

**The playground renders unstyled, or its buttons do nothing.** The inline
`<style>`/`<script>` are not receiving the nonce. Check that the response
carries a `Content-Security-Policy` header with a `'nonce-...'` source and that
the same value appears in the page's tags.

**Everything is blocked after switching to enforcing.** Switch back to
report-only, and read the reports rather than guessing — the `directive` and
`blockedUri` fields name precisely what to add.

**Violations mention `chrome-extension://` or `moz-extension://`.** Browser
extensions injecting into the page. Not fixable from the server, and not worth
widening the policy for.

**Reports never arrive.** Confirm `report-uri` points at a URL the browser can
reach from the page's origin, and that the collector is not behind auth. Some
browsers only implement `report-to`; the server sends both.
