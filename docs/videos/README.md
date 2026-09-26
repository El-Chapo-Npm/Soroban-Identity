# Video Documentation

Video companions to the written docs. All videos are in the
[Soroban Identity YouTube playlist](https://www.youtube.com/playlist?list=PLACEHOLDER_SOROBAN_IDENTITY).
Maintainers replace `PLACEHOLDER` IDs as each video is published.

## Core series

| # | Title | Length | Covers | Status |
|---|-------|--------|--------|--------|
| 1 | Introduction to Soroban Identity | 5 min | DIDs, credentials, reputation, [architecture](../architecture.md) | Planned |
| 2 | Setup & Installation | 10 min | [Getting started](../getting-started.md), [Tutorial 1](../tutorials/01-getting-started.md) | Planned |
| 3 | Building Your First dApp | 20 min | [Tutorials 2 and 3](../tutorials/README.md) | Planned |

## Advanced topics

| Title | Covers | Status |
|-------|--------|--------|
| Custom Credential Types | `Custom` credentials, [schema registry](../verifiable-credentials-jsonld.md) | Planned |
| Reputation Integration | [Tutorial 4](../tutorials/04-reputation-system.md), Sybil checks | Planned |
| Production Deployment | [Server operations](../server-operations.md), [secret management](../secret-management.md), [canary deploys](../cdn-and-canary-deployments.md) | Planned |

## Tutorial walkthroughs

Each tutorial in [`docs/tutorials`](../tutorials/README.md) gets a short screen-recorded walkthrough, added to the same playlist.

## Embedding

Use the privacy-enhanced embed in docs pages:

```html
<iframe
  src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
  title="VIDEO TITLE"
  width="100%" height="400" frameborder="0"
  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
```

## Production standards

- **Recording:** 1080p screen recording, voice narration, terminal font at 18pt or larger.
- **Captions:** every video ships with reviewed closed captions. Upload the `.srt` to YouTube and commit it to `docs/videos/captions/<slug>.srt`. Auto-generated captions alone are not enough.
- **Scripts:** commit the script to `docs/videos/scripts/<slug>.md` before recording, so reviewers can check accuracy.
- **Versioning:** state the SDK version in the first 10 seconds and in the description.

## Maintenance schedule

- **Quarterly review:** in the first week of each quarter, a maintainer checks every video against the current SDK and marks outdated ones in the table above.
- **Major and minor releases:** re-record any video whose code no longer runs. The release checklist links here.
- **Analytics and feedback:** record views, average watch time and top comments from YouTube Studio in the quarterly review issue (label `video-docs`). Viewers can leave feedback through a
  [video feedback issue](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/new?labels=documentation,video-docs&title=Video+feedback%3A+).
