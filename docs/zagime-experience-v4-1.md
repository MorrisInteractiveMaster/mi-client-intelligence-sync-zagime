# Zagimē Experience V4.1

The client distribution uses the same authorized report as Leadership and Project Explorer. Each visible delivery project contributes once to its department, nearest approved parent engagement and delivery status. Unclassified and independent projects remain in the denominator. A zero count is shown as zero when the denominator is known and as an undefined share when the portfolio is empty. Source-recorded Morris time plays no part in the client chart.

## Sorting coverage

| Surface | Sortable values and scope | Verification |
| --- | --- | --- |
| Morris Time Allocation entries | Date, consultant, provider notes, work order, recorded seconds, reporting description, assignment label, allocation status. The server orders the bounded authorized result set before cursor pagination. Column selection is persisted in the route and uses source IDs for selected entries. | 52-entry emulator case for every field, exact numeric order, three pages, cursor mismatch and authorization. Browser checks header direction, persistence and selection. |
| Recorded Time Distribution | Name, recorded, share, allocated and unallocated, in either direction. Applies to work orders, consultant groups and available Morris profiles. Shares use a shared denominator, so sort order is identical to recorded seconds for shares. | Browser active selector plus the grouped-source emulator fixtures. |
| Exact source breakdowns | Work order, consultant, Morris profile or period, then recorded, allocated and unallocated seconds. Period identifiers sort chronologically. | Shared headers and the Time Allocation and overview browser routes. |
| Morris overview | Exact chart table sorts by month, recorded and allocated; chart timeline remains chronological. | Existing overview route and chart regressions. |
| Morris Clients | A single authorized tenant card. No list order applies. | Existing tenant access checks. |
| Morris Projects | Name, displayed status, visibility, reported seconds and work order. An explicit sort uses the bounded authorized catalog, with 25 visible rows at a time. The Publication column contains actions. | Project workspace and authorized catalog regression. |
| Project hierarchy and budget/health | Project or parent path, department, managers, monthly effort, remaining monthly cap with lifetime fallback, completion and publication. Combined columns sort on their named primary metric. | Existing hierarchy and inline-cap browser regression. |
| Project Management | Project chooser sorts by name, location, work order and status. Editing fields and checklist inputs retain their form order. | Existing project management browser flow. |
| Morris Departments | Configured order, name, project count and visibility. Department project cards sort by name, status, allocated seconds and completion. | Staff department routes in the responsive browser audit. |
| QuickBooks Time Mapping | Work order name, jobcode, queue status, recorded current and historical seconds, allocated seconds, last successful sync. | Existing mapping and review browser routes. |
| Morris and client directories | Name and published role; Morris staff can also use visibility. Board and Team retain their grouping. Fixed Other Contacts remain a curated list. | Directory authorization and portrait regressions. |
| Client portfolio and department projects | Distribution by department, parent or delivery status, ordered by project count or name, with configured department order. Explorer sort fields work in either direction before pagination. | Six-project zero-effort browser fixture, 100-project client scope and 300-project staff preview. |
| Client project detail and timeline | Project team name and role, history month and seconds, milestone date/title/status, update date/title; client timeline date/title/type. | Populated approved project fixture and timeline route. |
| Client reporting and chart tables | Month/group, raw hours or share as applicable. Completion tables sort by month and recorded count, with unavailable months last. Presentation data tables can sort in the live view; the printable document retains canonical order. | Leadership and chart regressions plus the completion/calendar browser fixture. |
| Client deadlines | Deadline, project, department and status in either direction within the selected horizon. | Existing deadline horizon regression. |

The grouped cards and tables keep their active filters while changing sort order. URL-backed direction is used for source entries, staff project browsing, client Explorer, client directory and published timeline. Standalone report controls are scoped to their current view.

Time Allocation's default chronological order stays backward compatible. Explicit sorting keeps empty values last, uses Canadian natural collation for text, and breaks ties by source date and ID. Ascending status prioritizes needs review, unassigned, partial, classified and deleted, in that order. Split assignments use their visible project names in split order. Time-entry CSV follows the active server ordering. Exact grouped breakdown CSV retains canonical server ordering and period identifiers.

Read-only audit trails, source allocation history, fixed status legends, wizard fields, authored presentation chapter order and controls without data keep their meaningful sequence. Other staff administration lists, including the paginated employee-link verification queue and legacy portfolio configuration, retain their existing ordering.

## Contextual help and evidence

The portfolio distribution and Leadership metrics use the same keyboard-, pointer- and touch-accessible help component as effort and cap explanations. The status composition retains exact segment counts and percentages with status-specific drilldowns. Public client projections and source-ledger allocation semantics are unchanged.

The accepted V4 screenshots are available in [the baseline browser archive](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/actions/runs/45478701106/artifacts/14962005494). V4.1 browser files use the `v41-` prefix alongside the existing Explorer and detail captures.
