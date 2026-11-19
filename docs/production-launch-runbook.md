# Zagimē production launch and QuickBooks Time activation

The November 19, 2026 owner decision calls for a separate production deployment in the existing Google Cloud project. QuickBooks Time is the only source integration. This runbook applies to production. The [active staging runbook](project-only-operator-runbook.md) still applies to the existing staging service. Each **STOP** is an independent approval gate. Do not paste the entire runbook into one shell.

## Existing production service

The owner reports that the production dashboard, named database, indexes and Microsoft sign-in are operating. **Start at [production Time activation](#4-production-time-activation)**. The initial build/bootstrap instructions in sections 1–3 are retained for recovery history. They are not activation steps for the current service.

## Original inventory and resource proposals

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

## 4. Production Time activation

Work in the existing production environment. Run each command from the reviewed checkout in a single owner-controlled Cloud Shell account. The helper records non-secret state under `~/.mi-zagime-time-production` with mode 0700. It never prints the Time token, uploads secret bytes through a pipe, and does not touch the browser's existing Firebase or Microsoft configuration. Every cloud-changing command is a separate invocation with a typed confirmation. Close the terminal only after confirming the last successful phase with `report`. A failed cloud response can follow a successful remote mutation. Check the named resource in the Console before retrying any failed phase.

### 4.1 Read-only preflight

```bash
set +x
set -euo pipefail
umask 077
: "${REVIEWED_SHA:?Set the approved activation source commit}"
[[ "$REVIEWED_SHA" =~ ^[a-f0-9]{40}$ ]]
test -z "$(git status --porcelain)"
git fetch origin main
git merge-base --is-ancestor "$REVIEWED_SHA" origin/main
git switch --detach "$REVIEWED_SHA"
for executable in gcloud python3 curl jq; do command -v "$executable" >/dev/null; done

TIME_ACTIVATION='scripts/production-time.py'
PROJECT='morris-client-dash-zagime'
REGION='northamerica-northeast1'
ORIGIN='https://mi-client-prod-dashboard-u3xjh6xfkq-nn.a.run.app'
RUNTIME_SA="mi-client-production-api@$PROJECT.iam.gserviceaccount.com"
python3 "$TIME_ACTIVATION" preflight
curl --fail --silent --show-error "$ORIGIN/health" | jq -e '.status == "ready"'
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "$ORIGIN/api/v2/tenants/zagime-production/workspace")"
test "$status" = 401
```

Expect one serving revision at 100 percent, an immutable Montréal registry digest, named database UID `b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd`, two required ready composite indexes and verified deny-all rules for that named database. Record the existing job and schedule inventory. If the named rules, image, origin, attached identity or tenant differ, stop and reconcile the inventory. If preflight cannot read the named Firebase rules release, obtain read access or have the authorized owner run it. Keep the baseline revision and image available for rollback. The running dashboard should continue to show Time disconnected.

**STOP for independent IAM review.** Have a reviewer with the necessary ancestor and group visibility confirm the effective permissions of the production runtime and intended scheduler invoker. Use the following read-only evidence, privately. Select the highest actual ancestor reported by `get-ancestors`. Use `--project` only if the project has no parent, otherwise use the highest organization or folder scope. Confirm group expansion and analysis completeness. Review custom role definitions, conditions, deny policies and principal access boundaries, inherited grants, and impersonation paths. The database allow must use exact equality to `projects/morris-client-dash-zagime/databases/mi-client-production`, permit only the reviewed create/update/read permissions, and have no broader grant. Firebase Auth lookup and the eventual access to the single regional Time secret must be independently scoped. Check that the Scheduler identity has no data or secret role. An inconclusive report is a stop. The actual attached runtime will reverify its email and read the named database in the dry-run worker. Do not probe either other database. [Google Cloud allow-policy analysis](https://cloud.google.com/policy-intelligence/docs/analyze-iam-policies)

```bash
gcloud projects get-ancestors "$PROJECT" --format='table(type,id)'
gcloud iam service-accounts get-iam-policy "$RUNTIME_SA" --project="$PROJECT" --format=json > "$HOME/.mi-zagime-time-production/runtime-sa-policy.json"
gcloud iam roles describe miClientProductionData --project="$PROJECT" --format=json > "$HOME/.mi-zagime-time-production/data-role.json"
gcloud iam roles describe miClientProductionAuthRead --project="$PROJECT" --format=json > "$HOME/.mi-zagime-time-production/auth-role.json"
: "${IAM_SCOPE_FLAG:?Set --organization=ID or --folder=ID or the verified parentless --project=PROJECT}"
[[ "$IAM_SCOPE_FLAG" =~ ^--(organization|folder)=[0-9]+$ || "$IAM_SCOPE_FLAG" == "--project=$PROJECT" ]]
gcloud asset analyze-iam-policy "$IAM_SCOPE_FLAG" --identity="serviceAccount:$RUNTIME_SA" \
  --expand-groups --expand-roles --show-response --format=json > "$HOME/.mi-zagime-time-production/runtime-allow-analysis.json"
```

If the analyzer or ancestor visibility is unavailable, use an authorized IAM administrator's signed review of the complete policy chain and group effective membership. Do not enable APIs just to collect evidence. If the reviewer cannot establish isolation without probing other databases, keep activation stopped. No rollback is needed for these checks. Retain or remove the private review files per company policy.

### 4.2 Approve company identity and enroll a pinned credential

Intuit documents `company_id`, `user_id` and `client_url` in the Time OAuth grant response. Its documented `current_user` response includes the active user ID and account slug and can omit `company_id`. The Time website's Company Details identifier is a candidate. Accept it only if the account owner can match it to existing grant metadata for the **same Time Add-on credential/account**, or receives written confirmation from Intuit that the website value is this Add-on account's API `company_id`. In a private ticket record only the tuple, evidence type and date. Never share the grant payload, token, refresh token, client secret, or a screenshot that contains them. If neither evidence source is available, stop before uploading or using the credential. The current application rejects a conflicting company ID whenever the provider supplies one, and always checks the slug and active user. No new OAuth app, callback, or refresh implementation is required. [Intuit QuickBooks Time API reference](https://tsheetsteam.github.io/api_docs/)

Use the four previously approved jobcode and Time Project ID pairs for this first pilot. Pair IDs come from the verified child inventory and scoped QuickBooks Time project metadata. The similarly named top-level customer is excluded. Do not publish any discovered draft during reconciliation. Have the data owner approve the exact UTC **modification** floor, as distinct from work date. Older work can qualify if it was modified after that floor. Use the existing credential's grant issue time plus `expires_in`, an explicit expiration shown for the token, or an earlier owner-imposed cutoff grounded in independently confirmed provider validity. Record the earliest applicable expiry as `YYYY-MM-DDTHH:MM:SS.sssZ`. Never assume the token is perpetual. Use the approved connector operator's existing Firebase UID from Authentication → Users for the same Microsoft user who already has Morris staff access. A UID by itself does not grant staff permissions.

Set the following approved values privately. The company ID, provider user, slug, parent and approved jobcode/project pairs are non-secret operational identifiers. Keep them in the owner's private checkout or shell session and out of public issues or PRs. Obtain any missing confirmed scope value from the existing account evidence. Do not reuse a similarly named jobcode or an Accounting identifier.

```bash
: "${TIME_COMPANY_ID:?Set the independently confirmed numeric Time API company_id}"
: "${TIME_USER_ID:?Set the verified active Time user ID}"
: "${TIME_SLUG:?Set the verified Time account slug}"
: "${TIME_PARENT_ID:?Set the independently verified numeric customer parent jobcode}"
: "${TIME_WORK_ORDER_1:?Set first verified jobcode ID:Time Project ID pair}"
: "${TIME_WORK_ORDER_2:?Set second verified jobcode ID:Time Project ID pair}"
: "${TIME_WORK_ORDER_3:?Set third verified jobcode ID:Time Project ID pair}"
: "${TIME_WORK_ORDER_4:?Set fourth verified jobcode ID:Time Project ID pair}"
: "${TIME_MODIFIED_FROM:?Set the owner-approved UTC modification floor}"
: "${TIME_EXPIRES_AT:?Set approved exact UTC token expiry with milliseconds}"
: "${MORRIS_OPERATOR_UID:?Set the approved connector operator Firebase UID}"
: "${COMPANY_EVIDENCE_REF:?Set the private identifier for the verified company evidence}"
: "${IAM_EVIDENCE_REF:?Set the private effective IAM review reference}"
python3 "$TIME_ACTIVATION" configure \
  --company "$TIME_COMPANY_ID" --actor "$TIME_USER_ID" --slug "$TIME_SLUG" --parent "$TIME_PARENT_ID" \
  --work-order "$TIME_WORK_ORDER_1" --work-order "$TIME_WORK_ORDER_2" \
  --work-order "$TIME_WORK_ORDER_3" --work-order "$TIME_WORK_ORDER_4" \
  --floor "$TIME_MODIFIED_FROM" --expires "$TIME_EXPIRES_AT" --operator "$MORRIS_OPERATOR_UID" \
  --identity-evidence "$COMPANY_EVIDENCE_REF" --iam-evidence "$IAM_EVIDENCE_REF"
```

**STOP for secret creation or version upload approval.** Ensure the terminal is private, shell tracing is disabled, and only approved owner and runtime principals can read the target regional secret. The helper accepts the existing token through hidden terminal input. Paste only when prompted. It constructs the exact production binding (environment, database UID, tenant, account, user, slug, customer, modification floor, UTC expiry and token) in process memory, hashes the exact UTF-8 bytes and passes those bytes via stdin to Montréal Secret Manager. It pins the returned numeric version in private state. No plaintext credential file, environment variable, shell argument or terminal output is created. Close the private terminal and clear the clipboard under your local credential handling procedure. The helper creates `mi-client-prod-time` only if absent and reuses it when present. Each approved enrollment adds a new version.

```bash
python3 "$TIME_ACTIVATION" credential
```

**STOP for secret-level runtime IAM approval.** Confirm the private policy of the single regional secret has the expected principals, including inherited access review. Expect a numeric enabled version of the named Montréal secret. Never run `gcloud secrets versions access` to display the credential. The actual digest match is tested by the attached production worker before the first provider read.

```bash
python3 "$TIME_ACTIVATION" secret-iam
```

For a failed or canceled enrollment inspect regional version metadata without reading contents. If a version was uploaded but was never pinned, disable the orphan version after checking that no revision or job references it. Revoke the exact secret-level grant if the rollout is abandoned and no approved worker uses it. Never delete a credential needed by a known-good revision. [Regional Secret Manager setup](https://cloud.google.com/secret-manager/regional-secrets/config-sm-rs)

### 4.3 Approve the production worker and first import

Each command below has a separate authorization and keeps the dashboard Time-disabled. The worker uses the approved immutable image of the known-good dashboard and the same restricted production service account. It uses one task, 30 minutes maximum with a 25-minute application budget, zero automatic task retries during the pilot, and on-clock collection off. An existing matching job is reused. A differing dormant job requires inspection, no schedule, no active executions and a separate `job --replace-reviewed-job` approval. The helper does not overwrite an enrolled or unrelated job.

**STOP for job configuration approval.** Expect `mi-client-prod-time-sync` with the exact named database scope and pinned regional credential, without a job execution.

```bash
python3 "$TIME_ACTIVATION" job
```

**STOP for read-only QuickBooks Time verification approval.** Expect `verified:true`, `applied:false`, and four reviewed descendants with four verified Time projects in the sanitized job result. Compare the exact approved parent and ID pairs with your independently scoped source inventory. The worker currently returns counts here, and the next reconciliation check confirms exact IDs after import. If the count differs or metadata is unavailable, stop. Recheck scope from the authorized provider account before any enrollment. Account mismatch, stale or incorrect credentials, inaccessible database and digest mismatch fail before import.

```bash
python3 "$TIME_ACTIVATION" verify
```

**STOP for customer enrollment approval.** This records the customer binding and its audit event. It does not import hours.

```bash
python3 "$TIME_ACTIVATION" enroll --accept-verify
```

**STOP for the first bounded production write.** Expect `failed:0` and four registered unpublished drafts on a clean baseline. Initial history can require more than one bounded execution if the date range or volume is large. A nonzero failure may follow successful incremental commits. Keep the dashboard disconnected, inspect the diagnostic stage and checkpoints, wait for the active execution and lease, and approve each retry. A completed Regina day is a no-op for a repeated daily job. Never delete completed checkpoints to force a replay.

```bash
python3 "$TIME_ACTIVATION" sync
```

If stopped after enrollment, leave the Time job uninvoked and the dashboard disconnected. If an import partially completed, preserve the stored checkpoints, audits, assignments and projects. Investigate discrepancies privately. The connector can retry a failed run without erasing successful prior slices.


### 4.4 Reconcile before enabling Time in the dashboard

Use a private provider report or an approved owner-only aggregate from the scoped Time report. Include completed entries for the exact jobcodes, excluding customer-root entries, over the approved modification range. Group by the source work date's month, use integer seconds, and include a zero row for each work order that has no time. If hours were rounded, edited after the export, revised, or deleted, refresh or adjust the report under the approved comparison procedure. Stop if the source report and database use different windows. The helper checks both monthly totals and the resulting lifetime totals. Reconciliation reads only named production rollups, scoped mapping metadata, private draft state and checkpoints. It prints counts and a coverage verdict without row-level data or totals.

```bash
: "${TIME_TOTALS_CSV:?Set the private Time aggregate CSV path}"
chmod 600 -- "$TIME_TOTALS_CSV"
# Required header: jobcode_id,month,recorded_seconds
python3 "$TIME_ACTIVATION" reconcile --totals "$TIME_TOTALS_CSV"
python3 "$TIME_ACTIVATION" monitor
```

Accept only a complete run with all four exact jobcode/project pairs, the expected source relationships, no customer-root or lookalike records, four unpublished imported drafts, and every per-job checkpoint through the pilot cutoff. Recorded, allocated and unallocated totals must remain distinct. For a fresh import, each allocated total is zero until Morris explicitly allocates it. Compare any corrected/deleted source entries against the corresponding provider report changes. Leave future discovery on the same approved parent. The existing worker automatically discovers nested and new descendants and marks missing/moved orders for review. The first-run acceptance tool deliberately expects the reviewed four direct work orders. An unexpected initial inventory requires a new scope review before rollout.

A failed reconciliation leaves live traffic unchanged. Fix the source report comparison or separately authorize the bounded retry, as appropriate. Keep the private CSV under the approved retention policy.

### 4.5 Stage and cut over the existing dashboard

**STOP for a zero-traffic candidate.** Record the baseline revision and immutable digest from preflight. A candidate uses the same image, serving origin, tenant, database UID, attached account, Microsoft configuration, and existing runtime environment. The helper overlays only the Time variables, retains a larger existing timeout, and enforces at least 210 seconds for the authorized manual sync endpoint. The worker's separate task deadline is 30 minutes. The Node ten-second request timeout covers receiving the HTTP request, while sync processing has its own 150-second budget. The protected Time routes are under `/api/v2/tenants/:tenant/time`. The legacy API is deliberately unavailable.

```bash
python3 "$TIME_ACTIVATION" candidate
```

The command prints the candidate tag URL after verifying readiness, immutable image, zero normal traffic and unchanged environment outside the Time overlay. Set the printed URL as `CANDIDATE_URL` to confirm the candidate can start and serves its app while preserving anonymous denial. The named database metadata and attached identity are checked at process startup before the candidate accepts traffic.

```bash
: "${CANDIDATE_URL:?Set the exact verified zero-traffic candidate URL}"
[[ "$CANDIDATE_URL" =~ ^https://time-candidate---[a-z0-9-]+\.run\.app$ ]]
curl --fail --silent --show-error "$CANDIDATE_URL/health" | jq -e '.status == "ready"'
curl --fail --silent --show-error --output /dev/null "$CANDIDATE_URL/"
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "$CANDIDATE_URL/api/v2/tenants/zagime-production/time")"
test "$status" = 401
```

The tagged hostname has a different origin. Keep it out of Firebase authorized domains and leave the configured production origin unchanged. Run the full authenticated provider and privacy smoke on the main origin in the approved cutover window. A failed tag smoke leaves the baseline serving. Use the rollback command to remove the tag and preserve the records.

**STOP for traffic cutover.** Approve only after the candidate passes and you have the baseline available. Keep the schedule absent or paused.

```bash
python3 "$TIME_ACTIVATION" cutover --accept-candidate
```

Immediately confirm `$ORIGIN/health`, Microsoft staff sign-in from the known main origin, real production draft projects and source metadata, recorded/allocated/unallocated totals for at least two months, the confirmed last-success and checkpoint status, and persisted Morris edits. Verify only the designated operator sees the manual Time retry control. Test an approved client account against both an already published authorized project and the new unpublished work orders. Confirm clients cannot query Time state, raw records, or unrelated project IDs. Do not publish pilot work orders for testing. If any check fails, restore the production baseline before enabling the schedule.

### 4.6 Approve daily synchronization and monitor it

An authorized owner must supply a dedicated same-project Scheduler invoker identity with no data/secret access. If it does not exist, obtain separate IAM approval to create it. Only the role grant on the exact production job occurs in the next helper command. The Cloud Scheduler service agent must already have its normal service-agent role. The human Scheduler operator needs permission to use the invocation identity. The schedule invokes the Cloud Run Jobs API with OAuth. A new schedule starts enabled. Check next due time before approving creation.

**STOP for job-only invocation IAM approval.**

```bash
: "${SCHEDULER_INVOKER_EMAIL:?Set the independently reviewed dedicated Scheduler invoker}"
python3 "$TIME_ACTIVATION" scheduler-iam --invoker "$SCHEDULER_INVOKER_EMAIL" --accept-browser
```

**STOP for live scheduling approval.** Expect job `mi-client-prod-time-daily`, cron `0 6 * * *`, `America/Regina`, OAuth, and only `mi-client-prod-time-sync:run` as target. The worker prevents overlapping imports and treats a repeated successful Regina day as a no-op. Scheduler retries dispatch once. Dispatch success does not establish job or checkpoint success.

```bash
python3 "$TIME_ACTIVATION" scheduler --accept-browser
python3 "$TIME_ACTIVATION" report
```

After the first 6 AM run, check Scheduler dispatch and Cloud Run execution separately. Have the designated Morris operator review `monitor` after 6 AM daily during rollout and escalate any stale result (over 26 hours), incomplete/failed status, expired lease or unexpected absence of a schedule. Review the expiry warning at least weekly and renew before the remaining seven-day window. An expiry warning is an operational reminder, not evidence that the provider still accepts the token. Leave application logs and credential details private.

```bash
python3 "$TIME_ACTIVATION" monitor
gcloud scheduler jobs describe mi-client-prod-time-daily --location="$REGION" --project="$PROJECT" \
  --format='yaml(state,schedule,timeZone,lastAttemptTime,scheduleTime)'
gcloud run jobs executions list --job=mi-client-prod-time-sync --region="$REGION" --project="$PROJECT" \
  --format='table(metadata.name,status.completionTime,status.succeededCount,status.failedCount)'
```

### 4.7 Recovery, renewal and final acceptance

Use each mutating recovery command only after its own approval. Pausing blocks future dispatches and leaves active executions alone. If needed, an authorized owner can cancel a confirmed active execution from the exact job and wait for the bounded lease to expire. Rollback restores the recorded Time-disabled production revision and removes the tag. It preserves all production data and leaves production sign-in available.

```bash
# Review and approve each operation separately.
python3 "$TIME_ACTIVATION" pause
# For a confirmed active execution only, fill the exact name from the named job inventory.
# gcloud run jobs executions cancel "$APPROVED_EXECUTION" --region="$REGION" --project="$PROJECT"
python3 "$TIME_ACTIVATION" sync
python3 "$TIME_ACTIVATION" resume --accept-browser
# On a failed launch, use this instead of resuming.
python3 "$TIME_ACTIVATION" rollback
```

After rollback verify the production origin, Microsoft sign-in and Time disconnected. If abandoning the schedule configuration, an IAM owner can separately revoke the approved invoker's `roles/run.invoker` binding from the exact job. Retain completed checkpoints, imported projects, allocations and publication history. If the latest service template still points at a rolled-back candidate, the helper stops before another service update. Have the authorized operator restore the recorded baseline template as a zero-traffic revision and reconcile the activation record before restaging. Restore the same company ID, user and parent on any retry. Never move the modification floor or change the namespace on an existing customer without a reviewed data plan.

For renewal, obtain a replacement grant for the same Time account and independently verify the same binding and the new exact expiry. Pause the schedule and approve rotation separately. Use the same hidden-input and Montréal upload procedure to add a pinned version with the new exact digest. Stage the version/digest changes on the worker and dashboard, run read-only `verify-time-customer` for the new credential, and resume only after the main-origin checks succeed. Retain the prior enabled version until both workloads have switched. Then disable it by its numeric version if no rollback revision needs it. The initial activation helper intentionally refuses replacement of a pinned credential. A dedicated reviewed rotation is required so the owner can keep the existing activation record, job state and rollback revision aligned. No automatic token refresh is enabled.

The rollout is complete only when all of the following are observed and recorded privately.

- The established production service still serves the same primary URL. The attached identity, UID, named rules, indexes and effective IAM boundary have passed review.
- The approved company identity, numeric scope, regional credential version and exact expiry are confirmed. The initial dry run and enrolled worker runs succeeded.
- All four approved work orders are reconciled in seconds and unpublished. Source corrections/deletions, checkpoint coverage, recorded/allocated/unallocated totals, and zero duplicate records have been checked.
- Main-origin staff sign-in, persistence, manual operator controls, client privacy and project publication boundaries passed.
- A scheduled 6 AM Regina dispatch successfully ran the expected job and advanced its persisted success/coverage state. The operational monitor and rollback owner are assigned.

Use `python3 "$TIME_ACTIVATION" report` for a redacted record of locally accepted phases and `monitor` for the current persisted worker state. Keep the signed approval and reconciliation evidence in Morris's approved private location.
