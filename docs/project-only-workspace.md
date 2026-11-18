# PR B — Project-only secured workspace

Controlling [owner contract](master-implementation-contract.md). Base: `8c1953b3e6a8b092e9b0884e4bd041c10eaf81b4`, verified merged PR A/#11. Branch: `codex/project-only-persistence`. Working local/emulator implementation; no deployment, remote database operation, OAuth or QuickBooks connection.

## Implemented workflows and security

The protected React workspace uses `/api/v2/tenants/{tenantId}`. Morris staff can create without agreements, departments or work orders; edit name/status/progress/description/private notes/monthly or lifetime plan; optionally attach a Morris reporting work-order reference; explicitly publish/unpublish; load relevant month-scoped time; split integer seconds; inspect unallocated/conflicting time and allocation/audit history. The optional reference never establishes a QuickBooks identity. New projects are unpublished. Ordinary edits cannot change source identity, roles, tenant, actors or publication.

Existing server-verified Microsoft/Entra corporate ownership/current-enabled-account policy is reused on every request. There is no staff enrollment or browser role grant. Approved clients have explicit project IDs and remain read-only. Client responses are allowlisted, including nested plans: no notes, raw/source identities, allocations/history, work-order references, connector details, unapproved/unpublished projects or global tenant revision. Hidden project edits do not change client response counts/revision metadata.

The executable blocks production mode and requires explicit mi-client-staging before SDK initialization. ProjectStore requires the verified runtime handle, existing project, named database and owner-confirmed UID. Preview still returns before Firebase initialization. The original legacy demo/test adapters remain separate; their local demo default database is never a live fallback. Active startup routes only v2; legacy API routes return 404. A schema-1 tenant returns migration_required and a safe setup message, never a hidden default agreement or automatic rewrite.

## Actual API

Common origin/rate/body/preview gates and Firebase signature, issuer/audience, revocation/account/provider verification precede data operations. All suffixes below follow `/api/v2/tenants/{tenantId}/`.

| Method / suffix | Contract |
| --- | --- |
| GET workspace | Staff tenant/capability/disabled integration status; client role/name only, revision 0. |
| GET projects?month=YYYY-MM&limit=25&cursor=... | Staff-only bounded project summaries and month/lifetime seconds. |
| GET projects/{id} | Staff-only detail/notes. |
| POST projects | Managed fields; timestamped random Idempotency-Key required, actor/tenant/operation/payload bound. Same retry returns original result; conflicting reuse 409. |
| PATCH projects/{id} | Complete managed `{expectedRevision,patch}`; no source/role/publication fields. No-op = zero writes/audits. |
| PATCH projects/{id}/publication | Explicit `{expectedRevision,published}` staff action with atomic audit. |
| GET sources?month=YYYY-MM&limit=25&cursor=... | Staff-only relevant schema-2 source rows for month; valid internal scope project required. Unknown approval stays unknown. |
| PATCH allocations/{sourceId} | `{expectedRevision,portions}`; at most 10 unique project portions, integer seconds within recorded duration. Atomic head/history/month/lifetime/audit/revision transaction; raw source unchanged. |
| GET sources/{id}/history?month=YYYY-MM&limit=25&cursor=... | Staff-only newest revisions first. |
| GET audits?month=YYYY-MM&limit=25&cursor=... | Staff-only newest audit revisions first; month binds cursor context, history remains lifetime. |
| GET report?month=YYYY-MM | Client-only explicit approved project IDs and published projections. No arbitrary scope/count/detail parameters. |

Managed fields: name, status(planned/active/paused/completed), progress(0–100), description, internalNotes, plan{basis:monthly|fixed,targetSeconds}, optional workOrderReference. Target seconds are nonnegative safe integers, at most 3,600,000,000. UI decimal hours must convert to exact seconds; no silent rounding. Blank optional reference normalizes to absent. Detail is fetched before editing; partial patches are not accepted.

Cursors are untrusted positions bound to tenant/actor/resource/month/source/revision. They grant no authority; each page rechecks access. Stale/context-changed pages and concurrent edits require refresh (409). Missing summaries/corrupt source scope fail closed. Source revision/deletion conflicts deny allocation writes and preserve history. No ingestion/correction worker is introduced; C/D must atomically reconcile source changes with summaries rather than hand-edit rawTime.

## Actual physical paths and bounds

All new operations use the existing `morris-client-dash-zagime / mi-client-staging`, or its explicitly named demo-mi-security emulator. No live data operation was run.

| Path under tenants/{tenantId} | Actual use |
| --- | --- |
| root | Small schemaVersion=2/name/revision/synthetic metadata, no growing state array. |
| projects/{immutableId} | Source envelope/null, Morris-managed fields, server actor/time metadata. |
| projectViews/{sameId} | Allowlisted projection, tenant binding, published flag and lifetime seconds; re-projected for clients. |
| projectPeriods/{existingKey(month,id)} | One project/month allocated seconds, existing deterministic key retained. |
| rawTime/{sourceId} | Relevant immutable synthetic fixture, schemaVersion=2/scopeProjectId; no interactive writer. |
| allocationHeads/{sourceId}, allocationRevisions/{existingKey(sourceId,revision)} | Current intended/applied portions/source revision and append-only actor/time/portion history. |
| audits/{id} | Atomic verified material-change evidence. |
| idempotency/{key('project-v2',actorOperationKey)} | Original create result/hash, actor, 30-day expiry metadata; existing bounded timestamped retry window and guarded cleanup. No TTL/scheduler deployment. |
| memberships/{existingKey(uid)} | Approved/enabled schema-2 client and explicit project IDs only; no staff membership write. |

SourceMappings, integrationConnections, syncCheckpoints, source-version ingestion and reconciliation workers are NOT IMPLEMENTED in B. No empty/fake-successful connection records or source API requests are created. Integration UI reports disabled, not synchronized.

Read bounds (document counts, not measured paid production cost): workspace 1 tenant read for staff, 2 for clients. Project page <=26 projects+25 views+25 periods+tenant. Source page <=26 sources+25 heads+25 scope projects+tenant. History/audit page <=26 rows+tenant. Client report <=100 explicitly approved project views+100 published periods+tenant/membership; greater scope fails closed and needs a reviewed scalable projection strategy. No global count, unrelated project scan, idle listener/polling or navigation writes.

Create writes project/view/idempotency/audit/tenant revision. Edit/publication writes project/view/audit/revision only when changed. Allocation updates bounded affected summaries/head and appends one immutable history/audit; source never changes. Root-wide revision contention is a known scaling limit, not a throughput certification.

Prepared actual query indexes: rawTime(schemaVersion ASC,record.date ASC); allocationRevisions(sourceId ASC,revision DESC,__name__ DESC). Projects use schema equality/document-ID order; audits use revision DESC/document-ID DESC. Exact-key lookups need no composite. Definitions are code only; emulator success does not establish deployed-index availability. Missing live indexes must fail, not broaden queries or auto-create indexes.

## Operators and migration

`seed-project-synthetic TENANT` dry-runs by default. Explicit --apply requires a verified named runtime, synthetic-* prefix and nonexistent tenant. Creates exactly 7 documents: root, two unpublished projects, two views, one relevant synthetic 7200-second unknown-approval source, one audit. No agreements/caps/departments/budgets, users, memberships or connections. Existing tenants are never overwritten.

`bootstrap-project-client APPROVAL_FILE` defaults to dry-run. Input exactly `{approved:true,tenantId,uid,projectIds}` (1–100 IDs). Approved UID must already exist, be enabled/email-verified and Google-linked, matching the existing intended client provider. It verifies actual tenant projects, refuses role injection/conflicting membership and appends an atomic audit. No Auth changes; no real UIDs in Git/examples. Staff do not use this procedure.

`inspect-project-migration TENANT` is bounded READ-ONLY inventory, with no --apply option. It hashes metadata/project/source/head/period/membership evidence and returns counts/blockers without dumping notes/payloads. Refuses >100 documents per inspected collection. No rewriting/deleting/re-publication. Legacy tenant remains blocked from active writes; existing IDs/raw/allocation/audit/publication evidence is intact. The [preparation](project-only-persistence-handoff.md) retains a reviewed migration design, but a live apply migrator is NOT IMPLEMENTED. Fresh isolated synthetic tenants are the local acceptance path.

## Verification and honest status

`security-tests/project-workspace.test.ts` uses actual local Auth/Firestore and the production-bundled ProjectStaffWorkspace component with a test-only entry, signed synthetic Microsoft provider proof and fresh Firebase tokens in memory. No production hook, token storage or live OAuth. It tests secured API ownership/scope/client/revocation/conflicts/audits; browser create/edit/reload/independent sessions/publication/splits/history; 1440/1366/768/390 widths. PR A's separate production-container smoke covers actual root/welcome/secure/query routes. These are complementary tests, not live Microsoft popup or remote persistence proof.

IMPLEMENTED AND TESTED locally/emulators: project-only CRUD and persistent editing, exact-second plans/splits, publication/projection and transaction/idempotency/audit/conflict/revocation safeguards. IMPLEMENTED BUT NOT DEPLOYED: frontend/API/operator tools. BLOCKED BY EXTERNAL ENTITLEMENT OR APPROVAL: Microsoft/provider readiness, effective write-isolation review, approved seed/activation/deployment and cross-session remote persistence. NOT IMPLEMENTED: live migration apply, native Projects/Time/OAuth, ingestion/correction/checkpoint workers, real-data redesign. No production readiness or source connection claim.

Ordered commands/approvals: [project-only operator runbook](project-only-operator-runbook.md). No verification flag is set merely to start the application.
