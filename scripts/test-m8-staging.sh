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
echo 'Offline M8 phase guards passed; no deployment or live cloud verification.'
