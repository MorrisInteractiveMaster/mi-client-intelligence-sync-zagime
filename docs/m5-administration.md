# M5 secured Morris administration

Base: verified main `615ae61a510ed496d79364751ef662a081a88187`, PR #4 merged. Branch `codex/m5-secure-morris-administration`. No live configuration, user, credential, data or infrastructure changes.

## Implemented experience

The default synthetic Nordic Minimal dashboard and Dots renderer remain separate and unchanged. The disabled-by-default `/secure` workspace uses in-memory Firebase Authentication and the real secured API. It now renders assigned private/published projects for staff, project creation without a work order, name/plan/progress editing, optional reporting-only work-order references, administrator publication/unpublication, month-specific and lifetime effort, bounded source-time pages, unallocated/conflicting hours, split allocation and revision history. Clients receive only the published report; they never invoke staff source/history routes. No localStorage persistence or browser Firestore calls are introduced.

One lightweight membership/hierarchy bootstrap is cached in component memory per verified session. Project pages load per month or explicit refresh. Source time loads only on first opening allocation for that month. Cosmetic tab changes reuse data; history loads only on demand. Writes invalidate staff pages; month/identity changes discard stale read responses. Failed or revoked requests are never cached as successful; authorization failures clear the staff component. No polling/listeners or automatic write retries. Read cache lasts only until explicit refresh, write, month change, sign-out or page close. Server membership is rechecked on every API operation even if the cached UI still shows an action.

## Routes and permissions

All routes below retain Firebase signature/audience/expiry/revocation checks and current membership authorization in the same Firestore transaction as data access. No user/role authority is accepted from browser JSON or token custom role claims.

| Route | Contract |
| --- | --- |
| GET `/workspace` | Role/capability and bounded authorized hierarchy; clients receive no staff hierarchy. At most 100 agreements, 100 budget records, 100 referenced departments; hard failure above capacity. |
| GET `/projects?month=YYYY-MM&limit=20&cursor=ID[&agreementId=ID]` | Staff only; up to 25 candidate projects per page, scoped authorization, sanitized project metadata and exact month/lifetime counters. |
| GET `/sources?month=YYYY-MM&limit=20&cursor=ID` | Staff only; bounded candidate scan by document ID, month filtering and complete-entry authorization before response. Empty pages may have a continuation. No claim of a global count or all-source total. |
| GET `/sources/ID/history?month=YYYY-MM&limit=20&cursor=REVISION` | Staff only; source/head authorization, up to 25 exact revision-document reads, descending sequence. Editors cannot read historical revisions involving unauthorized projects. |
| POST `/projects` | Requires timestamped UUIDv4 `Idempotency-Key`; actor and tenant scoped, server-generated project identity, always private. |
| PATCH `/projects/ID` | `expectedRevision`, allowlisted `patch`: name, progress, plan, optional workOrderReference. No hierarchy move or external mapping mutation. |
| PATCH `/projects/ID/publication` | Administrator only, explicit boolean + current revision. |
| PATCH `/allocations/ID` | Current revision, at most ten unique project portions; exact seconds and over-allocation checks. Raw source remains unchanged. |

Paths are relative to `/api/tenants/{tenant}`. Limit/cursor/month/query keys and JSON fields are bounded/validated. Project/source pages read `limit+1` candidates and expose only an authorized subset; cursors identify the last candidate scanned, not an unbounded offset. There can be empty authorized pages, and the UI offers continuation. A cursor conveys no authority. The UI refuses to append pages with a different tenant revision and requires refresh rather than silently mixing snapshots. Single-field project agreement filtering + document-ID order uses existing indexes; no index/rule deployment is introduced.

Editors with explicit project IDs can edit only those projects and cannot create projects outside that list. Editors with `all-authorized-agreements` may create privately inside their approved agreement. Source access requires every applied and intended project to be authorized; unassigned entries are administrator-only. History is checked against both current source access and each revision's targets. Staff reads do not fetch internal notes or source identities unnecessarily. Client projections explicitly exclude work-order references, raw source identities, descriptions, notes, histories and private projects.

Source revision mismatch returns `409 source_conflict` and requires trusted source reconciliation. Intended/applied split differences are visible as conflicts and may be explicitly repaired against the same source revision. Allocation deltas use the applied baseline, preserve previous month contributions and update period/lifetime summaries, head, immutable revision and verified-actor audit atomically. No-op saves perform zero writes. `409 revision_conflict` requires refresh and review; draft inputs are not silently overwritten into a newer version. Failure inside a transaction leaves no partial business state or audit.

## Idempotency lifecycle

Header format: `13-digit UNIX milliseconds` + `-` + random UUIDv4. The server accepts keys issued within the previous 24 hours (up to five minutes future skew). It hashes authenticated UID + operation + key inside the tenant's `idempotency` collection and hashes a canonical normalized payload. Creation, result record, audit and revision commit atomically. Identical concurrent/retried submissions return the original private creation result without writes. Conflicting payload reuse returns `409 idempotency_conflict`. Replay still requires current approved staff membership and creation scope. The stored creation result is the original result, not a claim that later edits have not occurred.

Records receive `expiresAt` 30 days after creation. No TTL policy, scheduler or resource is enabled. Operator `prune-idempotency` defaults to a dry run and removes at most 100 expired records per transaction; each changed batch appends a maintenance audit. Business audits and allocation history are retained. An expired key cannot become a fresh operation after cleanup because the 24-hour acceptance window is checked first. This bounds record retention after approved maintenance, not an unbounded automatic growth guarantee when maintenance is never run. A flood is further bounded by application/approved edge rate limits.

The form holds the exact key/payload in memory after an uncertain response and offers an identical retry; simultaneous clicks are locked. It never retries automatically. Reloading loses that in-memory retry context: inspect existing projects before making a new request. Expired keys require reconciliation, not generating a replacement blindly. Production-grade offline draft recovery remains outside this milestone.

## First administrator

`server/operator.ts` is a separate process, never an HTTP route. See the runbook. Explicit reviewed approval file includes approved UID, provider ID + provider subject, tenant, administrator role and review reference. The tool reads the existing Firebase user and refuses unknown, disabled, unverified or mismatched provider identities. It never creates a user. Dry run verifies Auth and Firestore state without writing. First-admin marker, membership, tenant revision and audit commit together. Concurrent attempts create one membership/audit; identical rerun is a no-op. Any existing administrator/target membership or different bootstrap identity is refused. Revoking the membership leaves the permanent marker locked; bootstrap cannot re-enable it.

The local file is a trusted operator-controlled approval artifact, not a public approval protocol. Protect it outside Git, obtain independent review and restrict the operator identity. Audit actor is honestly recorded as `operator-bootstrap` with approval reference, rather than claiming an unverified Firebase operator UID. Correlate with approved execution/IAM audit evidence; no downloaded account keys. Auth identity and Firestore membership cannot be one cross-service transaction; recheck identity immediately before apply and smoke-test revocation afterward.

## Capacity and operation budgets

| Operation | Reads/writes per attempt (excluding SDK Auth verification and transaction retries) |
| --- | --- |
| Project page | 2 root/membership + at most 26 candidate projects + 25 views + 25 periods = at most 78 document reads. |
| Source page | 2 + at most 26 candidates + 25 heads + up to 500 target checks = at most 553 reads; actual scope checks are per candidate and bounded to ten portions. No raw read on initial project view. |
| History page | 2 + source/head + up to 20 current-target checks + 25 revisions + up to 250 historical target checks = at most 299 reads. |
| Create | 5 writes: project, sanitized view, idempotency result, verified audit, tenant revision. Replay: root/membership/idempotency reads; zero writes. |
| Edit/publication | 4 material writes; no-op 0. Metadata reads are targeted, with existing 100-record cap/budget guards. |
| Allocation | `4 + 2N` writes for N affected projects (at most 20 old/new targets); no-op 0. |
| Cleanup | Up to 100 deletes + audit/root writes; empty batch 0. |

These are code-derived bounds, not live billing measurements. Browser evidence records zero extra calls for cosmetic staff tab changes. Emulator tests verify no-op revisions/audits unchanged and raw/history preservation. Root revision remains a conservative tenant-wide concurrency hotspot; high throughput, aggregate report pagination (M4 still hard-fails above 100), bounded hierarchy growth and distributed rate limiting require further production work. No scheduler/background job or ongoing cloud cost was introduced.
