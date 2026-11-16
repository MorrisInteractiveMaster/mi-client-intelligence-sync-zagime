# Current M7 operator handoff — no deployment or seeding executed

The owner supplied verified read-only cloud evidence. Reuse all existing resources; no IAM grants, Token Creator restoration, provider/user changes, API activation, seed or deployment is authorized by this coding update.

- Project: morris-client-dash-zagime
- Named staging database: mi-client-staging
- Database UID: 6d09ea71-f495-44a5-94a6-732ed1c47d88
- Region: northamerica-northeast1
- Existing staging identity: mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com
- Owner reports staging GET 404 / LIST 200; production (default) GET / LIST 403.
- Owner reports temporary Token Creator IAM binding successfully removed.

These are owner-verified facts, not probes rerun by the implementation agent. Actual write-permission isolation, running attachment, published rules, image/network/origin/privacy approval and remote smoke acceptance remain gates. The agent has no authenticated Cloud SDK connection. No claim of verified production or API readiness follows from the read-only report.

## Exact next read-only commands

~~~powershell
$ProjectId = 'morris-client-dash-zagime'
$Region = 'northamerica-northeast1'
$StagingIdentity = 'mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com'
$WriteEvidencePath = 'OWNER_PROTECTED_NEW_PATH.iam-evidence.json'
./scripts/verify-staging-iam.ps1 -PrincipalEmail $StagingIdentity -WritePermissionsOnly -OutputPath $WriteEvidencePath
$ExistingStagingService = 'OWNER_VERIFIED_EXISTING_STAGING_SERVICE_NAME'
gcloud run services describe $ExistingStagingService --project=$ProjectId --region=$Region --format='value(spec.template.spec.serviceAccountName)'
gcloud run services describe $ExistingStagingService --project=$ProjectId --region=$Region --format=json
~~~

The first command checks six data-write policy decisions with no database writes; default create/update/delete must be definitely denied. Configured service identity must match the existing account above. Service names/digests/origins were not supplied: keep placeholders and stop if no existing runner can be verified; do not create a replacement. Do not repeat the completed document/list probes or IAM grants.

Follow [M7 detailed next steps](m7-operator-next-steps.md) for trusted runtime metadata validation under an existing approved read-only runner, exact expected results, error handling and remaining release gates. A configured identity is not an actual attached identity. The standalone check can run with activation flags false and reports zero Firestore operations; startup enforces the same identity before credentials and DB access.

## Future controlled smoke/release gate — not authorized to execute now

Use the [M7 synthetic smoke plan](m7-synthetic-smoke-tests.md), after independently approved image/edge/origin/rules/privacy/write/identity gates and a later explicit release/seed approval. Existing templates now contain the known UID/account and all live flags false. API/reporting/Morris data contracts remain unchanged; Firebase Authentication is shared and named memberships remain separate.

Never write to (default) to test a permission, change shared Auth users for staging cleanup, grant broad roles, restore Token Creator, recreate a database/project, guess an image/service name, or switch a failed staging image to production mode. Current [named-database architecture](same-project-staging.md) and historical [M5 administration](m5-administration.md) remain references. Old M6 instructions to gather the full read matrix are superseded for this update by accepted owner read evidence plus write-only verification.

Rollback after any separately approved future release must block/drain staging traffic and use only a compatible named-DB/attached-identity image. If none exists, keep staging stopped. Preserve audits/markers and production configuration; no automatic cleanup or QuickBooks OAuth/sync. All actual live changes remain subject to separate owner authorization.
