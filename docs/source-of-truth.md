# Source-of-truth boundaries

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
