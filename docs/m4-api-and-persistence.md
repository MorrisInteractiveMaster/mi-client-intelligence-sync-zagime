# M4 API and persistence architecture

## Verified identity and permission boundaries

FirebaseIdentityVerifier calls the official Admin SDK verifyIdToken(token, true). Production SDK validates Google RS256 signatures, issuer, audience and expiry; true enables disabled/revoked-account checks. The existing backend rechecks approved/enabled membership inside each Firestore transaction and enforces tenant, agreement/project scope and field/publication permissions. It ignores custom role claims for authorization. No browser-provided user/role/actor is accepted. No self-registration, membership or role-change API is provided.

The production runtime defaults disabled. Emulator startup requires the demo project and exact loopback hosts. Production requires the confirmed project, explicit live/rules-verification flags, no emulator host variables, and attached service identity/ADC rather than a JSON key file. No live startup was performed. Test-only fixture public-key/account responses exercise the real SDK RSA verification implementation offline; emulator tests exercise real local Auth/Firestore integration but do not prove production provider configuration.

## Firestore document layout and transactions

Tenant root stores only name and revision; it does not contain growing project/source/audit arrays. Existing M3 TenantStore is extended with a targeted transaction plan. FirestoreTenantStore reads current membership, root revision, the specific project and relevant agreement/department budget/cap records. Material project mutation, sanitized view metadata, revision and verified-actor audit commit together. New projects always start unpublished. Generic interactive mutation explicitly rejects any change to loaded source/allocations/memberships/checkpoints or other protected state.

Collections under tenants/{tenantId}:
- agreements / departments / departmentBudgets / agreementCapRevisions: stable hierarchy and monthly allocations/revisions.
- projects: internal project metadata/notes; never read directly by the browser.
- projectViews: sanitized approved-view metadata and lifetimeSeconds; no source IDs or internal notes. Publication toggles this view atomically.
- projectPeriods: exact monthly delivered seconds per project, addressed by SHA-256 tuple key(month, projectId).
- rawTime: source product/company envelope with immutable raw record.
- allocationHeads: latest revision/portions and appliedPortions for each source entry, bounded to 10 portions for interactive edits.
- allocationRevisions: immutable documents keyed by source/revision; retained after edits.
- memberships: server-controlled, addressed by hashed subject; no public CRUD.
- audits: immutable generated document per material action; actor from verified token, time from server, revision from transaction.
Other M3 contracts remain; no source synchronization or checkpoint-writing HTTP route exists.

Published reads do not load raw time, allocation history, contact PII or internal notes. They use membership + sanitized views + selected-month counters + budget metadata. Agreement/project permissions and publication are applied server-side. Monthly totals sum project portions once; lifetime counters remain separate from monthly counters and plans/caps are never summed into an extra cap. Transactional reporting allocations update head/revision, affected monthly/lifetime counters, audit and root revision without changing raw time. Reassigning an entry changes only its month and target contributions. Client users cannot allocate. Editors must be authorized for both previous and new projects; unassigned raw entries require administrator allocation.

Collection reads are capped at 101 documents and fail closed if more than 100 exist in a read slice. This is a conservative pilot capacity bound, not pagination or infinite-scale support; larger portfolios/history require an approved paginated or cached-summary redesign before rollout. No silent truncation. No listeners/full raw reload on navigation. Read/no-op actions generate no database writes. Transactions retry at most three times. Root tenant revision is a deliberate conservative concurrency boundary and may become a hot document at scale.

Projection invariant: future import/correction workers must update raw revisions, valid appliedPortions, monthly/lifetime summaries and checkpoints atomically, and quarantine conflicting corrected allocations. No such worker is active. For now only the synthetic emulator fixture seeds normalized source/history and matching derived counters; no generic browser import or live migration is provided. Do not hand-edit raw or derived counters independently. Raw records/history persist as separate documents and the interactive APIs never alter raw values.

## HTTP contract

All data routes require Authorization: Bearer <Firebase ID token>. No cookies or browser-supplied role/UID is used. Routes:
- GET /api/tenants/{id}/report?month=YYYY-MM[&agreementId=...]: approved publication only, monthly/lifetime totals and current revision.
- POST /api/tenants/{id}/projects: exact name/agreementId/departmentId/plan fields, server ID and unpublished defaults.
- PATCH /api/tenants/{id}/projects/{id}: expectedRevision + patch (name/progress only).
- PATCH /api/tenants/{id}/projects/{id}/publication: expectedRevision + published boolean; administrator only.
- PATCH /api/tenants/{id}/allocations/{sourceId}: expectedRevision + bounded portions; authorized Morris users only.
- GET /healthz: non-sensitive readiness, no tenant data.

JSON body limit 16 KiB, URL limit 2048 characters, bounded IDs, explicit allowlisted fields/content type and reporting-period validation. Exact configured Origin allowlist (no credentials/wildcard), no-store responses, and controlled 400/401/403/409/413/429/503 errors. No token/body/detail logging. Request/header timeouts configured at runtime. A 60-request/minute per socket-IP per-instance limiter bounds 10,000 buckets and does not trust X-Forwarded-For. Behind a proxy multiple users may share a bucket; with multiple instances it is not a global quota. Template caps instances at one, but owner must review edge/central rate limiting and proxy topology before production.

The client does not automatically retry writes. Create is not an idempotent retry API; after an ambiguous transport failure, reconcile with an administrator before resubmitting creation. Revisioned edits/allocations reject stale writes. A future create idempotency key is recommended before high-reliability production write UX.

## React integration

Existing synthetic demo remains the default. Optional /#/secure workspace is compiled behind VITE_ENABLE_SECURE_API=false by default. It uses Firebase client Auth with in-memory persistence and Google/Microsoft sign-in, then calls the secured API with a fresh ID token. No browser Firestore SDK calls, role flags, OAuth secrets or token storage. It displays published reporting and controlled loading/denial/empty/error states; protected write administration is currently HTTP-only. Demo role switching never changes protected permissions. Missing/invalid configuration fails closed. Sign-out clears displayed data; requests are aborted/discarded on identity/month changes.

No rules exceptions or deployment are added. firestore.indexes.json stays empty because implemented queries use exact document reads or single/equality-filter merging; add reviewed composites only when actual new query shapes require them.

Firebase Auth multi-tenancy is not configured in this foundation: tokens carrying a firebase.tenant claim are rejected to avoid UID collisions across separate Auth tenants. Platform tenant scope continues to come exclusively from approved server membership for the verified project-level UID.
