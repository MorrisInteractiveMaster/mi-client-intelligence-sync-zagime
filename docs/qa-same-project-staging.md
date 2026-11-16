# Same-project staging verification

Starting main: ad4c2cfddc0d3d879c093885e6d2d910d4baf4a2 (PR #5 merged). Branch: codex/same-project-named-staging. No live resources, IAM, providers, users, Firestore records, credentials, deployment or QuickBooks connections were changed.

## Passed locally

- Clean npm ci --ignore-scripts (Node 24), full unit/regression suite: **107/107**, no failures/skips.
- Frontend + server typecheck, frontend production build, API/operator/read-only-probe bundles.
- Auth + Firestore emulator security suite (Java 21): **25/25**, no failures/skips. M3/M4 default-database tests retained; all M5 administration tests now use the named staging emulator DB.
- PowerShell IAM checker syntax validation; live gcloud checks were not invoked.
- Production dependency audit: **zero vulnerabilities**; inherited development-tooling findings remain 14 moderate (no high/critical). No dependency change or suppression.
- git diff --check. firebase.json, firestore.rules, firestore.indexes.json and package-lock.json are unchanged. No frontend product files/design changes; M5 Nordic Minimal/Dots and API behaviour remain intact. Browser UI screenshots were not regenerated for this server/configuration change; prior M5 evidence remains under docs/qa-m5.

New unit coverage: missing/wrong/default DB configuration, mixed production/staging refusal, explicit named SDK selection, withheld handle before verification, pinned resource/UID/region/edition/mode, permission/missing/transport failures without fallback, operator default/unverified-handle refusal before RPC, required IAM grant/deny matrix and rejection of unknown/incomplete evidence, exact conditional-role artifact, read-only probe method/status contract.

New emulator coverage uses shared Auth identities with separate memberships and proves default-only administrator denial in staging; named client role remains read-only despite default administrator membership. Actual named bootstrap/create/publication/allocation/maintenance preserve the emulator default sentinel and its memberships/audits/source absence. Direct default-DB operator calls reject. Browser reads/writes deny in both DBs even for shared administrator/client identities. Existing M5 concurrent/idempotent creation, split/history/month/lifetime/no-op/revocation and audit tests pass in mi-client-staging.

## Emulator setup correction

The initial multi-database rules array was ignored by the pinned Firebase CLI and the named browser-denial assertion failed. The retained test caught the open local rules. firebase.emulators.json now supplies a single named configuration and the unchanged deny-all file; explicit named/default browser tests pass. The production/default firebase.json remains unchanged. firebase.staging.json is a named-only future owner configuration, not a deployment performed here.

## Not certified by these tests

Emulators do not enforce Google Cloud IAM. Offline matrix fixtures validate the evidence contract, not the actual service principal. Database UID/region/edition existence, deployed named rules, inherited IAM grants, actual attached identity and live default denial were **not verified**. The prepared Policy Troubleshooter checker and read-only runtime probe must pass under owner-approved access before activation; no production write experiment is permitted. Docker is unavailable; no image/remote rollout was executed. All M5 scale/privacy/network/recovery gates remain.

Startup overhead is one staging metadata GET/credential acquisition per process; existing dashboard requests/no-op write budgets remain M5. No new listener, scheduled job, cloud resource or ongoing background cost was introduced.

MERGED: No · DEPLOYED: No · PRODUCTION DATA CONNECTED: No · PRODUCTION VERIFIED: No
