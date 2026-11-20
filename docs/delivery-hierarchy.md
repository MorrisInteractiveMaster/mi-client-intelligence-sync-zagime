# Project creation and budget rules

From Morris Workspace, open Projects and select **Create project**. Choose a parent engagement, service area or delivery project. An engagement can be created with just a name. A service area needs a parent and an approved classification. A delivery project needs a parent and can optionally sit inside one of its service areas. Use **Next** to add budget, dates, people and milestones, or create the project as soon as the required details are available. Every new record starts as a private draft.

Select **Save and add details** at review to continue in the regular editor. Work-order links, descriptions, training dates, team changes and client visibility are available there. A work-order link is optional and uses the existing verified Time registry. Changing it keeps the project ID and previously allocated seconds. Choose **Use the three-level project structure** in an existing editor to convert that record when its relationships fit. Existing groups remain available in Portfolio management.

## Stored records and compatibility

The project remains in `tenants/{tenantId}/projects/{projectId}` with its existing project and tenant IDs. The versioned fields sit under `delivery`.

| Field | Behavior |
| --- | --- |
| `structure: 2` | Enables explicit parent engagement, service area and delivery project validation. |
| `kind` | `engagement` has no parent. A `service-area` has a parent engagement and an approved `areaId`. A `project` has either a parent engagement or a service area as its direct parent. |
| `parentId`, `areaId` | Preserve stable relationships within the same tenant. Projects under a service area use its classification. |
| `allowDirectAllocation` | An engagement may accept its own allocated time. Service areas summarize projects. Reassignments can remove past allocations from either. |
| `countAgainstParentCap` | A project can exclude its effort from its parent engagement’s cap. Its hours still appear in effort reporting and consume the service area’s own cap. |
| `monthlyCap`, `lifetimeCap` | Optional independent limits in seconds. A zero-valued cap is an explicit limit. |

The server validates parent relationships, classification, permitted work orders and staff directory IDs in the existing transaction. It keeps the 600-project bound. Legacy project shapes and compatible stored relationships remain readable and editable. Moving a legacy project requires choosing the three-level structure. New parent relations use that structure. This change requires no production backfill, Firestore collection or index.

Cap consumption uses applied allocations already recorded in project period and lifetime totals. Parent reports add each project’s direct effort once. The client projection calculates cap usage from approved in-scope projects and discloses it only when the project shares budget details. Milestone progress and deadline status use their own inputs.

## Verification and recovery

Run unit, typecheck, application builds and the named emulator suite. Verify all three creation paths, an invalid parent or classification, a split of five hours into three and two, and an excluded project whose hours remain visible without consuming the engagement cap. Confirm saving changes to an existing published project creates its private draft and leaves the last approved hierarchy until publication.

If the dashboard returns to a build from before explicit structure support, pause edits and allocations until a compatible build is available. A pre-structure image does not enforce the new relationships or allocation policy. Preserve the new fields, audits and existing job. Use the prior image for read-only recovery and follow the [release and rollback procedure](delivery-operations.md#owner-controlled-release).
