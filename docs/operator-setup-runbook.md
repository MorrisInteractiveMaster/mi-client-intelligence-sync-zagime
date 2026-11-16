# Same-project named staging operator runbook — NOT EXECUTED

Current owner target: **morris-client-dash-zagime / mi-client-staging / northamerica-northeast1**. Production **(default)** is out of scope and must remain unchanged. This replaces the M5 requirement for a separate project. No resource, IAM, provider, user, credential, data, deployment or QuickBooks change was performed in this PR.

All live-changing operations below require independent review and explicit owner approval. Example identities, image digests, service names and database UID are placeholders; do not guess them. Stop if the named database is missing or mismatched; do not create/rename/clone/restore a database as a workaround.

## 1. Read-only inventory and database verification

The owner can inspect existing metadata without changing anything:

~~~powershell
gcloud projects describe morris-client-dash-zagime
gcloud firestore databases describe --project=morris-client-dash-zagime --database='mi-client-staging' --format=json
gcloud projects get-iam-policy morris-client-dash-zagime --format=json
gcloud services list --enabled --project=morris-client-dash-zagime
~~~

Record staging's exact name, system UID (UUID4), locationId=northamerica-northeast1, type=FIRESTORE_NATIVE and databaseEdition=STANDARD. Record production's known identity separately; do not query/change production tenant data. Staging existence/UID/edition and deployed rules have not been independently verified by this implementation. Confirm no project/database creation is needed before any activation. Actual metadata verification also runs at every staging process start.

In Firebase Console select **mi-client-staging** explicitly and inspect its published deny-all release/ruleset ID, content and timestamp. Selecting the production tab or seeing an unsaved rules editor is not staging verification. Browser reads/writes must remain denied on both DBs. firebase.json/default rules/index configuration is unchanged. firebase.staging.json contains only mi-client-staging for a separately approved future rules operation; do not use a generic all-database deployment command. If rules are missing/wrong, stop for a separately reviewed named-only rules change. Do not deploy rules during this coding task.

## 2. Review shared Authentication and approval boundaries

Use existing approved public Firebase web configuration for morris-client-dash-zagime, not a guessed new staging project/app. Provider/domain/web-app changes require separate privacy and owner approval and are not part of this task. Canadian client/reporting storage is preferred; Firebase Auth US-processing and applicable client contract requirements still need review.

Auth identities are shared, while each database has independent tenant memberships. A valid production administrator token alone must get 403 from staging without an approved named-database membership. Do not copy production memberships, raw records or audits to staging. Use existing approved synthetic identities and explicit staging approval only. Disabling/deleting/revoking an Auth account affects production sign-in too; rollback/cleanup normally changes only staging membership/edge access. Never perform shared-Auth mutation as an implicit staging cleanup step.

## 3. Database-specific IAM — design only, separate owner approval

Use dedicated staging runtime, bootstrap and retention identities; their actual service-account emails are UNVERIFIED. No downloaded service-account JSON keys. Runtime data role: deployment/staging-data-role.json (transactions, metadata, document get/list/create/update, no delete). Exact project IAM conditional binding: deployment/staging-data-binding.example.json. The condition must be:

~~~text
resource.name == "projects/morris-client-dash-zagime/databases/mi-client-staging"
~~~

No wildcard, prefix, not-default expression, unconditional datastore role or broad Owner/Editor role is acceptable. Review organization/folder/project/group/impersonation grants; IAM is additive and another broad grant defeats the condition. Do not remove/alter existing production identities/roles as part of this PR. Stage runtime also needs a separate project-scoped custom role containing only firebaseauth.users.get for token revocation/disabled checks; Firestore database conditions cannot scope that Auth permission. No Auth user-management permission is needed. A separate approved retention operator may receive datastore.entities.delete only under the same exact database condition. Bootstrap/seed need no delete. Do not grant service identity IAM or database-administration permissions.

[Firestore database IAM guidance](https://firebase.google.com/docs/firestore/manage-databases) and [IAM permission definitions](https://firebase.google.com/docs/firestore/security/iam) are the authoritative references. A Console data view does not prove database-conditional enforcement. No IAM change or role creation was made here.

## 4. Prove effective IAM before activation — read-only, owner-run

An authorized policy reviewer must be able to inspect all relevant policies/custom roles. Unknown or incomplete results are NOT denial. After any separately approved IAM changes and propagation, run:

~~~powershell
$StagingIdentity = 'OWNER_APPROVED_STAGING_SERVICE_ACCOUNT_EMAIL'
$EvidencePath = 'OWNER_PROTECTED_NEW_PATH.iam-evidence.json'
./scripts/verify-staging-iam.ps1 -PrincipalEmail $StagingIdentity -OutputPath $EvidencePath
~~~

This makes Policy Troubleshooter read-only checks for named grants and default denial across get/list/create/update/delete/transaction/metadata permissions. No production write experiment is used. Expected runtime result: named required permissions GRANTED, named delete NOT_GRANTED, every default permission NOT_GRANTED. Repeat for bootstrap identities; use -AllowStagingDelete only for an independently approved named retention identity. Preserve evidence privately outside Git. Incomplete hierarchy visibility, unknown condition context or unexpected access blocks activation. [Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) does not replace actual service identity or VPC/edge checks.

Then run the separately built read-only probe under the actual attached runtime identity, using an approved one-shot operator environment/container with no credential overrides. It checks metadata-server identity against STAGING_SERVICE_ACCOUNT_EMAIL, requires a matching evidence file less than one hour old, verifies named metadata, and tests named positive reads/default denied reads with random nonexistent paths. It never writes or reads client/tenant record paths. Default 200/404, missing named metadata, transport/API errors or ambiguous permissions are failures, not evidence of isolation.

~~~powershell
npm run probe:staging-iam -- --approved-read-only-probe OWNER_PROTECTED_RUNTIME_IAM_EVIDENCE_FILE
~~~

An approved attached-identity job may pass protected evidence through STAGING_IAM_EVIDENCE_JSON and use '-' instead of a file. This is policy evidence, never an access/refresh token. Do not put it into Git or the normal API container environment. The probe is not a startup hook, CI cloud test or public endpoint.

**Neither effective IAM nor this live read-only probe was run during implementation.** Do not set STAGING_IAM_VERIFIED=true until the operator has recorded both matrix and runtime probe success. For the one-shot probe, the flag may be temporarily set after matrix review so the guarded verifier can run; that is not permission to open API traffic. Repeat on image/identity/IAM changes. Never enable APIs or expand IAM merely to force a probe to pass without separate approval.

## 5. Explicit server configuration — default OFF

Use the existing Montréal region and approved new staging service identity, never the production service/identity. Fill UID from step 1; fake placeholder UID fails validation. Reviewed staging environment:

~~~text
BACKEND_MODE=staging
STAGING_FIREBASE_PROJECT_ID=morris-client-dash-zagime
FIRESTORE_DATABASE_ID=mi-client-staging
STAGING_DATABASE_UID=OWNER_VERIFIED_DATABASE_UUID4
STAGING_IAM_VERIFIED=false
ENABLE_SYNTHETIC_STAGING=false
ENABLE_LIVE_FIREBASE=false
FIRESTORE_RULES_VERIFIED=false
ALLOWED_ORIGIN=https://OWNER_APPROVED_FRONTEND_ORIGIN
~~~

The flags above remain false until steps 1–4 and owner release approval pass; committed deployment/cloud-run-staging.yaml is review-only/nondeployable. Production mode rejects staging settings. Missing/typo/default DB IDs, missing UID/attestations, emulator variables or key-file credentials block live staging. Metadata mismatch blocks startup before HTTP listen or operator data operations; never fix failure by switching to (default).

## 6. Local/emulator tests — no cloud credentials

Node 24 and Java 21+:

~~~powershell
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
~~~

The security runner uses firebase.emulators.json with one named rules configuration because the pinned CLI ignores multi-database rules arrays. It explicitly tests deny-all on both named and default emulator DBs. M5 fixtures use mi-client-staging; legacy default tests remain. Emulators do not enforce Google IAM. Unit IAM matrix/HTTP fixtures are contract tests, not live principal proof.

For optional existing M5 Chrome workflows, run the unchanged QA script with the named emulator configuration (isolated Playwright package and installed Chrome paths as in docs/qa-m5):

~~~powershell
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --config firebase.emulators.json --project demo-mi-security --only firestore,auth 'node --import tsx scripts/qa-m5.ts'
~~~

The same guards apply to a manually started local API/operator. Set BACKEND_MODE=emulator, FIRESTORE_DATABASE_ID=mi-client-staging, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 and FIRESTORE_EMULATOR_HOST=127.0.0.1:8080. Emulator fixtures are synthetic and local only. Do not export/import production data.

## 7. Exact controlled deployment sequence — future approval required

No deploy/build/resource creation command below was executed. Required approvals include image build/costs, a dedicated staging service/identity, edge/network/hostname/origin, named IAM/rules and shared-Auth privacy/use. Existing Google Cloud APIs and infrastructure must be inspected first. Required services remain Cloud Run, Firestore, Firebase Auth, regional Artifact Registry/approved Cloud Build, and approved load-balancing/Cloud Armor/logging/monitoring; Policy Troubleshooter availability is needed for step 4. Do not enable APIs automatically.

After explicit build approval, substitute only owner-verified names:

~~~powershell
$ProjectId = 'morris-client-dash-zagime'
$Region = 'northamerica-northeast1'
$ApiService = 'OWNER_APPROVED_STAGING_SERVICE_NAME'
$ImageTag = 'northamerica-northeast1-docker.pkg.dev/morris-client-dash-zagime/OWNER_APPROVED_REPOSITORY/mi-api:OWNER_APPROVED_COMMIT_TAG'
gcloud builds submit --project=$ProjectId --region=$Region --config=deployment/cloudbuild-staging.yaml --substitutions="_IMAGE=$ImageTag"
~~~

Record the approved immutable image digest and base image/dependency scan result; Docker image build was not locally verified here. In a separate reviewed manifest outside Git, render deployment/cloud-run-staging.yaml with the actual digest, dedicated staging service account, exact frontend origin, known project/named DB, verified UID and approved guards. Verify it does not name a production service or use the production identity. Never copy the production revision's environment wholesale.

Topology remains M5: external HTTPS Application Load Balancer + Cloud Armor -> regional serverless NEG -> Montréal Cloud Run. Ingress internal-and-gclb, direct run.app URL disabled, no alternate mappings/tag bypass, owner-approved invoker IAM-check configuration so browser Firebase-token/preflight traffic reaches application verification. Exact origin only; no credential cookies/wildcard CORS. Do not replace the edge with a directly public API. Runtime and database IAM enforce authorization independently of browser visibility.

Keep edge access denied while approving the new staging service, maximum one service/revision instance, min zero, concurrency 20, 1 CPU/512Mi, 10-second request timeout. Application socket-IP rate limiting remains 60/minute and ignores forwarded-IP spoofing; proxy users can share buckets. Owner-approved Cloud Armor supplies edge limits. Budgets are alerts, not hard caps; named DB/API/build/edge/log costs share the existing billing project and require review.

Only after explicit deployment approval, with the project fixed and the staging manifest independently reviewed:

~~~powershell
gcloud run services replace OWNER_REVIEWED_RENDERED_STAGING_MANIFEST --project=morris-client-dash-zagime --region=northamerica-northeast1
gcloud run services describe $ApiService --project=morris-client-dash-zagime --region=northamerica-northeast1
~~~

A merge never performs these commands. Do not route browser traffic until the live matrix/attached identity probe succeeds and synthetic smoke acceptance is approved. Non-sensitive /health is a process check, not database/IAM certification. No-auth protected data requests must return 401; default-only membership must return 403 from staging.

## 8. Synthetic initialization/admin bootstrap/maintenance — future approval only

Use an approved attached-identity operator environment with the exact named configuration in step 5 and reviewed guards; no JSON credential keys. For seed, use a new synthetic- prefixed tenant. For first admin use a protected independently approved UID/provider-subject/tenant/administrator approval file; no real identifiers are prepopulated. These are named-database operations only and never create an Auth user:

~~~powershell
npm run operator -- seed-synthetic OWNER_APPROVED_SYNTHETIC_TENANT
npm run operator -- bootstrap-admin OWNER_PROTECTED_BOOTSTRAP_APPROVAL_FILE
npm run operator -- prune-idempotency OWNER_APPROVED_SYNTHETIC_TENANT
~~~

Dry run is the default. Review previews and obtain separate approval before adding --apply. Do not run even dry-run cloud lookups in this coding task. Repeat bootstrap must be a no-op; it cannot reactivate a revoked membership. Verify all new tenant/membership/marker/audit/source/allocation/idempotency records exist only under mi-client-staging. Client/admin roles come from named memberships, never production claims. No production membership copying.

Cleanup is a separately approved named-only retention operation. First close/drain staging writers, retain protected synthetic evidence/audits per approved policy, and confirm both project and database **mi-client-staging** in the operator UI/tool. Parent deletion alone does not delete descendants. Never issue generic database deletion, project deletion, cross-database export/import, (default) cleanup or shared Auth-account deletion. No new generic destructive cleanup endpoint exists. Existing bounded idempotency cleanup rejects default/unverified handles and keeps business audits.

## 9. Synthetic staging smoke acceptance

Verify approved synthetic sign-in, default-only membership denial, project-specific editor restrictions, private creation, duplicate-request idempotency, name/plan/progress edits, reporting-only WO reference, allocation/history/raw immutability, month/lifetime counters, publication/client filtering, concurrent 409 recovery, current membership revocation and no-op writes. Named and default browser SDK reads/writes must still deny. Do not test production writes to prove IAM. Capture UID-free/token-free synthetic evidence and actual database-specific cost/read/write measurements before wider rollout. No live QuickBooks OAuth/sync; future approved QBO Accounting and QuickBooks Time secrets remain separate in regional Secret Manager, entered only in a later authorized connector milestone.

## 10. Rollback and production blockers

Deny staging edge traffic first, stop/drain staging writers, record named DB UID/revision/schema/current digest and identity. Roll back only to a reviewed image that supports explicit named staging selection and these guards. **M5 and earlier images are incompatible rollback targets for same-project staging**: they hardcode/refuse the project/default combination. Do not switch BACKEND_MODE to production, remove FIRESTORE_DATABASE_ID, point at (default), clone records, delete bootstrap markers or reset audits to make an old image run. If no compatible image exists, keep staging stopped with activation flags false.

Restore staging service revision/config only with separate owner approval; verify service-level ingress/IAM/default URL changes separately from image rollback. If needed disable only staging database memberships; do not revoke shared Auth sessions/accounts automatically. Revoke only the specifically approved staging IAM binding/identity access if approved after impact review; retain production policies intact. Review any named-only data recovery/cleanup independently and preserve audit evidence. Production database/traffic/backups/billing/providers/log configuration remain unchanged.

Production release remains blocked pending independent architecture/security review, actual named/default IAM proof, metadata/rules verification, privacy/client approvals, approved staging network/cost/rollback/smoke acceptance and M5 scale/recovery blockers (100-record reporting/hierarchy limits, tenant revision contention, per-instance limiter and memory-only retry drafts). No deployment, IAM or infrastructure approval is implied by this PR.
