> M4 current decision supersedes older residency/infrastructure assumptions below: no blanket Canada-only identity/log/service-processing rule; Canadian project/reporting storage preferred; Firebase Auth requires privacy approval. Existing database (default) already exists in Montréal. See docs/canadian-residency.md.

# Milestone 2 decisions and review boundary

Main was verified at 45cde462f394eb467b11cb3fdb8e8a6fbbda9fa0 after PR #1 merged. Milestone 2 uses codex/m2-synthetic-reporting-nordic and targets main.

The current user instruction supersedes outdated M1 branch/base references and the ZIP's non-Canadian-hosting assumption. Confirmed Firebase project ID: morris-client-dash-zagime. Canadian production data residency is mandatory; deployment topology and all regions remain unverified. No cloud service was contacted or changed.

Internal agreement, department and delivery-project IDs supersede the old work-order-shaped display hierarchy. External IDs are optional links. The new model uses integer seconds for source and allocated time, integer minutes for plans/caps, and revisioned allocations. Parent caps are not added to department or project plans. A corrected source duration preserves manual history and quarantines over-allocated records from delivered totals until reviewed.

Compatibility: the old version-1 save key and all 45 regression inputs remain intact. The new explicit opt-in demo uses mi-reporting-v2; no browser data is migrated or erased. Existing screens remain accessible, including the original overview at /#/legacy-overview. Legacy routes still use v1, carry explicit labels and do not affect M2. Primary Projects/New project/Time Allocation now use a shared v2 provider. No storage migration is performed.

Only Nordic Minimal and Dots are selected for M2. Other design sources are retained under docs for provenance and are not loaded into the product. Original legacy presentation remains accessible for regression review.

Known limits: broader milestone/status, staffing and training administration is represented by contracts but not exposed; references, revision uniqueness, training budget basis and auxiliary fields are validated. The demo defaults to October 2026; a reporting-month selector drives all M2 aggregates and Dots. There is no production authentication, tenant enforcement, live sync, or emulator configuration. The native dialog and keyboard controls were browser-tested, but this is not a full accessibility certification. Invalid v2 saves show an explicit read-only synthetic preview and cannot be overwritten through the editor. Source-link attachment is available through a small local form and preserves project identity/history. Full recovery/import administration belongs to a subsequent milestone.

## Review corrections, 16 November 2026
- ReportingScope carries the selected month and optional agreement. Internal scope and published client projections are separate APIs.
- External source links target exactly one agreement or one granular delivery project. An umbrella link belongs to the agreement; many projects consume allocations from its raw entries without duplicate work-order mappings. Optional granular links can be attached later. Duplicate external mappings are rejected.
- Corrections retain complete before/after raw snapshots (source revision and seconds included) in sourceCorrections. Numeric revisions compare deterministically with BigInt; stale/equal changed revisions are rejected and identical replays are no-ops. Allocation history is retained.
- One existing M2 publication assertion was updated to call clientProjection explicitly because project now returns the internal calculation. Its client-visibility expectation is unchanged. The original 45 tests remain untouched.

## M3 decisions (16 November 2026)
M2 main verified at 745df43b97750d3c30678e31b7ab5145e81ce03f. Choose offline Standard emulator, all browser Firestore denied, server-only persistence architecture and provider-neutral identity boundary. Do not activate Firebase Auth: official US processing conflicts with Canada-only identity residency. Proposed Montréal Firestore/Cloud Run/regional Secret Manager are service capabilities, not approved deployed resources. Cloud Run built-in regional-secret mounting is unsupported; future server uses regional API. Existing global mandatory logging and all identity/control-plane/Intuit boundaries are unresolved owner gates. No live resource discovery, login, IAM/billing changes or deployment. Latest handoff says Firestore/Storage NOT CREATED; prior M1 report is superseded.

## M4 decisions
Verified merged M3 main d62dc9d8ac853423cf6d62a6775c68b4f1719a57. Reuse existing Standard Native database; never create another project/database. Implement Admin SDK verifyIdToken(checkRevoked=true), targeted Firestore transactions, sanitized published period/lifetime summaries and immutable audits. Browser Firestore remains denied. Live startup and protected frontend are disabled by default. Auth privacy/provider approval, deployed rule-release verification, ADC/IAM, ingress and synthetic staging are owner gates. No live changes. See docs/m4-api-and-persistence.md for bounded pilot limits and create-retry limitation.
