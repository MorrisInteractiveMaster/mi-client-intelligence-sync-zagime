# Project-only staging operator runbook — PR B

No command in this runbook was used by the agent to change live infrastructure/data. The full [owner contract](master-implementation-contract.md) controls. Existing project/database/service/account/registry are reused. No Cloud Build, new resources, IAM grants, provider/user changes, QuickBooks authorization or automatic activation. All resource-changing phases below require separate owner approval. A matching policy profile or a successful local test is never an activation grant.

## A. Immediate read-only inventory

Cloud Shell Bash; do not assume the reported old revision is still current. No database/default request or impersonation grant:

```bash
PROJECT='morris-client-dash-zagime'
REGION='northamerica-northeast1'
SERVICE='mi-client-staging-dashboard'
DATABASE='mi-client-staging'
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.serviceAccountName,spec.template.spec.containers.image)'
gcloud run jobs list --project="$PROJECT" --region="$REGION" \
  --format='table(metadata.name,spec.template.spec.template.spec.serviceAccountName)'
curl --fail --silent 'https://mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app/health'
curl --silent -o /dev/null -w '%{http_code}\n' \
  'https://mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app/api/v2/tenants/synthetic-zagime-projects/workspace'
```

Expect /health inactive-preview and anonymous workspace 503 while preview is inactive. Neither establishes records, authentication or write access. /healthz is not the Cloud Run smoke path. Preserve owner-reported successful identity job, staging GET404/LIST200 and production GET/LIST403; do not repeat IAM grants or production probes. Confirm the actual attached account remains mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com. Store the current exact image/traffic map as rollback evidence. Existing owner image digest f970e140a6acda803f90409edf1b1b78519cb9cea554c757044ae76edc932b67 is historical evidence, not the repaired/new image.

## B. Local/synthetic acceptance first

Use Node24, Java21+ and a clean reviewed checkout. These tests use local demo-mi-security, explicitly named mi-client-staging, loopback Auth/Firestore and synthetic provider fixtures. They never authorize a real company or write the existing cloud database.

```bash
node --version
java -version
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
node scripts/validate-m8-build.cjs
node --test scripts/validate-m8-build.test.cjs
bash scripts/test-staging-iam-collector.sh
bash scripts/test-m8-staging.sh
```

CI additionally builds the production Dockerfile and runs actual route/asset/CSP/browser smoke with the backend inactive and container external egress disabled. Inspect uploaded project-only browser screenshots/reports and production-container evidence. The component test entry exists only in a temporary loopback harness; it is not a production sign-in bypass. Real Microsoft popup/provider readiness is still unverified.

## C. Independently approved image publication / preview revision

No new infrastructure is needed. Do not rerun old M8 bootstrap/deploy/Cloud Build phases. After review, use the existing approved direct-Docker publication process and existing regional repository. Replace the reviewed-SHA placeholder with the exact PR head from review, and verify a clean checkout. Owner must provide verified **public** Firebase web config and Entra tenant, not OAuth client secrets or tokens. Never enable shell tracing or use secret build arguments.

```bash
REVIEWED_SHA='OWNER_REVIEWED_PR_B_HEAD_SHA'
test -z "$(git status --porcelain)" || exit 1
git fetch origin "$REVIEWED_SHA"
git switch --detach "$REVIEWED_SHA"
test "$(git rev-parse HEAD)" = "$REVIEWED_SHA" || exit 1
REGISTRY='northamerica-northeast1-docker.pkg.dev'
IMAGE_TAG="$REGISTRY/morris-client-dash-zagime/mi-client-build/mi-client-staging:projects-$REVIEWED_SHA"
: "${VITE_FIREBASE_API_KEY:?Owner-verified public web configuration required}"
: "${VITE_FIREBASE_APP_ID:?Owner-verified public web configuration required}"
: "${VITE_FIREBASE_AUTH_DOMAIN:?Owner-verified public web configuration required}"
: "${VITE_MORRIS_ENTRA_TENANT_ID:?Owner-verified Entra tenant required}"
docker build -f deployment/Dockerfile -t "$IMAGE_TAG" \
  --build-arg "VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY" \
  --build-arg "VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID" \
  --build-arg "VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg "VITE_MORRIS_ENTRA_TENANT_ID=$VITE_MORRIS_ENTRA_TENANT_ID" \
  --build-arg VITE_SECURE_TENANT_ID=synthetic-zagime-projects .
# Separate approval for publishing into the EXISTING repository:
gcloud auth configure-docker "$REGISTRY"
docker push "$IMAGE_TAG"
docker inspect --format='{{json .RepoDigests}}' "$IMAGE_TAG"
```

Record the returned existing-repository sha256 image reference; do not invent a digest or reuse the original image. Separately approve updating only the existing service, no normal traffic, preview retained:

```bash
REVIEWED_IMAGE='OWNER_VERIFIED_EXISTING_REGISTRY_IMAGE_AT_SHA256_DIGEST'
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$REVIEWED_IMAGE" --no-traffic --tag=render-check \
  --update-env-vars='BACKEND_MODE=staging,STAGING_PREVIEW_ONLY=true,FIRESTORE_DATABASE_ID=mi-client-staging,ENABLE_LIVE_FIREBASE=false,ENABLE_SYNTHETIC_STAGING=false,STAGING_IAM_VERIFIED=false,FIRESTORE_RULES_VERIFIED=false'
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.serviceAccountName)'
CANDIDATE_URL='OWNER_VERIFIED_RENDER_CHECK_TAG_URL'
node scripts/smoke-preview.cjs "$CANDIDATE_URL" --live-read-only
```

The update preserves service identity/IAM/ingress/resources and requires owner preflight verification; it does not create a replacement service. If the candidate fails, stop without enabling Firebase or adding permissions. Actual OAuth-enabled public config may make Auth initialization requests; this repair smoke never clicks sign-in and blocks external calls. Inspect actual provider/browser evidence separately rather than weakening its policy. Promote only after separate traffic approval:

```bash
CANDIDATE_REVISION='OWNER_VERIFIED_READY_PREVIEW_REVISION'
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$CANDIDATE_REVISION=100"
```

## D. Owner configuration, operator writes and API activation — blocked pending review

1. Independently finish effective create/update isolation review with no production writes, actual attached identity, exact database UID 6d09ea71-f495-44a5-94a6-732ed1c47d88, Canadian region/Standard Native and published deny-all browser rules. Follow corrected M7 collection/runtime evidence; UNKNOWN/inconclusive is never denial. Do not repeat grants or set STAGING_IAM_VERIFIED from a local match.
2. Owner verifies Firebase/Entra public app/provider configuration through permitted Console access, exact Microsoft tenant/client IDs, corporate account ownership/current-enabled checks and required privacy consent. Operator admin-config403 is not proof of disabled Microsoft. No new users/providers or shared-user modifications by this PR. Approved client accounts stay scoped read-only.
3. Owner separately reviews the two prepared index definitions **for mi-client-staging only**. No broad firebase deploy or index/IAM change is performed here. Missing-index errors must stop access, not trigger scans.
4. Select a fresh approved synthetic tenant. Default new build is synthetic-zagime-projects; require the runtime MORRIS_DASHBOARD_TENANT_ID to match. If it already exists, stop: never overwrite/reseed or guess a different tenant. Legacy tenant migration requires inventory/review; no live apply migrator is included.
5. Inventory an approved attached-identity operator runner; an identity-check job is not automatically approved for seeding. Owner must approve its exact existing name, reviewed image/command, dedicated staging service account, named database/UID and independently verified environment. If no suitable runner exists, creating/configuring one requires a separate approved operation; this agent does not create it or grant impersonation. Do not run these operator processes with an unverified Cloud Shell/default identity or downloaded JSON key.

Exact **process arguments for that approved runner**, not Cloud Shell commands to execute against the live database now:

```bash
node dist-server/operator.mjs inspect-project-migration synthetic-zagime
node dist-server/operator.mjs seed-project-synthetic synthetic-zagime-projects
# Inspect dry-run and nonexistent-tenant evidence; separate write approval:
node dist-server/operator.mjs seed-project-synthetic synthetic-zagime-projects --apply
# Optional approved EXISTING client UID/project scope in an external approval file:
node dist-server/operator.mjs bootstrap-project-client OWNER_REVIEWED_CLIENT_APPROVAL_FILE
# Separate approval after dry-run:
node dist-server/operator.mjs bootstrap-project-client OWNER_REVIEWED_CLIENT_APPROVAL_FILE --apply
```

These commands do not create Auth users or staff memberships. Live guard values are deliberately not populated here. Owner must separately verify/configure BACKEND_MODE=staging, SERVE_STAGING_FRONTEND=true, project/UID/account/named database, matching synthetic tenant, exact ALLOWED_ORIGIN for the browser URL under test, approved provider config and review-backed guard flags. A tagged URL and stable service URL are different origins; do not add a wildcard to work around this. Keep preview true until independent activation approval; never set verification flags just to bypass startup. No QuickBooks environment/credentials are supplied.

6. Only after approvals, owner configures a reviewed active revision of the SAME service; rerun attached-account/UID/rules checks. Perform browser sign-in as an approved Morris test employee, create/edit synthetic progress/plan/notes, publish explicitly, refresh, reauthenticate in another session and confirm exact persisted values/audits. Test concurrent edits, split totals/month/lifetime, client read-only/published-only scope, revocation and controlled recovery. Record actual revision, synthetic IDs and token-free outcomes. No remote persistence claim until this succeeds.

## E. Rollback / production blocks

Keep the recorded previous traffic/image and verify it is an inactive preview before restoring it. If an active revision has been approved, separately disable writes/return to an independently verified preview first; do not blindly route to an old active backend. Then restore the exact recorded traffic map, no LATEST shortcut:

```bash
PREVIOUS_TRAFFIC='OWNER_RECORDED_REVISION_PERCENT_MAP'
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$PREVIOUS_TRAFFIC"
curl --fail --silent 'https://mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app/health'
```

If restoring the original 00001-b4d revision, its known blank-screen defect returns. No data deletion/restore/migration accompanies traffic rollback. Preserve newly written synthetic tenant records and audit evidence; review any intervening revisions before a later migration. Do not remove candidate tags/images/data automatically.

Production (default), real client data, QuickBooks OAuth/import/schedules, new projects/databases, secrets/IAM/provider/user changes and production readiness remain blocked. C must verify native Projects entitlement and server-side Zagimē stable-ID scope; no Customer/subcustomer fallback. D separately verifies relevant operational Time capability. No API callback URI is registered or claimed implemented in B.
