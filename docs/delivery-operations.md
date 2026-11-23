# Delivery operations and release handoff

Base commit `869fbb8d6b94fceadb1a795d3f72e437f3f672c0` includes PRs #19, #20 and #21. The candidate reuses the existing production runtime, database, tenant, Microsoft/Firebase sign-in, Time credentials, worker, and Scheduler configuration. Its new fields are additive. Owner-reported November 20 historical checkpoint is **456.75 recorded hours**. Confirm the current value against the existing read-only Time status and account for later scheduled imports and provider corrections.

## Using the workspace

- **Project Management** uses one searchable project picker and stores work completion independently of the milestone checklist. Confirm a completion date when setting work to 100%. Add a project update and manage milestones and blockers from the same workspace. **Save Draft** preserves the approved view, and **Save & Publish** uses the tenant’s publication permission and the same revision check in one transaction. Private staff and blocker notes stay out of client reports. New date and blocker fields are optional for existing records and need no backfill.
- **Projects** creates a private draft at the client root or under an existing project. A work-order number is optional. Expand the hierarchy, department and reporting group, caps and dates, and team sections as needed. An engagement can have child engagements and delivery projects, up to 24 nodes deep. The hierarchy and caps view supports up to 600 projects in a tenant. IDs and links stay stable when a project moves. For a published project, use **Save Draft**, **Preview Changes**, then **Publish Changes** or **Discard Draft**. The last approved version stays visible to clients until publication. Reload after a revision conflict and review the latest draft before publishing.
- **Time Allocation** searches the entire selected month on the server. Use date, work order, consultant, department, project and allocation status filters with **Apply filters**. The count next to the scope shows the number of matches after every applied filter. Status counts reflect the other filters before the selected allocation status, and the queue includes entries with remaining time. **More recorded time** keeps the same scope. Reload if a source correction, allocation or enrichment invalidates a cursor. A month with more than 5,000 stored entries returns an explicit capacity error. A server-side search index would be needed to support larger months.
- **Source details** show the QuickBooks Time timesheet's `user_id` and `notes` when present. The workspace uses `display_name` from the matching supplemental profile, with the provider's first and last names as a fallback. Values the source did not supply show as **Unavailable**. The original duration, date, ID and revision come from the saved source record. Staff reporting text, classifications and private notes are separate fields. [QuickBooks Time timesheets](https://tsheetsteam.github.io/api_docs/#retrieve-timesheets) · [QuickBooks Time users](https://tsheetsteam.github.io/api_docs/#the-user-object)
- **Allocation** supports the full entry or split integer seconds across projects. History offers a draft restore, and the most recent eligible change offers Undo. Bulk operations accept up to 25 eligible unallocated entries. Results show the outcome of each entry and which entries need review. **Retry unsaved entries** uses the original request key for temporary failures. If the response was lost, **Check this bulk request again** recovers the same outcomes. Resolve source or allocation conflicts against refreshed rows before making a new selection. Request replay is available for 24 hours.
- **Work-order linkage** in the project editor selects verified jobcodes already in the customer's registry. It never changes the importer scope anchor or historical allocations. Use the existing Integrations screen to review discoveries. Where one order covers several projects, link the projects as appropriate and allocate each source line explicitly.
- **Budgets & Delivery Health** distinguishes delivery completion, planned hours, elapsed time and cap consumption. Project parent utilization includes its direct effort and descendant allocations. Department and reporting-group caps are configured in Portfolio management. Fixed-fee work uses effort and delivery tracking. A group configured for training can track actual session dates and facilitators.
- **Team Directory** syncs the published Morris profile directory on request. Client visibility and email/phone sharing are separately controlled. Existing manual profiles and assignments are retained. The candidate reads stable post IDs, photos, alt text and modified timestamps from the [public team REST collection](https://morrisinteractive.ca/wp-json/wp/v2/team) and matches professional titles by post ID to the [public team page](https://morrisinteractive.ca/our-team/). Missing media and titles are optional. The existing WordPress launcher stays installed or installable independently.
- **Client Preview** uses the published projection for a selected enabled client access profile. Draft mode is staff-only and marked on screen and in presentations. The client projection excludes unapproved project IDs, raw Time entries, private allocations, staff roles for imported profiles and private contact fields. Only assigned, approved directory profiles appear.

## Compatibility and diagnostics

Existing project records keep their IDs, plans, stored manual progress, historical allocations and legacy placements. Saving a revision to a published project creates a private `projectDrafts` document and a staff audit event. Publication atomically updates the approved projection. Discarding a draft keeps the previously approved content. Existing approved records need no backfill.

Existing Time mappings and source anchors remain in `timeMappings` and `rawTime`. New source metadata is stored at `rawTime/{sourceId}/privateDetails/{sourceRevision}` with the provider, lookup method, observed timestamp and source modification timestamp. The importer can attach details to current verified entries as part of scheduled sync. The owner can enrich previously imported records separately. The enrichment operation matches exact IDs within the approved account, customer and jobcode scope and verifies the stored source revision against the provider. Stale, corrected, deleted and out-of-scope rows are skipped. The operation has no writes to source records, histories, allocations, checkpoints or totals. Staff projections only use metadata matching the current source revision. Client reports exclude these private details. No required production seed or bulk upgrade accompanies the dashboard rollout.

Before approval, create a protected, tenant-scoped inventory under the existing operator access. The offline diagnostic accepts one private JSON object with arrays `projects`, `rawTime`, `timeMappings`, and `allocationHeads`. Export the documents as saved. Include Firestore document IDs as `sourceId` on allocation heads. The diagnostic validates references and amounts, emits counts and an identity/duration digest, and never opens the database. Keep the input snapshot in approved storage off-repository.

```bash
node --import tsx scripts/inspect-delivery-snapshot.ts /approved/private/delivery-before.json
node --import tsx scripts/inspect-delivery-snapshot.ts /approved/private/delivery-after.json
```

Compare recorded seconds and the digest using the same import checkpoint. Expect allocations to change only when staff explicitly save reporting changes. Preserve revisions and audits. Investigate any unexpected change before promoting traffic.

## Owner-controlled release

Run these sections separately in Cloud Shell from the approved checkout. Review CI and browser evidence from the candidate SHA before release. Rehearse draft publication, exact splits, mixed bulk results, historical search and access isolation in an approved staging or emulator tenant. Keep the diagnostic snapshots in their approved private location.

### 1. Inventory and verify the candidate image

```bash
set -euo pipefail
umask 077
PROJECT=morris-client-dash-zagime
REGION=northamerica-northeast1
DATABASE=mi-client-production
TENANT=zagime-production
DASHBOARD=mi-client-prod-dashboard
TIME_JOB=mi-client-prod-time-sync
SCHEDULER=mi-client-prod-time-daily
EVIDENCE="$(mktemp -d)"
test "$(gcloud firestore databases describe --project="$PROJECT" --database="$DATABASE" --format='value(uid)')" = b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd
gcloud run services describe "$DASHBOARD" --project="$PROJECT" --region="$REGION" --format=json >"$EVIDENCE/dashboard-before.json"
PRIOR_TRAFFIC="$(jq -er '[.status.traffic[] | select(.percent > 0) | "\(.revisionName)=\(.percent)"] | join(",") | select(length > 0)' "$EVIDENCE/dashboard-before.json")"
gcloud run jobs describe "$TIME_JOB" --project="$PROJECT" --region="$REGION" --format=json >"$EVIDENCE/worker-before.json"
PRIOR_WORKER_IMAGE="$(jq -er '.spec.template.spec.template.spec.containers[0].image' "$EVIDENCE/worker-before.json")"
gcloud scheduler jobs describe "$SCHEDULER" --project="$PROJECT" --location="$REGION" --format=json >"$EVIDENCE/scheduler-before.json"
jq -e --arg job "$TIME_JOB" '.state == "ENABLED" and .schedule == "0 6 * * *" and .timeZone == "America/Regina" and (.httpTarget.uri | endswith("/jobs/" + $job + ":run"))' "$EVIDENCE/scheduler-before.json" >/dev/null
python3 scripts/production-time.py monitor
```

Reconcile the recorded, allocated and remaining seconds and the four exact work-order IDs, `132160684`, `135372950`, `132160686` and `136571342`. Use the [existing production Time monitor and reconciliation procedure](production-launch-runbook.md#4-production-time-activation). Preserve the previous revision and worker digest for rollback. If the worker configuration uses a tag, resolve the currently approved immutable image digest before updating it.

Set the public build environment values and submit the exact approved commit using the existing build account and bucket. Use section 3 of the [dedicated build account procedure](production-build-iam.md#3-verify-the-equivalent-build-before-removing-editor). After the build completes successfully, verify its digest.

```bash
: "${REVIEWED_SHA:?Set the full owner-reviewed commit SHA}"
: "${SOURCE_BUCKET:?Set the existing approved build-source bucket}"
: "${BUILD_ID:?Set the ID of that successful build}"
IMAGE="$(python3 scripts/production-build.py verify --build-id "$BUILD_ID" --revision "$REVIEWED_SHA" --source-bucket "$SOURCE_BUCKET")"
[[ "$IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]
```

### 2. Verify without traffic, then promote

After owner approval, deploy a revision of the existing service. Preserve its current runtime account, origin policy, database configuration and environment. Use a fresh tag for this release.

```bash
TAG="review-$(cut -c1-10 <<<"$REVIEWED_SHA")"
gcloud run deploy "$DASHBOARD" --project="$PROJECT" --region="$REGION" --image="$IMAGE" --no-traffic --tag="$TAG"
gcloud run services describe "$DASHBOARD" --project="$PROJECT" --region="$REGION" --format=json >"$EVIDENCE/candidate.json"
CANDIDATE_REV="$(jq -er --arg tag "$TAG" '.status.traffic[] | select(.tag == $tag) | .revisionName' "$EVIDENCE/candidate.json")"
CANDIDATE_URL="$(jq -er --arg tag "$TAG" '.status.traffic[] | select(.tag == $tag) | .url' "$EVIDENCE/candidate.json")"
READY_IMAGE="$(gcloud run revisions describe "$CANDIDATE_REV" --project="$PROJECT" --region="$REGION" --format='value(status.imageDigest)')"
test "${READY_IMAGE##*@}" = "${IMAGE##*@}"
curl --fail --silent --show-error "$CANDIDATE_URL/health"
```

Verify the signed-in workflows in staging against the reviewed SHA. Use production tagged authentication only when the tag is already supported by the approved origin and identity policies. Use the normal production origin immediately after promotion for read-only staff and authorized client smoke checks. Hold staff writes until those checks pass. If a check fails, restore the prior routing below.

```bash
gcloud run services update-traffic "$DASHBOARD" --project="$PROJECT" --region="$REGION" --to-revisions="$CANDIDATE_REV=100"
gcloud run services describe "$DASHBOARD" --project="$PROJECT" --region="$REGION" --format='table(status.traffic.revisionName,status.traffic.percent)'
```

### 3. Optional historical details enrichment

The dashboard can ship without a historical enrichment run. For a separately approved worker rollout, wait until there is no active execution or import lease and avoid the 6 AM Regina dispatch window. Confirm that the existing job uses the approved Node command and one task. Update its image only. The schedule still applies the daily arguments from the existing job template.

```bash
gcloud run jobs executions list --job="$TIME_JOB" --project="$PROJECT" --region="$REGION" \
  --format='table(metadata.name,status.completionTime,status.succeededCount,status.failedCount)'
python3 scripts/production-time.py monitor
gcloud run jobs update "$TIME_JOB" --project="$PROJECT" --region="$REGION" --image="$IMAGE"
: "${MONTH:?Set one approved imported reporting month as YYYY-MM}"
[[ "$MONTH" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]
DETAILS_ARGS="dist-server/operator.mjs,enrich-time-details,$TENANT,--month=$MONTH"
gcloud run jobs execute "$TIME_JOB" --project="$PROJECT" --region="$REGION" --args="$DETAILS_ARGS" --wait
```

Inspect counts in the approved Cloud Run execution logs. Each run scans up to 100 stored rows and emits optional `nextCursor`. Compare `wouldWrite`, `unavailable`, `notCurrent` and `conflicts` with the expected inventory before approving a write. For each approved page, rerun the same scope with `--apply`. Repeat the dry run and approval for each next cursor and month. To resume on a page, set `DETAILS_ARGS="dist-server/operator.mjs,enrich-time-details,$TENANT,--month=$MONTH,--after=$CURSOR"` using the cursor from the preceding page. The apply run revalidates each source and can skip rows changed by the normal worker.

```bash
gcloud run jobs execute "$TIME_JOB" --project="$PROJECT" --region="$REGION" --args="$DETAILS_ARGS,--apply" --wait
python3 scripts/production-time.py monitor
gcloud scheduler jobs describe "$SCHEDULER" --project="$PROJECT" --location="$REGION" --format='yaml(state,schedule,timeZone,httpTarget.uri)'
```

Repeat the same-checkpoint diagnostics and compare totals, mappings and allocations. Verify a sample of enriched and unavailable entries in the staff workspace and confirm an authorized client's report omits them. After the next regular dispatch, check the execution result and the Time monitor separately.

### Rollback

Ask staff to pause project edits before routing to the older image. It may write approved content directly or reject newer milestone fields. Use it for read-only emergency service. The accepted published content stays in the database and pending drafts and audit records remain available when the compatible image returns. Restore the worker image separately if needed after confirming no execution or lease is active. Preserve historical Time records, enrichment, job configuration and checkpoints.

```bash
gcloud run services update-traffic "$DASHBOARD" --project="$PROJECT" --region="$REGION" --to-revisions="$PRIOR_TRAFFIC"
gcloud run services update-traffic "$DASHBOARD" --project="$PROJECT" --region="$REGION" --remove-tags="$TAG"
# Run only if the worker also needs rollback. Use the previously verified immutable image.
gcloud run jobs update "$TIME_JOB" --project="$PROJECT" --region="$REGION" --image="$PRIOR_WORKER_IMAGE"
python3 scripts/production-time.py monitor
```

## Visual asset

The staff masthead and sign-in use the user-supplied `Original-16-9-cinematic-background-plate.png`, encoded as a 17 KB WebP for the candidate. Logo assets remain the existing approved Morris and Zagimē marks.

## Recover historical consultant names and original notes

Use the independently approved worker image and inventory procedure above. The dashboard image and its release stay separate. Confirm the expected project, named database UID, four work-order associations, current worker digest, pinned regional secret version, and scheduler configuration before running recovery. Take protected same-checkpoint snapshots of source IDs and revisions, recorded seconds, mappings, allocations, checkpoints and publications. Keep them out of the repository.

The coordinator launches the existing named worker with either `inventory-time-details` or `enrich-time-details`. It uses a Cloud Shell state file as the durable cursor, in addition to the worker's exact revision checks. It writes only the verified private metadata during the explicitly approved apply phase. The recovery does not run the scheduled synchronization command.

```bash
umask 077
mkdir -p "$HOME/mi-private-recovery"
STATE="$HOME/mi-private-recovery/zagime-time-details.json"
node scripts/recover-time-details.mjs review "$STATE" 3
node scripts/recover-time-details.mjs report "$STATE"
```

Repeat review until the state reads `awaiting-approval`. It inventories all imported months and performs one dry run for each page. If it stops early, resume with the same state file. Review the `before` and `dryRun` monthly counts. Source revision changes, out-of-scope rows and provider omissions require reconciliation before acceptance. Use one coordinator at a time and avoid the scheduler window.

After the owner approves the reviewed inventory, repeat the next command until the state reads `done`. The worker rechecks the account, jobcode, entry ID and source revision at each apply. A lost receipt leaves the previous cursor in place. Repeating that bounded operation is safe because metadata writes are idempotent.

```bash
node scripts/recover-time-details.mjs apply "$STATE" 3
node scripts/recover-time-details.mjs report "$STATE"
```

The final state contains `before` and `after` coverage, recorded seconds, verified consultant IDs and names, verified notes, verified empty notes and unavailable notes for each month. It also includes provider omissions and revision conflicts from apply. A completed scan may still contain exceptions. Compare the private source, checkpoint and allocation snapshots separately before accepting the result. Archive the state file with the release evidence and use a new state file for a subsequent recovery pass. The worker rollback above restores the verified prior worker image independently of dashboard traffic.

## Project workflow compatibility and reviewed Time mappings

This candidate reads existing projects, published views and legacy service-area records in place. New project workflow saves use a Parent Project or Delivery Project, with a parent and reusable department for new Delivery Projects. No migration or reclassification runs on startup. Review legacy relationships from the Projects workspace before converting or mapping them.

Before release, have the owner verify the named production database and registered UID, the four approved jobcode identities, one identical-cutoff Time inventory and the daily job state and schedule. Use the existing read-only production Time monitor and catalog diagnostics. Keep the current worker image and its customer verification path. Do not set an example customer ID in configuration. The Mapping workspace shows the current bound customer identity only after setup has been verified.

For a newly discovered work order, open **Time & Reporting → QuickBooks Time Mapping**, review the recorded and allocated totals, and select the exact Parent Project or Delivery Project. A Delivery Project must already have its own verified parent and department relationship. Confirm only after reviewing whether already-published reporting is affected. The server checks the Time operator, customer scope, project classification, current mapping and historical second totals again when saving. Linked legacy orders and inactive orders remain review-only. If the server reports a conflict, refresh and repeat the review.

The mapping moves the reporting destination of remaining source hours. The immutable ledger anchor and active allocations are kept. Reporting reads assign each anchor to one destination, and only that destination's authorized report can include its remaining hours. Named source facts, employee identities, source notes, checkpoints and allocation revisions stay private or unchanged as applicable. Compare before/after tenant-wide recorded seconds and approved project totals with the same cutoff. Recheck the next scheduled execution without changing its 06:00 America/Regina schedule.

For application rollback, pause project edits and mapping confirmations and restore the prior verified serving revision using the owner-controlled rollback above. Prior code can still read the source anchors directly, so the reporting destination of a confirmed new mapping will only be visible when the compatible dashboard is serving. Do not run a Time reimport or reverse a confirmed mapping with ad hoc writes. Record any mapping requiring correction in the owner's reconciliation review.
