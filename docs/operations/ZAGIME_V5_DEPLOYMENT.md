# Zagimē V5 owner deployment and recovery

This handover coordinates the application and Time worker releases on the existing production infrastructure. A successful draft PR or candidate check provides evidence for review. Production changes require the owner’s separate approval.

## 1. Pin the reviewed source and production baseline

Use the GitHub merge record after approval. The reviewed production source is the exact resulting merge commit, including any merge-created changes. Verify that commit is on the remote main branch, review validation for the exact tree, and use a clean checkout to build.

```bash
git fetch origin main
git show --no-patch --format='%H %P %s' origin/main
git status --porcelain
```

Run [read-only preflight](../delivery-operations.md#1-read-only-preflight) in the same Cloud Shell session as the release. Verify project **morris-client-dash-zagime**, region **northamerica-northeast1**, Firestore database **mi-client-production**, UID **b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd**, and tenant **zagime-production**. Compare the dashboard traffic split, worker image, credential reference and service identity privately. Verify Scheduler target and **06:00 America/Regina**, the four approved jobcode associations, and same-cutoff source, allocation and publication totals. Retain the private evidence and prior immutable digests.

## 2. Verify compatibility before changing images

The dashboard reads and writes tenant-scoped historical classification progress alongside existing raw Time, mapping, allocation and audit records. Older mappings and classifications have no mandatory migration. Historical impact uses the work-order field and document ordering. Pending staff effort uses the project field of automatic classification records. These reads use single-field indexes. Retain both existing composite indexes in the repository and verify readiness before staging.

The prior V5 worker can continue scoped Time imports and its earlier automatic draft classifications. Use the reviewed V5 worker image for consistent behavior on future records and test it with corrections and deleted entries in named staging. The dashboard governs historical confirmation, manual and bulk allocation, explicit effort approval, publication and resume. An older dashboard provides its earlier workflow and has no interface for resuming the new historical progress documents.

Check that cloud images are built for the exact reviewed commit, configuration and named tenant. Use the [dedicated build account procedure](../production-build-iam.md#3-verify-the-equivalent-build-before-removing-editor). Keep the resulting immutable Montréal digest and build record.

## 3. Stage and verify the dashboard candidate

Use the [owner-approved candidate phase](../delivery-operations.md#2-owner-approved-candidate-verification-without-traffic). Compare service account, named database, tenant, origin, environment, authorization and digest with the reviewed configuration. Check **/health** and the sign-in page at the candidate. Perform authenticated smoke on an approved origin under the documented release procedure.

On named staging, exercise a mapping preview and a resumable historical operation. Review a large fixed selection, retry a simulated interruption and verify tenant-scoped totals. Check an approved client report using a scoped account. Keep these tests on synthetic data.

## 4. Update the Time worker

Check that there is no active or inconclusive Time execution and coordinate with the operator so manual synchronization, recovery and the scheduled invocation do not overlap. Use the existing [image-only procedure](../delivery-operations.md#separately-approved-time-worker-image-change) when the reviewed worker digest requires promotion. Verify the unchanged service account, command, arguments, credentials, limits and schedule. A worker update does not authorize a provider reimport or a historical classification run.

## 5. Promote traffic and perform authenticated smoke

Use [dashboard traffic promotion](../delivery-operations.md#3-owner-approved-promotion) after the candidate and team approval. Verify the actual serving revision. Sign in as an authorized Morris staff user and separately as an authorized client. Check Time Allocation filters and approved-only reporting, then confirm the next normal Time dispatch from the read-only monitor.

## 6. Run approved historical classification

In the approved operational window, verify a single work order in the Morris mapping screen. Compare the complete preview against the preflight inventory. Confirm only the exact approved destination and monitor the historical results. Reconcile processed, unchanged, conflicting and changed-source entries before moving to the next work order. The normal worker schedule handles newly imported eligible time.

## 7. Roll back and reconcile

Use [dashboard traffic rollback](../delivery-operations.md#4-owner-controlled-rollback) to restore the captured split. If the worker image also needs rolling back, use the separate image-only procedure with the captured prior digest. Verify the running revisions and schedule. An image rollback leaves mapping decisions, classified entries, allocation history, approved effort, and historical progress documents in Firestore. Keep these records and reconcile differences using the before/after inventories and audit history. Pause discretionary mapping and approval actions during recovery. Resume the suspended historical check only on a compatible dashboard after resolving conflicts. Preserve all confirmed source and allocation versions.
