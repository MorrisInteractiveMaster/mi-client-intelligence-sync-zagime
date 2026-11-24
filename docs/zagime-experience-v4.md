# Zagimē Experience V4

Built from the verified V3 merge at `ee73efd4d535e25fe159ac722a5b88a57a158bdc`. V4 is a presentation and authorized-report navigation change. It needs no production data migration or infrastructure changes.

## Project Explorer

The default list renders up to 20 delivery projects. Page sizes of 10, 20 and 50, card mode, search, department, status, parent, deadline and sort controls use URL state. Filter changes reset the page and out-of-range links are clamped. A project opened from the Explorer records its list URL and focus point for return navigation. CSV export covers the full filtered result set, with the existing server recheck.

The client grant limit is still 100 project IDs. The 300-record browser fixture uses authenticated staff draft preview to prove the browsing interface scales when a wider authorized report is available. The 100-record fixture uses a client-scoped response. Fixtures use the loopback emulators and are excluded from production.

## Leadership reporting

Department counts exclude parent engagements and service-area grouping nodes. Each authorized delivery project contributes to one department or No department. Status composition is exclusive. The work assessment bands are independent of delivery status. The completion chart shows consecutive 12-month windows ending in the current Regina month or an earlier period. It counts only authorized completed or closed projects with valid published completion dates. Within the span of those dates, a zero represents no published dated completion records in that month. Outside that span, coverage is unavailable. Time-entry history does not establish completion coverage. The milestone comparison excludes waived milestones and makes blocked, overdue and in-progress classifications mutually exclusive.

The V3 approved-effort and cap calculations remain separate from project delivery. The monthly effort chart retains selected-period and monthly-portfolio denominators, as documented in [V3 reporting](zagime-experience-v3.md#design-and-reporting). Missing completion assessments, published dates, contact information and cap versions remain unavailable.

## Sign-in and visual evidence

The sign-in returns to the V2 two-part branded composition using the repository's existing delivery artwork. Google and Microsoft handlers, provider verification, and the local emulator's existing test-only controls are preserved.

The five new annotated V4 images were unavailable. The user authorized using the written defects and available V3 and Morris references. The original Morris Overview reference from the V3 ZIP was opened at its exported size. The screenshots shared through Actions contain synthetic records only.

Visual evidence in the Actions archive includes the full 100-project Explorer, the 300-record staff draft preview, the zero-effort Leadership view, and a populated client project with approved teammates, dates, updates, milestones and hour caps. The light and dark matrices include the completion calendar and the viewport-height sign-in.

## Owner release

Use the existing [read-only preflight, candidate verification, promotion and rollback](delivery-operations.md#owner-controlled-release). Verify the exact accepted SHA, approved client-versus-staff responses and the selected serving revision before any owner-controlled rollout.
