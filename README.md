# Morris Interactive Client Intelligence Platform

Company-owned repository baseline for the Zagimē Anishinabēk synthetic prototype. The default application remains synthetic; M4 adds a disabled-by-default secured API and protected workspace without deploying or connecting live data.

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

## Milestone 2 synthetic reporting
The overview now demonstrates agreement → department → delivery project with Nordic Minimal and Dots. Switch to Morris Internal for local project creation, progress and split allocations. Old saves and pages remain available; see docs/decisions.md and docs/qa-m2/README.md for limitations and browser evidence. Confirmed Firebase Project ID: morris-client-dash-zagime (documentation only). Canadian client project/reporting storage remains preferred under the updated M4 decision; specific client contracts still apply.

M2 review corrections: Primary Projects, New project, portfolio and Time Allocation share the normalized workspace. Views labeled Legacy use independent v1 data. The month selector scopes dashboard and recap; lifetime effort is separately labeled for fixed plans. Internal mapping and correction information is Morris-only demonstration content. See docs/qa-m2-corrections for updated acceptance evidence. Demo role switching is not production authorization.

## M3 security and Canadian infrastructure foundation
M2 is merged. The application stays synthetic/browser-local. New server-only contracts, deny-all Firestore rules and local security tests prepare a separately reviewed persistence path; nothing connects to the live Firebase project. Run npm run test:security with Java 21+ and Node 24.
See docs/security-and-access.md, docs/canadian-residency.md, docs/operator-setup-runbook.md and docs/qa-m3.md. Historical M3 strict-residency assumptions are superseded by the owner’s M4 decision; Firebase Auth US identity processing needs privacy approval and global Logging buckets are not automatic blockers. All cloud-changing operator steps require owner approval; none ran.

## M4 secure integration
The existing Montréal Firestore database is reused by prepared server code; no live access occurred. Firebase Admin signature/revocation verification, transactional persistence and scoped API are implemented. Run npm run build:server and npm run test:security in addition to the existing checks (Node 24/Java 21+). Live startup is disabled. Optional /#/secure is unavailable unless explicitly enabled and owner-configured; the synthetic dashboard remains unchanged.
See docs/m4-api-and-persistence.md, docs/firebase-setup.md and docs/operator-setup-runbook.md for actual capabilities, pilot limits, approval gates and how future QuickBooks credentials will be handled.
