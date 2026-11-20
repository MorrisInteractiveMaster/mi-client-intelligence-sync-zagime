# Morris Interactive Client Intelligence Platform

This release builds on merged PR #22 at `341c3c5c4f44ae37717fec38d0599fa7982d467e`. It continues to use the existing named Firestore database, verified Time customer binding and scheduled worker. The route shell, guided project creation, employee mappings and historical summaries use the same authorized backend as the previous workspace.

## Start here

| Destination | How to use it |
| --- | --- |
| `/` | Sign in and open a destination allowed by the verified account. A Zagimē account opening Home goes to its client dashboard. |
| `/workspace` | Review the selected month or All History. Open a consultant or work-order total to inspect the underlying authorized entries. The workspace covers projects, time, team, milestones, budget health, previews and audit. |
| `/workspace/projects/new` | Create a Parent Engagement, Service Area or Delivery Project. Save as soon as the name and location are complete, or add budget, dates, people and milestones in the wizard. |
| `/workspace/time` | Choose a period, inspect original notes and recorded seconds, then allocate effort to the appropriate delivery project. Open an entry to get a stable link to its drawer. |
| `/control` | Review approved profiles, WordPress and Time status, employee mapping, branding, publication preferences and audit. Requires a separate owner-approved administrator identity. |
| `/clients/zagime` | See approved reports, engagements, service areas, projects, milestones and team. Morris staff can select an approved client access profile or open a visibly marked private draft preview. |
| `/clients/zagime/present?month=YYYY-MM&chapter=3` | Open the historical-effort chapter. Select another chapter, drill into its live report, or print the approved report. The same authentication and publication rules apply. |

Saved legacy `/#/secure` URLs still work. A full refresh preserves the requested path and report period. Users may need to sign in again because the approved session proof is kept in memory. Destination links inside the application keep the active session.

## Data ownership and compatibility

| Data | Storage and controls |
| --- | --- |
| Source work orders, recorded seconds and current or corrected source versions | Existing Time ledger. Review uses the four approved work orders and the existing source customer and parent binding. |
| Consultant attribution and notes | Current revision-matched private Time details. Missing data reads as Unavailable. Accounting approval stays unverified unless supported by approved evidence. |
| Employee links | Existing tenant with a versioned staff settings document and audit. A verified Time ID and WordPress post ID are linked explicitly. [Employee mapping and undo](employee-mapping.md) |
| Allocations and organization | Existing exact-second, revisioned allocation ledger. The v2 project hierarchy adds explicit engagement, service area and delivery kinds. Legacy placements and reporting groups are retained. [Hierarchy and caps](delivery-hierarchy.md) |
| Branding label, opening presentation title and publication gate | Optional tenant `portalSettings`. Revision-checked updates are audited. The owner can require a platform administrator to publish or unpublish. Client responses contain only the published label and title. |
| Client reports | The existing approved project projection, intersected with the actual client access profile. Staff-only draft overlay is available through an authenticated preview. |

The current runtime serves the approved Zagimē tenant. Additional client enrollment and changes to staff or client identity grants still follow the reviewed owner procedures. Control shows the approved access and onboarding status. The administrator setting is optional and names one existing verified Microsoft-linked Firebase UID. It confers application controls for this tenant and does not confer Cloud IAM or provider access.

Historical queries are paginated with exact totals within a bounded scan. The current limits are 5,000 stored entries per month and 12,000 across a longer period. Use a shorter interval above that limit. The new hierarchy, control settings and identity mappings require no production backfill. See the [Time history and enrichment procedure](time-history.md) for the read-only inventory, dry-run, bounded apply and resume commands.

## Owner release

1. Review the PR, its CI results and browser screenshots. Rehearse in an authorized test environment with a verified Morris administrator, ordinary Morris staff and a scoped client account. Check Bookmarks and Back/Forward from each destination. Check publication, source totals, employee mapping, budget exclusion and printed presentation.
2. Use the owner Cloud Shell procedure to confirm `mi-client-production` and the approved database UID, Time checkpoint and four work-order identities. Compare recorded, allocated and remaining seconds from the same checkpoint. Use the original approval state and approved credential. Production reconciliation is an owner check.
3. Build the reviewed commit with the existing dedicated build account, then verify the immutable image digest. Deploy the existing dashboard service with zero traffic. To enable the new Control Panel, approve and configure `MORRIS_PLATFORM_ADMIN_UID` on that candidate, using the existing verified Firebase UID for the designated owner. Verify the identity, active origin, database binding and read-only staff and client paths before releasing writes.
4. Promote traffic only after owner approval. Keep `mi-client-prod-time-daily` at 06:00 America/Regina. Upgrade the existing Time job image separately only if the history inventory and enrichment commands are needed. Keep its command, environment, regional credential and scheduler configuration. Approve each enrichment page after reviewing dry-run counts.
5. For recovery, pause staff writes and restore the previous dashboard traffic targets. Restore the previous worker digest only if its rollout needs reversal. Keep source data, revisions, settings, memberships and audits in the named database. Older application images should serve read-only until a compatible build is restored.

Follow the [executable Cloud Shell procedure](delivery-operations.md#owner-controlled-release) for inventory, immutable build verification, zero-traffic checks, promotion and separate rollback. If production authentication policies exclude a tag origin, use the tested staging route first and run production read-only sign-in checks at the approved main origin immediately after promotion. Custom domains need separate owner review of DNS, Firebase authorized domains, Entra redirects and Cloud Run origin policy.

### Optional administrator on the zero-traffic candidate

After the preflight in the Cloud Shell procedure, replace its zero-traffic deploy command with this version only when the owner has approved the designated account. Continue the existing candidate verification and traffic approval steps.

```bash
: "${ADMIN_UID:?Set the approved existing Microsoft-linked Firebase user ID}"
[[ "$ADMIN_UID" =~ ^[-A-Za-z0-9_]{1,128}$ ]]
gcloud run deploy "$DASHBOARD" --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
  --no-traffic --tag="$TAG" --update-env-vars="MORRIS_PLATFORM_ADMIN_UID=$ADMIN_UID"
```

Test that the designated corporate account can open the Control Panel, another Morris account can use the Workspace, and a client account can open only its authorized reports. Settings and employee mappings remain in the tenant on rollback. Keep publication writes paused if the prior image predates the selected publication policy.
