# Morris and Zagimē reporting experience

The redesign starts at merged main `4c4d7b550379818847a30916070d9970d797d05b`. Its tree matches the reviewed historical recovery candidate. Existing production configuration, access, time imports and publications stay under the established owner controls.

## Interface foundations

- The native shell uses DM Sans Variable from the existing bundled Fontsource package (SIL Open Font License), with the system sans-serif as fallback and tabular figures. Major titles use a compact responsive scale. Forms and status text stay at the underlying application’s readable size.
- `premium-shell.css` defines the ink, surface, navy, accent, focus and action treatments. Spacing uses an 8 px base with tighter metadata spacing. Strong actions use the navy-to-blue gradient. Neutral actions and destructive operations keep separate visual treatments.
- `WorkspaceNavigation.tsx` provides grouped workspaces, an icon rail with a persisted local preference, a small-screen dialog and keyboard search. Search uses the existing authorized project catalog and known destinations. It does not send search terms to a new service.
- `ReportingPeriod.tsx` manages selected month and range navigation. The URL owns the selected month. The server continues to authorize the selected detail report and the surrounding trend independently of presentation state.
- `ReportingPlots.tsx` provides chart scales and interactions for the leadership review, detailed reports and presentation. Exact values remain available through chart controls and tables. The staff operating trend uses the existing aggregated recorded-hours response.
- `CsvExport.tsx` and `report-csv.ts` implement the report download action and CSV encoding. See [reporting export scopes](reporting-exports.md).

## Native destination map

| Audience | Destination | Route |
|---|---|---|
| Authorized Morris staff | Home and client entry | `/` |
| Authorized Morris staff | Overview, Clients, Projects, Time, People | `/workspace`, `/workspace/clients`, `/workspace/projects`, `/workspace/time`, `/workspace/team` |
| Authorized Morris staff | Project configuration and delivery progress | `/workspace/projects/:id`, `/workspace/project-management/:id` |
| Authorized Morris staff | Milestones, Budgets & Health, Portfolio, Audit | `/workspace/milestones`, `/workspace/delivery-health`, `/workspace/portfolio`, `/workspace/audit` |
| Platform administrators | Control Panel and private employee mapping | `/control`, `/control/employee-mapping`, `/control/time` |
| Authorized client or permitted staff preview | Leadership Summary, Engagements, Service Areas, Projects, Milestones, Team | `/clients/zagime`, `/clients/zagime/engagements`, `/clients/zagime/service-areas`, `/clients/zagime/projects`, `/clients/zagime/milestones`, `/clients/zagime/team` |
| Authorized client or permitted staff preview | Reporting history and executive presentation | `/clients/zagime/reports`, `/clients/zagime/present` |
| Authorized Morris staff | Staff-only draft preview | `/clients/zagime?previewMode=draft` |

The compatibility hash routes remain supported. The period can be shared using `?month=YYYY-MM`. On native routes the server-backed project ID is addressable as part of the path. Lifecycle and progress saves use the existing revision guard and draft workflow. Published client content changes only through the existing publication action.

## Design audit and browser evidence

The before gallery is the [reviewed baseline browser run](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/actions/runs/44810991671/artifacts/14667875702). The new run publishes the same fixture families under its browser-evidence artifact. Both sets contain synthetic data.

| Screen | Observed problem and source | Implemented change | Evidence under `test-results/` and verification |
|---|---|---|---|
| Sign-in and home | Large landing/sign-in mastheads placed primary actions far from their context. `PlatformHome` and `SecureDashboard` used a single full-width hero. | Split sign-in panel, compact account menu, and a home stage with the operational workspace entry in the first view. | Container login screenshots in `fixed/`, native `morris-home.png`. |
| Morris overview and navigation | Staff hero consumed the first viewport. A flat navigation stack duplicated workspace links near the footer. `ProjectWorkspace`, `executive.css` and `intelligence.css`. | Compact heading, grouped rail, contextual period, accessible search and mobile menu. Recorded hours lead the metric group and the trend links into Time. | `morris-workspace-native-overview.png`, `morris-workspace-mobile-menu.png`. Browser checks 320 to 1920 px and menu focus. |
| Projects and management | Editing project setup and delivery progress required the same form. `ProjectWorkspace` owned both. | Dedicated progress route with lookup, milestones, updates, blocker state, status and confirmed saves. The setup editor links into delivery progress. | `project-management.png`, `project-management-mobile.png`, `parent-recorded-effort.png`. Browser checks direct route, saved draft and unchanged approved project. |
| Time and filtered reporting | CSV coverage skipped exports across report views. Previously it was possible to confuse the visible page with the full export scope. | Export uses authorized filtered summaries or revision-consistent pagination. The toolbar keeps the applied filters and places the download next to the dataset. | `historical-time.png`, `time-allocation.png`; source-page authorization and CSV paging tests. |
| Leadership Summary | A framed KPI and oversized dark region separated the executive insight from its supporting change. `ExecutiveOverview`, `intelligence.css`, `platform.css`. | Borderless metric, compact leadership layout, computed comparisons and a real trend visualization. | `client-dashboard-native-overview.png`, `client-dashboard-tablet.png`; browser checks border and metric widths. |
| Client projects and detail | Repeated dates and nested metric boxes made it hard to scan peer cards. `ProjectReportingCard` and default secure-card styles. | One authoritative date row, compact progress wording and consistent card actions. | `client-project-native-route.png`, legacy service-area browser captures. |
| Reporting history | Chart month discovery used the selected month as the upper bound. The dot chart grid was optimized for a handful of buckets. | Read authorized later month aggregates and plot the range independently of selection. Previous/next, latest and direct month controls use URL history. | `reporting-history-october.png`, `reporting-history-october-mobile.png`. Browser checks October/November/September, Back/Forward, approved October export and narrow width. |
| Draft preview | The watermark took up a full report row. `DeliveryOperations` and `delivery-operations.css`. | Small persistent staff-only badge with existing authentication and publication boundaries. | Draft preview and project revision preview screenshots. |
| Presentation | Repeated decorative dot fields left less room for useful chart axes and labels. `ExecutivePresentation` and `PresentationChapters`. | Shared line, bar and progress views, contextual captions, exact values and slide navigation. | Chromium, Firefox and WebKit presentation screenshots and slide interaction assertions. |
| People and settings | Small control text made navigation and actions inconsistent. | Shared native type, focus and action styling with the existing permission-aware directory and administrative flows. | Employee mapping desktop/mobile, Team Directory and Control Panel desktop/mobile. |

## Release and rollback

This release changes dashboard code and reads existing reporting data. It requires no new Firestore database, index deployment, migration or historical reimport. The Time worker, source ledger and schedule are outside the rollout. Preserve the current production dashboard revision and traffic assignments.

Use the [owner-controlled deployment procedure](delivery-operations.md#owner-controlled-release). Build the exact approved commit through the existing build pipeline, verify the image digest, and deploy a zero-traffic candidate. Verify the named production database UID and runtime identity, then check authorized staff and client scopes, approved report totals, the October–November stepper and a correctly filtered export. Promote only after owner approval. Restore the saved prior traffic assignments using the [rollback commands](delivery-operations.md#rollback) if a candidate fails inspection.
