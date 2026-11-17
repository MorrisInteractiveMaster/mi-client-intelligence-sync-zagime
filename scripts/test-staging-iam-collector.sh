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
printf '%s\n' "$*" >>"$COMMAND_LOG"
case "$*" in
 'projects describe '*)
  case "$FIXTURE" in
   inherited|deniedfolder) echo '{"projectId":"morris-client-dash-zagime","projectNumber":"1000","parent":{"type":"folder","id":"2000"}}' ;;
   *) echo '{"projectId":"morris-client-dash-zagime","projectNumber":"1000"}' ;;
  esac ;;
 'projects get-ancestors '*)
  case "$FIXTURE" in
   numeric) echo '[{"type":"project","id":"1000"}]' ;;
   inherited|deniedfolder) echo '[{"type":"project","id":"morris-client-dash-zagime"},{"type":"folder","id":"2000"},{"type":"organization","id":"3000"}]' ;;
   unknown) echo '[{"type":"project","id":"morris-client-dash-zagime"},{"type":"unsupported","id":"3000"}]' ;;
   *) echo '[{"type":"project","id":"morris-client-dash-zagime"}]' ;;
  esac ;;
 'projects get-iam-policy '*)
  case "$FIXTURE" in
   invalid) echo 'INVALID_ARGUMENT / INVALID_RESOURCE_NAME: //firestore.googleapis.com/projects/example/databases/mi-client-staging' >&2; exit 1 ;;
   disabled) echo 'SERVICE_DISABLED: API not enabled' >&2; exit 1 ;;
   denied) echo 'PERMISSION_DENIED: getIamPolicy permission missing' >&2; exit 1 ;;
  esac
  echo '{"version":3,"bindings":[{"role":"projects/morris-client-dash-zagime/roles/miClientStagingData","members":["serviceAccount:mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com"],"condition":{"expression":"resource.name==\"projects/morris-client-dash-zagime/databases/mi-client-staging\""}},{"role":"projects/morris-client-dash-zagime/roles/miClientStagingAuthRead","members":["serviceAccount:mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com"]}]}' ;;
 'organizations get-iam-policy '*) echo '{"bindings":[]}' ;;
 'resource-manager folders get-iam-policy '*)
  if [[ "$FIXTURE" == deniedfolder ]]; then echo 'PERMISSION_DENIED: folder policy inaccessible' >&2; exit 1; fi
  echo '{"bindings":[]}' ;;
 'iam service-accounts describe '*) echo '{"email":"mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com","disabled":false}' ;;
 'iam service-accounts get-iam-policy '*) echo '{"bindings":[]}' ;;
 'iam roles describe miClientStagingData '*) echo '{"name":"projects/morris-client-dash-zagime/roles/miClientStagingData","includedPermissions":["datastore.databases.get","datastore.databases.getMetadata","datastore.entities.get","datastore.entities.list","datastore.entities.create","datastore.entities.update"]}' ;;
 'iam roles describe miClientStagingAuthRead '*) echo '{"name":"projects/morris-client-dash-zagime/roles/miClientStagingAuthRead","includedPermissions":["firebaseauth.users.get"]}' ;;
 *) echo 'Unexpected command in offline test' >&2; exit 99 ;;
esac
MOCK
chmod +x "$base/bin/gcloud"
export PATH="$base/bin:$PATH" TMPDIR="$base/evidence"
for scenario in profile numeric inherited invalid disabled denied deniedfolder unknown; do
 export FIXTURE="$scenario"
 export COMMAND_LOG="$base/$scenario.commands"
 set +e
 bash scripts/verify-staging-iam.sh >"$base/$scenario.log" 2>&1
 code=$?
 set -e
 [[ "$code" -eq 2 ]] || { cat "$base/$scenario.log"; echo 'Collector must never report operational PASS'; exit 1; }
 if [[ "$scenario" == profile || "$scenario" == numeric || "$scenario" == inherited ]]; then
   grep -q 'PROFILE_MATCH_REQUIRES_REVIEW' "$base/$scenario.log"
   grep -q '^projects get-iam-policy morris-client-dash-zagime --format=json$' "$COMMAND_LOG"
   grep -q '^iam roles describe miClientStagingData --project=morris-client-dash-zagime --format=json$' "$COMMAND_LOG"
   grep -q '^iam roles describe miClientStagingAuthRead --project=morris-client-dash-zagime --format=json$' "$COMMAND_LOG"
 else
   grep -q 'INCONCLUSIVE' "$base/$scenario.log"
 fi
 if [[ "$scenario" == inherited || "$scenario" == deniedfolder ]]; then
   grep -q '^resource-manager folders get-iam-policy 2000 --format=json$' "$COMMAND_LOG"
   grep -q '^organizations get-iam-policy 3000 --format=json$' "$COMMAND_LOG"
 fi
 report="$(sed -n 's/^Private evidence directory: //p' "$base/$scenario.log")/review.json"
 node -e '
  const r=require(process.argv[1]), s=process.argv[2];
  if(r.activationAuthorized!==false)process.exit(1);
  const expected={invalid:"UNSUPPORTED_RESOURCE",disabled:"UNSUPPORTED_API",denied:"MISSING_VISIBILITY",deniedfolder:"MISSING_VISIBILITY",unknown:"MISSING_ANCESTRY"}[s];
  if(expected && !r.findings.some(f=>f.code===expected))process.exit(1);
  if(!expected && (r.findings.length || r.violations.length))process.exit(1);
 ' "$report" "$scenario"
 if [[ "$scenario" == profile || "$scenario" == numeric || "$scenario" == inherited ]]; then
   [[ ! -f "${report%/review.json}/ancestor-review.error.txt" ]]
 fi
done
echo 'Offline collector regressions passed; no cloud access or effective-permission proof.'
