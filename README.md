# Morris Interactive Client Intelligence Platform

Company-owned repository baseline for the Zagimē Anishinabēk synthetic prototype. Milestone 1 only: no live integrations, authentication, deployment, or production data.

## Local verification
Use Node.js 24 (CI) and the committed npm lockfile:
```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run dev -- --host 127.0.0.1
```
Dependency lifecycle scripts are disabled; the existing prebuilt tooling supports this installation. No application environment variables are required. Lint is not configured.

Open the local URL printed by Vite. Hash routes include /#/, /#/projects, /#/projects/p1 and /#/presentation/1. Use a separate browser profile to preserve existing browser-local demo edits.

## Preserved prototype
React/TypeScript/Vite, branded client and Morris Internal views, ten presentation chapters, hierarchy and rollups, monthly effort, caps, forecast rules, manual reporting allocations, category lifecycle, identity mappings, upcoming work-order attachment, mock repositories and all 45 existing tests are retained. Application source, styles, fixtures, lockfile and active branding assets are unchanged from the pinned source.

Demo role switching is not authentication or authorization. The full synthetic dataset ships to the browser. Do not enter real employee or client information. Browser storage is local and not shared or tenant-secure.

## Review documents
- [Import record and verification](docs/import-review.md)
- [Architecture](docs/architecture.md)
- [Data ownership](docs/source-of-truth.md)
- [Firebase prerequisites](docs/firebase-setup.md)
- [Release boundaries](docs/release-runbook.md)
- [Original prototype reference](docs/prototype-reference.md) and [historical QA](docs/prototype-qa-history.md)

The original reference and QA are historical records. Their personal-repository branch and automatic deployment instructions do not apply here. The company workflow validates only and has no deployment job. Relative asset paths and hash routing retain static-host/GitHub Pages compatibility; hosting remains unapproved.
