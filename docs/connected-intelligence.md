# Connected Client Intelligence

This branch extends the secure dashboard in [PR #19](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/pull/19) at reviewed commit `5cdc198676240bfbaaf32867450d22be6be2947e`. The dedicated build identity in [PR #20](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/pull/20) is a separate release dependency. Review this branch as a stacked change. Keep the existing reviewed dashboard available for the Friday usability session.

## Open and present reports

The portal keeps its secured entry URL. Report routes use the same origin and preserve authentication. Copy the URL after selecting the reporting month and destination. Identifiers in copied links come from the report the signed-in user is permitted to see.

| Destination | Parameters |
| --- | --- |
| Leadership, portfolio and reporting history | `month=2026-11`, `view=projects`, or `view=history` |
| Service area or reporting group | `view=area:<id>` or `view=group:<id>` |
| Project, project timeline or milestone | `view=project:<id>`, `view=timeline:<id>`, or `view=milestone:<project-id>:<milestone-id>` |
| Directory and contact | `view=directory` or `view=contact:<id>` |
| Milestone index and executive notes | `view=milestones` or `view=notes` |
| Chart detail | `chart=distribution`, `chart=trend`, or `chart=plan` alongside the report view |
| Executive presentation | `present=1` alongside the report view |
| Morris overview, projects, allocations, audit and integrations | `staff=overview`, `staff=projects`, `staff=hours`, `staff=activity`, `staff=integrations`, or `staff=time` |
| Staff portfolio configuration | `staff=portfolio` with `subsection=areas`, `engagements`, `placements`, `directory`, or `notes` |
| Staff editor and presentation preview | `staff=projects&editor=new`, `staff=projects&editor=<id>`, or `staff=projects&staff-preview=<id>` |

Select a chart row with a pointer, touch, or keyboard. The detail panel shows exact hours and gives an accessible table of the same values. Service-area and monthly-target analyses link to the contributing projects. The trend opens the selected month's report, where published projects and allocations are loaded under that month's permission scope.

**Present this view** opens the current report's presentation. Use the chapter picker, arrow keys, Next or Previous. Play advances every seven seconds. Restart returns to the opening. Close or Escape returns to the report. Overview uses the existing nine chapters. Service areas, projects and other scopes use the same authorized data and shared presentation controls.

## Data and scope

The portal reads the authorized published report and existing revision-checked staff APIs. Dots represent allocated seconds, while plans retain monthly or lifetime basis. Timelines, dates, notes, project membership and directory entries come from the approved projection. Source freshness uses its recorded timestamp. Work-order identity stays in the staff workspace under the existing projection. The client view keeps the existing published fields. Client history is portfolio-level. Staff preview links resolve projects on the currently loaded page.

The original whiteboards informed the hierarchy and service-area structure. The hours and teams sketched on them are examples. The available design archive was `DashboardUploadNov13.zip`. See [approved design source](design-source.md) for the recorded hash and the earlier prototype provenance. Brand marks come from the existing reviewed dashboard assets. [Artwork provenance](intelligence-artwork.md) records the image generation and fallback.

## WordPress

Install [the plugin ZIP](../wordpress/morris-client-intelligence.zip) and follow [the setup and verification steps](../wordpress/morris-client-intelligence/README.md). The block and shortcode launch the allowlisted secure portal. Authentication and authorization remain with the dashboard.

## Verification

Run `npm test`, `npm run typecheck`, `npm run build`, `npm run build:server`, and `MI_SECURE_CROSS_BROWSER=true npm run test:security`. The last command needs Java 21, Firebase emulators, and Playwright Chromium, Firefox and WebKit. CI also builds the existing container and runs the isolated browser smoke sequence. Find browser evidence under `test-results/project-only-browser/` and the hosted validation artifact. Tests use local data with no production credentials. [WordPress verification](../wordpress/morris-client-intelligence/README.md) includes the PHP test and archive checks.

The Vite production build measured approximately 124 KB gzip for the app entry, 23 KB gzip of CSS and 4 KB gzip for the lazy-loaded presentation module. Local browser timings in the evidence JSON cover the authenticated fixture plus local server round trips. They are useful for comparing this development fixture across runs. The checks exercise keyboard, focus return, motion preference, mobile touch, viewport overflow and 200% zoom. Formal WCAG 2.2 AA conformance and production performance measurements remain open.
