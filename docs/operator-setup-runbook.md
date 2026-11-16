# M4 ordered owner runbook — NOT EXECUTED

Target project **morris-client-dash-zagime**. Existing database **(default), Standard Native, northamerica-northeast1**. No database/project creation belongs in this runbook. Every live-changing action below is **REQUIRES OWNER APPROVAL**. A code merge does not approve deployment, credentials or live data.

## 1. Confirm existing configuration (read-only)

Use the authorized local Console/CLI account. Verify exact project, billing owner, database ID/edition/mode/location, realtime setting and disabled scheduled backups. Read-only examples:

```powershell
gcloud projects describe morris-client-dash-zagime
gcloud billing projects describe morris-client-dash-zagime
gcloud firestore databases describe --project=morris-client-dash-zagime --database='(default)'
gcloud services list --enabled --project=morris-client-dash-zagime
```

Firestore Console → Rules: inspect the published release/version timestamp and ruleset content, not an unsaved editor buffer. Verify deny-all for all browser paths against this repository. Record the release identifier/timestamp and operator review. If access or deployed state cannot be verified, stop live activation; do not infer deployment from the local file or Console editor alone. No live read/write is performed by M4. FIRESTORE_RULES_VERIFIED is a future operator attestation after this check. Do not publish rules or create a replacement database as a shortcut.

Latest owner decision supersedes M3: no blanket Canada-only rule for every identity/log/service process. Montréal project/reporting storage is preferred; contractual requirements still apply. Global Logging buckets are not automatic blockers. Scheduled backups remain disabled until separately approved. See docs/canadian-residency.md.

## 2. Approve identity processing, then configure providers

**REQUIRES OWNER APPROVAL — privacy/provider configuration and user changes.** Approve Firebase Authentication US identity processing, provider data sharing, retention, sign-in domains and intended users first. Firebase Console → Authentication → Sign-in method: enable Google with owner-selected support email; enable Microsoft with owner-registered application settings. Microsoft client secret is entered only in the approved provider configuration UI, never React/Git/Firestore. Authorize exact frontend domains and provider callback URI shown by Firebase; do not guess or register URLs in this milestone. Disable anonymous/unused providers. No provider was enabled by M4.

A provider account is only identity. New/unknown UIDs have no membership and cannot access tenant data. Approve initial Morris administrator through a separately reviewed server-side bootstrap, then editors/client users with explicit agreement/project scopes, approved=true and enabled=true. No self-assigned custom-claim role, no public membership route. Any creating/disabling/revoking Auth users or writing memberships is **REQUIRES OWNER APPROVAL**. Use synthetic test accounts first. Document revocation and account disable procedures; backend checks current account/membership on subsequent requests.

## 3. Approve backend identity/IAM and API prerequisites

**REQUIRES OWNER APPROVAL — IAM/API activation/configuration.** Inventory before enabling anything. The backend uses an attached dedicated service account and ADC, no downloaded JSON keys. Candidate data permission: roles/datastore.user on the intended database/project; token revocation/account checks need narrowly reviewed Firebase Auth user-read permission (e.g. custom role containing firebaseauth.users.get). Neither role grants tenant/project authorization; backend checks remain mandatory. Do not grant broad Owner/Editor or user-management roles to runtime simply to read accounts. Release identity and runtime identity remain separate.

If prerequisites are missing, owner reviews activation of Firestore, Firebase Auth/Identity Toolkit, Cloud Run, Artifact Registry, Cloud Build and logging APIs as appropriate. No activation, billing or IAM command was executed here. Existing global log buckets require policy/redaction/access review rather than replacement. No backup/log changes are authorized by this step.

## 4. Validate local synthetic behavior before remote staging

Node 24 and Java 21+ on PATH:

```powershell
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
```

The security runner starts Auth 127.0.0.1:9099 and Firestore 127.0.0.1:8080 for **demo-mi-security only**, strips credential environment variables, seeds synthetic data and closes emulators. Never substitute the real project ID or production configuration in tests. No login or live deploy command is part of the scripts. Emulator tokens are unsigned; separate offline RSA tests exercise production verifier signature rejection. Emulator identity success does not prove provider/privacy setup.

**REQUIRES OWNER APPROVAL — any remote synthetic staging users, data writes or release.** Do not seed the existing database automatically. Before remote testing, agree on a distinct synthetic tenant namespace, bounded fixture, cleanup plan and preexisting-data protection; use a separately approved staging project/database if the owner chooses, never create one implicitly. First verify deployed deny-all browser rules. Test unknown/disabled/revoked users, wrong tenant/scope, client writes, unpublished visibility, admin publication, allocation raw integrity, audits, concurrency, transport recovery and no-op writes with synthetic data. Do not begin with Morris production records.

## 5. Review Cloud Run package and enable only after gates

**REQUIRES OWNER APPROVAL — image build/storage, service deployment, service-account attachment, ingress/origin, traffic and cost.** deployment/Dockerfile builds the server; deployment/cloud-run.yaml is a review template with deliberately non-runnable image/account/origin placeholders and ENABLE_LIVE_FIREBASE=false. Do not apply it in M4.

After separate approval, build in approved infrastructure, record exact image digest, attach approved runtime identity, target region **northamerica-northeast1**, review internal ingress and approved browser delivery path, initial maximum one instance, request concurrency and rate limits. No API needs unauthenticated tenant-data access; health is non-sensitive. Choose an authenticated ingress/session topology that actually supports the approved browser; an internal-only template will not be reachable from arbitrary public browsers. Resolve this before activation, not by blindly opening traffic.

Live startup requires BACKEND_MODE=production, ENABLE_LIVE_FIREBASE=true, FIRESTORE_RULES_VERIFIED=true, correct ALLOWED_ORIGIN, and no emulator/key-file variables. These flags are disabled/unset now. The rules flag is an attestation, not automated verification. Readiness requires startup; backend errors fail closed without exposing details. Approve rollback to exact prior image/config and zero-traffic synthetic smoke testing before traffic migration.

## 6. Configure optional protected React workspace

**REQUIRES OWNER APPROVAL — hosted build/configuration/traffic changes.** Default demo remains. Owner supplies verified Firebase public web API key (not guessed), approved API HTTPS origin and tenant ID, then sets VITE_ENABLE_SECURE_API=true in the approved frontend build. Optional /#/secure uses in-memory Firebase Auth and server publication reads. Public web configuration is not authorization. Never put Intuit client secrets/refresh tokens, service-account keys or server credentials in VITE_* variables. Do not mix the demonstration role switch with authenticated roles. Protected write administration is currently available via the authenticated HTTP contract, not the synthetic editor.

Sign-in providers/callbacks/domains, privacy approval, deploy path, ingress and scoped memberships must all be tested using synthetic users before any real client use.

## 7. QuickBooks credentials and backup decisions come later

No live QuickBooks integration exists or runs. **REQUIRES OWNER APPROVAL — future OAuth registration, company authorization, secret creation/version upload and sync activation.** Credentials will be entered only in regional Secret Manager under the approved Canadian project/location during a later connector task, after sandbox endpoint/scopes/callback/rotation design review. They are not entered into Firebase Auth, Firestore, GitHub, the React app or this API. Cloud Run built-in secret mounts do not support regional secrets; future connector uses regional Secret Manager API with attached identity. No credential is required to run local emulators.

**REQUIRES OWNER APPROVAL — backup/PITR, retention, logs, billing or schedules.** Existing scheduled backups stay disabled. Owner selects RPO/RTO, retention, access and deletion/legal-hold policy, then separately approves and tests any changes. No cloud resource, user, secret, IAM, billing, logs, backups, synchronization or deployment operation was executed in M4.
