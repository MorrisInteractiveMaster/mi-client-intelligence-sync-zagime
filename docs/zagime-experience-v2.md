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

## PR #29 visual follow-up

The review started from `959ada4a7a03691c1dd6c6d0b8e78b5379a86441`. The [reviewed browser artifact](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/actions/runs/45258405644/artifacts/14857799061) contains the two before images.

- `project-only-browser/time-allocation.png` exercised the still-reachable secure hash route. Its banner preceded the workbench and the captured sidebar sat midway down the page. The legacy route now uses the same compact workspace navigation and Time Allocation heading as the native route. The desktop check measures a 10px masthead-to-sidebar gap. Collapsed filters share the toolbar and the test opens a saved filter and entry URL, verifies the reporting description, and returns to the filtered list.
- `platform-routes-browser/client-directory-public-contacts.png` used a test that returned HTTP 204 for the three remote images. Edge opened and decoded the original 300 × 300 PNGs from the three official profile pages. Both directories serve the verified copies from the application origin and keep the existing initials fallback. The browser check separately verifies successful image decoding and fallback after a controlled missing response. [Morris portrait sources](../public/branding/morris/README.md#public-directory-portraits)
- The control panel uses a compact settings header and a mobile sections disclosure. The audit also caught a blank WordPress team settings page caused by reading the portfolio response at the wrong level. The settings page now reads the portfolio field and renders its directory. Legacy client preview has one staff sidebar and scoped client controls. The route audit checks the page width, horizontal control boundaries and desktop sidebar alignment on authenticated fixtures.

### Annotated references

All 11 PNGs in the supplied ZIP were opened. The route audit captures synthetic-data screens at the exported image dimensions alongside the standard desktop, tablet and phone matrix. Several originals are cropped or include the Windows taskbar, so the original browser zoom, CSS viewport and scroll position are unverified. Production values and names in the supplied captures are used only for private review. The published evidence uses emulator fixtures.

| Original reference | Retest evidence |
| --- | --- |
| `01_staff_header_and_portfolio.png` | Compact shared masthead, aligned rail and wide department settings surface |
| `02_client_header_and_leadership.png` | Short staff preview toolbar, draft badge and leadership status visualization |
| `03_department_effort.png` | Percentage distribution with a concise zero-approved-effort state |
| `04_parent_engagement_cards.png` | Parent counts and approved allocated effort in the legacy client route |
| `05_published_project_cards.png` | Responsive project filters, progress cards and status legend |
| `06_staff_overview.png` | Dotted recorded history, percentage coverage and source mix |
| `07_mi_directory_reference.png` | Actual headshots and compact cards in both directories, with a separate fallback test |
| `08_create_project_wizard_broken.png` | Type cards with readable labels at the reference size, phone widths and simulated 200% zoom |
| `09_time_allocation_filters.png` | Compact filter controls, percentages and visible Manage Time actions |
| `10_milestones_unwanted_nav.png` | Milestones under project management and retained direct bookmarks |
| `11_portfolio_tabs_to_remove.png` | Contextual configuration links in place of the old Portfolio tabs |
