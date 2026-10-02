# Video tutorial series

> **Issue:** [DOC-14 #942](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/942)  
> **Scope:** `docs/videos/`  
> **Status:** Planned

Comprehensive video tutorials for developers building on Soroban Identity. All videos are published to the [Soroban Identity YouTube playlist](https://www.youtube.com/playlist?list=PLACEHOLDER_SOROBAN_IDENTITY) and embedded in the relevant documentation pages.

---

## Series overview

| # | Title | Length | Audience | Status |
|---|-------|--------|----------|--------|
| 1 | [Introduction to Soroban Identity](#1-introduction-to-soroban-identity) | ~5 min | All | Planned |
| 2 | [Quick start guide](#2-quick-start-guide) | ~10 min | Beginner | Planned |
| 3 | [DID creation walkthrough](#3-did-creation-walkthrough) | ~8 min | Beginner | Planned |
| 4 | [Credential lifecycle tutorial](#4-credential-lifecycle-tutorial) | ~15 min | Intermediate | Planned |
| 5 | [Integration guide](#5-integration-guide) | ~20 min | Advanced | Planned |

---

## Video details

### 1. Introduction to Soroban Identity

**Length:** ~5 min  
**Goal:** Give a developer who has never heard of Soroban Identity a clear mental model of the system before they write a line of code.

**Outline:**
- What is a decentralized identity and why it matters on Stellar (1 min)
- The three core primitives: DIDs, verifiable credentials, and reputation (2 min)
- High-level system architecture — contracts, server, SDK, and frontend (1 min)
- Where to go next: quick start vs. deep-dive tutorials (1 min)

**Related docs:** [Architecture](../architecture.md), [Getting started](../getting-started.md)

**Embed placeholder:**
```html
<iframe
  src="https://www.youtube-nocookie.com/embed/PLACEHOLDER_VIDEO_1"
  title="Introduction to Soroban Identity"
  width="100%" height="400" frameborder="0"
  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
```

---

### 2. Quick start guide

**Length:** ~10 min  
**Goal:** Get a developer from zero to a running local environment with a registered DID inside one sitting.

**Outline:**
- Prerequisites: Node.js, Rust toolchain, Stellar Testnet account (1 min)
- Clone the repo and install dependencies (2 min)
- Environment configuration — `.env` values, RPC endpoint, contract addresses (2 min)
- Start the server and run the health check (1 min)
- Register a DID via the SDK and confirm on-chain (3 min)
- Next steps (1 min)

**Related docs:** [Getting started](../getting-started.md), [Tutorial 1 — Getting started](../tutorials/01-getting-started.md), [Server operations](../server-operations.md)

**Embed placeholder:**
```html
<iframe
  src="https://www.youtube-nocookie.com/embed/PLACEHOLDER_VIDEO_2"
  title="Soroban Identity — Quick start guide"
  width="100%" height="400" frameborder="0"
  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
```

---

### 3. DID creation walkthrough

**Length:** ~8 min  
**Goal:** Show every step of creating, resolving, updating, and deactivating a DID so viewers understand the full identity lifecycle.

**Outline:**
- DID document structure and `did:stellar:` method (1 min)
- Creating a DID with the SDK — key generation and on-chain registration (2 min)
- Resolving a DID and inspecting the document (1 min)
- Updating verification methods and service endpoints (2 min)
- Deactivating a DID — what happens on-chain and in the registry (1 min)
- Common errors and how to diagnose them (1 min)

**Related docs:** [Tutorial 2 — DID management](../tutorials/02-did-management.md)

**Embed placeholder:**
```html
<iframe
  src="https://www.youtube-nocookie.com/embed/PLACEHOLDER_VIDEO_3"
  title="Soroban Identity — DID creation walkthrough"
  width="100%" height="400" frameborder="0"
  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
```

---

### 4. Credential lifecycle tutorial

**Length:** ~15 min  
**Goal:** Walk through issuing, holding, presenting, and revoking a verifiable credential end-to-end.

**Outline:**
- Credential model: subject, issuer, schema, and claims (2 min)
- Defining a schema in the schema registry (2 min)
- Issuing a credential — signing and on-chain anchoring (3 min)
- Storing and presenting a credential from a holder wallet (3 min)
- Verifying a presentation — signature check and revocation lookup (3 min)
- Revoking a credential and its effect on existing presentations (2 min)

**Related docs:** [Tutorial 3 — Credential lifecycle](../tutorials/03-credential-lifecycle.md), [Verifiable credentials JSON-LD](../verifiable-credentials-jsonld.md)

**Embed placeholder:**
```html
<iframe
  src="https://www.youtube-nocookie.com/embed/PLACEHOLDER_VIDEO_4"
  title="Soroban Identity — Credential lifecycle tutorial"
  width="100%" height="400" frameborder="0"
  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
```

---

### 5. Integration guide

**Length:** ~20 min  
**Goal:** Show a realistic third-party integration: an app that verifies a user's credentials before granting access to a protected resource.

**Outline:**
- Integration patterns: server-side verification vs. client-side wallet flow (2 min)
- Setting up the SDK in an existing Node.js or browser app (3 min)
- Requesting a credential presentation from a user (3 min)
- Verifying the presentation on the server — schema, signature, and revocation (4 min)
- Handling errors: expired credentials, revoked credentials, unknown issuers (3 min)
- Reputation checks as a Sybil-resistance layer (3 min)
- Production checklist (2 min)

**Related docs:** [Tutorial 4 — Reputation system](../tutorials/04-reputation-system.md), [OAuth2](../oauth2.md), [Secret management](../secret-management.md)

**Embed placeholder:**
```html
<iframe
  src="https://www.youtube-nocookie.com/embed/PLACEHOLDER_VIDEO_5"
  title="Soroban Identity — Integration guide"
  width="100%" height="400" frameborder="0"
  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
```

---

## Production standards

Follow the standards defined in [videos/README.md](./README.md#production-standards) for all videos in this series:

- **Resolution:** 1080p screen recording with voice narration; terminal font at 18pt or larger.
- **Closed captions:** every video ships with reviewed captions. Upload the `.srt` to YouTube and commit it to `docs/videos/captions/<slug>.srt`. Auto-generated captions alone do not meet the standard.
- **Scripts:** commit the script to `docs/videos/scripts/<slug>.md` before recording so reviewers can check technical accuracy before a single frame is recorded.
- **SDK version:** state the SDK version being demonstrated in the first 10 seconds of the video and in the YouTube description.
- **Chapters:** add YouTube chapter timestamps matching the outline headings above so viewers can seek directly to the section they need.

### Suggested slug names

| Video | Slug |
|-------|------|
| Introduction | `01-introduction` |
| Quick start | `02-quick-start` |
| DID creation | `03-did-creation` |
| Credential lifecycle | `04-credential-lifecycle` |
| Integration guide | `05-integration-guide` |

---

## Publishing checklist

When a video is ready to publish, work through this checklist before updating the status table above:

- [ ] Script committed to `docs/videos/scripts/<slug>.md` and reviewed
- [ ] Recording reviewed by at least one maintainer for technical accuracy
- [ ] Closed captions uploaded to YouTube and committed to `docs/videos/captions/<slug>.srt`
- [ ] YouTube video set to the correct playlist
- [ ] Chapter timestamps added to the YouTube description
- [ ] SDK version stated in the first 10 seconds and in the description
- [ ] Embed code updated in this file (replace the `PLACEHOLDER_VIDEO_N` ID)
- [ ] Embed code added to the related documentation page
- [ ] Status column in the series overview table updated to **Published**
- [ ] `docs/videos/README.md` table updated

---

## Embedding in documentation pages

When the video is published, replace the `PLACEHOLDER_VIDEO_N` embed above with the real YouTube video ID and copy the `<iframe>` snippet into the matching documentation page. Use the privacy-enhanced domain (`youtube-nocookie.com`) as shown.

---

## Maintenance

Videos are reviewed quarterly alongside the rest of the video documentation. See [videos/README.md — Maintenance schedule](./README.md#maintenance-schedule) for the full process. When a public SDK method used in a video changes, re-record the affected segment in the same release cycle that ships the breaking change.
