# M8 controlled synthetic staging launch

No command below has been run against Google Cloud by the implementation agent. Each changing phase requires distinct owner approval; the script's approval argument records operator intent, it is not independent security verification. No running dashboard URL exists until approved deployment. Use latest reviewed PR checkout, Cloud Shell Bash and existing authorized credentials. Do not enable APIs/grant IAM to fix a failed command.

## Existing facts and required decisions

Existing project morris-client-dash-zagime; staging mi-client-staging, UID 6d09ea71-f495-44a5-94a6-732ed1c47d88, Montréal; existing mi-client-staging-api service identity. Production (default) is never used. Owner reports no Run service/job yet, named read access/default read denial and narrow direct IAM declarations. Complete effective write-isolation review remains pending: follow m7-operator-next-steps.md, no default write experiment. A profile match does not authorize activation.

Owner must approve: effective write isolation including inheritance/indirect routes, deployed named deny-all browser rules, Auth/privacy/client requirements, corporate tenant/app IDs, delegated Graph read permission/consent, public staging ingress, spending/log policy, image/build identity and each resource/job execution. Canadian project/reporting storage remains preferred; no blanket residency compliance is claimed. Microsoft/Firebase identity processing and logs have separate privacy considerations.

New resource names below are **proposed**, not already verified: mi-client-staging-identity-check (job), mi-client-staging-dashboard (service), mi-client-staging-synthetic-seed (job). Regional Artifact Registry repository is an owner-selected placeholder. No project/database is created. If an approved regional repository or build/API permissions do not exist, stop for a separately reviewed provisioning task. Do not silently create them.

## 1. Read-only inventory and review

```bash
bash scripts/m8-staging.sh inventory
bash scripts/verify-staging-iam.sh  # exit 2 remains review-required, never activation approval
gcloud iam service-accounts get-iam-policy mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com --project=morris-client-dash-zagime --format=json
```

Inventory enabled APIs, existing repositories/jobs/services. Required existing APIs: run.googleapis.com, cloudbuild.googleapis.com, artifactregistry.googleapis.com, firestore.googleapis.com, identitytoolkit.googleapis.com, logging.googleapis.com. No Secret Manager access is needed by M8. Future QuickBooks credentials belong in regional Secret Manager, only after a separately approved connector task; never enter them here.

Runtime keeps only reviewed database-conditional Firestore get/getMetadata/entities get/list/create/update and separate Firebase Auth users.get. No runtime delete/Auth writes/impersonation/Owner/Editor. Build identity needs reviewed regional Artifact Registry upload/build-log access, not Firestore or user administration. Operator needs existing narrowly scoped build/service/job deployment/execution and actAs for this specific account, not Token Creator. Exact principal/role bindings must be reviewed from actual policy; this PR supplies no grants. Jobs use one task, zero retries and bounded timeouts; service min 0/max 1, concurrency 20, 1 CPU/512 MiB, 15-second requests. Configure spending alerts separately (budgets do not hard-stop spend). Logs must exclude credentials, tokens, request bodies, names and client records; operator evidence stays outside Git.

## 2. Owner Console configuration (separate approval, no per-staff onboarding)

- Confirm the **existing** Firebase web app public configuration. Enable Google for approved clients and Microsoft for staff only after privacy approval. Do not enable password/anonymous/public admin registration. Emulator passwords are local tests only.
- In the trusted Morris Entra tenant, confirm a single-tenant app registration matching Firebase's Microsoft provider client ID. Record immutable tenant UUID and app UUID. Configure the exact Firebase Console callback URI; enter its client secret only into the approved Firebase provider setup, never the frontend/build/runbook/GitHub. No guessed callback registration.
- Approve delegated **read-only** User.Read.All consent for the server's current-account check. The backend only requests `/me` id/userPrincipalName/userType/accountEnabled, never lists the directory or writes it. Independently verify the approved read grant returns accountEnabled and userType; missing/null/denied data fails closed. Never add write permissions as a workaround. Owner review of this directory-read scope is a release dependency.
- Staff authorization requires Microsoft issuer/audience/signature/expiry, configured tenant, Firebase-linked provider OID, same Graph caller ID, Member account, enabled=true and exact corporate UPN domain. Email strings, Google accounts with matching email, custom claims and legacy staff memberships never grant staging editing. No invitations, allowlists, staff membership writes or administrator bootstrap are needed.
- After preview supplies its URL, add that exact hostname to Firebase authorized domains. Clients use approved Google identities and scoped named-database client memberships; there is no self-registration privilege. Optional operator-only bootstrap-client accepts an independently approved private JSON file with approved=true, tenantId, existing uid and agreementIds, supports dry-run, validates Google provider/verified identity and synthetic scope, creates a client-only membership plus audit atomically, and refuses conflicting existing records. It creates no Auth user. Run only in a separately approved trusted operator runner with a reviewed read-only approval-file mount; no mount/resource is invented here. Existing system bootstrap remains separate and is not a staff editing prerequisite.

## 3. Public configuration and image build (approve costs first)

Replace only owner-verified placeholders. These are public identifiers, never credentials. Repository must already exist from step 1. Run the following only for the reviewed exact commit.

```bash
export MORRIS_ENTRA_TENANT_ID='OWNER_VERIFIED_ENTRA_TENANT_UUID'
export MORRIS_ENTRA_CLIENT_ID='OWNER_VERIFIED_MICROSOFT_CLIENT_UUID'
export FIREBASE_WEB_API_KEY='OWNER_VERIFIED_PUBLIC_WEB_API_KEY'
export FIREBASE_WEB_APP_ID='OWNER_VERIFIED_WEB_APP_ID'
export FIREBASE_AUTH_DOMAIN='morris-client-dash-zagime.firebaseapp.com' # confirm against existing app
export BUILD_SERVICE_ACCOUNT='projects/morris-client-dash-zagime/serviceAccounts/mi-client-build@morris-client-dash-zagime.iam.gserviceaccount.com'
export BUILD_SOURCE_BUCKET='gs://OWNER_APPROVED_EXISTING_CANADIAN_BUILD_SOURCE_BUCKET'
export BUILD_LOG_BUCKET='gs://OWNER_APPROVED_EXISTING_CANADIAN_BUILD_LOG_BUCKET'
export IMAGE_TAG="northamerica-northeast1-docker.pkg.dev/morris-client-dash-zagime/OWNER_APPROVED_EXISTING_REPOSITORY/mi-client-staging:$(git rev-parse HEAD)"
npm ci --ignore-scripts
node scripts/validate-m8-build.cjs # offline YAML/GCS_ONLY guard; no submission
bash scripts/m8-staging.sh build --approved-build
# Inspect the returned registry metadata/build provenance. Paste its verified immutable digest:
export IMAGE_DIGEST='northamerica-northeast1-docker.pkg.dev/morris-client-dash-zagime/OWNER_APPROVED_EXISTING_REPOSITORY/mi-client-staging@sha256:OWNER_VERIFIED_DIGEST'
```

Dockerfile builds both frontend and backend. Public build args are visible in build metadata. Do not pass OAuth secrets, tokens or private configuration. CI builds the container with unconfigured sign-in and tests inactive preview; it does not certify the owner-provided web config or deploy remotely.

The build identity must be separate from the staging runtime. Explicit existing source/log buckets prevent implicit default build-bucket creation. Verify bucket ownership/location/access from inventory/describe output before build approval. If these prerequisites are absent, resource/identity creation requires a separate approved operation; this script does not create them. Changing phases first verify required APIs are already enabled; missing/inaccessible API state stops rather than enabling services.

## 4. Identity-check job (approve creation, then separately approve execution)

```bash
bash scripts/m8-staging.sh create-checker --approved-create-checker
gcloud run jobs describe mi-client-staging-identity-check --project=morris-client-dash-zagime --region=northamerica-northeast1 --format=json
# Independently inspect exact image digest, attached identity, command, flags, no secret mounts/overrides.
bash scripts/m8-staging.sh check-identity --approved-check-identity
gcloud run jobs logs read mi-client-staging-identity-check --project=morris-client-dash-zagime --region=northamerica-northeast1 --limit=20
```

Require attachedIdentityMatched=true, firestoreOperations=0, apiActivated=false from the trusted metadata check. A configured service-account name alone is not attachment proof. No Firebase credential acquisition or database access happens in this job. Never restore the removed Token Creator grant.

## 5. Deploy inactive preview (separate approval)

```bash
bash scripts/m8-staging.sh preview --approved-preview
export STAGING_ORIGIN="$(gcloud run services describe mi-client-staging-dashboard --project=morris-client-dash-zagime --region=northamerica-northeast1 --format='value(status.url)')"
curl --fail --silent "$STAGING_ORIGIN/healthz"  # inactive-preview
curl --silent -o /dev/null -w '%{http_code}\n' "$STAGING_ORIGIN/api/tenants/synthetic-zagime/workspace" # 503
```

This creates a public Cloud Run HTTPS endpoint via **explicitly approved ingress=all and no-invoker-iam-check**, not a Cloud IAM binding. Static assets/health are public; all data routes remain inactive. This resolves the old internal-ingress template's browser reachability problem. No external LB, DNS or hosting resources are created. The direct run.app URL is a controlled synthetic pilot decision, not a production edge design. App CORS accepts only the exact configured origin after activation; Firebase verification, current staff policy and server authorization protect data. Per-socket application rate limit is 60/min, one instance/10,000 bounded buckets; it is not a DDoS/cost firewall. Owner must accept this pilot exposure or separately approve an edge/LB/Cloud Armor design before release. No production traffic migration is proposed.

## 6. Synthetic initialization, then activation (separate approvals)

Only after complete independent review and verified rules/identity, record the review outside Git. The environment flag below is an operator attestation, not a permission proof. The seed writes only a new synthetic-zagime tenant in named staging, creates no users/memberships and refuses overwrite. Job creation/update and execution in each seed phase are one explicit approved operation; inspect the exact proposed command before approving it.

```bash
export M8_LIVE_REVIEW_APPROVED=true
bash scripts/m8-staging.sh seed-preview --approved-seed-preview  # read-only preview; inspect job output
gcloud run jobs logs read mi-client-staging-synthetic-seed --project=morris-client-dash-zagime --region=northamerica-northeast1 --limit=20
bash scripts/m8-staging.sh seed-apply --approved-seed-apply       # separate synthetic-write approval
bash scripts/m8-staging.sh activate --approved-activate         # separate API activation approval
curl --fail --silent "$STAGING_ORIGIN/healthz"                 # ready
printf '%s/#/secure\n' "$STAGING_ORIGIN"
```

Activation sets approved IDs/origin and explicit live/named/rules/IAM flags. Backend verifies exact attached identity before acquiring credentials, verifies UID/location/edition/mode, then exposes the named database. There is no default fallback. Same-origin frontend has no Firestore browser SDK access. In-memory Auth/OAuth proofs intentionally disappear on refresh: sign in again and persisted projects reload from the API. Tokens are not stored in localStorage. Expired proof requires sign-out/sign-in; Graph/verification failures stop edits, with no automatic write retries. Separate sessions see saved records through new authenticated API reads.

## 7. Controlled smoke, rollback and still-blocked production

Use m7-synthetic-smoke-tests.md with the M8 policy: all verified Morris staff can create/edit/allocate/publish; no per-staff editor enrollment/restriction. Existing legacy editor tests remain compatibility regressions, not staging policy. Verify two distinct staff sessions, refresh/sign-in persistence, private defaults, explicit publish/unpublish, clients published-only/read-only, no source mutation, monthly/lifetime totals, concurrency/idempotent retries, audit display, Graph account disable and client-membership revocation. Exercise Google/Microsoft popup, redirect/authorized domains, Graph read fields/consent, logout/expiry and CSP in actual browsers. External OAuth is not certified by local emulator tests. Never disable real staff or shared Auth users solely for testing; use approved synthetic identities.

```bash
# Separate rollback approval: return to static preview, disable all API Firebase flags.
bash scripts/m8-staging.sh rollback --approved-rollback
curl --silent -o /dev/null -w '%{http_code}\n' "$STAGING_ORIGIN/api/tenants/synthetic-zagime/workspace" # 503
```

Stop new editing first, wait for the previous revision's bounded requests to drain, confirm only the inactive revision receives traffic and disable any old tagged write URLs. Retain audits/data; do not delete/reseed or roll back schema blindly. Job deletion/log retention/resource cleanup requires a separate reviewed operation, no cleanup is automatic. Production deployment/default access, live QuickBooks, schedules and credentials remain blocked. A usable live URL and remote smoke evidence can only be returned after the owner-approved phases actually run.

References: [Cloud Run deploy](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy), [job create](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/create), [job deploy](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/deploy), [service update](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update), [Firebase Microsoft OID binding](https://firebase.google.com/docs/auth/web/microsoft-oauth), [Microsoft Graph user reads](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0).
