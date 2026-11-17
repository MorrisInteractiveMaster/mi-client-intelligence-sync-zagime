#!/usr/bin/env bash
# Cloud Shell. Each changing phase requires a separately approved invocation.
# No IAM grant, provider change, API enablement, repository or database creation.
set -euo pipefail
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
project='morris-client-dash-zagime'
region='northamerica-northeast1'
sa='mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'
service='mi-client-staging-dashboard'
checker='mi-client-staging-identity-check'
tenant='synthetic-zagime'
base_env="BACKEND_MODE=staging,STAGING_FIREBASE_PROJECT_ID=$project,FIRESTORE_DATABASE_ID=mi-client-staging,STAGING_DATABASE_UID=6d09ea71-f495-44a5-94a6-732ed1c47d88,STAGING_SERVICE_ACCOUNT_EMAIL=$sa"
inactive_env="$base_env,ENABLE_LIVE_FIREBASE=false,ENABLE_SYNTHETIC_STAGING=false,STAGING_IAM_VERIFIED=false,FIRESTORE_RULES_VERIFIED=false"
active_env="$base_env,ENABLE_LIVE_FIREBASE=true,ENABLE_SYNTHETIC_STAGING=true,STAGING_IAM_VERIFIED=true,FIRESTORE_RULES_VERIFIED=true"
phase="${1:-inventory}"
if [[ "$phase" != inventory && "${2:-}" != "--approved-$phase" ]]; then
  echo 'STOP: independently approve this exact phase before invoking it.' >&2; exit 2
fi
image() {
  [[ "${IMAGE_DIGEST:-}" =~ ^northamerica-northeast1-docker\.pkg\.dev/morris-client-dash-zagime/[a-z0-9-]+/mi-client-staging@sha256:[a-f0-9]{64}$ ]] || { echo 'Verified regional image digest required' >&2; exit 2; }
}
live_review() {
  [[ "${M8_LIVE_REVIEW_APPROVED:-}" == true ]] || { echo 'Independent effective write-isolation, named rules, identity, privacy and release review required' >&2; exit 2; }
}
identity_config() {
  [[ "${MORRIS_ENTRA_TENANT_ID:-}" =~ ^[a-fA-F0-9-]{36}$ && "${MORRIS_ENTRA_CLIENT_ID:-}" =~ ^[a-fA-F0-9-]{36}$ ]] || { echo 'Verified Entra IDs required' >&2; exit 2; }
}
url() { gcloud run services describe "$service" --project="$project" --region="$region" --format='value(status.url)'; }
apis() {
  local enabled api
  enabled="$(gcloud services list --enabled --project="$project" --format='value(config.name)')"
  for api in "$@"; do
    grep -Fxq "$api" <<<"$enabled" || { echo "STOP: required API not verified enabled: $api" >&2; exit 2; }
  done
}
case "$phase" in
 inventory)
  gcloud run services list --project="$project" --region="$region" --format=json
  gcloud run jobs list --project="$project" --region="$region" --format=json
  gcloud artifacts repositories list --project="$project" --location="$region" --format=json
  gcloud services list --enabled --project="$project" --format=json
  gcloud firestore databases describe --project="$project" --database=mi-client-staging --format=json
  gcloud storage buckets list --project="$project" --format=json
  ;;
 build)
  identity_config
  [[ "${IMAGE_TAG:-}" =~ ^northamerica-northeast1-docker\.pkg\.dev/morris-client-dash-zagime/[a-z0-9-]+/mi-client-staging:[a-f0-9]{40}$ ]] || exit 2
  [[ "${FIREBASE_WEB_API_KEY:-}" =~ ^[A-Za-z0-9_-]+$ && "${FIREBASE_WEB_APP_ID:-}" =~ ^[A-Za-z0-9:]+$ && "${FIREBASE_AUTH_DOMAIN:-}" == 'morris-client-dash-zagime.firebaseapp.com' ]] || { echo 'Verified public Firebase web configuration required' >&2; exit 2; }
  [[ "${BUILD_SOURCE_BUCKET:-}" =~ ^gs://[a-z0-9.-]{3,63}$ && "${BUILD_LOG_BUCKET:-}" =~ ^gs://[a-z0-9.-]{3,63}$ ]] || { echo 'Existing approved regional build buckets required' >&2; exit 2; }
  [[ "${BUILD_SERVICE_ACCOUNT:-}" =~ ^projects/morris-client-dash-zagime/serviceAccounts/[a-z0-9-]+@morris-client-dash-zagime\.iam\.gserviceaccount\.com$ && "$BUILD_SERVICE_ACCOUNT" != "projects/$project/serviceAccounts/$sa" ]] || { echo 'Existing separate approved build identity required' >&2; exit 2; }
  apis cloudbuild.googleapis.com artifactregistry.googleapis.com
  # Describe must succeed before submission; do not let CLI create default buckets.
  gcloud storage buckets describe "$BUILD_SOURCE_BUCKET" --project="$project" --format=json
  gcloud storage buckets describe "$BUILD_LOG_BUCKET" --project="$project" --format=json
  gcloud builds submit --project="$project" --region="$region" --config=deployment/cloudbuild-m8.yaml \
   --service-account="$BUILD_SERVICE_ACCOUNT" --gcs-source-staging-dir="$BUILD_SOURCE_BUCKET/m8-source" --gcs-log-dir="$BUILD_LOG_BUCKET/m8-logs" \
   --substitutions="_IMAGE=$IMAGE_TAG,_API_KEY=$FIREBASE_WEB_API_KEY,_APP_ID=$FIREBASE_WEB_APP_ID,_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN,_ENTRA_TENANT=$MORRIS_ENTRA_TENANT_ID" .
  gcloud artifacts docker images describe "$IMAGE_TAG" --project="$project" --format=json
  ;;
 create-checker)
  image
  apis run.googleapis.com artifactregistry.googleapis.com
  gcloud run jobs create "$checker" --project="$project" --region="$region" --image="$IMAGE_DIGEST" \
   --service-account="$sa" --command=node --args=dist-server/check-staging-identity.mjs,--approved-read-only-identity-check \
   --set-env-vars="$inactive_env" --tasks=1 --max-retries=0 --task-timeout=60s --cpu=1 --memory=512Mi
  ;;
 check-identity)
  apis run.googleapis.com
  gcloud run jobs describe "$checker" --project="$project" --region="$region" --format=json
  gcloud run jobs execute "$checker" --project="$project" --region="$region" --wait
  ;;
 preview)
  image
  apis run.googleapis.com artifactregistry.googleapis.com
  gcloud run deploy "$service" --project="$project" --region="$region" --image="$IMAGE_DIGEST" \
   --service-account="$sa" --ingress=all --no-invoker-iam-check --min=0 --max=1 --min-instances=0 --max-instances=1 \
   --concurrency=20 --cpu=1 --memory=512Mi --timeout=15s --set-env-vars="$inactive_env,STAGING_PREVIEW_ONLY=true,SERVE_STAGING_FRONTEND=true"
  url
  ;;
 seed-preview|seed-apply)
  image; live_review
  apis run.googleapis.com firestore.googleapis.com identitytoolkit.googleapis.com
  job='mi-client-staging-synthetic-seed'
  extra=''
  [[ "$phase" == seed-apply ]] && extra=',--apply'
  # Separate preview and apply invocations; never overwrites an existing tenant.
  gcloud run jobs deploy "$job" --project="$project" --region="$region" --image="$IMAGE_DIGEST" \
   --service-account="$sa" --command=node --args="dist-server/operator.mjs,seed-synthetic,$tenant$extra" \
   --set-env-vars="$base_env,ENABLE_LIVE_FIREBASE=true,ENABLE_SYNTHETIC_STAGING=true,STAGING_IAM_VERIFIED=true,FIRESTORE_RULES_VERIFIED=true" \
   --tasks=1 --max-retries=0 --task-timeout=120s --cpu=1 --memory=512Mi
  gcloud run jobs execute "$job" --project="$project" --region="$region" --wait
  ;;
 activate)
  image; live_review; identity_config
  apis run.googleapis.com firestore.googleapis.com identitytoolkit.googleapis.com
  origin="$(url)"
  [[ "$origin" =~ ^https://[a-z0-9-]+\.[a-z0-9-]+\.run\.app$ || "$origin" =~ ^https://[a-z0-9-]+\.run\.app$ ]] || exit 2
  gcloud run services update "$service" --project="$project" --region="$region" --image="$IMAGE_DIGEST" \
   --set-env-vars="$active_env,STAGING_PREVIEW_ONLY=false,SERVE_STAGING_FRONTEND=true,ALLOWED_ORIGIN=$origin,MORRIS_ENTRA_TENANT_ID=$MORRIS_ENTRA_TENANT_ID,MORRIS_ENTRA_CLIENT_ID=$MORRIS_ENTRA_CLIENT_ID,MORRIS_DASHBOARD_TENANT_ID=$tenant"
  printf 'Controlled staging URL: %s/#/secure\n' "$origin"
  ;;
 rollback)
  apis run.googleapis.com
  gcloud run services update "$service" --project="$project" --region="$region" \
   --update-env-vars="STAGING_PREVIEW_ONLY=true,ENABLE_LIVE_FIREBASE=false,ENABLE_SYNTHETIC_STAGING=false,STAGING_IAM_VERIFIED=false,FIRESTORE_RULES_VERIFIED=false"
  ;;
 *) echo 'Unknown phase; no change performed' >&2; exit 2 ;;
esac
