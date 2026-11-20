# Production build identity migration

Run each section separately in Cloud Shell as an authorized owner. Keep the evidence directory private. The dedicated build account builds and publishes immutable image digests. A separate release operator deploys an approved digest using the existing Cloud Run runtime identity. This procedure uses the existing project, registry, accounts and source bucket.

The owner reported that Compute is the Cloud Build default in Montréal and global, and that its direct project Editor grant permits attaching the production runtime. Confirm these facts in section 1. The repository already pins staging builds to the dedicated builder. The production Docker build remains an independent fallback under the release operator's own registry access. This production Cloud Build path sends build logs to Cloud Logging. Review the existing routing before approving the first build. The build accepts only public Firebase and Entra configuration.

## 1. Read-only inventory and dependency check

```bash
set -euo pipefail
umask 077
P=morris-client-dash-zagime
R=northamerica-northeast1
B="mi-client-build@$P.iam.gserviceaccount.com"
C=892989290947-compute@developer.gserviceaccount.com
PRUN="mi-client-production-api@$P.iam.gserviceaccount.com"
SRUN="mi-client-staging-api@$P.iam.gserviceaccount.com"
SECRET=mi-client-prod-time
SVC=mi-client-prod-dashboard
E="$(mktemp -d "$HOME/zagime-build-iam.XXXXXXXX")"
test "$(gcloud projects describe "$P" --format='value(projectNumber)')" = 892989290947
gcloud projects get-ancestors "$P" --format=json >"$E/ancestors.json"
while IFS=$'\t' read -r level id; do
  case "$level" in
    folder) gcloud resource-manager folders get-iam-policy "$id" --format=json >"$E/folder-$id.json" ;;
    organization) gcloud organizations get-iam-policy "$id" --format=json >"$E/organization-$id.json" ;;
  esac
done < <(jq -r '.[]|[.type,.id]|@tsv' "$E/ancestors.json")
gcloud projects get-iam-policy "$P" --format=json >"$E/project-before.json"
gcloud iam roles describe roles/editor --format=json >"$E/editor.json"
for account in "$B" "$C" "$PRUN" "$SRUN"; do
  gcloud iam service-accounts describe "$account" --project="$P" --format='json(email,uniqueId,disabled)' >"$E/$account.json"
  gcloud iam service-accounts get-iam-policy "$account" --project="$P" --format=json >"$E/$account-iam.json"
  gcloud iam service-accounts keys list --iam-account="$account" --managed-by=user --project="$P" --format=json >"$E/$account-keys.json"
done
gcloud artifacts repositories get-iam-policy mi-client-build --project="$P" --location="$R" --format=json >"$E/registry.json"
gcloud secrets get-iam-policy "$SECRET" --project="$P" --location="$R" --format=json >"$E/time-secret-iam.json"
gcloud firestore databases describe --project="$P" --database=mi-client-production --format='json(name,uid,locationId)' >"$E/database.json"
jq -e --arg location "$R" '.uid == "b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd" and .locationId == $location' "$E/database.json" >/dev/null
gcloud logging sinks list --project="$P" --format='json(name,destination,filter,disabled)' >"$E/log-routing.json"
gcloud services list --enabled --project="$P" --format='value(config.name)' >"$E/enabled-apis.txt"
for location in global "$R" ${OTHER_REVIEWED_BUILD_REGIONS:-}; do
  gcloud builds get-default-service-account --project="$P" --region="$location" >"$E/default-$location.txt"
  gcloud builds triggers list --project="$P" --region="$location" --format='json(id,name,serviceAccount,disabled,filename,createTime)' >"$E/triggers-$location.json"
  gcloud builds list --project="$P" --region="$location" --limit=100 --format='json(id,createTime,status,serviceAccount,buildTriggerId,images,results.images)' >"$E/builds-$location.json"
done
gcloud run services list --project="$P" --region="$R" --format='json(metadata.name,spec.template.spec.serviceAccountName,status.traffic)' >"$E/run-services.json"
gcloud run jobs list --project="$P" --region="$R" --format='json(metadata.name,spec.template.spec.template.spec.serviceAccountName)' >"$E/run-jobs.json"
gcloud logging read "protoPayload.authenticationInfo.principalEmail=\"$C\" OR protoPayload.authenticationInfo.serviceAccountDelegationInfo.firstPartyPrincipal.principalEmail=\"$C\"" --project="$P" --freshness=90d --limit=500 --format='json(timestamp,protoPayload.serviceName,protoPayload.methodName)' >"$E/default-usage.json"
if grep -Fxq compute.googleapis.com "$E/enabled-apis.txt"; then
  gcloud compute instances list --project="$P" --flatten='serviceAccounts[]' \
    --filter="serviceAccounts.email=$C" --format='json(name,zone,serviceAccounts.email)' >"$E/compute-instances.json"
  gcloud compute instance-templates list --project="$P" \
    --format='json(name,properties.serviceAccounts)' >"$E/compute-templates.json"
fi
capture_serving() {
  for service in "$SVC" mi-client-staging-dashboard; do
    local state revision
    state="$(gcloud run services describe "$service" --project="$P" --region="$R" \
      --format='json(spec.template.spec.serviceAccountName,status.traffic)')" || return
    jq -ceS '{account:.spec.template.spec.serviceAccountName,traffic:([.status.traffic[]|select(.percent > 0)]|sort_by(.revisionName))}' <<<"$state" || return
    for revision in $(jq -er '[.status.traffic[]|select(.percent > 0)|.revisionName]|sort|.[]' <<<"$state"); do
      gcloud run revisions describe "$revision" --project="$P" --region="$R" --format='value(status.imageDigest)' || return
    done
  done
}
capture_serving >"$E/serving-before.txt"
printf 'Private evidence directory %s\n' "$E"
```

Review all enabled locations, inherited folder and organization policies, deny and principal access boundary policies, custom roles, groups and principal sets. Include direct resource policies, service-account keys, Token Creator chains and workload identity federation. Inspect the Cloud Build service agent `service-892989290947@gcp-sa-cloudbuild.iam.gserviceaccount.com` and its existing managed service-agent binding. Separate that service agent from the identities that execute build steps.

Confirm the production and staging runtime identities and the production database UID `b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd`. Review the named regional secret and its version metadata if needed. If the secret or its policy is unavailable, resolve its existence and target with the owner before certifying access. Run no data probes or secret payload commands.

Check every active, scheduled or infrequent user of the Compute account. Where enabled, enumerate Compute instances and templates, Cloud Run services and jobs in other regions, Cloud Functions build and runtime identities, Scheduler identities, and CI, source deployments, or other callers that omit `--service-account`. Inspect trigger build configuration before reassigning any trigger. A blank build identity or missing historical logs leaves the dependency unresolved. Cover callers and regions beyond the sample in this inventory through owner records and a complete inventory of enabled services. Keep an explicit owner sign-off for any dependency that cannot be retired or migrated during the equivalent-build test. Stop before role removal if any such dependency still relies on Editor.

If the inventory reveals a legacy Cloud Build account or another build identity, include it in the isolation review.

## 2. Owner-approved targeted grants

Use the existing Montréal staging source bucket only after confirming it is in this project and its approved build-source prefix contains source archives only. Review existing effective grants first. Apply each command only for a documented missing permission. Use the existing Cloud Build service-agent binding. Use an approved submitter with existing `cloudbuild.builds.create`, `cloudbuild.builds.get`, and the Cloud Storage permissions needed to upload source to this prefix. Cloud Build itself reads source, publishes the result to the repository and writes logs.

```bash
: "${SOURCE_BUCKET:?Set the existing approved gs:// Montréal source bucket}"
: "${SUBMITTER_MEMBER:?Set the approved user: or group: principal}"
gcloud storage buckets describe "$SOURCE_BUCKET" --project="$P" --format=json >"$E/source-bucket.json"
gcloud storage buckets get-iam-policy "$SOURCE_BUCKET" --project="$P" --format=json >"$E/source-before.json"
SOURCE_NAME="${SOURCE_BUCKET#gs://}"
SOURCE_CONDITION="expression=resource.name.startsWith('projects/_/buckets/$SOURCE_NAME/objects/production-build-source/'),title=zagime-production-build-source"
```

For a missing grant, apply the matching command after owner approval. A conditional Cloud Storage grant requires uniform bucket-level access. If the existing bucket cannot support that condition, stop and select an existing suitable bucket with the owner.

```bash
gcloud artifacts repositories add-iam-policy-binding mi-client-build --project="$P" --location="$R" \
  --member="serviceAccount:$B" --role=roles/artifactregistry.writer
gcloud storage buckets add-iam-policy-binding "$SOURCE_BUCKET" --project="$P" \
  --member="serviceAccount:$B" --role=roles/storage.objectViewer --condition="$SOURCE_CONDITION"
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$B" \
  --role=roles/logging.logWriter --condition=None
gcloud iam service-accounts add-iam-policy-binding "$B" --project="$P" \
  --member="$SUBMITTER_MEMBER" --role=roles/iam.serviceAccountUser
```

Keep deployment rights on the separately approved release operator. Check its existing Artifact Registry read, Cloud Run service update, and `actAs` on the production runtime. Preserve the Cloud Run service agent's existing image-pull access. The builder gets zero Cloud Run or Firebase/Firestore roles, Secret Accessor grants, runtime impersonation privileges, or token creation grants. If the supported explicit build needs more, stop and identify the exact missing permission.

## 3. Verify the equivalent build before removing Editor

Use a checkout that has the reviewed production candidate commit locally. The migration helper can archive the pending redesign independently of which branch contains the helper. Set the public build values specified in the [production launch runbook](production-launch-runbook.md#3-build-and-initialize-then-deploy-privately). The helper checks the bucket and repository, archives the exact reviewed commit, sets the build identity explicitly and chooses a unique tag. It never deploys the image.

```bash
: "${REVIEWED_SHA:?Set the full reviewed dashboard commit SHA}"
: "${REPOSITORY_DIR:?Set the checkout containing the reviewed dashboard SHA}"
python3 scripts/production-build.py submit --approved-build \
  --repository "$REPOSITORY_DIR" --revision "$REVIEWED_SHA" --source-bucket "$SOURCE_BUCKET"
# After SUCCESS, set PRE_BUILD_ID to the exact ID printed at submission.
: "${PRE_BUILD_ID:?Set the exact successful pre-removal build ID}"
python3 scripts/production-build.py verify --build-id "$PRE_BUILD_ID" \
  --revision "$REVIEWED_SHA" --source-bucket "$SOURCE_BUCKET" | tee "$E/pre-image.txt"
gcloud logging read "resource.type=build AND resource.labels.build_id=\"$PRE_BUILD_ID\"" \
  --project="$P" --limit=1 --format='value(timestamp)' >"$E/pre-log.txt"
test -s "$E/pre-log.txt"
```

Verify that effective access for the dedicated account meets section 5 before treating the build as a replacement. Smoke-test the approved digest through the existing isolated container check where feasible, with production mode disabled and no runtime credentials or data mounted. Update and test every approved build-only trigger or explicit caller still using Compute. A trigger's service-account setting controls trigger builds even when its YAML names another account. Review the source and the trigger type before changing its identity. Keep serving revisions and their image digests pinned throughout.

## 4. Owner gate to remove the direct Editor binding

Proceed only after exact digest verification, dependency sign-off for both regions and other affected services, and explicit approval for the one binding removal. Snapshot the current binding and ensure it is the direct unconditional assignment described by the owner.

```bash
test -s "$E/pre-image.txt"
test -s "$E/pre-log.txt"
read -r -p 'After owner and dependency approval, type REMOVE COMPUTE EDITOR: ' CONFIRM_EDITOR_REMOVAL
test "$CONFIRM_EDITOR_REMOVAL" = 'REMOVE COMPUTE EDITOR'
gcloud projects get-iam-policy "$P" --format=json >"$E/project-at-cutover.json"
jq -e --arg principal "serviceAccount:$C" \
  'any(.bindings[]; .role == "roles/editor" and (.condition == null) and (.members | index($principal) != null))' \
  "$E/project-at-cutover.json" >/dev/null
gcloud projects remove-iam-policy-binding "$P" --member="serviceAccount:$C" \
  --role=roles/editor --condition=None
gcloud projects get-iam-policy "$P" --format=json >"$E/project-after.json"
jq -e --arg principal "serviceAccount:$C" \
  'all(.bindings[]; .role != "roles/editor" or (.members | index($principal) == null))' \
  "$E/project-after.json" >/dev/null
```

After propagation, repeat the explicit build with a fresh build ID and run the verifier again. Recheck the recorded runtime identities and traffic, review registry and logging evidence, and run section 5 for both build principals. The platform can continue to report Compute as its default. Production submissions and approved triggers must all choose the dedicated builder explicitly. Changes to project or organization default-selection policy require a separate scope and approval.

```bash
capture_serving >"$E/serving-after.txt"
diff -u "$E/serving-before.txt" "$E/serving-after.txt"
: "${POST_BUILD_ID:?Set the exact successful post-removal build ID}"
test "$POST_BUILD_ID" != "$PRE_BUILD_ID"
python3 scripts/production-build.py verify --build-id "$POST_BUILD_ID" \
  --revision "$REVIEWED_SHA" --source-bucket "$SOURCE_BUCKET" | tee "$E/post-image.txt"
```

## 5. Verify effective isolation without touching data

Run the direct checks before removal for the dedicated builder and after propagation for both principals. Use the exact runtime service account and deployment service. Capture each result. Run this with authorization to see all applicable policies.

```bash
SA_RESOURCE="//iam.googleapis.com/projects/$P/serviceAccounts/$(jq -er '.uniqueId' "$E/$PRUN.json")"
RUN_RESOURCE="//run.googleapis.com/projects/$P/locations/$R/services/$SVC"
PROJECT_RESOURCE="//cloudresourcemanager.googleapis.com/projects/$P"
for principal in "$B" "$C"; do
  for permission in actAs getAccessToken getOpenIdToken signBlob signJwt implicitDelegation setIamPolicy; do
    gcloud beta policy-troubleshoot iam "$SA_RESOURCE" --principal-email="$principal" \
      --permission="iam.serviceAccounts.$permission" --project="$P" --format=json >"$E/$principal.$permission.json"
  done
  gcloud beta policy-troubleshoot iam "$SA_RESOURCE" --principal-email="$principal" \
    --permission=iam.serviceAccountKeys.create --project="$P" --format=json >"$E/$principal.keys-create.json"
  gcloud beta policy-troubleshoot iam "$RUN_RESOURCE" --principal-email="$principal" \
    --permission=run.services.update --project="$P" --format=json >"$E/$principal.run-update.json"
  gcloud beta policy-troubleshoot iam "$PROJECT_RESOURCE" --principal-email="$principal" \
    --permission=resourcemanager.projects.setIamPolicy --project="$P" --format=json >"$E/$principal.project-policy.json"
  if jq -e 'any(.[]; .metadata.name == "mi-client-prod-time-sync")' "$E/run-jobs.json" >/dev/null; then
    TIME_JOB_RESOURCE="//run.googleapis.com/projects/$P/locations/$R/jobs/mi-client-prod-time-sync"
    for permission in run.jobs.update run.jobs.runWithOverrides; do
      gcloud beta policy-troubleshoot iam "$TIME_JOB_RESOURCE" --principal-email="$principal" \
        --permission="$permission" --project="$P" --format=json >"$E/$principal.$permission.json"
    done
  fi
done
```

For any direct permission above, require a conclusive `CANNOT_ACCESS` from the effective-policy review. Before removal, the Compute account is expected to fail this isolation gate. For Firestore and the regional credential, match the actual resource names and evaluate every applicable direct and inherited allow, condition, group and delegation route. Use the exact named database when evaluating `datastore.entities.get`, `datastore.entities.list`, database metadata and export permissions. Review the exact regional secret and its configured numeric version for `secretmanager.versions.access`, plus IAM policy administration on the secret. A check against a project placeholder cannot establish named-resource denial.

Get the canonical names from Cloud Asset when enabled. Use the database name or regional secret version only if the analysis tool supports the returned resource. Where tooling lacks coverage, the authorized reviewer must resolve permissions from the actual policies, role definitions and delegation paths before certifying denial.

```bash
gcloud asset list --project="$P" --content-type=resource \
  --asset-types=firestore.googleapis.com/Database,secretmanager.googleapis.com/Secret \
  --format='json(name,assetType)' >"$E/protected-assets.json"
DB_RESOURCE="$(jq -er '.[]|select(.assetType=="firestore.googleapis.com/Database" and (.name|endswith("/databases/mi-client-production")))|.name' "$E/protected-assets.json")"
SECRET_RESOURCE="$(jq -er --arg suffix "/locations/$R/secrets/$SECRET" '.[]|select(.assetType=="secretmanager.googleapis.com/Secret" and (.name|endswith($suffix)))|.name' "$E/protected-assets.json")"
: "${TIME_SECRET_VERSION:?Set the configured numeric version from approved runtime metadata}"
[[ "$TIME_SECRET_VERSION" =~ ^[1-9][0-9]*$ ]]
for principal in "$B" "$C"; do
  for permission in datastore.entities.get datastore.entities.list datastore.databases.getMetadata datastore.databases.export; do
    gcloud beta policy-troubleshoot iam "$DB_RESOURCE" --principal-email="$principal" \
      --permission="$permission" --project="$P" --format=json >"$E/$principal.$permission.json"
  done
  gcloud beta policy-troubleshoot iam "$SECRET_RESOURCE/versions/$TIME_SECRET_VERSION" --principal-email="$principal" \
    --permission=secretmanager.versions.access --project="$P" --format=json >"$E/$principal.secret-access.json"
  gcloud beta policy-troubleshoot iam "$SECRET_RESOURCE" --principal-email="$principal" \
    --permission=secretmanager.secrets.setIamPolicy --project="$P" --format=json >"$E/$principal.secret-policy.json"
done
```

When the organization reviewer has Cloud Asset visibility, use this supplementary query to look for allow and delegation paths, including access through other service accounts. Inspect both analysis sections and require complete results. Empty, incomplete or unsupported output requires policy review with an authorized reviewer. IAM policy conditions must be checked against the actual resources. Cloud Asset is an allow-policy tool and can lag recent changes.

```bash
ORG_ID="$(jq -er '.[] | select(.type == "organization") | .id' "$E/ancestors.json")"
for principal in "$B" "$C"; do
  gcloud asset analyze-iam-policy --organization="$ORG_ID" --identity="serviceAccount:$principal" \
    --permissions=datastore.entities.get,datastore.entities.list,datastore.databases.export,secretmanager.versions.access,secretmanager.secrets.setIamPolicy,iam.serviceAccounts.actAs,iam.serviceAccounts.getAccessToken,iam.serviceAccountKeys.create \
    --expand-groups --expand-roles --analyze-service-account-impersonation --show-response --format=json >"$E/$principal.indirect.json"
  jq -e '.fullyExplored == true and .mainAnalysis.fullyExplored == true' "$E/$principal.indirect.json" >/dev/null
done
```

Close the release blocker only after the pre/post builds, the direct and indirect evidence, and the protected-resource review are conclusive. Do not mint tokens as the build or runtime accounts, access secret versions, or query production Firestore records as an IAM test.

## Rollback

Before removal, troubleshoot the dedicated build or use the reviewed owner-run Docker build documented in the production launch runbook. After removal, use the dedicated path or the Docker fallback for dashboard images. If a verified legacy dependency is broken and the owner separately approves a time-limited emergency restore, restore only the recorded direct binding. Keep an owner and deadline to clear it again. Restoring Editor reopens the production IAM blocker.

```bash
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$C" \
  --role=roles/editor --condition=None
```

For targeted grant rollback, change `add-iam-policy-binding` to `remove-iam-policy-binding` in section 2 for grants that this change actually added, keeping each exact resource, member, role and condition. Verify the grant is unused first. Do not restore an older whole-policy snapshot over concurrent policy edits. This procedure performs no traffic rollback because it stages only an image.

References [Cloud Build account and logging configuration](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts), [Artifact Registry access](https://docs.cloud.google.com/artifact-registry/docs/access-control), [Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access), [Cloud Asset IAM analysis](https://docs.cloud.google.com/policy-intelligence/docs/analyze-iam-policies).
