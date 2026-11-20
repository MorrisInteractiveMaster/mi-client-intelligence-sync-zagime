# Historical Time and source detail enrichment

## Staff reporting

Time Allocation supports all history, this month, previous month, this year, last year, a selected month or quarter, and an inclusive custom date range. The relative presets use America/Regina. Select **Apply period** for time windows, sort direction and month, quarter or year summaries. **Apply filters** combines date, consultant, source work order, department, project, allocation status and text filters within that period. **Save reporting scope** stores the selected period, sort direction and grouping on this browser. The saved preference contains no source notes or employee identity.

Recorded, allocated and unallocated totals include matching current records across the entire reporting scope. Deleted records can appear in the review table and count but contribute no recorded hours. A corrected entry can be awaiting review while its current seconds remain recorded. Employee and work-order summaries lead to matching source rows. An explicitly linked WordPress profile contributes an approved photograph and professional title. The consultant name and original notes still come from the source Time record. **Approval not verified** applies to QuickBooks Online accounting approval, which is separate from Time recording and synchronization.

The server reads the existing `rawTime` time index for the authorized tenant and joins current allocation heads and revision-matched details. It serves at most 25 rows per HTTP response. Search includes current and previously imported Time facts and permitted staff reporting text. To return accurate results within a bounded read, the month view accepts at most 5,000 stored rows and longer views at most 12,000. Larger reporting periods require a smaller range. There is no new database, Firestore index or historical reimport to enable this workflow.

## Owner-controlled inventory and enrichment

Use [the delivery release runbook](delivery-operations.md#owner-controlled-release) to verify the named production database UID, approved worker image and the 06:00 America/Regina schedule. Update the worker image in its own approved release step. This is separate from dashboard traffic and uses the existing job's identity, command, regional credential, pinned customer scope and configuration. The normal scheduled invocation keeps its existing arguments.

Run the read-only inventory for imported records within the existing approved account. This emits counts by reporting month for each page of up to 100 stored rows. It also identifies missing current consultant names, IDs or notes and rows outside the current mapping. It queries the named database and never requests data from the upstream provider. Save each output and the resume cursor in approved private storage. A month can appear in multiple pages. Sum its counts and seconds across those pages. The cursor is tied to the named tenant, account and catalog.

```bash
PROJECT=morris-client-dash-zagime
REGION=northamerica-northeast1
TENANT=zagime-production
TIME_JOB=mi-client-prod-time-sync
gcloud run jobs execute "$TIME_JOB" --project="$PROJECT" --region="$REGION" \
  --args="dist-server/operator.mjs,inventory-time-details,$TENANT" --wait
# If the approved execution log contains nextCursor, set INVENTORY_CURSOR to that value.
gcloud run jobs execute "$TIME_JOB" --project="$PROJECT" --region="$REGION" \
  --args="dist-server/operator.mjs,inventory-time-details,$TENANT,--after=$INVENTORY_CURSOR" --wait
```

Choose a month from the inventory. Confirm the Time job and lease are idle before reviewing enrichment batches. Obtain separate approval to apply the page after reviewing its dry-run output. Use the same original inputs for dry-run and apply. Preserve the apply result and its `nextCursor` before advancing. The page can be safely reapplied if a result is lost. The sidecar stays attached to the imported source revision. A later source correction or deletion makes superseded details unavailable.

```bash
: "${MONTH:?Set the owner-approved month as YYYY-MM}"
PAGE="dist-server/operator.mjs,enrich-time-details,$TENANT,--month=$MONTH"
# For a later page, append ,--after=CURSOR using this month's preceding apply result.
gcloud run jobs execute "$TIME_JOB" --project="$PROJECT" --region="$REGION" --args="$PAGE" --wait
# Run the next command only after dry-run and owner approval for this page.
gcloud run jobs execute "$TIME_JOB" --project="$PROJECT" --region="$REGION" --args="$PAGE,--apply" --wait
```

Check recorded and allocated seconds and sync checkpoints at the same import checkpoint before and after applying. Corrected, deleted, missing and inaccessible provider records require no fabricated metadata. The original source duration, revision and import identity stay intact. An old revision's metadata and the allocation and correction ledger remain available to the approved runtime. The dashboard and worker rollback steps are separate in the delivery runbook.
