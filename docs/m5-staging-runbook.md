# M5 operator runbook — review only, nothing deployed

This is the current staging handoff; it supersedes M4's internal-ingress browser assumption. Every live-changing step requires separate owner approval after architecture/security review. Commands are copy-ready only after the operator substitutes owner-verified placeholders and records the approved change/rollback ticket. No credentials belong in commands, source, screenshots or PRs.

## A. Read-only checks available now

Existing production-intended project is **morris-client-dash-zagime**, database **(default)**, **Standard / Native**, **northamerica-northeast1** (owner confirmed). Reuse it for future production; do not create another database in it. Do not write synthetic staging records into it. Realtime enabled and scheduled backups disabled are owner reports, not live attestations from M5.

```powershell
gcloud projects describe morris-client-dash-zagime
gcloud billing projects describe morris-client-dash-zagime
gcloud firestore databases describe --project=morris-client-dash-zagime --database='(default)'
gcloud services list --enabled --project=morris-client-dash-zagime
git rev-parse HEAD
```

In Firebase Console verify the **published** Firestore rules release ID, timestamp and full deny-all contents (not an unsaved editor buffer). Record database mode/edition/location, provider/domain configuration, actual web-app config and billing owner. Do not turn the `FIRESTORE_RULES_VERIFIED` attestation on until that independent check succeeds. No M5 live database/rules verification was performed. Canadian project/reporting storage remains preferred; there is no blanket Canada-only identity/log-processing policy. Obtain Firebase Auth US-processing/privacy approval and review applicable client contracts; global Logging buckets are not automatic blockers.

## B. Owner Console decisions/configuration — separate approval required

1. Approve a **separate synthetic staging Firebase/GCP project** and billing cap/alerts. Its immutable ID is **UNVERIFIED**; do not derive it from a display name. Do not replace or rename the existing project. If isolation is not approved, remain on emulators; do not point staging at the existing database.
2. Approve identity processing, Google/Microsoft sign-in, support email, authorized frontend domains and provider callbacks displayed by Firebase. Register a staging web app; copy its actual public web configuration after review. Microsoft OAuth credentials go only in the approved provider Console configuration, never command-line examples or React. Disable unused providers; do not enable anonymous/admin self-registration. An identity alone confers no dashboard membership.
3. Approve initial UID/provider identity/tenant/role and independent approval reference. Have the owner create/approve synthetic accounts manually and verify provider-linked identity and email verification. No user is created by bootstrap or this PR. Approve any later editor/client memberships with explicit scopes through a separately reviewed operator change; no membership CRUD API exists.
4. Approve staging frontend origin, API hostname/DNS/TLS, load balancer, edge policy, runtime/build/operator identities, IAM, costs, retention and cleanup plan before proceeding. Auth configuration and staging DNS/hosting are not implicitly authorized by merging code.

## C. Isolated staging resources — explicit creation/deployment approval required

All names below are placeholders, not existing resources:

```powershell
$StagingProjectId = 'OWNER_VERIFIED_STAGING_PROJECT_ID'
$Region = 'northamerica-northeast1'
$ApiService = 'OWNER_APPROVED_STAGING_SERVICE_NAME'
$RuntimeServiceAccount = 'OWNER_APPROVED_RUNTIME_SERVICE_ACCOUNT_EMAIL'
$ArtifactRepository = 'OWNER_APPROVED_REGIONAL_ARTIFACT_REPOSITORY'
$ApiOrigin = 'https://OWNER_APPROVED_API_HOST'
$FrontendOrigin = 'https://OWNER_APPROVED_FRONTEND_HOST'
$SyntheticTenant = 'synthetic-OWNER_APPROVED_LAB_ID'
if ($StagingProjectId -eq 'morris-client-dash-zagime' -or $StagingProjectId -like '*OWNER*') { throw 'Isolated staging identity must be approved and verified' }
gcloud projects describe $StagingProjectId
gcloud firestore databases list --project=$StagingProjectId
```

Owner manually creates/adds Firebase to the separately approved staging project, links approved billing and creates **one staging (default) Standard Native database in Montréal only if absent**. Never run a database creation command against the production-intended project. Record deployed deny-all staging rules. All staging records must be conspicuously synthetic. Do not use production exports.

### APIs, accounts and minimum access

Owner reviews/enables only needed APIs in staging: `run.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com` (if Cloud Build chosen), `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `compute.googleapis.com` (load balancing/Cloud Armor), `certificatemanager.googleapis.com` (if that TLS certificate option is chosen), and operational `logging.googleapis.com`/`monitoring.googleapis.com`. Check existing enabled APIs first. Secret Manager is reserved for a later connector approval, not needed for Admin ADC now. No API was enabled by this PR.

Use distinct attached service identities and operator impersonation/approved ADC, **no JSON keys** and no broad Owner/Editor roles:

| Identity | Proposed narrow access, independently verify in synthetic staging |
| --- | --- |
| Runtime | Custom role containing `datastore.databases.get` (transactions), `datastore.entities.get/list/create/update`, `firebaseauth.users.get` (revocation/disabled checks). Scope to isolated staging project/database as supported. No user management, IAM changes, secret access, database provisioning or document delete. IAM cannot enforce tenant fields; backend authorization is mandatory. |
| Bootstrap/seed operator | Separate short-lived approved identity, Auth users.get + required Firestore transaction/read/create/update access. No Auth create/delete or role assignment API. No authority from browser flags. Approval artifact must be protected outside Git. |
| Retention operator | Separate reviewed Firestore read/delete plus audit create/root update permissions. Runtime does not need delete. Full synthetic tenant cleanup uses a separately approved scoped operator. |
| Image builder | Artifact Registry writer on the approved regional repository, Cloud Build execution/log access as selected; no dashboard data/Auth access. |
| Deployer | Scoped Cloud Run deployment permissions + serviceAccountUser for the approved runtime only; no application data access. Owner performs IAM review separately. |

Review current permission definitions before creating roles. Do not grant datastore.admin, firebase.admin or firebaseauth.admin as a shortcut. The API verifies tokens and rechecks current memberships even though Admin SDK bypasses browser rules. See [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam).

### Container and browser reachability

Proposed topology: static React frontend on an owner-approved host → **external HTTPS Application Load Balancer with Cloud Armor** → regional serverless NEG → Cloud Run in Montréal. API is a separate exact HTTPS origin; CORS allows only the approved frontend origin and `Authorization, Content-Type, Idempotency-Key`, methods GET/POST/PATCH/OPTIONS. Cookies are omitted. Firebase ID token is checked by the application on every protected request; it is **not** a Cloud Run IAM invoker token.

Cloud Run ingress must be `internal-and-cloud-load-balancing` (`internal-and-gclb` in v1 YAML), with the default run.app URL disabled, no direct domain mappings or bypass routes. Disable the Cloud Run Invoker IAM check **only as part of this approved load-balancer topology**, so browser Firebase tokens/preflight can reach the app. This permits network arrival, not data access; application Auth and tenant checks remain compulsory. Do not combine internal-only ingress with an assumption of direct browser reachability. Do not make a direct public run.app endpoint the staging shortcut. Consult [ingress controls](https://docs.cloud.google.com/run/docs/securing/ingress), [invoker IAM access](https://docs.cloud.google.com/run/docs/securing/managing-access) and [Cloud Armor serverless integration](https://docs.cloud.google.com/armor/docs/integrating-cloud-armor). Independently verify no default URL or tag bypasses the approved edge before opening traffic.

Owner creates a regional Artifact Registry Docker repository, approves image scanning/retention, then builds using `deployment/Dockerfile`. Example **after explicit build approval**:

```powershell
$ImageTag = "$Region-docker.pkg.dev/$StagingProjectId/$ArtifactRepository/mi-api:OWNER_APPROVED_COMMIT_TAG"
gcloud builds submit --project=$StagingProjectId --region=$Region --config=deployment/cloudbuild-staging.yaml --substitutions="_IMAGE=$ImageTag"
```

Record the resolved immutable image digest; deploy by digest, never an unchecked mutable tag. `deployment/cloud-run-staging.yaml` is nondeployable review input with placeholders and live flags false. Owner renders a reviewed manifest with actual isolated staging ID, runtime identity, image digest, origin, `BACKEND_MODE=staging`, `STAGING_FIREBASE_PROJECT_ID`, `ENABLE_SYNTHETIC_STAGING=true`, `ENABLE_LIVE_FIREBASE=true` and `FIRESTORE_RULES_VERIFIED=true`. These flags require staging verification; they confer no approval by themselves. Production mode remains disabled/default-blocked. Staging mode refuses the production-intended project ID and any emulator/key-file environment variables.

After separate container/network release approval:

```powershell
gcloud run services replace OWNER_REVIEWED_RENDERED_STAGING_MANIFEST --project=$StagingProjectId --region=$Region
gcloud run services describe $ApiService --project=$StagingProjectId --region=$Region
```

Review service-level ingress/invoker/default-URL flags in Console as well as the rendered revision. Prefer a new staging service with edge traffic denied until smoke approval; do not rely on `--no-traffic` to hide service-level changes. The reviewed initial limits are min instances 0, max instances 1, concurrency 20, 1 CPU, 512 MiB, request timeout 10 seconds. Set project budgets and alert recipients, usage alerts, Artifact Registry retention, log retention and a manual stop procedure. Budgets alert; they are not hard spending caps. Service-level and revision-level maximums are both set to one (Cloud Run may temporarily exceed instance limits during platform events); see [maximum-instance controls](https://docs.cloud.google.com/run/docs/configuring/max-instances). Max instances bounds API scale, not load-balancer/build/database/egress costs.

Cloud Armor: approve an IP/identity access policy for testers and a reviewed rate-limit rule on API requests (including preflight/health exceptions if needed). Begin in preview to inspect synthetic traffic, enforce before opening staging. Confirm edge 429 behaviour and direct-URL denial. The application retains 60 requests/minute per socket IP per instance and ignores X-Forwarded-For. Proxied users may share an application bucket; edge per-client IP enforcement is separate. No distributed application quota is claimed. Do not loosen proxy trust or increase instances to bypass this limit.

Do not log Authorization, token query parameters, request bodies, raw descriptions, provider identities or approval files. Review Cloud Run/LB/Cloud Armor access logs for URL/PII exposure, restricted viewers and retention. Retain immutable business audits independently; no logging bucket/sink/backup setting was changed here. Synthetic staging is not a compliance certification.

## D. Local tests and operator dry runs

Node 24 / Java 21+, no cloud login required:

```powershell
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
```

For secured Chrome checks, install Playwright in an isolated tools directory, supply its absolute package path via `M5_PLAYWRIGHT_PACKAGE` and installed Chrome via `CHROME_PATH`. These paths are local tools, not credentials. Then:

```powershell
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-mi-security --only firestore,auth 'node --import tsx scripts/qa-m5.ts'
```

The script starts its own loopback Vite/API, seeds synthetic emulator users/data, and removes the processes on exit. It is never a remote seeder. Test emulator password UI is guarded by `VITE_AUTH_EMULATOR=true`, exact demo project, loopback browser hostname and loopback API; omit that variable from all hosted builds. Standard hosted Google/Microsoft provider sign-in remains separately approved/configured.

## E. Controlled remote staging checks — blocked until B/C approved

1. Confirm immutable project ID differs from production-intended ID; independently verify database Montréal/Standard/Native and deployed deny-all rules. Verify runtime ADC identity and no JSON keys. Confirm edge denies unknown traffic/default run.app URL and exact-origin preflight works. No-auth `/health` returns only status (M4 `/healthz` is kept for local compatibility, but [Cloud Run reserves some paths ending in z](https://docs.cloud.google.com/run/docs/known-issues#reserved-url-paths)); protected calls without a valid token return 401.
2. With approved operator impersonation/attached ADC, set reviewed staging guards in that operator process. Never put tokens/secrets into command examples:

   ```powershell
   $env:BACKEND_MODE = 'staging'
   $env:STAGING_FIREBASE_PROJECT_ID = $StagingProjectId
   $env:ENABLE_SYNTHETIC_STAGING = 'true'
   $env:ENABLE_LIVE_FIREBASE = 'true'
   $env:FIRESTORE_RULES_VERIFIED = 'true'
   npm run operator -- seed-synthetic $SyntheticTenant
   # Separate approval after dry-run count review:
   npm run operator -- seed-synthetic $SyntheticTenant --apply
   ```

   Seed refuses non-`synthetic-` IDs and existing tenants, never creates users, initializes all projects private, and appends initialization audit. Review count before apply; no production seed is supported by the operator entrypoint. Revoke/remove operator ADC session after use.
3. Create a protected approval JSON **outside the repository** with fields `approved: true`, `uid: OWNER_VERIFIED_EXISTING_UID`, `tenantId: OWNER_APPROVED_SYNTHETIC_TENANT`, `role: administrator`, `providerId: google.com OR microsoft.com`, `providerUid: OWNER_VERIFIED_PROVIDER_SUBJECT`, `approvalReference: OWNER_REVIEW_REFERENCE`. These are placeholders, not real identities. Verify provider and review reference independently; file must not contain OAuth tokens/secrets.

   ```powershell
   npm run operator -- bootstrap-admin OWNER_PROTECTED_APPROVAL_FILE
   # Separate approval after no-write preview:
   npm run operator -- bootstrap-admin OWNER_PROTECTED_APPROVAL_FILE --apply
   npm run operator -- bootstrap-admin OWNER_PROTECTED_APPROVAL_FILE
   ```

   Repeat should report changed=false. Verify one membership/marker/audit and exact scope. Do not delete the permanent bootstrap marker to re-enable a revoked user. Rollback: block edge writes, independently approve setting membership approved/enabled false, disable/revoke that Auth account if approved, confirm next API request denied, retain audit/marker. Recovery is a separately reviewed membership change, never replay of bootstrap. Correlate operator execution identity with the approval reference. No real UID is prepopulated.
4. Owner adds reviewed synthetic editor/client memberships using server-side operator access with least privileges and immutable approval audit, then removes temporary access. No public role provisioning endpoint exists. Build React with the actual staging public web config (`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, public API key), exact API origin/tenant and `VITE_ENABLE_SECURE_API=true`. Public web config is not authorization. Never set `VITE_AUTH_EMULATOR` remotely.
5. Through the protected browser, perform create without WO → uncertain-response identical-key retry → plan/name/progress edit → split allocation → history → month/lifetime checks → publish/unpublish → client projection. Verify one creation/audit, no raw mutations, no client source/notes/history/private data, no escalation, editor project restrictions, stale revision 409, rejected cross-tenant access, account/member revocation and recovery. Record evidence with synthetic data only. Confirm browser Firestore SDK attempts still deny. Record read/write usage and rate limits; larger portfolios must not silently truncate totals.
6. Run bounded retention preview and, after approval, apply:

   ```powershell
   npm run operator -- prune-idempotency $SyntheticTenant
   # Separate approved maintenance only; one batch <=100:
   npm run operator -- prune-idempotency $SyntheticTenant --apply
   ```

   Review count/morePossible, retain cleanup audit, repeat approved batches only as needed. No TTL or scheduled job is enabled by code. No-op batches must not change revision.
7. Rollback: deny edge traffic first, stop/drain writes, record current revision/digest/schema and review older-writer compatibility. Route to a known compatible revision only after authorization checks; do not erase or reset data/audits to hide a failed release. Retain staging evidence and isolate broken service identities. Close old tags/direct routes; revoke test sessions and memberships. Do not assume a container rollback reverses data or service-level ingress/IAM changes.
8. Cleanup after separate retention/cleanup approval: preserve a protected manifest/export and audit evidence; deny traffic, revoke synthetic memberships/sessions; verify isolated project and exact `synthetic-` tenant. Use the authorized Console to delete only that tenant and all descendants (deleting the parent alone does not remove subcollections), then verify no child documents remain. Remove only owner-approved synthetic Auth accounts, tags and staging resources, never production or unreviewed logs/backups. No destructive cleanup command is auto-executed. Record each action and restore plan in the change ticket.

## F. Production remains blocked

No merge, deploy, provider enablement, users/memberships, Firestore writes, IAM/API/billing/log/backup changes, DNS/traffic changes or resource creation are authorized by this coding PR. The existing production-intended database is untouched. Before production: independent architecture/security review; client/privacy approvals; isolated staging and smoke sign-off; real rules release verification; approved frontend/edge/IAM/service identity; backup/RPO/RTO/retention decisions; cost/monitoring and rollback acceptance; M4 report/hierarchy capacity remediation for expected scale; tenant-wide revision throughput review; and separately authorized release.

QuickBooks Online Accounting and QuickBooks Time stay separate and disabled (`server/integrations.ts`). No live OAuth, records or time sync. Only after a separately reviewed connector/sandbox milestone will an authorized owner enter each product's client secret/refresh material in **regional Google Cloud Secret Manager** using the approved regional API/service identity. No secret names, callbacks, production scopes or credentials are guessed here. Never enter them in React, Git, command examples, Firestore or a PR.
