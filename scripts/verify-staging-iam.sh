#!/usr/bin/env bash
# Cloud Shell, read-only collection. No Troubleshooter/database writes/grants/API enablement.
set -euo pipefail
umask 077
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
command -v gcloud >/dev/null || { echo 'INCONCLUSIVE: gcloud unavailable' >&2; exit 2; }
command -v node >/dev/null || { echo 'INCONCLUSIVE: node unavailable' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project='morris-client-dash-zagime'
sa='mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'
out="$(mktemp -d "${TMPDIR:-/tmp}/mi-staging-iam.XXXXXXXX")"
echo "Private evidence directory: $out"
capture() {
  local file="$1"; shift
  if ! gcloud "$@" --format=json >"$out/$file.json" 2>"$out/$file.error.txt"; then
    echo "INCONCLUSIVE: read failed: $file (see protected error file)" >&2
    return 0
  fi
  rm -- "$out/$file.error.txt"
}
capture project projects describe "$project"
capture ancestors projects get-ancestors "$project"
capture service-account iam service-accounts describe "$sa" --project="$project"
capture service-account.policy iam service-accounts get-iam-policy "$sa" --project="$project"
if node "$script_dir/staging-iam-review.cjs" --ancestors "$out" >"$out/ancestors.txt" 2>"$out/ancestor-review.error.txt"; then
  rm -- "$out/ancestor-review.error.txt"
  while read -r kind id; do
    case "$kind" in
      project) capture "$kind-$id.policy" projects get-iam-policy "$project" ;;
      folder) capture "$kind-$id.policy" resource-manager folders get-iam-policy "$id" ;;
      organization) capture "$kind-$id.policy" organizations get-iam-policy "$id" ;;
    esac
  done <"$out/ancestors.txt"
fi
if node "$script_dir/staging-iam-review.cjs" --roles "$out" >"$out/roles.txt" 2>"$out/role-list.error.txt"; then
  rm -- "$out/role-list.error.txt"
  while IFS= read -r role || [[ -n "$role" ]]; do
    [[ -z "$role" ]] && continue
    name="role-${role//\//__}"
    case "$role" in
      roles/*) capture "$name" iam roles describe "$role" ;;
      projects/*/roles/*) owner="${role#projects/}"; owner="${owner%%/*}"; capture "$name" iam roles describe "${role##*/}" --project="$owner" ;;
      organizations/*/roles/*) owner="${role#organizations/}"; owner="${owner%%/*}"; capture "$name" iam roles describe "${role##*/}" --organization="$owner" ;;
    esac
  done <"$out/roles.txt"
fi
# Exit 2 intentionally even for a direct-profile match: complete human/runtime review is required.
node "$script_dir/staging-iam-review.cjs" --review "$out"
