# Work-order attribution

The dashboard now uses the existing Time importer’s per-project monthly and lifetime facts. A verified import already records the project that owns the work order. The display adds the recorded balance that has no reporting assignment to the existing project effort. The classification transaction still writes only explicit assignments.

For example, 74,700 recorded seconds (20.75 hours) with a 14,400-second assignment leaves 60,300 seconds on the original work order. The receiving project shows 14,400 seconds. The two contributions total 74,700 seconds. The original recorded figure also remains available. When an older record has an explicit assignment directly to a parent, that assignment stays on the parent. New recording and correction behavior remains under the existing Time worker.

Each project display adds only its original work-order balance and incoming assignments. Branch rollups use these contributions, and cap exclusions continue to govern consumption independently. Client reports apply the same projection after authorization. Service-area charts use classified effort. The default staff client preview uses the projects common to all approved client profiles. Control Panel links can still test a particular profile.

## Read-only release check

1. In the currently approved named database, use the same protected snapshot workflow from [Delivery operations](delivery-operations.md#compatibility-and-diagnostics). Capture the existing projects, work-order mappings, raw time and allocation heads at one completed checkpoint. Keep this snapshot out of Git.
2. Run the diagnostic in the reviewed checkout. It checks the four existing Time jobcodes against the existing project scope. Review any missing or ambiguous mapping with the owner. Preserve the imported scope IDs and the linked project's existing business type unless Morris explicitly chooses to convert it. The command performs no writes.

```bash
: "${SNAPSHOT:?Set the approved private snapshot path}"
node --import tsx scripts/inspect-delivery-snapshot.ts "$SNAPSHOT"
```

3. Compare month and lifetime recorded seconds against the existing Time view. Confirm the candidate shows the recorded balance on mapped projects before classification. Test the four-hour classification split in an approved nonproduction fixture. Confirm the project and parent views, selected month, available reporting history, and the same authorized client project IDs.
4. Follow the [zero-traffic release and rollback commands](delivery-operations.md#owner-controlled-release). Attribution is computed at read time. The release needs no historical reimport, allocation backfill or worker change. Restore the prior dashboard revision for rollback. If staff save newly supported delivery statuses or blocker fields, keep project writes paused on an older revision until the compatible dashboard is restored.

Current reports include up to 120 prior imported month buckets as well as the recent reporting window. Aggregate fields apply to approved projects only. For older historical windows, select a past reporting month or use the Morris Time filters. Missing optional employee metadata has no effect on hours.
