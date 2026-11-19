# Source-of-truth boundaries

## Current boundaries — 2026-11-19

The [2026-11-19 owner decision](master-implementation-contract.md#controlling-owner-decision--2026-11-19) supersedes the historical Accounting Projects, Accounting OAuth and financial-data scope. QuickBooks Time is the only approved external source. The exact setup label is **Zagimē Anishinabēk Nation**. The independently verified numeric Time account and parent jobcode IDs establish scope. The label is a cross-check. WordPress and the Morris-internal team directory remain later work.

| Data | Authority and visibility |
| --- | --- |
| Customer catalog, work-order source labels, raw time and revisions | Scoped Time worker. Discover current and future children, register unpublished Morris projects, and preserve history during source reconciliation. |
| Internal project fields, mappings, plans, progress, updates, milestones, allocations and publication | Morris. Retain existing edits and allocation history through sync. |
| Recorded, allocated, unallocated and optional on-clock values | Derived reporting. Keep the measures separate. Only verified evidence establishes source approval. |
| Client report | Server-authorized published projects and permitted Morris allocation aggregates. Raw entries, unallocated source time and integration status stay with staff. |

PR #15 implements customer discovery and the daily worker. Owner inventory confirms the existing dashboard’s active named-staging baseline. Live Time enrollment and import require a separately approved pilot. Enable the **06:00 America/Regina** schedule only after reconciliation. See the [Time runbook](integration-quickbooks-time.md) for status and operator gates.

## Historical source boundaries

The sections below retain the prior implementation context. The table and status descriptions refer to earlier phases.

PR B: [implemented project-only paths/costs/tests/gaps](project-only-workspace.md). Active CRUD/publication/allocation operates without agreements/departments. Managed field allowlists preserve source identity; client projections enforce explicit project grants and exclude private fields/global revision. Only local synthetic persistence is verified. Ingestion/correction workers, native Projects/Time/OAuth and remote persistence remain future gates. Historical preparation/status paragraphs below do not override this implementation update.

Current controlling requirements: [owner master contract, 18 November 2026](master-implementation-contract.md). Active project workflows must become independent of agreements/departments; only native verified Zagimē QBO Projects and relevant Time records are permitted. General Customer/subcustomer imports and company-wide discovery are not approved substitutes. The historical sections below describe existing legacy/demo behavior, not the new target or remote verification. [PR B handoff](project-only-persistence-handoff.md) maps the concrete migration and authorization changes; these are not yet implemented. Current secured persistence exists in code/emulators, while remote cross-session persistence and live integrations remain unverified. Verified corporate Morris staff policy supersedes individual staff onboarding; client memberships remain server-controlled and scoped.

| Entity / fields | Owner | Current read/write path | Future audit responsibility |
| --- | --- | --- | --- |
| Project.external | External QBO metadata | Synthetic fixture; allowlisted external merge helper | Authorized server sync |
| TimeEntry.external | External QuickBooks Time | Synthetic fixture; protected from reporting edits | Authorized server sync/reconciliation |
| Project.managed / narrative | Morris | Validated local service commands | Verified Morris actor |
| TimeEntry.managed | Morris allocation | Local reporting edits, never external write-back | Verified Morris actor |
| People/identity aliases/categories | Morris canonical mapping | Stable IDs and validated local edits | Verified Morris actor |
| Hours, pace, health, forecasts | Calculated reporting | Pure domain calculations | Calculation version/provenance |

No production audit exists yet. Existing project fields combine local work-order labels with future external metadata; their mock semantics must be reconciled with verified API contracts before connecting any source.
External merge allowlists preserve manual metadata, narratives and time allocations. Project attachment retains internal IDs. Do not match principally on titles/names; use explicit stable external-ID mappings.
No live approval status is verified. Current approved/unapproved time flags are synthetic examples.

M2: raw source duration/description/reference are immutable in reporting edits. Each allocation revision is append-only; active portions cannot exceed source seconds. Source corrections preserve history and flag conflicts. Monthly agreement cap revisions and department budgets are separate from fixed/monthly project plans.

Review correction: source links may belong to an agreement umbrella or a granular project. Internal IDs are independent of external IDs; allocations need no one-work-order-per-project assumption. Source corrections retain previous/new revisions and duration snapshots, reject stale numeric revisions, and never erase manual allocation revisions. Client projections exclude source identity/reconciliation metadata.

M3: TenantDocuments maps typed per-tenant records; raw source/mapping identities include product+company namespaces. Only future source workers own raw import/checkpoints; no editor command can mutate them. Backend-generated actor/timestamp/revision audit records are atomically appended for supported privileged commands. No-op/read commands commit zero writes in the memory test adapter. Production Firestore measurements and transaction implementation are not claimed.

M4 persistence: rawTime is immutable to interactive APIs; allocationHeads and immutable allocationRevisions track reporting edits. projectViews/projectPeriods are derived records updated in the same transaction as allowed project/allocation changes, audit and tenant revision. Backend authorizes verified UID/current membership in each transaction. No browser raw access, source import, checkpoint route or live integration is exposed. Future workers must maintain the same summary/correction invariant; no raw-only hand edits.

M5 optional workOrderReference is Morris reporting metadata only; it does not establish an external identity mapping or change QuickBooks. Staff split edits preserve raw envelopes and append allocation history. Idempotency results and bootstrap markers are server-controlled records, never browser role authority.

Same-project staging: `mi-client-staging` owns its own tenants, memberships, audits, raw fixtures, allocations, idempotency records and bootstrap markers. Nothing reads/copies memberships or records from production `(default)`. An existing shared Auth UID has no staging authority until an independently approved staging membership exists. Production-role claims in tokens are not authorization.
