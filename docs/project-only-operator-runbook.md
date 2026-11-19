# Project-only staging operator runbook

The existing Cloud Run dashboard is active. Use the active-to-active rollout below to preserve Microsoft sign-in, Firestore persistence and the main dashboard origin. The [owner contract](master-implementation-contract.md) controls. Local tests and this runbook grant no permission to change live resources.

## Local acceptance

Use Node 24, Java 21+ and a clean reviewed checkout. The security suite uses synthetic data and the local Auth and named Firestore emulators.

```bash
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
```

CI also builds the production container and exercises the inactive test container in Playwright. The local fixture is separate from the active Cloud Run dashboard.

## Dashboard experience rollout

### 1. Record the active baseline

Use Cloud Shell Bash in a private operator session. Turn off shell tracing. Keep full revision specs private because they may contain runtime values. Record the current serving revision, digest and traffic map as restricted rollback evidence. This procedure expects one active revision with all untagged traffic and the same revision as the service template's latest ready revision. If a split or template drift exists, stop for an owner-reviewed rollout that preserves the split and identifies the exact template to carry forward.

```bash
set +x
set -euo pipefail
PROJECT='morris-client-dash-zagime'
REGION='northamerica-northeast1'
SERVICE='mi-client-staging-dashboard'
RUNTIME_SA='mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'

describe_service() {
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json
}
describe_revision() {
  gcloud run revisions describe "$1" --project="$PROJECT" --region="$REGION" --format=json
}

BASELINE="$(describe_service)"
jq '{url: .status.url, traffic: .status.traffic, latestReady: .status.latestReadyRevisionName,
     latestCreated: .status.latestCreatedRevisionName}' <<< "$BASELINE"
PREVIOUS_TRAFFIC="$(jq -er '
  [.status.traffic[] | select((.percent // 0) > 0)] |
  if length == 1 and .[0].percent == 100 and (.[0].revisionName | type == "string")
  then .[0].revisionName + "=100"
  else error("Review the serving split before proceeding") end' <<< "$BASELINE")"
SERVING_REVISION="${PREVIOUS_TRAFFIC%=100}"
jq -e --arg serving "$SERVING_REVISION" '
  .status.latestReadyRevisionName == $serving and .status.latestCreatedRevisionName == $serving
' <<< "$BASELINE" > /dev/null

SERVING="$(describe_revision "$SERVING_REVISION")"
jq '{revision: .metadata.name, digest: .status.imageDigest, serviceAccount: .spec.serviceAccountName}' <<< "$SERVING"
jq -e --arg sa "$RUNTIME_SA" '
  .spec.serviceAccountName == $sa and (.spec.containers | length == 1) and
  (.spec.containers[0].env | map({key: .name, value: .value}) | from_entries |
    .BACKEND_MODE == "staging" and .STAGING_PREVIEW_ONLY != "true" and
    .SERVE_STAGING_FRONTEND == "true" and .ENABLE_LIVE_FIREBASE == "true" and
    .FIRESTORE_DATABASE_ID == "mi-client-staging" and
    .STAGING_FIREBASE_PROJECT_ID == "morris-client-dash-zagime" and
    .STAGING_DATABASE_UID == "6d09ea71-f495-44a5-94a6-732ed1c47d88" and
    .STAGING_SERVICE_ACCOUNT_EMAIL == $sa and .ENABLE_QUICKBOOKS_TIME != "true")
' <<< "$SERVING" > /dev/null

MAIN_ORIGIN="$(jq -er '.spec.containers[0].env[] | select(.name == "ALLOWED_ORIGIN") |
  .value | select(test("^https://[^/]+$"))' <<< "$SERVING")"
ACTIVE_TENANT="$(jq -er '.spec.containers[0].env[] | select(.name == "MORRIS_DASHBOARD_TENANT_ID") |
  .value | select(test("^[-a-zA-Z0-9_]{1,128}$"))' <<< "$SERVING")"
API_PATH="/api/v2/tenants/$ACTIVE_TENANT/workspace"
test "$(curl -fsS "$MAIN_ORIGIN/health" | jq -er '.status')" = ready
test "$(curl -sS -o /dev/null -w '%{http_code}' -H "Origin: $MAIN_ORIGIN" "$MAIN_ORIGIN$API_PATH")" = 401
```

Confirm `MAIN_ORIGIN` matches the working dashboard URL used by staff and clients. Before the update, verify a staff Microsoft sign-in and an approved client session at that origin. Read an existing approved staging test project and record token-free baseline results. Reuse the existing tenant and test project for verification. If the baseline fails, stop before changing traffic.

### 2. Build the reviewed image and stage it at zero normal traffic

Use the exact public Firebase web config, Entra tenant and dashboard tenant from the approved serving build. The Dockerfile compiles the dashboard for a same-origin API. Confirm these settings match the active frontend before building. OAuth secrets and tokens stay out of the build.

```bash
: "${REVIEWED_SHA:?Set the approved commit SHA}"
: "${VITE_FIREBASE_API_KEY:?Set the approved public Firebase API key}"
: "${VITE_FIREBASE_APP_ID:?Set the approved Firebase Web App ID}"
: "${VITE_FIREBASE_AUTH_DOMAIN:?Set the approved Firebase Auth domain}"
: "${VITE_MORRIS_ENTRA_TENANT_ID:?Set the approved Entra tenant}"
: "${VITE_SECURE_TENANT_ID:?Set the tenant from the serving frontend build}"
test "$VITE_SECURE_TENANT_ID" = "$ACTIVE_TENANT"
test -z "$(git status --porcelain)"
git fetch origin "$REVIEWED_SHA"
git switch --detach "$REVIEWED_SHA"
test "$(git rev-parse HEAD)" = "$REVIEWED_SHA"

REGISTRY='northamerica-northeast1-docker.pkg.dev'
IMAGE_REPO="$REGISTRY/$PROJECT/mi-client-build/mi-client-staging"
IMAGE_TAG="$IMAGE_REPO:dashboard-$REVIEWED_SHA"
docker build -f deployment/Dockerfile -t "$IMAGE_TAG" \
  --build-arg "VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY" \
  --build-arg "VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID" \
  --build-arg "VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg "VITE_MORRIS_ENTRA_TENANT_ID=$VITE_MORRIS_ENTRA_TENANT_ID" \
  --build-arg "VITE_SECURE_TENANT_ID=$VITE_SECURE_TENANT_ID" .
# Separately approve publishing the image into the existing registry.
gcloud auth configure-docker "$REGISTRY"
docker push "$IMAGE_TAG"
REVIEWED_IMAGE="$(docker inspect --format='{{json .RepoDigests}}' "$IMAGE_TAG" |
  jq -er --arg prefix "$IMAGE_REPO@sha256:" '.[] | select(startswith($prefix))')"
[[ "$REVIEWED_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]
```

Recheck the serving state immediately before the separate approval to create the candidate. The only runtime change is the immutable image. `--no-traffic` keeps the existing serving allocation by pinning any `LATEST` target to its previous revision. The tag is a separate candidate URL for checks. [Cloud Run update flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update)

```bash
TAG="dashboard-${REVIEWED_SHA:0:12}"
CURRENT="$(describe_service)"
jq -e --arg rev "$SERVING_REVISION" --arg tag "$TAG" '
  .status.latestReadyRevisionName == $rev and .status.latestCreatedRevisionName == $rev and
  ([.status.traffic[] | select((.percent // 0) > 0)] | length == 1 and
    .[0].revisionName == $rev and .[0].percent == 100) and
  all(.status.traffic[]; .tag != $tag)
' <<< "$CURRENT" > /dev/null

gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$REVIEWED_IMAGE" --no-traffic --tag="$TAG"

CANDIDATE="$(describe_service)"
CANDIDATE_REVISION="$(jq -er --arg tag "$TAG" '.status.traffic[] | select(.tag == $tag) | .revisionName' <<< "$CANDIDATE")"
CANDIDATE_URL="$(jq -er --arg tag "$TAG" '.status.traffic[] | select(.tag == $tag) | .url' <<< "$CANDIDATE")"
jq -e --arg old "$SERVING_REVISION" --arg new "$CANDIDATE_REVISION" '
  $old != $new and .status.latestReadyRevisionName == $new and
  ([.status.traffic[] | select((.percent // 0) > 0)] |
    length == 1 and .[0].revisionName == $old and .[0].percent == 100)
' <<< "$CANDIDATE" > /dev/null

REVIEWED_REVISION="$(describe_revision "$CANDIDATE_REVISION")"
# Compare the effective revision specs with only the image removed. Do not print the specs.
test "$(jq -cS '.spec | del(.containers[0].image)' <<< "$SERVING")" = \
     "$(jq -cS '.spec | del(.containers[0].image)' <<< "$REVIEWED_REVISION")"
DIGEST="${REVIEWED_IMAGE##*@}"
jq -e --arg digest "$DIGEST" '
  ((.status.imageDigest // .status.containerStatuses[0].imageDigest // "") | split("@") | last) == $digest
' <<< "$REVIEWED_REVISION" > /dev/null

test "$(curl -fsS "$CANDIDATE_URL/health" | jq -er '.status')" = ready
test "$(curl -sS -o /dev/null -w '%{http_code}' -H "Origin: $MAIN_ORIGIN" "$CANDIDATE_URL$API_PATH")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' -H "Origin: $CANDIDATE_URL" "$CANDIDATE_URL$API_PATH")" = 403
```

On the tagged URL, check page rendering and asset loading without signing in. The tag has its own browser origin and is outside the dashboard's approved origin. Run the authenticated browser smoke on the main origin during the approved cutover window. Keep the original CORS, Firebase and Entra settings. A health check or anonymous 401 alone cannot verify sign-in or Firestore persistence.

### 3. Approve cutover, verify on the main origin, and retain rollback

After the owner approves the ready image and rollback evidence, confirm the baseline revision still has all normal traffic. Shift traffic to the exact reviewed revision. [Cloud Run traffic migration and rollback](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)

```bash
describe_service | jq -e --arg old "$SERVING_REVISION" --arg new "$CANDIDATE_REVISION" '
  .status.latestReadyRevisionName == $new and
  ([.status.traffic[] | select((.percent // 0) > 0)] |
    length == 1 and .[0].revisionName == $old and .[0].percent == 100)
' > /dev/null
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$CANDIDATE_REVISION=100"
describe_service | jq '{url: .status.url, traffic: .status.traffic}'
test "$(curl -fsS "$MAIN_ORIGIN/health" | jq -er '.status')" = ready
```

Immediately repeat the main-origin Microsoft staff and client smoke. Under the approved staging test scope, save and reload an edit to an existing synthetic project and verify it in a fresh session. Verify project publication boundaries, switch between two reporting months, and confirm Time reports disconnected. Timeline fields are optional on existing documents. This release requires no reseeding, bootstrap, index changes or migration.

On failure, restore the recorded revision traffic map and repeat the main-origin health and sign-in checks against the restored active revision. Existing Firestore records are retained.

```bash
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$PREVIOUS_TRAFFIC"
describe_service | jq '{url: .status.url, traffic: .status.traffic}'
test "$(curl -fsS "$MAIN_ORIGIN/health" | jq -er '.status')" = ready
```
