# Zagimē V5.1 release verification

V5.1 uses the existing dashboard release path and production tenant. After owner approval to merge, pin the resulting main commit and validate the exact tree. Use the [delivery runbook](../delivery-operations.md#1-read-only-preflight) to capture the serving dashboard image, traffic assignments, named Firestore UID and QuickBooks Time worker configuration privately.

1. Build the dashboard image from the approved main commit through the [existing production build procedure](../production-build-iam.md#3-verify-the-equivalent-build-before-removing-editor). Record the immutable digest.
2. Follow the [zero-traffic candidate procedure](../delivery-operations.md#2-owner-approved-candidate-verification-without-traffic). Check the approved origin and **/health**. Exercise the full allocation workflow using synthetic data in the named staging database. Verify the actual candidate image separately.
3. In authorized staff and client sessions, inspect the sidebar, reporting toolbar, department filters, Time Allocation and the Manage Time drawer. On named staging, check a multi-page consultant selection, review its destination and confirm that allocated and remaining seconds reconcile. Check that the client still sees only authorized, published reporting. Use read-only checks for real production data.
4. With the owner's production approval, follow [traffic promotion](../delivery-operations.md#3-owner-approved-promotion). Verify the serving revision and repeat the read-only browser checks. On rollback, restore the captured split using [the dashboard rollback procedure](../delivery-operations.md#4-owner-controlled-rollback).

**QuickBooks Time worker.** V5.1 changes dashboard reads and interactions. The existing worker image and schedule can continue serving the dashboard without an image update. There are no migrations, new indexes, credential changes or source imports in this release. Keep the V5 worker and 06:00 America/Regina schedule, and verify the next normal execution from the existing monitor.

Application rollback restores the prior dashboard. Allocations already committed remain in the existing audit and reporting ledger. Review them through the normal allocation workflow.


## Verification notes

- V5 drawer labels and parent values used plain bold elements that inherited the shared Nordic 46 px display treatment. The Time drawer now uses scoped section labels, body text and a read-only parent field.
- V5's Time table used automatic column sizing across long headers and repeated multi-line cell contents. The selection column expanded beyond its declared width and adjacent columns reflowed. V5.1 assigns column widths, caps source descriptions at a two-line preview and provides the full text on demand.
- In the V5 browser fixture, selecting all and then reapplying the filter cleared the visible checks while leaving the earlier selection announcement. V5.1 derives the visible checks, header state, totals and actions from the same selection. Changing scope clears the selection together. Interrupted bulk requests retain settled outcomes and the remaining confirmed entries for retry.
