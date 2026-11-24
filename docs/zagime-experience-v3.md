# Zagimē Experience V3

This change starts at the verified PR #29 merge, `c1219cad40fc6a548b5d9a1a9866a90f786e263f`. The Morris Overview retains its existing sections and source-time controls. The client dashboard derives comparisons from the authorized report used by its existing exports and presentations.

## Design and reporting

The visual system uses an 8px grid with 16px, 24px and 32px section spacing, 14px panel corners, single-accent interaction states and 160ms transitions. The shared deep navy rail extends through the usable viewport on desktop. At narrow sizes the existing mobile drawer remains the navigation surface. Focus rings, labels, exact values, and reduced-motion controls carry meaning alongside color or motion. The sign-in screen uses a centered, branded provider chooser with the existing Google and Microsoft flows and no new credential fields. The Apple reference informed hierarchy, low-chrome controls and typography.

| Client metric | Scope |
| --- | --- |
| Allocation share | Approved seconds for an item divided by approved seconds in the selected scope and month. A zero denominator has no share. |
| Monthly approved effort · Share of selected-period effort | Each month's approved portfolio seconds divided by the sum of approved seconds in the displayed window. The window covers up to 24 calendar months and keeps the selected reporting month available. |
| Monthly approved effort · Share of monthly portfolio effort | With a department or project selected, its approved seconds are divided by the whole authorized portfolio's approved seconds for the same month. |
| Monthly cap utilization | Approved cap-consumed seconds divided by published caps in the current period. Portfolio totals omit nested limits under a capped ancestor. Effort outside those caps is excluded. |
| Work completion | Approved published assessment or eligible milestone completion. |
| Dated completion history | Verified published dates only. Closed projects enter the history only when a completion date was recorded. The percentage view uses the current approved portfolio as denominator. |
| Deadline horizon | Calendar months from the current America/Regina date, including overdue actionable projects. Only published dates contribute. |

The monthly effort plot and table use the same authorized series. The Hours toggle changes the plotted unit. Hover, focus and the table show the underlying integer seconds and the relevant denominator. Months missing from the report appear as Not reported, and zero denominators have no percentage. Existing CSV exports on other views continue to report their authorized effort measures in hours. The Monthly Approved Effort panel shows cap utilization separately for the latest reporting month. Historical cap versions are unavailable, so the panel omits historical utilization.

Training & Workshops uses the existing `training` value for new records. Existing `training` and `workshop` values remain supported. Historical caps on those records remain readable and unchanged on ordinary edits. The server rejects new cap assignments, including zero, for both program types. No cap or production migration is applied automatically.

Existing publication flags remain in effect. New projects keep the previous private schedule/cap default and may publish the delivery phase without the date. Project Management exposes the separate Client visibility settings to publishers. Changes pass through the existing permission, revision, draft, and audit gates. The wizard's confirmation does not itself change any setting.

## Visual review references

The 11 November 24 originals are kept private. Repository test artifacts use synthetic fixtures. Export dimensions below provide comparison sizes. Original browser zoom, crop and scroll offsets are unavailable. The fixture's project count, approved values and names differ from live screenshots.

| References | Comparison |
| --- | --- |
| 01–04 | Client project-card alignment, HR analytics, engagement cards, month history, aligned leadership rows |
| 05 | Morris Overview keeps the approved delivery, reconciliation and recorded-effort panels |
| 06–07 | Training schedule fields without caps and a shorter review step with one publication confirmation |
| 08 | Warning icon and label for the blocker action, with existing resolve and milestone controls |
| 09–11 | Budget list and cap editing are preserved, with stronger dark boundaries and an integrated masthead |

## Owner release and rollback

Use the four owner-controlled phases in [Delivery operations](delivery-operations.md#owner-controlled-release). Obtain the actual current traffic and digest with the read-only preflight before selecting a rollback target. Build the exact accepted commit, stage one dashboard revision at zero traffic, and verify its immutable digest. Confirm that the production service points to `mi-client-production` with UID `b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd` in Montréal. Verify the Time job schedule separately without running or changing it.

On a tagged candidate with approved identity origins, confirm sign-in for an authorized staff and client account, verify one out-of-scope project is denied, check a past month and return to the latest report, and reconcile the same authorized allocation total at the same cutoff. Verify draft and publication on synthetic staging, including private schedule flags and stale revisions. The owner can then approve promotion. If verification fails after promotion, pause edits and restore the previously recorded revision split through the rollback phase. No data migration or Time reconciliation is required for rolling back the dashboard image.
