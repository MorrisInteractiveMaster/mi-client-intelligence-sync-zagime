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
