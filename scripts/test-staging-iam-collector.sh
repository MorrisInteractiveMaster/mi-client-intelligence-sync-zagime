#!/usr/bin/env bash
# OFFLINE regression test. A fake gcloud never certifies actual IAM.
set -euo pipefail
base="$(mktemp -d /tmp/mi-collector-test.XXXXXXXX)"
cleanup() { [[ "$base" == /tmp/mi-collector-test.* && -d "$base" ]] && rm -rf -- "$base"; }
trap cleanup EXIT
mkdir "$base/bin" "$base/evidence"
cat >"$base/bin/gcloud" <<'MOCK'
#!/usr/bin/env bash
set -eu
case "$*" in
 'projects describe '*) echo '{"projectNumber":"1000","parent":{"type":"organization","id":"3000"}}' ;;
 'projects get-ancestors '*) echo '[{"type":"project","id":"1000"},{"type":"organization","id":"3000"}]' ;;
 'projects get-iam-policy '*)
  case "$FIXTURE" in
   invalid) echo 'INVALID_ARGUMENT / INVALID_RESOURCE_NAME: //firestore.googleapis.com/projects/example/databases/mi-client-staging' >&2; exit 1 ;;
   disabled) echo 'SERVICE_DISABLED: API not enabled' >&2; exit 1 ;;
   denied) echo 'PERMISSION_DENIED: getIamPolicy permission missing' >&2; exit 1 ;;
  esac
  echo '{"version":3,"bindings":[{"role":"projects/morris-client-dash-zagime/roles/data","members":["serviceAccount:mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com"],"condition":{"expression":"resource.name==\"projects/morris-client-dash-zagime/databases/mi-client-staging\""}},{"role":"projects/morris-client-dash-zagime/roles/auth","members":["serviceAccount:mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com"]}]}' ;;
 'organizations get-iam-policy '*) echo '{"bindings":[]}' ;;
 'iam service-accounts describe '*) echo '{"email":"mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com","disabled":false}' ;;
 'iam service-accounts get-iam-policy '*) echo '{"bindings":[]}' ;;
 'iam roles describe data '*) echo '{"name":"projects/morris-client-dash-zagime/roles/data","includedPermissions":["datastore.databases.get","datastore.databases.getMetadata","datastore.entities.get","datastore.entities.list","datastore.entities.create","datastore.entities.update"]}' ;;
 'iam roles describe auth '*) echo '{"name":"projects/morris-client-dash-zagime/roles/auth","includedPermissions":["firebaseauth.users.get"]}' ;;
 *) echo 'Unexpected command in offline test' >&2; exit 99 ;;
esac
MOCK
chmod +x "$base/bin/gcloud"
export PATH="$base/bin:$PATH" TMPDIR="$base/evidence"
for scenario in profile invalid disabled denied; do
 export FIXTURE="$scenario"
 set +e
 bash scripts/verify-staging-iam.sh >"$base/$scenario.log" 2>&1
 code=$?
 set -e
 [[ "$code" -eq 2 ]] || { cat "$base/$scenario.log"; echo 'Collector must never report operational PASS'; exit 1; }
 if [[ "$scenario" == profile ]]; then
   grep -q 'PROFILE_MATCH_REQUIRES_REVIEW' "$base/$scenario.log"
 else
   grep -q 'INCONCLUSIVE' "$base/$scenario.log"
 fi
done
echo 'Offline collector regressions passed; no cloud access or effective-permission proof.'
