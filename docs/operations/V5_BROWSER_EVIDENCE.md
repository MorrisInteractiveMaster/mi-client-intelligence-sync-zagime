# Zagimē V5 browser evidence index

Use the validation run attached to [draft PR #33](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/pull/33). Download **production-container-browser-evidence** for the reviewed commit. The captures and reports use synthetic data.

| Experience | Route or view | Capture or folder | Coverage |
| --- | --- | --- | --- |
| Sign-in and account entry | Protected routes before sign-in | fixed/ | Staging-container real browser smoke, including light/dark sign-in |
| Morris workspace shell | /workspace/overview | platform-routes-browser/morris-workspace-native-overview.png | Desktop overview, sidebar, branding and date controls |
| Navigation | Morris and client workspaces | platform-routes-browser/, project-only-browser/ | Expanded/collapsed navigation, mobile menu, keyboard and browser history |
| Time Allocation | /workspace/time and linked records | project-only-browser/time-allocation*.png | Desktop, tablet and phone table layout |
| Time filters | Time Allocation advanced filters | project-only-browser/v5-time-parent-and-mapping-filters.png | Parent Project and Mapping status controls |
| Manage Time | Time entry drawer | project-only-browser/time-allocation-editor.png | Source evidence, reporting description and allocation actions |
| Mapping | /workspace/time/mapping | platform-routes-browser/quickbooks-time-mapping*.png | Impact review on desktop and dark mobile |
| Project creation and status | Create and edit project, Project Management | project-only-browser/project-creation*.png and platform-routes-browser/project-management*.png | Desktop and mobile review, edit, approval and management |
| Scheduling | Create project | platform-routes-browser/v5-consecutive-schedule-and-venues.png, v5-single-delivery-date.png, v5-separate-dates-shared-venue.png and v5-ongoing-unscheduled.png | Single, consecutive, separate, ongoing, shared and per-date venues |
| Leadership and Portfolio Distribution | /clients/zagime | platform-routes-browser/client-dashboard*.png | Approved figures, project counts and empty states |
| Project Explorer and details | Client Projects and project detail | platform-routes-browser/client-project*.png | Projects, filters, detail and tablet captures |
| Departments and Directory | Client Departments and MI Directory | platform-routes-browser/client-empty-department.png and client-directory-public-contacts*.png | Empty and populated views where fixture data is available |
| Presentation | Client presentation and linked chapters | platform-routes-browser/client-presentation*.png, project-only-browser/presentation*.png | Chromium, Firefox and WebKit evidence |

For a prior-layout comparison use the [V4.1 browser archive](https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime/actions/runs/45509393166/artifacts/14975361293). Consult the PR acceptance checklist for comparisons that still require manual sign-off.
