#!/usr/bin/env bash
# OFFLINE deployment phase/argument regressions. Never calls cloud SDK.
set -euo pipefail
base="$(mktemp -d /tmp/mi-m8-test.XXXXXXXX)"
cleanup() { [[ "$base" == /tmp/mi-m8-test.* && -d "$base" ]] && rm -rf -- "$base"; }
trap cleanup EXIT
mkdir "$base/bin"
cat >"$base/bin/gcloud" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$COMMAND_LOG"
if [[ "$*" == 'run services describe '* ]]; then echo 'https://synthetic-test.run.app'; fi
if [[ "$*" == 'services list '* ]]; then printf '%s\n' run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com identitytoolkit.googleapis.com; fi
MOCK
chmod +x "$base/bin/gcloud"
export PATH="$base/bin:$PATH" COMMAND_LOG="$base/commands"
export IMAGE_DIGEST="northamerica-northeast1-docker.pkg.dev/morris-client-dash-zagime/synthetic-repo/mi-client-staging@sha256:$(printf 'a%.0s' {1..64})"
bash scripts/m8-staging.sh inventory
[[ "$(wc -l <"$COMMAND_LOG")" -eq 6 ]]
for phase in build create-checker check-identity preview seed-preview seed-apply activate rollback; do
  if bash scripts/m8-staging.sh "$phase" >"$base/denial.log" 2>&1; then echo 'Missing approval must stop'; exit 1; fi
done
[[ "$(wc -l <"$COMMAND_LOG")" -eq 6 ]]
if bash scripts/m8-staging.sh activate --approved-activate >"$base/denial.log" 2>&1; then exit 1; fi
[[ "$(wc -l <"$COMMAND_LOG")" -eq 6 ]]
bash scripts/m8-staging.sh create-checker --approved-create-checker
grep -q 'jobs create mi-client-staging-identity-check' "$COMMAND_LOG"
grep -q -- '--service-account=mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com' "$COMMAND_LOG"
bash scripts/m8-staging.sh preview --approved-preview
grep -q 'STAGING_PREVIEW_ONLY=true' "$COMMAND_LOG"
if grep -q 'ENABLE_LIVE_FIREBASE=true' "$COMMAND_LOG"; then exit 1; fi
export M8_LIVE_REVIEW_APPROVED=true MORRIS_ENTRA_TENANT_ID='11111111-1111-4111-8111-111111111111' MORRIS_ENTRA_CLIENT_ID='22222222-2222-4222-8222-222222222222'
bash scripts/m8-staging.sh activate --approved-activate
grep -q 'FIRESTORE_DATABASE_ID=mi-client-staging' "$COMMAND_LOG"
grep -q 'ALLOWED_ORIGIN=https://synthetic-test.run.app' "$COMMAND_LOG"
if grep -qE '\(default\)|add-iam-policy-binding|set-iam-policy|services enable' "$COMMAND_LOG"; then exit 1; fi
# Prove invalid logging prevents submission, using an isolated config and fake SDK.
mkdir "$base/scripts" "$base/deployment"
cp scripts/m8-staging.sh scripts/validate-m8-build.cjs "$base/scripts/"
ln -s "$PWD/node_modules" "$base/node_modules"
printf 'options:\n  logging: LEGACY\n' >"$base/deployment/cloudbuild-m8.yaml"
before="$(wc -l <"$COMMAND_LOG")"
if bash "$base/scripts/m8-staging.sh" build --approved-build >"$base/logging-denial.log" 2>&1; then exit 1; fi
[[ "$(wc -l <"$COMMAND_LOG")" -eq "$before" ]]
grep -q 'STOP: M8 build config' "$base/logging-denial.log"
cp deployment/cloudbuild-m8.yaml "$base/deployment/cloudbuild-m8.yaml"
export IMAGE_TAG="northamerica-northeast1-docker.pkg.dev/morris-client-dash-zagime/synthetic-repo/mi-client-staging:$(printf 'b%.0s' {1..40})"
export FIREBASE_WEB_API_KEY='synthetic-public-key' FIREBASE_WEB_APP_ID='1:123:web:abc' FIREBASE_AUTH_DOMAIN='morris-client-dash-zagime.firebaseapp.com'
export BUILD_SOURCE_BUCKET='gs://synthetic-existing-source' BUILD_LOG_BUCKET='gs://synthetic-existing-logs'
export BUILD_SERVICE_ACCOUNT='projects/morris-client-dash-zagime/serviceAccounts/mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'
if bash "$base/scripts/m8-staging.sh" build --approved-build >"$base/identity-denial.log" 2>&1; then exit 1; fi
[[ "$(wc -l <"$COMMAND_LOG")" -eq "$before" ]]
export BUILD_SERVICE_ACCOUNT='projects/morris-client-dash-zagime/serviceAccounts/mi-client-build@morris-client-dash-zagime.iam.gserviceaccount.com'
bash "$base/scripts/m8-staging.sh" build --approved-build
grep -q -- "--service-account=$BUILD_SERVICE_ACCOUNT" "$COMMAND_LOG"
grep -q -- "--gcs-source-staging-dir=$BUILD_SOURCE_BUCKET/m8-source" "$COMMAND_LOG"
grep -q -- "--gcs-log-dir=$BUILD_LOG_BUCKET/m8-logs" "$COMMAND_LOG"
grep -q -- "_IMAGE=$IMAGE_TAG" "$COMMAND_LOG"
echo 'Offline M8 phase guards passed; no deployment or live cloud verification.'
