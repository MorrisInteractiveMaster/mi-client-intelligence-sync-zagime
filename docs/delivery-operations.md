# Delivery operations and release handoff

Base commit `869fbb8d6b94fceadb1a795d3f72e437f3f672c0` includes PRs #19, #20 and #21. The candidate reuses the existing production runtime, database, tenant, Microsoft/Firebase sign-in, Time credentials, worker, and Scheduler configuration. Its new fields are additive. Owner-reported November 20 historical checkpoint is **456.75 recorded hours**. Confirm the current value against the existing read-only Time status and account for later scheduled imports and provider corrections.

## Using the workspace

- **Projects** creates a private draft at the client root or under an existing project. A work-order number is optional. Expand the hierarchy, department and reporting group, caps and dates, and team sections as needed. An engagement can have child engagements and delivery projects, up to 24 nodes deep. The hierarchy and caps view supports up to 600 projects in a tenant. IDs and links stay stable when a project moves. Publish from the project list after checking the client preview.
- **Time Allocation** loads the selected reporting month in pages. Use the queue, filters and batch pagination to find entries. Source duration, description, identifier and revision come from the existing stored record. Consultant and description detail depend on what the existing scoped import actually retained. Staff reporting text, private notes and classifications are separate fields. Select a project and assign the full entry or split exact seconds across projects. History offers a draft restore, and the most recent eligible change offers Undo. A bulk save writes only selected unallocated rows, in order. It stops on the first conflict and reports the number saved.
- **Work-order linkage** in the project editor selects verified jobcodes already in the customer's registry. It never changes the importer scope anchor or historical allocations. Use the existing Integrations screen to review discoveries. Where one order covers several projects, link the projects as appropriate and allocate each source line explicitly.
- **Budgets & Delivery Health** distinguishes delivery completion, planned hours, elapsed time and cap consumption. Project parent utilization includes its direct effort and descendant allocations. Department and reporting-group caps are configured in Portfolio management. Fixed-fee work uses effort and delivery tracking. A group configured for training can track actual session dates and facilitators.
- **Team Directory** syncs the published Morris profile directory on request. Client visibility and email/phone sharing are separately controlled. Existing manual profiles and assignments are retained. The candidate reads stable post IDs, photos, alt text and modified timestamps from the [public team REST collection](https://morrisinteractive.ca/wp-json/wp/v2/team) and matches professional titles by post ID to the [public team page](https://morrisinteractive.ca/our-team/). Missing media and titles are optional. The existing WordPress launcher stays installed or installable independently.
- **Client Preview** uses the published projection for a selected enabled client access profile. Draft mode is staff-only and marked on screen and in presentations. The client projection excludes unapproved project IDs, raw Time entries, private allocations, staff roles for imported profiles and private contact fields. Only assigned, approved directory profiles appear.

## Compatibility and diagnostics

Existing project records keep their IDs, plans, stored manual progress, historical allocations and legacy placements. Existing Time mappings and source anchors remain in `timeMappings` and `rawTime`. The importer, date checkpoints, correction worker, scheduler and writeback behavior do not change. Staff edits add optional `delivery` fields to existing projects, enrich configured milestones, and write reporting annotations as part of the existing allocation head and immutable revision. No bulk migration or production seed is required. Existing display plans stay separate from newly configured operational caps.

Before approval, create a protected, tenant-scoped inventory under the existing operator access. The offline diagnostic accepts one private JSON object with arrays `projects`, `rawTime`, `timeMappings`, and `allocationHeads`. Export the documents as saved. Include Firestore document IDs as `sourceId` on allocation heads. The diagnostic validates references and amounts, emits counts and an identity/duration digest, and never opens the database. Keep the input snapshot in approved storage off-repository.

```bash
node --import tsx scripts/inspect-delivery-snapshot.ts /approved/private/delivery-before.json
node --import tsx scripts/inspect-delivery-snapshot.ts /approved/private/delivery-after.json
```

Compare recorded seconds and the digest using the same import checkpoint. Expect allocations to change only when staff explicitly save reporting changes. Preserve revisions and audits. Investigate any unexpected change before promoting traffic.

## Owner-controlled candidate and rollback

1. Review CI and the browser evidence. Run the same flows against an approved staging or local emulator tenant. Verify scoped published/draft previews, splits, corrections, parent aggregates and an outage-safe directory refresh.
2. Use the reviewed [production runbook](production-launch-runbook.md) and [dedicated build account procedure](production-build-iam.md) if available on the release branch to build the exact reviewed commit. Reconfirm `morris-client-dash-zagime`, `northamerica-northeast1`, `mi-client-production`, UID `b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd`, tenant `zagime-production` and the existing service. Record the current serving revision, image digest, routed traffic and verified baseline hours.
3. With separate owner approval, deploy the candidate as an immutable Cloud Run revision with no traffic. Validate its authenticated smoke checks with the existing runtime identity, configuration and approved testers. Verify that scheduler `mi-client-prod-time-daily` still targets the existing worker at 06:00 America/Regina and that neither credentials nor checkpoints changed. Avoid writes during the overlapping-revision smoke period.
4. Promote the candidate only after the owner reviews the results. If a regression occurs, restore the recorded previous dashboard revision's traffic. Leave Time worker execution, job configuration and data in place.
5. After staff writes new milestone statuses and undated milestones, an older dashboard editor may reject edits to those projects. The compatible reporting projection keeps undated milestones out of the older reader and retains them in the project's complete record. Use the previous dashboard for read-only emergency service. Resume edits on a compatible build after review. Preserve annotations and immutable allocation history. Never drop newer fields or replay historical imports to make the old editor accept the records.

## Visual asset

The staff masthead and sign-in use the user-supplied `Original-16-9-cinematic-background-plate.png`, encoded as a 17 KB WebP for the candidate. Logo assets remain the existing approved Morris and Zagimē marks.
