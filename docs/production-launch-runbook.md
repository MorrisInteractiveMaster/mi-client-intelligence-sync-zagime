# Zagimē production launch

The November 19, 2026 owner decision calls for a separate production deployment in the existing Google Cloud project. QuickBooks Time is the only source integration. This runbook applies to production. The [active staging runbook](project-only-operator-runbook.md) still applies to the existing staging service. Each **STOP** is an independent approval gate. Do not paste the entire runbook into one shell.

## Inventory and proposed resources

| Resource | Owner-provided inventory or proposal |
| --- | --- |
| Project and region | Existing `morris-client-dash-zagime` and `northamerica-northeast1` (Montréal) |
| Staging | Existing `mi-client-staging` and `mi-client-staging-dashboard`. Keep the serving staging revision, origin, synthetic records, identity and jobs unchanged |
| Registry | Existing regional `mi-client-build` repository. Use a distinct `mi-client-production` image |
| Firebase/Entra | Existing Firebase Authentication and staging Microsoft configuration. Approve the production public web settings, origins, redirect and authorized client identities separately |
| Production database | Proposed `mi-client-production`, Native Standard, Montréal, deletion protection, deny-all browser rules, named indexes and an owner-recorded database UID |
| Runtime and custom roles | Proposed `mi-client-production-api` service account, `miClientProductionData` and `miClientProductionAuthRead`. Use named-database conditions and read-only Firebase Auth lookup |
| API/frontend | Proposed `mi-client-prod-dashboard`, a same-origin service with 0 minimum instances, an initial 1-instance cap and a 210-second request timeout |
| Jobs | Proposed `mi-client-prod-operator` (no schedule) and `mi-client-prod-time-sync` (one task). Use the bounded production identity for the API and jobs. Only the designated operator may start jobs with overrides |
| Secrets | Proposed regional `mi-client-prod-time` and per-approval `mi-client-prod-client-approval-*` secrets. Only approved pinned versions are consumed |
| Scheduler | Scheduler API already enabled per the owner. Proposed `mi-client-prod-time-daily` with a dedicated owner-approved invoker, restricted to the Time job |

The active staging revision is not a production rollback target. Firestore `(default)` must remain untouched. Do not seed, copy, or migrate synthetic staging data. Firebase Auth remains shared within this project, with separate production memberships bound to each approved Google identity and explicit project IDs. Microsoft staff authorization still requires signed Firebase and Entra proof from the approved corporate tenant and a currently enabled Morris account. Document owner approval for identity processing and applicable client requirements. Canadian storage for project and reporting data does not establish blanket residency for identity or logging.

## 1. Read-only preflight

Run from a clean checkout with Node.js 24, Docker, jq and a current Google Cloud CLI. Fill every value where a `${…:?…}` check asks for owner evidence. Use the exact reviewed source for all commands.

```bash
set +x
set -euo pipefail
umask 077
PROJECT=morris-client-dash-zagime
REGION=northamerica-northeast1
DATABASE=mi-client-production
SERVICE=mi-client-prod-dashboard
OPERATOR=mi-client-prod-operator
JOB=mi-client-prod-time-sync
SCHEDULE=mi-client-prod-time-daily
PROD_SA="mi-client-production-api@$PROJECT.iam.gserviceaccount.com"
IMAGE_REPO="$REGION-docker.pkg.dev/$PROJECT/mi-client-build/mi-client-production"
regional_secrets() {
  CLOUDSDK_API_ENDPOINT_OVERRIDES_SECRETMANAGER="https://secretmanager.$REGION.rep.googleapis.com/" gcloud secrets "$@"
}
: "${REVIEWED_SHA:?Set the reviewed immutable Git commit}"
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]
test -z "$(git status --porcelain)"
git fetch origin "$REVIEWED_SHA"
git switch --detach "$REVIEWED_SHA"
test "$(git rev-parse HEAD)" = "$REVIEWED_SHA"

gcloud run services list --project="$PROJECT" --region="$REGION" --format='table(metadata.name,status.latestReadyRevisionName)'
gcloud run services describe mi-client-staging-dashboard --project="$PROJECT" --region="$REGION" \
  --format='table(status.traffic.revisionName,status.traffic.percent)'
gcloud run jobs list --project="$PROJECT" --region="$REGION"
gcloud scheduler jobs list --project="$PROJECT" --location="$REGION"
gcloud artifacts repositories describe mi-client-build --project="$PROJECT" --location="$REGION" --format='value(format)'
gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' |
  grep -E '^(firestore|identitytoolkit|run|artifactregistry|secretmanager|cloudscheduler)\.googleapis\.com$'
```

Privately review any existing production resources before reuse. Review project and ancestor IAM policies, custom roles, group memberships, service-account impersonation and organization constraints. Use current effective-access evidence. A matching condition or an inconclusive troubleshooter result does not prove write isolation. No probe may access `(default)` or the staging database with production credentials. Verify the runtime cannot inherit broad database roles, write Auth users, assign IAM or invoke jobs with overrides.

## 2. Create and secure the named database

**STOP for database, rules, index and IAM approval.** Reuse the exact named database if it already exists after independently checking its UID, location, edition, rules and contents. Otherwise use the following approved creation step. Confirm `firestore.rules` denies all native browser access. Use a trusted operator with authority over these operations and keep outputs private.

```bash
gcloud firestore databases create --project="$PROJECT" --database="$DATABASE" --location="$REGION" \
  --type=firestore-native --edition=standard --delete-protection
gcloud firestore databases describe --project="$PROJECT" --database="$DATABASE" \
  --format='yaml(name,uid,locationId,type,databaseEdition,deleteProtectionState)'
: "${APPROVED_DATABASE_UID:?Set the independently recorded production database UID}"
[[ "$APPROVED_DATABASE_UID" =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]]
[[ "$APPROVED_DATABASE_UID" != 6d09ea71-f495-44a5-94a6-732ed1c47d88 ]]
test "$(gcloud firestore databases describe --project="$PROJECT" --database="$DATABASE" --format='value(uid)')" = "$APPROVED_DATABASE_UID"

npm ci --ignore-scripts
npx --no-install firebase deploy --project="$PROJECT" --config=firebase.production.json --only="firestore:$DATABASE" --non-interactive
gcloud firestore indexes composite list --project="$PROJECT" --database="$DATABASE" --format='table(name,state)'

gcloud iam service-accounts create mi-client-production-api --project="$PROJECT" \
  --display-name="Morris production dashboard runtime"
gcloud iam roles create miClientProductionData --project="$PROJECT" --file=deployment/production-data-role.json
gcloud iam roles create miClientProductionAuthRead --project="$PROJECT" --file=deployment/production-auth-role.json
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$PROD_SA" \
  --role="projects/$PROJECT/roles/miClientProductionData" \
  --condition="expression=resource.name==\"projects/$PROJECT/databases/$DATABASE\",title=production-dashboard-database"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$PROD_SA" \
  --role="projects/$PROJECT/roles/miClientProductionAuthRead" --condition=None
```

Wait for named indexes to be ready and independently verify the live named rules, the effective exact-database access and absence of broader access before setting verification flags. Allow the deploy operator to attach only the approved service identity. Never use downloaded service-account keys. The runtime checks its attached service-account email before requesting credentials, then requests regional database metadata and checks the name, UID, location, edition and mode before acquiring a document handle. The data role has no entity delete permission. The Auth role has only `firebaseauth.users.get` for token revocation and provider checks. [Database setup and IAM](https://cloud.google.com/firestore/docs/manage-databases) · [Named rules deployment](https://firebase.google.com/docs/rules/manage-deploy)

## 3. Build and initialize, then deploy privately

**STOP for image push and operator job approval.** The Firebase Web API key is public web app configuration. OAuth secrets, approval documents and tokens must stay out of build arguments. Use actual values from the approved Firebase Web App and Entra configuration. The tenant ID is the approved production dashboard tenant identifier. Use a distinct non-synthetic tenant and do not reuse a staging identifier.

```bash
: "${TENANT:?Set the approved production tenant ID}"
: "${VITE_FIREBASE_API_KEY:?Set the approved public Web API key}"
: "${VITE_FIREBASE_APP_ID:?Set the approved Web App ID}"
: "${VITE_FIREBASE_AUTH_DOMAIN:?Set the approved Firebase auth domain}"
: "${MORRIS_ENTRA_TENANT_ID:?Set the approved Entra tenant ID}"
: "${MORRIS_ENTRA_CLIENT_ID:?Set the approved Microsoft client ID}"
: "${MAIN_ORIGIN:?Set the approved production HTTPS origin with no path}"
[[ "$TENANT" =~ ^[a-z][a-z0-9-]{1,100}$ && "$TENANT" != synthetic-* ]]
[[ "$MAIN_ORIGIN" =~ ^https://[a-z0-9.-]+$ ]]
test "$(git rev-parse HEAD)" = "$REVIEWED_SHA"
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build --platform linux/amd64 -f deployment/Dockerfile \
  -t "$IMAGE_REPO:$REVIEWED_SHA" \
  --build-arg VITE_DASHBOARD_DEPLOYMENT=production \
  --build-arg "VITE_SECURE_TENANT_ID=$TENANT" \
  --build-arg "VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY" \
  --build-arg "VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID" \
  --build-arg "VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg "VITE_MORRIS_ENTRA_TENANT_ID=$MORRIS_ENTRA_TENANT_ID" .
docker push "$IMAGE_REPO:$REVIEWED_SHA"
IMAGE="$(docker inspect --format='{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE_REPO:$REVIEWED_SHA" |
  grep -F "$IMAGE_REPO@sha256:")"
[[ "$IMAGE" == "$IMAGE_REPO"@sha256:* && "${IMAGE##*@sha256:}" =~ ^[0-9a-f]{64}$ ]]
gcloud artifacts docker images describe "$IMAGE" --project="$PROJECT" --format='value(image_summary.digest)'

PROD_ENV="$(mktemp)"
cat >"$PROD_ENV" <<EOF
BACKEND_MODE: "production"
ENABLE_PRODUCTION: "true"
ENABLE_LIVE_FIREBASE: "true"
FIRESTORE_RULES_VERIFIED: "true"
PRODUCTION_IAM_VERIFIED: "true"
FIRESTORE_DATABASE_ID: "$DATABASE"
PRODUCTION_FIREBASE_PROJECT_ID: "$PROJECT"
PRODUCTION_DATABASE_UID: "$APPROVED_DATABASE_UID"
PRODUCTION_SERVICE_ACCOUNT_EMAIL: "$PROD_SA"
MORRIS_DASHBOARD_TENANT_ID: "$TENANT"
MORRIS_ENTRA_TENANT_ID: "$MORRIS_ENTRA_TENANT_ID"
MORRIS_ENTRA_CLIENT_ID: "$MORRIS_ENTRA_CLIENT_ID"
ALLOWED_ORIGIN: "$MAIN_ORIGIN"
ENABLE_QUICKBOOKS_TIME: "false"
PRODUCTION_TIME_APPROVED: "false"
EOF

gcloud run jobs create "$OPERATOR" --project="$PROJECT" --region="$REGION" \
  --image="$IMAGE" --service-account="$PROD_SA" --env-vars-file="$PROD_ENV" \
  --command=node --args="dist-server/operator.mjs,initialize-production,$TENANT" \
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=60s
gcloud run jobs execute "$OPERATOR" --project="$PROJECT" --region="$REGION" --wait
```

The dry run must report zero fixtures and no existing tenant or orphan records. **STOP for production initialization approval**, then create the empty tenant and audit together. **STOP for private service deployment approval** before the deploy command. The first revision of a new service has no previous production revision to receive traffic. Keep the service private while verifying it. If using the Google-assigned origin, set the intended origin before allowing browser traffic. Once the service reports its exact URL, set `ALLOWED_ORIGIN` to that exact origin in a new private revision if it differs. A tag URL is a separate origin and cannot verify the primary sign-in flow.

```bash
gcloud run jobs execute "$OPERATOR" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,initialize-production,$TENANT,--apply"
```

**STOP.** Deploy the private service only after approving that separate step.

```bash
gcloud run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$IMAGE" --service-account="$PROD_SA" --env-vars-file="$PROD_ENV" \
  --execution-environment=gen2 --ingress=all --invoker-iam-check \
  --no-allow-unauthenticated --min-instances=0 --max-instances=1 --timeout=210s
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.url,status.latestReadyRevisionName,status.traffic,spec.template.spec.serviceAccountName)'
REVISION="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.latestReadyRevisionName)')"
gcloud run revisions describe "$REVISION" --project="$PROJECT" --region="$REGION" --format='value(status.imageDigest)'
# For a Google-assigned origin, if the approved origin differs, update MAIN_ORIGIN
# to the exact status.url and also reflect it in the private PROD_ENV file.
# gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --update-env-vars="ALLOWED_ORIGIN=$MAIN_ORIGIN"
gcloud run services proxy "$SERVICE" --project="$PROJECT" --region="$REGION" --port=8080
# From another terminal, use the authenticated local proxy for basic infrastructure smoke.
# curl --fail-with-body http://127.0.0.1:8080/health
```

**STOP for authentication and launch approval.** Verify the approved Firebase authorized domain, Microsoft redirect `https://<APPROVED_AUTH_DOMAIN>/__/auth/handler` and existing corporate Entra application settings. Do not change staging provider settings or credentials. Approve Google provider use for clients. The Cloud Run HTTPS transport needs to admit browsers because their application bearer token is a Firebase token. If approved by owner and organization policy, grant service-level invocation only as shown below. The application independently verifies every protected request, applies exact-origin checks and enforces project-level publication and scope. Never add a public IAM grant to a job, database or secret.

```bash
gcloud run services add-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker
curl --fail-with-body "$MAIN_ORIGIN/health"
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "$MAIN_ORIGIN/api/v2/tenants/$TENANT/workspace")"
test "$status" = 401
```

Open the main-origin dashboard in a real browser. Verify Microsoft sign-in, an authorized staff save and refresh using only an approved production test record, isolation between projects, explicit publication, denied cross-tenant requests and disconnected Time. Verify the browser Firestore denial and that signin failure shows a useful message. Confirm a fresh approved client session sees only its published projects and allocated aggregates. Verify unapproved and revoked access, month switching, notes/Time/audit denial and client write denial. Do not place production data in synthetic screens or logs. [Firebase authentication troubleshooting](https://firebase.google.com/docs/auth/faq-and-troubleshooting) · [Cloud Run public transport](https://cloud.google.com/run/docs/authenticating/public)

### Client access approval

Approve each client identity and exact internal project IDs before running the operator. The existing verified Google user must already exist in Firebase. Store an approval payload with `approved: true`, `tenantId`, `databaseUid`, `action` (`grant` or `revoke`), `uid` and `projectIds` in a private transient file. A grant requires project IDs. For revocation, use an empty list. Changing an approved scope requires revoking the old membership and independently approving the complete replacement project list for the same Google identity. Revocation changes production membership only and leaves the shared Firebase account and staging intact.

Use the regional secret command in the next section with a unique approved `mi-client-prod-client-approval-*` ID in place of the Time secret. Grant the runtime access only on that secret. Use the numeric version and SHA-256 of the exact uploaded bytes. **STOP before apply.** Remove access to the approval secret after the approved operation completes. Follow retention policy for the approval record.

```bash
: "${CLIENT_APPROVAL_SECRET_ID:?Set the approved regional approval secret ID}"
: "${CLIENT_APPROVAL_VERSION:?Set the approved numeric version}"
: "${CLIENT_APPROVAL_SHA256:?Set the exact approval payload digest}"
[[ "$CLIENT_APPROVAL_SECRET_ID" =~ ^mi-client-prod-client-approval-[a-z0-9-]+$ &&
   "$CLIENT_APPROVAL_VERSION" =~ ^[1-9][0-9]*$ && "$CLIENT_APPROVAL_SHA256" =~ ^[a-f0-9]{64}$ ]]
APPROVAL_REFS="PRODUCTION_CLIENT_APPROVAL_SECRET_ID=$CLIENT_APPROVAL_SECRET_ID,PRODUCTION_CLIENT_APPROVAL_SECRET_VERSION=$CLIENT_APPROVAL_VERSION,PRODUCTION_CLIENT_APPROVAL_SHA256=$CLIENT_APPROVAL_SHA256"
gcloud run jobs execute "$OPERATOR" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,provision-production-client,$TENANT" --update-env-vars="$APPROVAL_REFS"
```

**STOP.** Apply the membership change only after checking the dry run and approving the exact project scope.

```bash
gcloud run jobs execute "$OPERATOR" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,provision-production-client,$TENANT,--apply" --update-env-vars="$APPROVAL_REFS"
```

## 4. Approve the QuickBooks Time scope and first import

**STOP for separate Time entitlement, data access and credentials approvals.** Independently verify the numeric Time company, provider user and exact parent jobcode of **Zagimē Anishinabēk Nation**. Check the four work-order references in the authorized account. Names are reference evidence. The numeric company/parent relationship controls scope. Approve the earliest permitted modification date, the existing authorized Morris connector operator’s Firebase UID, and entitlement for archived work, corrections and deletions. Review running timers separately before enabling that optional snapshot. Review [Time scoping and reconciliation](integration-quickbooks-time.md).

Store the exact UTF-8 payload in an owner-controlled temporary file with mode 0600. The fields are `environment: "production"`, `databaseUid`, `modifiedFrom`, `tenant`, `companyId`, `userId`, `customerParentId`, `clientUrl`, `expiresAt` (UTC ISO with milliseconds) and `accessToken`. IDs are strings. Enter the token through the owner’s secret handling workflow. Keep it out of terminal commands, plaintext environment variables, GitHub, Codex and logs. Compute a digest of the exact uploaded bytes. Separate account evidence is required if the provider identity response omits the company ID. Store access only for the matching production runtime with the secret-level role.

```bash
: "${SECRET_PAYLOAD_FILE:?Set the private transient secret payload file path}"
test -f "$SECRET_PAYLOAD_FILE" && test "$(stat -c '%a' "$SECRET_PAYLOAD_FILE")" = 600
TIME_SECRET=mi-client-prod-time
TIME_DIGEST="$(sha256sum "$SECRET_PAYLOAD_FILE" | cut -d ' ' -f1)"
regional_secrets create "$TIME_SECRET" --project="$PROJECT" --location="$REGION" \
  --data-file="$SECRET_PAYLOAD_FILE" --format='value(name)'
# For an existing secret, use versions add instead of create to obtain the new version:
# regional_secrets versions add "$TIME_SECRET" --project="$PROJECT" --location="$REGION" --data-file="$SECRET_PAYLOAD_FILE" --format='value(name)'
# Record the numeric version from the secret version output or this metadata-only check.
regional_secrets versions list "$TIME_SECRET" --project="$PROJECT" --location="$REGION" --format='table(name,state)'
: "${TIME_VERSION:?Set the approved numeric version matching the uploaded payload}"
[[ "$TIME_VERSION" =~ ^[1-9][0-9]*$ && "$TIME_DIGEST" =~ ^[a-f0-9]{64}$ ]]
regional_secrets add-iam-policy-binding "$TIME_SECRET" --project="$PROJECT" --location="$REGION" \
  --member="serviceAccount:$PROD_SA" --role=roles/secretmanager.secretAccessor
```

Remove the temporary credential file promptly by the approved secret handling procedure. For rotation, upload a new numeric version, pin the new digest, verify approved scope and update the job and dashboard through separate rollout before disabling the previous one. No automatic token refresh is implemented. Expired credentials fail closed. [Regional endpoint configuration](https://cloud.google.com/secret-manager/regional-secrets/config-sm-rs) · [Regional secrets and versions](https://cloud.google.com/secret-manager/regional-secrets/add-secret-version-rs)

**STOP for job creation approval.** The job starts without an open browser and creation does not execute it. The dashboard remains Time-disabled during the pilot. Build the Time environment by overlaying only the reviewed non-secret settings. Use the same immutable production image. The maximum execution deadline covers the bounded daily sync and the lower request timeout covers the designated manual retry. Review alerting, log retention and cost before activation.

```bash
: "${TIME_ACCOUNT_ID:?Set the approved Time company ID}"
: "${TIME_USER_ID:?Set the approved provider user ID}"
: "${TIME_PARENT_ID:?Set the approved customer jobcode ID}"
: "${TIME_ACCOUNT_SLUG:?Set the approved account slug}"
: "${TIME_MODIFIED_FROM:?Set the approved UTC modification floor}"
: "${TIME_ADMIN_UID:?Set the designated Morris operator Firebase UID}"
for id in "$TIME_ACCOUNT_ID" "$TIME_USER_ID" "$TIME_PARENT_ID"; do [[ "$id" =~ ^[1-9][0-9]*$ ]]; done
[[ "$TIME_ACCOUNT_SLUG" =~ ^[a-zA-Z0-9_-]{1,100}$ && "$TIME_MODIFIED_FROM" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ &&
   "$TIME_ADMIN_UID" =~ ^[-a-zA-Z0-9_]{1,128}$ ]]
TIME_ENV="$(mktemp)"
grep -Ev '^(ENABLE_QUICKBOOKS_TIME|PRODUCTION_TIME_APPROVED):' "$PROD_ENV" >"$TIME_ENV"
cat >>"$TIME_ENV" <<EOF
ENABLE_QUICKBOOKS_TIME: "true"
PRODUCTION_TIME_APPROVED: "true"
QUICKBOOKS_TIME_ACCOUNT_ID: "$TIME_ACCOUNT_ID"
QUICKBOOKS_TIME_CREDENTIAL_USER_ID: "$TIME_USER_ID"
QUICKBOOKS_TIME_CUSTOMER_PARENT_ID: "$TIME_PARENT_ID"
QUICKBOOKS_TIME_CLIENT_URL: "$TIME_ACCOUNT_SLUG"
QUICKBOOKS_TIME_MODIFIED_FROM: "$TIME_MODIFIED_FROM"
QUICKBOOKS_TIME_ADMIN_UID: "$TIME_ADMIN_UID"
QUICKBOOKS_TIME_SECRET_ID: "$TIME_SECRET"
QUICKBOOKS_TIME_SECRET_VERSION: "$TIME_VERSION"
QUICKBOOKS_TIME_CREDENTIAL_SHA256: "$TIME_DIGEST"
QUICKBOOKS_TIME_ON_CLOCK_SNAPSHOT: "false"
EOF

gcloud run jobs create "$JOB" --project="$PROJECT" --region="$REGION" \
  --image="$IMAGE" --service-account="$PROD_SA" --env-vars-file="$TIME_ENV" \
  --command=node --args="dist-server/operator.mjs,sync-time-customer,$TENANT" \
  --tasks=1 --parallelism=1 --max-retries=1 --task-timeout=1800s
gcloud run jobs describe "$JOB" --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.template.spec.serviceAccountName,spec.template.spec.template.spec.containers[0].image)'

```

**STOP for read-only customer verification approval.**

```bash
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,verify-time-customer,$TENANT"
```

**STOP for production enrollment approval.** This commits a customer binding and audit only.

```bash
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,verify-time-customer,$TENANT,--apply"
```

**STOP for first import approval.** This synchronizes the scoped work orders up to existing bounded limits.

```bash
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait
```

Compare the registered work orders with the independently verified child work orders. Confirm new projects are unpublished, repeated syncs do not duplicate projects or hours, corrected/deleted time reconciles, recorded totals are distinct from allocated and unallocated time, and unverifiable approval remains unknown. Review any incomplete checkpoints before retrying. Only browser-authorized Morris connector operators can invoke the existing scoped manual sync endpoint after the dashboard is enabled.

**STOP for dashboard connector cutover.** Record the current production revision and pin its image for rollback. Stage the candidate with the full verified production settings and the same origin and identity. The candidate must receive zero normal traffic. Use its tagged URL for unauthenticated asset smoke only. After review, separately authorize traffic and repeat main-origin sign-in, project persistence, audit, Time status and client privacy checks. The baseline runbook below assumes a single production revision at 100 percent. If production has split traffic, record and restore the complete map.

```bash
BASELINE="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json |
  jq -er '[.status.traffic[] | select((.percent // 0)>0)] | select(length==1 and .[0].percent==100) | .[0].revisionName')"
gcloud run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$IMAGE" --service-account="$PROD_SA" --env-vars-file="$TIME_ENV" \
  --no-traffic --tag=time-candidate --timeout=210s
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.latestReadyRevisionName,status.traffic)'
CANDIDATE="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(status.latestReadyRevisionName)')"
test "$CANDIDATE" != "$BASELINE"
gcloud run revisions describe "$CANDIDATE" --project="$PROJECT" --region="$REGION" \
  --format='value(status.imageDigest)'
```

**STOP for traffic cutover approval.** Compare the candidate image and main-origin settings with the reviewed values. Confirm that the baseline still receives 100 percent of normal traffic.

```bash
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" --to-revisions="$CANDIDATE=100"
```

## 5. Approve 6 AM Saskatchewan scheduling

**STOP for Scheduler and invoker approval.** Verify the provider pilot and the main-origin dashboard checks before creating the schedule. Use a dedicated, approved same-project service identity restricted to invoking this job. A newly created schedule is active. Check the next due time before creating it. Scheduler success confirms dispatch. Check actual Cloud Run execution and persisted synchronization state separately.

```bash
: "${SCHEDULER_INVOKER_EMAIL:?Set the approved dedicated Scheduler invocation identity}"
[[ "$SCHEDULER_INVOKER_EMAIL" == *"@$PROJECT.iam.gserviceaccount.com" &&
   "$SCHEDULER_INVOKER_EMAIL" != "$PROD_SA" ]]
gcloud run jobs add-iam-policy-binding "$JOB" --project="$PROJECT" --region="$REGION" \
  --member="serviceAccount:$SCHEDULER_INVOKER_EMAIL" --role=roles/run.invoker
gcloud scheduler jobs create http "$SCHEDULE" --project="$PROJECT" --location="$REGION" \
  --schedule='0 6 * * *' --time-zone=America/Regina \
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run" \
  --http-method=POST --oauth-service-account-email="$SCHEDULER_INVOKER_EMAIL" \
  --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform \
  --attempt-deadline=30s --max-retry-attempts=1 --min-backoff=60s --max-backoff=60s
gcloud scheduler jobs describe "$SCHEDULE" --project="$PROJECT" --location="$REGION" \
  --format='yaml(state,schedule,timeZone,httpTarget.uri)'
```

[Cloud Run scheduled execution](https://cloud.google.com/run/docs/execute/jobs-on-schedule) · [Schedule definition](../deployment/production-time-scheduler.example.json)

## Rollback

Use the approved incident procedure. Pause the schedule if created and block any additional manual imports. The pause does not cancel in-flight work. Inspect executions and cancel the affected execution when authorized. Wait for the bounded job lease before retrying. For the Time rollout, restore the recorded Time-disabled production revision and remove the candidate tag. For the first production release, withdraw public service invocation if no previous production revision exists. Keep the production database, audit history, mappings, allocation revisions and checkpoints intact. Escalate any data correction separately.

```bash
gcloud scheduler jobs pause "$SCHEDULE" --project="$PROJECT" --location="$REGION"
gcloud run jobs executions list --job="$JOB" --project="$PROJECT" --region="$REGION"
# After approval, for an active execution only.
# gcloud run jobs executions cancel "$EXECUTION" --project="$PROJECT" --region="$REGION"
# For a Time rollout with a recorded production baseline.
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" --to-revisions="$BASELINE=100" --remove-tags=time-candidate
# For an initial launch with no previous production revision, withdraw browser transport access.
gcloud run services remove-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker
```

Repeat the relevant production health, authentication, client privacy and stored-project checks after rollback. Never route production browsers to staging or switch databases.
