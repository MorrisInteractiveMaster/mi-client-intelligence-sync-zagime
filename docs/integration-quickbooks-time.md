# QuickBooks Time customer sync

The connector is read-only at QuickBooks Time and disabled by default. This rollout scopes the existing staging tenant to **Zagimē Anishinabēk Nation**. The four work-order labels supplied by the owner are reconciliation references. No account or jobcode ID is inferred from a name or work-order number.

## Source contract

- An authorized operator confirms the numeric customer **parent jobcode ID** in the matching Time account. `GET /jobcodes?ids=…` verifies that exact record. `GET /jobcodes?parent_ids=…&active=both&type=regular` returns direct children. Walk only verified parent IDs and check every returned ID and `parent_id`, including archived and nested jobcodes. `GET /projects?jobcode_ids=…` supplements a single discovered jobcode when the account exposes project metadata. Verify the returned project ID and `parent_jobcode_id`. A jobcode can exist without a project metadata record. The customer root itself is excluded from project/time import. [QuickBooks Time API reference](https://tsheetsteam.github.io/api_docs/#retrieve-jobcodes)
- `timesheets` and `timesheets_deleted` are filtered by verified jobcode, regular type and modification window. A parent filter may return child time. Verify the returned jobcode against the known descendants, then import only the exact jobcode in each batch. The immutable source key includes the Time company and timesheet ID. An explicit tombstone or correction reconciles reporting and retains the prior versions. A jobcode absent from a complete discovery is marked missing, its earlier data is retained, and its future reads stop. A move outside the customer tree or a deletion without sufficient jobcode evidence cannot be inferred from absence. Review any stale reported totals with the owner. [Timesheet filtering](https://tsheetsteam.github.io/api_docs/#retrieve-timesheets)
- Each checkpoint advances only after the scoped live and deleted feeds validate and all rows commit. A retry replays the previous overlap safely, and a dense window is halved before retry where possible. Numbered pages and overlapping timestamps do not constitute a snapshot or guarantee detection of arbitrary backdated changes. The reviewed modification floor is the earliest supported source history. Lifetime means all imported history since that floor. The worker bounds traversal to eight nested levels and 100 catalog entries, including retained missing records, and stops rather than widening scope or silently truncating. Extremely dense timestamps or retention capacity require a reviewed reconciliation.
- The optional on-clock query uses the verified customer ID, `on_the_clock=yes`, and the same modification floor. Only an observed count and elapsed seconds per jobcode are saved. The last snapshot is timestamped and can be stale. Timers do not appear in recorded/allocated hours. Completed entries keep exact integer seconds and approval `unknown` until source evidence supports a classification.
- A new mapping creates one deterministic unpublished draft. Renames update the staff-only source catalog while Morris names, plans, progress, notes, updates, milestones and publication stay under Morris control. Linking to an existing project changes the staff reporting grouping. The source anchor, original draft and existing manual allocations remain. Earlier explicitly mapped pilot projects can be adopted when rediscovered under this customer. Their legacy source anchors are fixed to preserve earlier totals. Zagimē clients receive only explicitly scoped, published Morris allocations. Unallocated source time is visible to staff under **Hours & allocations** and **Integrations**.

## Storage and retry behaviour

The worker uses the existing `tenants/{tenant}` namespace in `mi-client-staging`. `timeMappings` stores the account/jobcode relationship, customer catalog key and source snapshot. `timeRuns` stores customer enrollment, bounded run lease, Regina completion day and daily status. Registration and audit events commit atomically with the existing `projects` and `projectViews` writes. `rawTime/{source}/versions`, `timeProjectTotals`, the existing per-job checkpoints and the allocation/audit paths retain their existing authority. No new composite index is required.

The daily worker fences an execution for up to 27 minutes, uses a 25-minute work budget and reuses the existing fenced per-job transactions. It processes unfinished history round-robin against a daily cutoff. A completed Regina day is deduplicated. A failed attempt preserves previous successful jobcode checkpoints, records the failure stage and returns a nonzero exit code. A manual repeat of the job resumes failed work. Connector operators can also retry one discovered jobcode from the dashboard. The schedule is **06:00 America/Regina**.

## Approved staging rollout

Every live step below requires owner authorization. Do not build or run against `(default)`, reseed the existing tenant, change OAuth providers or log credentials. Use the active dashboard rollout procedure for image publication and the exact existing runtime settings. [Active dashboard rollout](project-only-operator-runbook.md#dashboard-experience-rollout)

1. Record the real Time company ID, actor ID, account slug, and the independently verified numeric parent ID. Confirm the account exposes all four known work orders and permits the requested scoped historical and incremental reads. The enrollment command also compares the returned parent label with **Zagimē Anishinabēk Nation** during setup. Once enrolled, stable IDs control scope. Record permissions for completed time, deletions, archived jobs and on-clock visibility separately. Missing entitlement remains a rollout blocker.
2. Prepare a pinned regional Secret Manager version in `northamerica-northeast1` using the approved version payload. It contains `companyId`, `userId`, `clientUrl`, `tenant`, `customerParentId` (string), `expiresAt` (UTC ISO timestamp with milliseconds), and `accessToken`. Bind the exact payload bytes by SHA-256, independently approve the account and customer scope, and grant only version access to the approved existing runtime identity on that specific secret. Use provider grant evidence to bind the company when `current_user` omits the numeric company ID. No token value belongs in shell commands, app configuration or environment files. When renewal is needed, approve a new numeric version and digest with identical account/customer scope, update both the job and dashboard using separate reviewed rollout, and verify access before retiring the previous version. Expired credentials fail closed. Automatic refresh is outside this implementation. [Regional secret access](https://docs.cloud.google.com/secret-manager/regional-secrets/access-secret-version-rs)
3. Copy the approved active runtime staging guard values into a private job environment file. Retain `BACKEND_MODE=staging`, `STAGING_FIREBASE_PROJECT_ID=morris-client-dash-zagime`, `FIRESTORE_DATABASE_ID=mi-client-staging`, UID `6d09ea71-f495-44a5-94a6-732ed1c47d88` and the reviewed runtime identity and verification guard values. Retain the existing approved `MORRIS_DASHBOARD_TENANT_ID`. Add these settings for the job and the later dashboard connector revision.

| Setting | Reviewed value |
| --- | --- |
| `ENABLE_QUICKBOOKS_TIME` | `true` only after authorized Time rollout |
| `QUICKBOOKS_TIME_ACCOUNT_ID` | Exact numeric Time account |
| `QUICKBOOKS_TIME_CLIENT_URL` | Approved account slug |
| `QUICKBOOKS_TIME_CREDENTIAL_USER_ID` | Exact active provider actor |
| `QUICKBOOKS_TIME_ADMIN_UID` | Existing authorized Morris connector operator |
| `QUICKBOOKS_TIME_CUSTOMER_PARENT_ID` | Exact independently approved customer jobcode |
| `QUICKBOOKS_TIME_MODIFIED_FROM` | Approved modification floor as a UTC date |
| `QUICKBOOKS_TIME_SECRET_ID`, `QUICKBOOKS_TIME_SECRET_VERSION`, `QUICKBOOKS_TIME_CREDENTIAL_SHA256` | Reviewed regional secret reference, numeric version and payload digest |
| `QUICKBOOKS_TIME_ON_CLOCK_SNAPSHOT` | Optional. Start with `false`; enable only after entitlement and expected start/end fields are verified |

The former `QUICKBOOKS_TIME_APPROVED_JOBCODES` is replaced by the bound parent. Remove it from the approved connector revision if present. The Cloud Run job has a single task and uses the same named database verification as the app. Confirm the existing runtime IAM policy still denies access to the default database. The separate Scheduler invocation identity needs job-level invocation only. The owner-approved setup operator must separately have permission to execute that job with argument overrides.

```bash
set +x
set -euo pipefail
PROJECT=morris-client-dash-zagime
REGION=northamerica-northeast1
JOB=mi-client-time-sync
SCHEDULE=mi-client-time-daily
RUNTIME_SA=mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com
: "${TIME_TENANT:?Set the approved existing dashboard tenant}"
: "${REVIEWED_IMAGE:?Set the owner-reviewed immutable image digest}"
: "${PRIVATE_JOB_ENV:?Set the private job environment file path}"
[[ "$REVIEWED_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]

# Inventory first. Reuse an existing reviewed job rather than creating a duplicate.
gcloud run jobs list --project="$PROJECT" --region="$REGION"
gcloud scheduler jobs list --project="$PROJECT" --location="$REGION"

# Separately approved candidate job creation. This command does not execute it.
gcloud run jobs create "$JOB" --project="$PROJECT" --region="$REGION" \
  --image="$REVIEWED_IMAGE" --service-account="$RUNTIME_SA" --env-vars-file="$PRIVATE_JOB_ENV" \
  --command=node --args="dist-server/operator.mjs,sync-time-customer,$TIME_TENANT" \
  --tasks=1 --parallelism=1 --max-retries=1 --task-timeout=1800s
```

4. After approval to read the scoped account, dry-run customer verification. Compare the job count with the approved references and cross-check the parent and work-order IDs in the authorized Time account. After separate setup-write approval, enroll the stable scoped ID. The setup command creates only a scoped marker and audit event. Run one controlled sync after first-import approval and verify unpublished projects, unknown approval, integer seconds, fresh checkpoints and denied client access to source data.

```bash
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,verify-time-customer,$TIME_TENANT"
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait \
  --args="dist-server/operator.mjs,verify-time-customer,$TIME_TENANT,--apply"
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait
```

5. When ready to show the integration to staff, stage the approved dashboard image at zero normal traffic with the existing identity, origin, named database and approved frontend settings. The **only** additional runtime changes for this release are the Time settings listed above. Preserve unrelated runtime variables and secrets using `--update-env-vars` for those approved settings. Review candidate configuration before cutover using the existing active rollout. Verify the serving Cloud Run request timeout is at least 210 seconds for the scoped manual sync. If it is shorter, separately approve the timeout change before enabling the operator action. The scheduled job has its own task deadline. Verify authorized staff can see records and retry a scoped job, and verify an approved client sees only published allocated summaries. No production access is needed.
6. After the manual job and dashboard checks pass, separately approve the daily Scheduler job. Use an approved same-project identity with `roles/run.invoker` bound to this job only. Retain Google-managed Scheduler service-agent permissions. Apply the reviewed [schedule definition](../deployment/time-sync-scheduler.example.json) using an owner-approved invoker, or use the equivalent Cloud Shell command below. Scheduler success confirms dispatch, while Cloud Run execution success and persisted daily status confirm synchronization. [Cloud Run scheduled execution](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)

```bash
: "${APPROVED_SCHEDULER_INVOKER:?Set the approved dedicated invocation service account}"
gcloud scheduler jobs create http "$SCHEDULE" --project="$PROJECT" --location="$REGION" \
  --schedule="0 6 * * *" --time-zone="America/Regina" \
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run" \
  --http-method=POST --oauth-service-account-email="$APPROVED_SCHEDULER_INVOKER" \
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" \
  --attempt-deadline=30s --max-retry-attempts=1 --min-backoff=60s --max-backoff=60s
gcloud scheduler jobs describe "$SCHEDULE" --project="$PROJECT" --location="$REGION"
```

## Stop, retry and rollback

Pause the schedule to stop new scheduled dispatches. Check existing job executions before resuming or retrying. In an incident, have the approved operator cancel any running execution, then wait for the bounded lease to expire if cancellation prevents release. Restore the exact previous active dashboard traffic map following the active rollout runbook. Pause manual runs while resolving the incident. Traffic rollback and Scheduler pause preserve projects, mappings, raw versions, allocations and checkpoints.

```bash
gcloud scheduler jobs pause "$SCHEDULE" --project="$PROJECT" --location="$REGION"
gcloud run jobs executions list --job="$JOB" --project="$PROJECT" --region="$REGION"
# After correcting the cause and confirming no execution is active, retry failed work:
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait
```

No live account setup, deployment, schedule creation, IAM update or data import was performed by this implementation.
