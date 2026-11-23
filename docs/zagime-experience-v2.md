# Zagime Experience Redesign V2

## What the numbers mean

| Metric | Calculation | Scope |
| --- | --- | --- |
| Work completion | Approved manual assessment, or the weighted share of completed applicable milestones under the existing delivery rules. Waived milestones are excluded. | Staff working version or authorized approved client version. |
| Portfolio status | Mutually exclusive counts of active, upcoming, completed and other delivery projects in the visible portfolio. Blockers can overlap these statuses and appear separately. | Uses the current scope and America/Regina calendar. |
| Allocation coverage | Allocated seconds divided by recorded seconds in the same period and filter scope. | Staff only. |
| Source mix | Recorded seconds for the selected work order or consultant divided by all recorded seconds in that same scope. | Staff only. |
| Client effort and mix | Seconds already allocated to authorized projects. Distribution divides a department or project’s approved allocated seconds by the same visible portfolio’s approved allocated total. | Client and staff client preview. Includes an ungrouped segment where appropriate. |
| Cap utilization | Cap-consumed effort divided by the corresponding monthly or lifetime cap. Staff and client views use their respective approved hour scopes and the existing parent participation rules. | Staff working cap or separately published client cap. |

Percentages use integer seconds before rounding. A recorded ledger with 138 hours and no allocations has measurable 0% allocation coverage. A report with no approved allocations has no effort distribution to measure. Cap use can exceed 100%. A zero or absent cap has no percentage denominator. Historical completion plots use explicit completion dates. Active-project trends show the current portfolio and state that a historical series requires verified snapshots.

Published reports, exports, presentations and historical charts now read project allocation totals. Staff still have separate access to recorded, attributed, classified and remaining hours. Publishing a project, including a parent engagement, does not release the work-order ledger or any remaining source time. Cap edits against an already published project save to its existing draft, guarded by the tenant revision. A publisher applies the draft through the normal project publication action.

## Review and release

Use the authenticated emulator evidence in `test-results/platform-routes-browser` and `test-results/project-only-browser`. The browser fixtures use controlled records and synthetic identities. The CI artifact also contains the independent production-container preview smoke checks. The pinned profiles use the public Morris directory. [Chris Cey](https://morrisinteractive.ca/team/chris-cey/) · [Steve Atkinson](https://morrisinteractive.ca/team/steve-atkinson/) · [Monica Pollard](https://morrisinteractive.ca/team/monica-pollard/)

The candidate needs no data backfill, new index or scheduled process. Use the existing owner-approved [delivery runbook](delivery-operations.md) for read-only preflight, a tagged zero-traffic dashboard candidate, signed-in verification, promotion and rollback. At identical reporting cutoffs confirm the four approved work orders, staff ledger totals, allocation revisions, and one approved and one restricted client scope. Verify the production Firestore database name and UID, the existing verified rollback revision, and the 06:00 America/Regina Time schedule before the owner approves any dashboard release.
