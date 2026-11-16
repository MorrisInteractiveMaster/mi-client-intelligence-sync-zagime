# M7 exact next operator steps — no deployment or seed executed

Base main 691f5aa3babe140420425794f0b016c33986c954, PR #6 merged. Reuse the existing project, mi-client-staging database and mi-client-staging-api service account. **Do not recreate resources, repeat grants, restore Token Creator bindings, deploy, seed, enable providers or activate the API as part of this task.** Commands below are operator instructions, not actions already performed by the agent.

## Accepted cloud evidence

Owner-verified evidence is recorded in m7-cloud-evidence.json: project morris-client-dash-zagime; staging UID 6d09ea71-f495-44a5-94a6-732ed1c47d88; staging identity mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com; staging GET 404/LIST 200; default GET/LIST 403; temporary Token Creator binding removed. Execution timestamp and runtime attachment evidence were not supplied. These results establish the reported read boundary, not create/update/delete denial or the identity of a running container. Do not manufacture a fresh timestamp or treat the report as an automatic live-activation attestation.

The agent has no authenticated Cloud SDK/runtime connection and has not independently certified the remaining live checks. Unknown/permission-limited policy results must block progress, not trigger new IAM grants or a production write experiment.

## 1. Verify remaining write permissions — read-only, no new grants

From an already authorized policy-review session, run only these policy queries, which do not write Firestore:

```powershell
$ProjectId = 'morris-client-dash-zagime'
$Region = 'northamerica-northeast1'
$StagingIdentity = 'mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'
$WriteEvidencePath = 'OWNER_PROTECTED_NEW_PATH.iam-evidence.json'
./scripts/verify-staging-iam.ps1 -PrincipalEmail $StagingIdentity -WritePermissionsOnly -OutputPath $WriteEvidencePath
```

Expected matrix:

| Permission | mi-client-staging | (default) |
| --- | --- | --- |
| datastore.entities.create | GRANTED | NOT_GRANTED |
| datastore.entities.update | GRANTED | NOT_GRANTED |
| datastore.entities.delete | NOT_GRANTED for API runtime | NOT_GRANTED |

The checker makes six Policy Troubleshooter queries and preserves private evidence. It does not call Firestore write endpoints, impersonate the service account, enable APIs or change policy. Existing default GET/LIST probes do not need to be repeated. Do not use -AllowStagingDelete for the API identity. If delete is granted in staging, stop for privilege review; do not silently accept an expanded runtime role or alter IAM automatically. Unknown, missing, partial visibility or broad default access fails closed. Review inherited roles and unexpected import/export/bulk/database-administration permissions as well: the CRUD matrix is not a claim about every possible administrative permission. No broad roles or additional Token Creator grants.

Reference: [Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access). If the reviewer lacks complete policy visibility or the API is unavailable, preserve the failure and request review through the existing owner process; no grant/enable command is included here.

## 2. Inspect existing configured identity — read-only

The staging service/job names and deployed image digest have not been supplied. Substitute only existing owner-verified names; do not create a runner merely to make this check possible.

```powershell
$ExistingStagingService = 'OWNER_VERIFIED_EXISTING_STAGING_SERVICE_NAME'
gcloud run services describe $ExistingStagingService --project=$ProjectId --region=$Region --format='value(spec.template.spec.serviceAccountName)'
gcloud run services describe $ExistingStagingService --project=$ProjectId --region=$Region --format=json
```

Configured service account must equal $StagingIdentity. Inspect current image digest, disabled/live flags, exact named database/UID, ingress/default URL and origin configuration. A service-account label in a template is not evidence of the running identity. If there is no service, record attachment as NOT YET VERIFIABLE and keep API activation blocked; do not deploy one automatically.

For an **existing approved read-only checker job**, inspect its configuration first:

```powershell
$ExistingIdentityCheckJob = 'OWNER_VERIFIED_EXISTING_IDENTITY_CHECK_JOB_NAME'
gcloud run jobs describe $ExistingIdentityCheckJob --project=$ProjectId --region=$Region --format=json
```

Do not execute a seeder, writer, API server, old generic probe or an unknown job. Confirm the reviewed image contains the new check-staging-identity bundle, the command is node dist-server/check-staging-identity.mjs, its only argument is --approved-read-only-identity-check, its attached identity is $StagingIdentity, and its project/database/UID/expected-identity environment matches below. There must be no credential mounts/overrides. Require live API/Firebase flags to remain false for this identity-only check. Only after that independent job-execution approval:

```powershell
gcloud run jobs execute $ExistingIdentityCheckJob --project=$ProjectId --region=$Region --wait
```

This executes an already approved existing job; it does not create/replace one. If the exact job/image is absent, stop and retain a future release gate. A separately approved operator process already running under the attached identity can instead invoke:

```sh
node dist-server/check-staging-identity.mjs --approved-read-only-identity-check
```

Required checker environment (no secrets):

```text
BACKEND_MODE=staging
STAGING_FIREBASE_PROJECT_ID=morris-client-dash-zagime
FIRESTORE_DATABASE_ID=mi-client-staging
STAGING_DATABASE_UID=6d09ea71-f495-44a5-94a6-732ed1c47d88
STAGING_SERVICE_ACCOUNT_EMAIL=mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com
ENABLE_LIVE_FIREBASE=false
ENABLE_SYNTHETIC_STAGING=false
STAGING_IAM_VERIFIED=false
FIRESTORE_RULES_VERIFIED=false
```

Expected output: attachedIdentityMatched=true, firestoreOperations=0, apiActivated=false. It makes one trusted metadata-server email GET, validates the Metadata-Flavor header and exact expected identity; it does not acquire tokens, open Firestore, start HTTP, seed data or retest production reads. An error/unavailable metadata host is not a pass. [Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity) explains attached ADC usage. Fresh approved images must have no downloaded keys or alternate ADC credential files.

Live staging API/operator startup now performs the same identity check **before** credential acquisition/database metadata verification; the DB handle stays withheld if it fails. Emulator/legacy tests remain isolated and do not call the real metadata server.

## 3. Record remaining readiness gates; do not activate

Combine the owner's read evidence with actual write matrix, runtime attachment check and independent named deny-all published-rules verification. The flags in the committed manifest/examples remain false; the UID and service-account values are now populated from the supplied evidence. Do not set STAGING_IAM_VERIFIED merely because the read-only probes passed.

Still required: image digest/build approval, existing service/job names, published staging rules release, edge/CORS/origin validation, approved staging memberships/synthetic identities, Auth-processing/privacy/client requirements, cost and rollback acceptance. M5 scale/recovery limits remain. No automatic Cloud Build/deploy, service replacement, IAM/provider change or resource creation is part of this handoff.

## 4. Controlled synthetic smoke plan — preparation only

See m7-synthetic-smoke-tests.md for preconditions, exact order, expected counters/audits and stop criteria. Run local checks now if desired:

```powershell
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
```

Remote dry runs/seeding/bootstrap are **not** approved by this update. After a later explicit owner-approved release, guarded operator previews would be:

```powershell
npm run operator -- seed-synthetic synthetic-m7-smoke
npm run operator -- bootstrap-admin OWNER_PROTECTED_SYNTHETIC_ADMIN_APPROVAL_FILE
```

These commands default to dry-run but still require approved remote access, named configuration and completed guards. Do not add --apply or run them now. Existing synthetic accounts/memberships must be independently approved; do not create or modify shared Auth users as a smoke-test shortcut. No real UID, token or credential is placed in these examples.

## 5. Rollback/stop

On any failed gate: keep traffic blocked and all activation flags false; retain private evidence and stop. No retries that expand IAM or switch databases. After a separately approved eventual staging release, stop/drain staging writes before rollback and select only an image with named DB + attached-identity guards. Never use (default), an older hardcoded-default image, a new project, deleted audits/bootstrap markers or shared Auth revocation to recover staging. Do not restore the removed Token Creator binding. Production data/traffic/configuration remains untouched; QuickBooks integrations stay disabled.
