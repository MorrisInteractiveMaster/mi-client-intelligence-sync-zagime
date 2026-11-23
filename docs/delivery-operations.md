# Delivery operations and release handoff

This release builds on the reporting work in PR #26. The candidate reuses the existing production runtime, database, tenant, Microsoft/Firebase sign-in, Time credentials, worker, and Scheduler configuration. Its new fields are additive. Owner-reported November 20 historical checkpoint is **456.75 recorded hours**. Confirm the current value against the existing read-only Time status and account for later scheduled imports and provider corrections.

## Using the workspace

- **Project Management** uses one searchable project picker and stores work completion independently of the milestone checklist. Confirm a completion date when setting work to 100%. Add a project update and manage milestones and blockers from the same workspace. **Save Draft** preserves the approved view, and **Save & Publish** uses the tenant’s publication permission and the same revision check in one transaction. Private staff and blocker notes stay out of client reports. New date and blocker fields are optional for existing records and need no backfill.
- **Create Project** supports Parent Projects and Delivery Projects. A new Delivery Project chooses an existing parent and department. Work-order references are optional. The project editor offers **Save Draft** and, for authorized edits, **Save & Publish**. Reload after a revision conflict and review the latest draft before publishing. Review the start-status and exact schedule-sharing choices separately when a project has a start date.
- **Time Allocation** searches the entire selected month on the server. Use date, work order, consultant, department, project and allocation status filters with **Apply filters**. The count next to the scope shows the number of matches after every applied filter. Status counts reflect the other filters before the selected allocation status, and the queue includes entries with remaining time. **More recorded time** keeps the same scope. Reload if a source correction, allocation or enrichment invalidates a cursor. A month with more than 5,000 stored entries returns an explicit capacity error. A server-side search index would be needed to support larger months.
- **Source details** show the QuickBooks Time timesheet's `user_id` and `notes` when present. The workspace uses `display_name` from the matching supplemental profile, with the provider's first and last names as a fallback. Values the source did not supply show as **Unavailable**. The original duration, date, ID and revision come from the saved source record. Staff reporting text, classifications and private notes are separate fields. [QuickBooks Time timesheets](https://tsheetsteam.github.io/api_docs/#retrieve-timesheets) · [QuickBooks Time users](https://tsheetsteam.github.io/api_docs/#the-user-object)
- **Allocation** supports the full entry or split integer seconds across projects. History offers a draft restore, and the most recent eligible change offers Undo. Bulk operations accept up to 25 eligible unallocated entries. Results show the outcome of each entry and which entries need review. **Retry unsaved entries** uses the original request key for temporary failures. If the response was lost, **Check this bulk request again** recovers the same outcomes. Resolve source or allocation conflicts against refreshed rows before making a new selection. Request replay is available for 24 hours.
- **QuickBooks Time Mapping** is the separate owner-reviewed workflow for discovered work orders. An editor reference identifies the project for staff and has no effect on the importer, historical allocations or reviewed mappings.
- **Budgets & Delivery Health** distinguishes delivery completion, planned hours, elapsed time and cap consumption. Project parent utilization includes its direct effort and descendant allocations. Department and reporting-group caps are configured in Portfolio management. Fixed-fee work uses effort and delivery tracking. A group configured for training can track actual session dates and facilitators.
- **Team Directory** syncs the published Morris profile directory on request. Client visibility and email/phone sharing are separately controlled. Existing manual profiles and assignments are retained. The candidate reads stable post IDs, photos, alt text and modified timestamps from the [public team REST collection](https://morrisinteractive.ca/wp-json/wp/v2/team) and matches professional titles by post ID to the [public team page](https://morrisinteractive.ca/our-team/). Missing media and titles are optional. The existing WordPress launcher stays installed or installable independently.
- **Client Preview** uses the published projection for a selected enabled client access profile. Draft mode is staff-only and marked on screen and in presentations. The client projection excludes unapproved project IDs, raw Time entries, private allocations, staff roles for imported profiles and private contact fields. Only assigned, approved directory profiles appear.

## Compatibility and diagnostics

Existing project records keep their IDs, plans, stored manual progress, historical allocations and legacy placements. Saving a revision to a published project creates a private `projectDrafts` document and a staff audit event. Publication atomically updates the approved projection. Discarding a draft keeps the previously approved content. Existing approved records need no backfill.

Existing Time mappings and source anchors remain in `timeMappings` and `rawTime`. New source metadata is stored at `rawTime/{sourceId}/privateDetails/{sourceRevision}` with the provider, lookup method, observed timestamp and source modification timestamp. The importer can attach details to current verified entries as part of scheduled sync. The owner can enrich previously imported records separately. The enrichment operation matches exact IDs within the approved account, customer and jobcode scope and verifies the stored source revision against the provider. Stale, corrected, deleted and out-of-scope rows are skipped. The operation has no writes to source records, histories, allocations, checkpoints or totals. Staff projections only use metadata matching the current source revision. Client reports exclude these private details. No required production seed or bulk upgrade accompanies the dashboard rollout.

Before approval, create a protected, tenant-scoped inventory under the existing operator access. The offline diagnostic accepts one private JSON object with arrays `projects`, `rawTime`, `timeMappings`, and `allocationHeads`. Export the documents as saved. Include Firestore document IDs as `sourceId` on allocation heads. The diagnostic validates references and amounts, emits counts and an identity/duration digest, and never opens the database. Keep the input snapshot in approved storage off-repository.

```bash
if node --import tsx scripts/inspect-delivery-snapshot.ts /approved/private/delivery-before.json &&
  node --import tsx scripts/inspect-delivery-snapshot.ts /approved/private/delivery-after.json; then
  printf 'Review the two snapshot summaries.\n'
else
  printf 'Snapshot check stopped. Review the reported error.\n' >&2
fi
```

Compare recorded seconds and the digest using the same import checkpoint. Expect allocations to change only when staff explicitly save reporting changes. Preserve revisions and audits. Investigate any unexpected change before promoting traffic.

## Owner-controlled release

Run the four phases separately from the approved checkout in the same interactive Cloud Shell. The functions stop their own phase on a failed check and leave the terminal available. Each invocation is guarded so this works even with `errexit` already enabled in the shell. Keep the private evidence directory and leave the existing Time worker and Scheduler outside this dashboard rollout.

### 1. Read-only preflight

```bash
DELIVERY_PROJECT=morris-client-dash-zagime
DELIVERY_REGION=northamerica-northeast1
DELIVERY_DATABASE=mi-client-production
DELIVERY_DASHBOARD=mi-client-prod-dashboard
DELIVERY_TIME_JOB=mi-client-prod-time-sync
DELIVERY_SCHEDULER=mi-client-prod-time-daily

delivery_stop() {
  printf 'STOP: %s\n' "$1" >&2
  return 1
}

delivery_traffic() {
  jq -er '[.status.traffic[] | select((.percent // 0) > 0)]
    | select(length > 0 and (map(.percent) | add) == 100 and all(.[]; .revisionName | type == "string" and length > 0))
    | group_by(.revisionName) | map({revision: .[0].revisionName, percent: (map(.percent) | add)})
    | map("\(.revision)=\(.percent)") | join(",")' "$1"
}

delivery_preflight() {
  DELIVERY_PREFLIGHT_READY=0
  DELIVERY_CANDIDATE_READY=0
  local database_uid
  DELIVERY_EVIDENCE=$(umask 077; mktemp -d) || { delivery_stop 'Could not create a private evidence folder.'; return 1; }
  database_uid=$(gcloud firestore databases describe --project="$DELIVERY_PROJECT" --database="$DELIVERY_DATABASE" --format='value(uid)') &&
    [[ "$database_uid" == b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd ]] || { delivery_stop 'The named Firestore database UID could not be verified.'; return 1; }
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/dashboard-before.json" &&
    DELIVERY_PRIOR_TRAFFIC=$(delivery_traffic "$DELIVERY_EVIDENCE/dashboard-before.json") || { delivery_stop 'Could not record the serving revisions and traffic percentages.'; return 1; }
  gcloud run jobs describe "$DELIVERY_TIME_JOB" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/worker-before.json" &&
    jq -e '.spec.template.spec.template.spec.containers[0].image | strings | length > 0' "$DELIVERY_EVIDENCE/worker-before.json" >/dev/null ||
    { delivery_stop 'Could not verify the existing Time job.'; return 1; }
  gcloud scheduler jobs describe "$DELIVERY_SCHEDULER" --project="$DELIVERY_PROJECT" --location="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/scheduler-before.json" &&
    jq -e --arg target "https://run.googleapis.com/v2/projects/$DELIVERY_PROJECT/locations/$DELIVERY_REGION/jobs/$DELIVERY_TIME_JOB:run" \
      '.state == "ENABLED" and .schedule == "0 6 * * *" and .timeZone == "America/Regina" and .httpTarget.uri == $target' \
      "$DELIVERY_EVIDENCE/scheduler-before.json" >/dev/null || { delivery_stop 'The 06:00 Regina Time schedule or worker target could not be verified.'; return 1; }
  python3 scripts/production-time.py monitor >"$DELIVERY_EVIDENCE/time-before.json" || { delivery_stop 'The read-only Time monitor failed.'; return 1; }
  DELIVERY_PREFLIGHT_READY=1
  printf 'Preflight evidence: %s\nPrior traffic: %s\n' "$DELIVERY_EVIDENCE" "$DELIVERY_PRIOR_TRAFFIC"
}

if delivery_preflight; then printf 'Review the inventory before candidate verification.\n'; fi
```

Review the Time status and reconcile recorded, allocated and remaining seconds at the same cutoff. Verify jobcode IDs `132160684`, `135372950`, `132160686` and `136571342` against the existing approved inventory. Review CI and browser evidence for the exact candidate SHA before proceeding. [Existing Time inventory procedure](production-launch-runbook.md#4-production-time-activation)

### 2. Owner-approved candidate verification without traffic

Build the reviewed commit through the existing build account and source bucket under the separate build approval. Supply that reviewed SHA, bucket and successful build ID as `REVIEWED_SHA`, `SOURCE_BUCKET` and `BUILD_ID`. This phase creates a tagged candidate revision with zero traffic. The checks compare its image, service account and environment with the approved digest and captured service configuration. [Dedicated build account procedure](production-build-iam.md#3-verify-the-equivalent-build-before-removing-editor)

```bash
delivery_check_candidate() {
  local traffic ready_image
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/candidate-service.json" &&
    traffic=$(delivery_traffic "$DELIVERY_EVIDENCE/candidate-service.json") && [[ "$traffic" == "$DELIVERY_PRIOR_TRAFFIC" ]] ||
    { delivery_stop 'Serving traffic differs from the captured baseline.'; return 1; }
  jq -e --arg tag "$DELIVERY_TAG" --arg revision "$DELIVERY_REVISION" \
    'any(.status.traffic[]; .tag == $tag and .revisionName == $revision and (.percent // 0) == 0) and all(.status.traffic[]; .revisionName != $revision or (.percent // 0) == 0)' \
    "$DELIVERY_EVIDENCE/candidate-service.json" >/dev/null || { delivery_stop 'The candidate tag or its zero-traffic setting changed.'; return 1; }
  gcloud run revisions describe "$DELIVERY_REVISION" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/candidate-revision.json" &&
    ready_image=$(jq -er '.status.imageDigest | strings | select(length > 0)' "$DELIVERY_EVIDENCE/candidate-revision.json") &&
    [[ "${ready_image##*@}" == "${DELIVERY_IMAGE##*@}" ]] || { delivery_stop 'The candidate revision digest did not match the reviewed build.'; return 1; }
  jq -e --slurpfile before "$DELIVERY_EVIDENCE/dashboard-before.json" '
    def runtime: {account: .serviceAccountName, env: ((.containers[0].env // []) | sort_by(.name))};
    (.spec | runtime) as $candidate | ($before[0].spec.template.spec | runtime) == $candidate and ($candidate.account | type == "string" and length > 0)
  ' "$DELIVERY_EVIDENCE/candidate-revision.json" >/dev/null || { delivery_stop 'The candidate runtime account or environment differs from preflight.'; return 1; }
  curl --fail --silent --show-error --max-time 30 "$DELIVERY_URL/health" >"$DELIVERY_EVIDENCE/candidate-health.json" ||
    { delivery_stop 'The tagged candidate health check failed.'; return 1; }
}

delivery_stage_candidate() {
  DELIVERY_CANDIDATE_READY=0
  [[ "${DELIVERY_PREFLIGHT_READY:-0}" == 1 ]] || { delivery_stop 'Complete read-only preflight first.'; return 1; }
  local sha=${1:-} bucket=${2:-} build=${3:-} timestamp traffic
  [[ "$sha" =~ ^[a-f0-9]{40}$ && -n "$bucket" && -n "$build" ]] || { delivery_stop 'Supply the reviewed SHA, approved source bucket and successful build ID.'; return 1; }
  DELIVERY_IMAGE=$(python3 scripts/production-build.py verify --build-id "$build" --revision "$sha" --source-bucket "$bucket") &&
    [[ "$DELIVERY_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { delivery_stop 'The build or immutable image digest could not be verified.'; return 1; }
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/before-candidate.json" &&
    traffic=$(delivery_traffic "$DELIVERY_EVIDENCE/before-candidate.json") && [[ "$traffic" == "$DELIVERY_PRIOR_TRAFFIC" ]] ||
    { delivery_stop 'Serving traffic changed after preflight.'; return 1; }
  timestamp=$(date -u +%Y%m%d%H%M%S) || { delivery_stop 'Could not name the review tag.'; return 1; }
  DELIVERY_TAG="review-${sha:0:10}-$timestamp"
  gcloud run deploy "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --image="$DELIVERY_IMAGE" --no-traffic --tag="$DELIVERY_TAG" ||
    { delivery_stop 'Cloud Run did not confirm the no-traffic deploy. Inspect the service before retrying.'; return 1; }
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/candidate-service.json" &&
    DELIVERY_REVISION=$(jq -er --arg tag "$DELIVERY_TAG" '.status.traffic[] | select(.tag == $tag) | .revisionName | strings | select(length > 0)' "$DELIVERY_EVIDENCE/candidate-service.json") &&
    DELIVERY_URL=$(jq -er --arg tag "$DELIVERY_TAG" '.status.traffic[] | select(.tag == $tag) | .url | strings | select(startswith("https://"))' "$DELIVERY_EVIDENCE/candidate-service.json") ||
    { delivery_stop 'Could not locate the tagged candidate. Review the service before promoting.'; return 1; }
  delivery_check_candidate || return 1
  DELIVERY_CANDIDATE_READY=1
  printf 'Zero-traffic candidate: %s\nReview URL: %s\n' "$DELIVERY_REVISION" "$DELIVERY_URL"
}

if delivery_stage_candidate "${REVIEWED_SHA:-}" "${SOURCE_BUCKET:-}" "${BUILD_ID:-}"; then
  printf 'Complete the signed-in acceptance checks before approving promotion.\n'
fi
```

Exercise project schedule visibility and transition, draft and one-step publication, department placement, parent caps, and Time reconciliation in staging against the verified SHA. Use production tagged sign-in only when the tag is already supported by the approved origin and identity policies.

### 3. Owner-approved promotion

Once the owner has approved the candidate and signed-in checks, invoke the function with the exact revision from phase 2. Keep staff writes paused until read-only staff and authorized client checks pass on the normal production origin. A failed check after a traffic update calls for phase 4.

```bash
delivery_promote() {
  [[ "${DELIVERY_CANDIDATE_READY:-0}" == 1 && "${1:-}" == "$DELIVERY_REVISION" ]] ||
    { delivery_stop 'Confirm the exact approved candidate from phase 2.'; return 1; }
  delivery_check_candidate || return 1
  gcloud run services update-traffic "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --to-revisions="$DELIVERY_REVISION=100" ||
    { delivery_stop 'The promotion command failed. Inspect current traffic before retrying.'; return 1; }
  local traffic
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/after-promotion.json" &&
    traffic=$(delivery_traffic "$DELIVERY_EVIDENCE/after-promotion.json") && [[ "$traffic" == "$DELIVERY_REVISION=100" ]] ||
    { delivery_stop 'Promotion could not be verified. Inspect current traffic and use rollback if needed.'; return 1; }
}

if read -r -p 'Type the approved candidate revision to promote: ' delivery_confirm_revision &&
  delivery_promote "$delivery_confirm_revision"; then
  printf 'Run the signed-in read-only production checks before resuming edits.\n'
fi
```

### 4. Owner-controlled rollback

Pause project edits and mapping confirmations. Restore the exact prior routing saved at preflight. Older application code may read source anchors directly or handle approved project edits differently. Use the prior service revision for read-only emergency access until a compatible revision returns.

```bash
delivery_rollback() {
  [[ "${DELIVERY_PREFLIGHT_READY:-0}" == 1 && -n "${DELIVERY_PRIOR_TRAFFIC:-}" && "${1:-}" == "$DELIVERY_PRIOR_TRAFFIC" ]] ||
    { delivery_stop 'Use the prior revision and traffic split recorded at preflight.'; return 1; }
  local traffic
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/before-rollback.json" &&
    traffic=$(delivery_traffic "$DELIVERY_EVIDENCE/before-rollback.json") ||
    { delivery_stop 'Current traffic could not be verified before rollback.'; return 1; }
  [[ "$traffic" == "$DELIVERY_PRIOR_TRAFFIC" ]] && return 0
  [[ -n "${DELIVERY_REVISION:-}" && "$traffic" == "$DELIVERY_REVISION=100" ]] ||
    { delivery_stop 'Current traffic differs from this release. Review the service before restoring traffic.'; return 1; }
  gcloud run services update-traffic "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --to-revisions="$DELIVERY_PRIOR_TRAFFIC" ||
    { delivery_stop 'Rollback command failed. Inspect Cloud Run traffic.'; return 1; }
  gcloud run services describe "$DELIVERY_DASHBOARD" --project="$DELIVERY_PROJECT" --region="$DELIVERY_REGION" --format=json >"$DELIVERY_EVIDENCE/after-rollback.json" &&
    traffic=$(delivery_traffic "$DELIVERY_EVIDENCE/after-rollback.json") && [[ "$traffic" == "$DELIVERY_PRIOR_TRAFFIC" ]] ||
    { delivery_stop 'Restored traffic could not be verified. Inspect Cloud Run traffic.'; return 1; }
}

if read -r -p 'Type the prior traffic split captured at preflight: ' delivery_confirm_traffic &&
  delivery_rollback "$delivery_confirm_traffic"; then
  printf 'Prior routing confirmed. Verify read-only service on the normal origin.\n'
fi
```

The rollback covers dashboard traffic. Keep the worker image, scheduler, Firestore records and Time state in place. If the Cloud Shell session was lost, recover the exact previous split from the saved `dashboard-before.json` in the private evidence folder and verify the named service before an owner-approved traffic restore.

## Visual asset

The staff masthead and sign-in use the user-supplied `Original-16-9-cinematic-background-plate.png`, encoded as a 17 KB WebP for the candidate. Logo assets remain the existing approved Morris and Zagimē marks.

## Recover historical consultant names and original notes

Use the existing approved worker and the read-only inventory procedure above. The dashboard image and its release stay separate. Confirm the expected project, named database UID, four work-order associations, current worker digest, pinned regional secret version, and scheduler configuration before running recovery. Take protected same-checkpoint snapshots of source IDs and revisions, recorded seconds, mappings, allocations, checkpoints and publications. Keep them out of the repository.

The coordinator launches the existing named worker with either `inventory-time-details` or `enrich-time-details`. It uses a Cloud Shell state file as the durable cursor, in addition to the worker's exact revision checks. It writes only the verified private metadata during the explicitly approved apply phase. The recovery does not run the scheduled synchronization command.

```bash
DELIVERY_RECOVERY_STATE="$HOME/mi-private-recovery/zagime-time-details.json"
if (umask 077; mkdir -p "$HOME/mi-private-recovery") &&
  (umask 077; node scripts/recover-time-details.mjs review "$DELIVERY_RECOVERY_STATE" 3); then
  node scripts/recover-time-details.mjs report "$DELIVERY_RECOVERY_STATE" || printf 'Could not read the recovery report.\n' >&2
else
  printf 'Recovery review stopped. Inspect the error and resume with the same state file.\n' >&2
fi
```

Repeat review until the state reads `awaiting-approval`. It inventories all imported months and performs one dry run for each page. If it stops early, resume with the same state file. Review the `before` and `dryRun` monthly counts. Source revision changes, out-of-scope rows and provider omissions require reconciliation before acceptance. Use one coordinator at a time and avoid the scheduler window.

After the owner approves the reviewed inventory, repeat the next command until the state reads `done`. The worker rechecks the account, jobcode, entry ID and source revision at each apply. A lost receipt leaves the previous cursor in place. Repeating that bounded operation is safe because metadata writes are idempotent.

```bash
if [[ -n "${DELIVERY_RECOVERY_STATE:-}" ]] &&
  (umask 077; node scripts/recover-time-details.mjs apply "$DELIVERY_RECOVERY_STATE" 3); then
  node scripts/recover-time-details.mjs report "$DELIVERY_RECOVERY_STATE" || printf 'Could not read the recovery report.\n' >&2
else
  printf 'Recovery apply stopped. Inspect the error and resume with the reviewed state file.\n' >&2
fi
```

The final state contains `before` and `after` coverage, recorded seconds, verified consultant IDs and names, verified notes, verified empty notes and unavailable notes for each month. It also includes provider omissions and revision conflicts from apply. A completed scan may still contain exceptions. Compare the private source, checkpoint and allocation snapshots separately before accepting the result. Archive the state file with the release evidence and use a new state file for a subsequent recovery pass. A separately approved worker release or rollback uses the existing Time operator procedure.

## Project workflow compatibility and reviewed Time mappings

This candidate reads existing projects, published views and legacy service-area records in place. New project workflow saves use a Parent Project or Delivery Project, with a parent and reusable department for new Delivery Projects. No migration or reclassification runs on startup. Review legacy relationships from the Projects workspace before converting or mapping them.

Before release, have the owner verify the named production database and registered UID, the four approved jobcode identities, one identical-cutoff Time inventory and the daily job state and schedule. Use the existing read-only production Time monitor and catalog diagnostics. Keep the current worker image and its customer verification path. Do not set an example customer ID in configuration. The Mapping workspace shows the current bound customer identity only after setup has been verified.

For a newly discovered work order, open **Time & Reporting → QuickBooks Time Mapping**, review the recorded and allocated totals, and select the exact Parent Project or Delivery Project. A Delivery Project must already have its own verified parent and department relationship. Confirm only after reviewing whether already-published reporting is affected. The server checks the Time operator, customer scope, project classification, current mapping and historical second totals again when saving. Linked legacy orders and inactive orders remain review-only. If the server reports a conflict, refresh and repeat the review.

The mapping moves the reporting destination of remaining source hours. The immutable ledger anchor and active allocations are kept. Reporting reads assign each anchor to one destination, and only that destination's authorized report can include its remaining hours. Named source facts, employee identities, source notes, checkpoints and allocation revisions stay private or unchanged as applicable. Compare before/after tenant-wide recorded seconds and approved project totals with the same cutoff. Recheck the next scheduled execution without changing its 06:00 America/Regina schedule.

For application rollback, pause project edits and mapping confirmations and restore the prior verified serving revision using the owner-controlled rollback above. Prior code can still read the source anchors directly, so the reporting destination of a confirmed new mapping will only be visible when the compatible dashboard is serving. Do not run a Time reimport or reverse a confirmed mapping with ad hoc writes. Record any mapping requiring correction in the owner's reconciliation review.
