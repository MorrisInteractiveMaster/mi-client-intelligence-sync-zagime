# M7 corrected Cloud Shell security workflow — SAME PR #7

The previous named-Firestore Policy Troubleshooter checker is **retired, unsupported/inconclusive for this workflow**. The owner ran its exact resource pattern and Google returned INVALID_ARGUMENT / INVALID_RESOURCE_NAME. A Firestore IAM condition's resource.name value does not establish that Policy Troubleshooter accepts the corresponding full resource name. Do not guess another database path, project number or context argument; do not convert an invalid/unknown result into NOT_GRANTED. The old PowerShell script and old matrix-probe entrypoint now stop without cloud access.

## Evidence and supported alternative

Owner-verified reads are preserved unchanged in m7-cloud-evidence.json: staging GET 404/LIST 200, default GET/LIST 403, UID 6d09ea71-f495-44a5-94a6-732ed1c47d88, existing mi-client-staging-api identity, temporary Token Creator binding removed. These do not prove write rights or an actual attached container identity. Do not repeat grants, restore Token Creator, create resources, enable APIs, deploy, activate, seed or connect QuickBooks.

Supported read APIs used instead:

- [Resource Manager projects.getIamPolicy](https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/getIamPolicy) via gcloud projects get-iam-policy, actual project ID morris-client-dash-zagime. Folder/organization policies are read using their actual numeric ancestor IDs from [projects get-ancestors](https://docs.cloud.google.com/sdk/gcloud/reference/projects/get-ancestors).
- [IAM roles.get / gcloud iam roles describe](https://docs.cloud.google.com/sdk/gcloud/reference/iam/roles/describe) expands each actual predefined, project or organization role. No assumed permission list based on role title.
- [Firestore database IAM](https://firebase.google.com/docs/firestore/manage-databases) documents the exact per-database condition below and project policy inspection. The Google Console's data view is not a valid database-conditional IAM test.
- [Troubleshooter guidance](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) requires an applicable resource/permission combination. Its [resource-name reference](https://docs.cloud.google.com/iam/docs/full-resource-names) supplies no verified named-Firestore pattern for this checker. The observed live failure remains authoritative; absence from a table is not a claim that all Firestore troubleshooting is universally unsupported.

## 1. Read-only inventory FIRST — assume no service/job exists

Run in an already authorized **Cloud Shell Bash** session from the existing PR checkout. No impersonation or IAM grant is needed to collect policies using an authorized reviewer account.

~~~bash
PROJECT_ID='morris-client-dash-zagime'
REGION='northamerica-northeast1'
SA='mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'
gcloud run services list --project="$PROJECT_ID" --region="$REGION" --format=json
gcloud run jobs list --project="$PROJECT_ID" --region="$REGION" --format=json
gcloud iam service-accounts describe "$SA" --project="$PROJECT_ID" --format=json
gcloud firestore databases describe --project="$PROJECT_ID" --database=mi-client-staging --format=json
~~~

Record existing names/digests, if any. Empty inventory is a valid result; do not invent a service or job. Lack of permission/API availability is inconclusive, not evidence that none exists. Do not enable APIs or add privileges automatically.

## 2. Collect actual policies, role permissions and inherited grants

~~~bash
bash scripts/verify-staging-iam.sh
~~~

The script reads project metadata/ancestors, every accessible project/folder/organization policy, the existing service account and its impersonation policy, and all referenced role definitions (including custom roles). It uses only documented read commands, no Troubleshooter request and no database read/write endpoint. It stores raw JSON/errors and review.json in a new private temporary directory under umask 077. Protect the directory outside Git; do not paste policies, member identities or credentials into the public PR.

**Exit 2 is intentional even on PROFILE_MATCH_REQUIRES_REVIEW.** This is evidence triage, not an effective-permission simulator or activation grant:

| Result | Meaning/action |
| --- | --- |
| INCONCLUSIVE | Missing permission, unsupported API/resource, missing role/ancestor, redacted conditions, unresolved group/domain/principal-set membership or custom condition. Stop; no denial inferred. |
| VIOLATION | Collected declarations include broad/unintended permissions for the identity/public members. Stop and obtain independent security review; no automatic IAM fix. |
| PROFILE_MATCH_REQUIRES_REVIEW | Only the narrow recognized direct profile is found in these snapshots. An authorized reviewer still must establish completeness, indirect/inherited routes and runtime prerequisites. No effective GRANTED/NOT_GRANTED result is emitted. |

The staging account resource policy controls who can impersonate it; it is not its outbound database policy. Resource-level grants on other accounts/resources and outbound impersonation routes also require authorized organization-wide/manual review. The collector does not enumerate all other resource policies.

The script cannot discover unseen policies when the reviewer lacks visibility, infer group membership, evaluate arbitrary CEL, or certify current effective permissions. It must never set STAGING_IAM_VERIFIED. Conditions require policy version 3; missing/withcond/redacted data is inconclusive. Collector limits/unknown formats stop rather than silently truncate. Error artifacts preserve INVALID_RESOURCE_NAME, SERVICE_DISABLED, permission failures and other unknowns for review.

### Mandatory permission review, based on actual snapshots

Expected minimal API profile:

~~~text
Firestore role permissions:
  datastore.databases.get
  datastore.databases.getMetadata
  datastore.entities.get
  datastore.entities.list
  datastore.entities.create
  datastore.entities.update
Every Firestore data grant must be restricted by exactly:
  resource.name == "projects/morris-client-dash-zagime/databases/mi-client-staging"
Separate project-scoped Firebase Auth permission:
  firebaseauth.users.get
~~~

Require no API-runtime delete, Auth create/update/delete, import/export/bulk delete, database administration, IAM administration, Owner/Editor/admin roles, public access or Token Creator/impersonation privileges. Other read-only Auth roles may still exceed the approved minimum; review their actual includedPermissions rather than approving the name. Do not add a role to make a missing permission disappear. Compare project policy with every folder/organization policy; inspect service-account policy and inherited impersonation/delegation routes. The removed temporary Token Creator binding stays removed.

The checker accepts optional spaces, tabs and line breaks between equality tokens and matched single or double quotes around the exact literal. The owner's `resource.name=="projects/morris-client-dash-zagime/databases/mi-client-staging"` therefore matches the same review-required profile as the spaced example. It does not normalize the literal, evaluate CEL, accept prefixes/alternate databases or permit additional Boolean operators, comments or escaped literals. A profile match still means activationAuthorized=false and exit 2, never effective IAM authorization.

For unresolved memberships/indirect routes, an already authorized organization reviewer can optionally use [Cloud Asset IAM analysis](https://docs.cloud.google.com/sdk/gcloud/reference/asset/analyze-iam-policy), without submitting a guessed Firestore resource:

~~~bash
ORG_ID='OWNER_VERIFIED_ORGANIZATION_ID_FROM_ANCESTORS'
umask 077
ANALYSIS_FILE="$(mktemp /tmp/mi-staging-memberships.XXXXXXXX.json)"
gcloud asset analyze-iam-policy --organization="$ORG_ID" \
  --identity="serviceAccount:$SA" --expand-groups --expand-roles \
  --analyze-service-account-impersonation --show-response --format=json >"$ANALYSIS_FILE"
~~~

This query may be expensive and requires existing authorized visibility/API availability. Do not run it with a guessed org, enable an API, add access, or treat a project-only query as complete organizational inheritance. Any analysis errors, incomplete/fullyExplored=false output, unknown conditions or unsupported resources remain inconclusive. Review condition applicability manually from authoritative policies; no tool absence is a denial.

## 3. Evidence for staging writes and default write denial — no production write experiment

Record a private review table for each actual grant/role/ancestor: source policy/etag, principal or verified membership path, expanded permissions, exact condition, and reviewer/completeness evidence.

- Staging create/update: require the actual role definitions to include both permissions under the exact named condition, plus transaction/read permissions above. Missing roles or conditional uncertainty blocks verification. Positive policy declarations are not proof that a transaction will succeed; deny/PAB/service-perimeter constraints can further restrict it.
- Default create/update/delete: an authorized reviewer may conclude denial by absence of any applicable allow **only after** all inherited/direct/indirect grants, conditions and impersonation routes are fully accounted for. Exact named equality does not match (default), while the separate Auth read grant gives no Firestore write permission. Any extra applicable allow, unseen policy or unresolved membership prevents this conclusion.
- Preserve the owner's verified default read denial as complementary evidence, not a substitute for write review. There is no reliable named-database testIamPermissions/dry-run-write API established for this task; none is invented. **Never send a write, rollback test transaction, invalid precondition write, create/delete probe or bulk operation to (default).**
- Actual staging create/update tests belong only to a later independently approved named synthetic smoke run. No remote writes/seed are executed in this task. Keep effective write status INCONCLUSIVE until the authorized review is complete; keep runtime-transaction status NOT TESTED until approved smoke evidence exists.

The agent has no authenticated Cloud SDK connection and has not inspected the actual live policies. This correction supplies a supported collection/review workflow; it does not falsely certify the existing service account's effective permissions.

## 4. Existing attached-identity runner, or explicit checker approval if absent

If inventory found a candidate, substitute that **existing** name and inspect before any execution:

~~~bash
EXISTING_JOB='OWNER_VERIFIED_EXISTING_CHECKER_JOB_NAME'
gcloud run jobs describe "$EXISTING_JOB" --project="$PROJECT_ID" --region="$REGION" --format=json
# For an existing service instead, inspect only:
EXISTING_SERVICE='OWNER_VERIFIED_EXISTING_STAGING_SERVICE_NAME'
gcloud run services describe "$EXISTING_SERVICE" --project="$PROJECT_ID" --region="$REGION" --format=json
~~~

A configured service account is not actual attachment proof. A usable checker must have independently reviewed immutable image digest, command node dist-server/check-staging-identity.mjs, only argument --approved-read-only-identity-check, exact existing staging identity, no credential overrides/mounts, no API server/seeder/worker, no traffic endpoint, no scheduled trigger and max retries 0/tasks 1/bounded timeout. All activation flags remain false. Known environment:

~~~text
BACKEND_MODE=staging
STAGING_FIREBASE_PROJECT_ID=morris-client-dash-zagime
FIRESTORE_DATABASE_ID=mi-client-staging
STAGING_DATABASE_UID=6d09ea71-f495-44a5-94a6-732ed1c47d88
STAGING_SERVICE_ACCOUNT_EMAIL=mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com
ENABLE_LIVE_FIREBASE=false
ENABLE_SYNTHETIC_STAGING=false
STAGING_IAM_VERIFIED=false
FIRESTORE_RULES_VERIFIED=false
~~~

Only after separate approval to execute an already verified checker job:

~~~bash
gcloud run jobs execute "$EXISTING_JOB" --project="$PROJECT_ID" --region="$REGION" --wait
~~~

Its actual metadata check must report attachedIdentityMatched=true, firestoreOperations=0, apiActivated=false. The entrypoint performs one trusted metadata email GET and no credential acquisition/Firestore/API startup. Runtime identity/UID/fail-closed guards are unchanged.

**If inventory is empty, denied or unsuitable: do not create a job automatically.** Submit a concrete checker-only proposal to the authorized Morris owner/architect containing: existing project/region/account above; verified no suitable runner; approved regional image digest/build provenance; the exact command/argument/environment above; tasks 1/max retries 0/60-second timeout/minimal CPU-memory; no public ingress/API/server/schedule; existing IAM only with no Token Creator grant; log/PII retention, estimated one-shot cost, execution owner and removal/rollback plan. Required distinct approvals: image build/storage if needed, dedicated checker job creation/configuration, execution/cost/access and cleanup. The owner-approved deployer must already have narrowly scoped actAs/deployment rights; do not grant those in this PR. After creation is separately authorized/performed, re-inventory/describe the exact job, independently review its configuration, then obtain execution approval. Identity-only checker requires no Firestore writes or API activation. Do not substitute an arbitrary existing job.

## 5. Smoke/release gates remain blocked

See m7-synthetic-smoke-tests.md for the prepared synthetic plan, only after a later explicit release/write/seed approval. Keep all live flags false until authorized complete policy review, actual attachment, published named deny-all rules, image/edge/CORS/origin/privacy/cost/rollback gates and appropriate smoke approval. Read evidence is preserved; no cloud provider/user/IAM change occurs here. No attached runner is assumed, no default writes are attempted, and no positive operational IAM assertion is made from offline fixtures.

Local verification commands:

~~~bash
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:server
npm run test:security
bash -n scripts/verify-staging-iam.sh scripts/test-staging-iam-collector.sh
bash scripts/test-staging-iam-collector.sh  # OFFLINE fixtures only, never cloud permission certification
~~~

On failure stop with activation disabled, retain private evidence, and return to review. Do not restore Token Creator, expand IAM, switch to default/production mode, recreate resources, delete audits or change shared Auth to force a pass.
