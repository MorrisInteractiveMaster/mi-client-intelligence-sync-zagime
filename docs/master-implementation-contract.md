# MORRIS INTERACTIVE — ZAGIMĒ CLIENT INTELLIGENCE PLATFORM
## Master Implementation Contract: Project-Centric Data, Live Staging and QuickBooks Integrations

Owner instruction received 18 November 2026. Full business/execution contract below, normalized from chat Markdown. This supersedes conflicting historical agreement-centric requirements and customer/subcustomer integration proposals. Recording a requirement does not establish that it is implemented, deployed or verified. Phase status and concrete PR B preparation: [project-only persistence handoff](project-only-persistence-handoff.md). PR A implementation/evidence/operator steps: [staging render repair](staging-render-repair.md).

**ROLE:** You are the senior full-stack implementation engineer, database architect, integration engineer, security engineer and testing lead.

**REPOSITORY:** `MorrisInteractiveMaster/mi-client-intelligence-sync-zagime`

**OBJECTIVE:** Deliver a functional, secure, persistent Zagimē Client Intelligence Dashboard backed by verified project records from QuickBooks Online and relevant time records from QuickBooks Time. Morris staff must be able to manage progress, time allocation, project updates and publication. Clients must see only authorized, published information.

This is an IMPLEMENTATION assignment, not a planning-only assignment.

Do not produce another abstract architecture document without working code, tests and focused PRs.

---

# 1. EXISTING PROJECT — DO NOT RECREATE INFRASTRUCTURE

Use the latest merged `main` branch. Inspect existing PRs before making changes and preserve work already completed.

**Google Cloud:**
- Project: `morris-client-dash-zagime`
- Region: `northamerica-northeast1`
- Firestore staging database: `mi-client-staging`
- Firestore staging UID: `6d09ea71-f495-44a5-94a6-732ed1c47d88`
- Cloud Run service: `mi-client-staging-dashboard`
- Runtime service account: `mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com`
- Artifact Registry repository: `mi-client-build`
- Existing Cloud Run revision: `mi-client-staging-dashboard-00001-b4d`

**Existing staging URL:**

`https://mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app`

**Existing verified container image:**

`northamerica-northeast1-docker.pkg.dev/morris-client-dash-zagime/mi-client-build/mi-client-staging@sha256:f970e140a6acda803f90409edf1b1b78519cb9cea554c757044ae76edc932b67`

**Verified operational facts:**
- Cloud Run service is deployed.
- `/` and `/health` return HTTP 200.
- `/healthz` returns HTTP 404 at the Cloud Run endpoint; use `/health` for smoke tests.
- Inactive protected APIs return HTTP 503.
- The runtime identity-check job executed successfully.
- Named staging Firestore rules are published as deny-all.
- Direct Firestore IAM grants are restricted to the named staging database.
- Microsoft/Firebase provider readiness and end-to-end authentication remain unverified.
- Production Firestore `(default)` must never be accessed for this project.
- Original Cloud Build failed before execution; a direct Docker build in Cloud Shell worked.

**DO NOT:**
- Create another Firebase or Google Cloud project.
- Create another Firestore database.
- Recreate existing service accounts, buckets or registry.
- Switch to production `(default)` Firestore.
- Introduce broad IAM roles.
- Automatically deploy or activate live data processing.
- Restart Cloud Build troubleshooting.
- Claim live data is connected without actual evidence.

---

# 2. NON-NEGOTIABLE BUSINESS REQUIREMENTS

This product is a **project-centric client intelligence platform**.

It is NOT an agreement-management system.

### QuickBooks Online Accounting

Fetch ONLY native QuickBooks projects belonging to Zagimē Anishinabēk.

Do not import, store or expose:
- Agreements or contracts
- General customer records
- Invoices or payments
- Billing and accounting balances
- Unrelated customer projects
- Unrelated financial transactions
- General company accounting information

Use a verified QuickBooks company/realm identifier and strict Zagimē project scope.

Source filtering must be enforced server-side wherever the official API supports it.

If the supported API requires reading unrelated project data to identify Zagimē projects, do not silently perform a company-wide import. Document the limitation and stop that integration path for approval.

Never identify Zagimē projects based solely on a name containing "Zagimē". Use verified stable identifiers and documented source relationships.

### QuickBooks Time

Only relevant time records associated with verified Zagimē projects may enter this platform.

Preserve:
- Stable source record ID
- Source company/account identifier
- Source person reference, only where needed for authorized attribution
- Project/jobcode association
- Work date
- Duration in integer seconds
- Modification timestamp or revision
- Approval state, including unknown/pending
- Deleted/voided/corrected status

Avoid unrelated time records, payroll, compensation, rates, billing or other clients.

QuickBooks Time is a separate integration. Do not assume QuickBooks Accounting OAuth automatically authorizes Time.

### Morris-managed information

Morris employees manage:
- Project progress
- Project status
- Project plans and target hours
- Project descriptions and internal notes
- Project updates and client communication
- Allocation of recorded hours to delivery projects
- Publication/visibility controls
- Team assignments where needed
- Audit history

These fields must not be overwritten by QuickBooks synchronization.

### Client access

Zagimē users see only published project information and approved summary metrics.

They cannot view internal notes, unpublished records, raw source payloads, OAuth administration, unpublished hours or other clients' information.

---

# 3. IMMEDIATE FRONTEND DEFECT — FIX BEFORE ACTIVATION

Browser reports:
- CSS and JavaScript bundles return HTTP 403.
- Stylesheet requests receive JSON rather than CSS.
- The dashboard displays a blank white screen.
- Favicon request returns HTTP 503.

Source review identified this likely cause:

`server/http.ts` performs an Origin check before `serveFrontend()`.

In inactive preview, `options.allowedOrigin` is undefined, potentially rejecting asset requests that contain an Origin header.

**Required implementation:**
1. Reproduce the error in a production-built container and real browser.
2. Inspect the actual Origin headers and error responses.
3. Fix the static asset routing without weakening API authentication.
4. Ensure GET/HEAD for approved same-origin assets serves the correct content type.
5. Ensure missing assets return appropriate 404 responses.
6. Preserve traversal protection, CSP, authentication and API access restrictions.
7. Confirm `/#/secure` and `?utm_source=chatgpt.com#/secure` both render.
8. Add automated browser smoke tests; checking only HTML 200 is insufficient.
9. Provide an understandable application error state instead of an unhandled blank screen.

**Acceptance tests:**
- JavaScript loads with correct MIME type.
- CSS loads with `text/css`.
- No uncaught JavaScript runtime errors.
- Secure sign-in controls appear.
- Inactive APIs remain HTTP 503.
- No staging Firestore read or write occurs in inactive mode.
- Cross-origin and unauthorized API requests remain denied.

Complete this as the first focused PR. Preserve existing frontend design during the repair.

---

# 4. PROJECT-CENTRIC FIRESTORE SCHEMA

Review current files:
- `server/contracts.ts`
- `server/firestore-store.ts`
- `server/staff-read.ts`
- `server/backend.ts`
- `server/authorization.ts`
- `server/synthetic-seed.ts`
- `server/database-target.ts`
- `server/integrations.ts`
- `src/api/StaffWorkspace.tsx`
- `src/api/SecureDashboard.tsx`
- `src/api/types.ts`
- `docs/source-of-truth.md`
- Existing migration and test files

The current implementation contains agreement-centric dependencies. These must not remain mandatory in the new active project workflow.

**Target logical data model:**

`tenants/{tenantId}`

Within the tenant, maintain these logical entities:

**projects**
- Internal immutable ID
- QBO external project ID
- QBO company/realm ID
- Source revision/timestamp
- Source-controlled project fields verified as available
- Morris-managed status and progress
- Morris-managed description and notes
- Morris-managed plan
- Publication state
- Creation/update metadata

**sourceTime**
- Immutable external source identity
- Source revision and modification history
- Relevant project reference
- Integer-second duration
- Approval state
- Deletion/correction status
- Reconciliation metadata

**allocations**
- Internal project association
- Source time reference
- Allocated seconds
- Revision/history
- Actor and timestamp

**projectViews**
- Server-derived approved projections
- Publication state
- Client-safe metrics

**projectPeriods**
- Period-specific calculated totals
- Allocated/unallocated values
- Recalculation version

**sourceMappings**
- Explicit QBO/Time-to-Morris mappings
- Stable source namespace and company IDs
- Verification status
- No fuzzy-name matching

**integrationConnections**
- Provider and product identifier
- Company/realm reference
- Connection status
- Opaque credential references
- Last verified/sync status

**syncCheckpoints**
- Separate Accounting and Time checkpoints
- Cursor/window
- Revision
- Last successful completed batch

**audits**
- Actor
- Action
- Target
- Revision
- Timestamp

**memberships**
- Approved client authorization only
- No browser-controlled role elevation

This is the TARGET LOGICAL MODEL, not permission to create collections blindly. Reconcile it against existing production-tested structures, identify exact document paths, indexes, read/write costs and required migration steps.

Do not create agreement collections or agreement-based reporting requirements.

Do not delete existing staging data automatically. Preserve legacy records for controlled migration and audit.

**Schema acceptance:**
- All active workflows operate without agreements.
- QBO project IDs remain immutable.
- Morris edits survive synchronization.
- Source corrections preserve history.
- Repeated sync creates no duplicate projects.
- Client projections contain no unauthorized fields.
- Every data operation explicitly targets `mi-client-staging`.
- No `(default)` fallback is possible.

---

# 5. QUICKBOOKS ACCOUNTING — PROJECTS ONLY

Implement a separately testable read-only QBO project integration.

First verify official Intuit documentation and the actual existing app's permissions.

Check:
- Current Canadian availability
- Native Projects API entitlement
- Partner tier requirements
- `project-management.project` permission availability
- Whether the Accounting scope is additionally required
- Supported list/read operations
- Exact query and pagination semantics
- Project/customer relationship identifiers required to limit Zagimē scope
- Update and deletion detection
- Sandbox availability
- Rate limits and applicable API charges

Do not invent API endpoints or GraphQL fields.

The native Projects API may require premium access. If the app lacks it, clearly report the blocker and owner-approved alternatives. Do not buy an upgrade, use unsupported scraping or silently substitute customer/subcustomer lists.

Implement:
- Provider-specific server-side connector
- Strict Zagimē project scope
- Stable source ID mappings
- Minimal project fields
- Pagination
- Rate limiting and bounded retry
- Idempotent upsert
- Change/deletion handling
- Checkpoint persistence after committed batches
- Connection status and sync diagnostics

No API methods that modify QuickBooks.

No live company authorization until explicitly approved.

---

# 6. QUICKBOOKS TIME — RELEVANT HOURS ONLY

Research the currently supported Time API for the existing Canadian QuickBooks account.

Confirm whether the available integration uses:
- Legacy QuickBooks Time/TSheets API
- QuickBooks Online TimeActivity
- Newer approved Payroll/Time APIs

Do not assume these are equivalent.

Required capabilities must be verified against the actual approved product:
- Current timesheet visibility
- Unapproved and pending hours
- Approved hours
- Ongoing records where available
- Corrections/amendments
- Deleted time
- User/jobcode associations
- Stable identifiers
- Incremental reads and pagination
- Timezone semantics

If the API cannot supply required operational states, identify the missing capability explicitly. Never label unknown time as approved.

The connector must import only records reliably associated with verified Zagimē projects.

Preserve original duration and source identity. Morris allocations must never alter source records or write back to QuickBooks.

Implement independent product-level checkpoint and failure handling.

---

# 7. OAUTH AND CREDENTIAL SECURITY

Use the existing Cloud Run service as the HTTPS callback host.

Implement backend OAuth endpoints with clearly defined paths.

Do not register an arbitrary callback URI before code exists.

Requirements:
- Exact Intuit-registered HTTPS redirect URI
- Server-side authorization-code exchange
- One-use, short-lived, cryptographically protected state
- State bound to the verified initiating system administrator, tenant, product and connection attempt
- CSRF/replay protection
- Separate Accounting and Time authorization handling
- Correct state expiry and token rotation
- Secure, bounded refresh-token handling
- Concurrency-safe refresh leases
- Revocation and reconnect handling
- No credentials, access tokens or refresh tokens in browser storage, URLs, Firestore document bodies, logs or Git

Use regionally stored secrets in `northamerica-northeast1`, subject to an approved Secret Manager setup and least-privilege runtime authorization.

Do not create secrets, modify IAM or authorize real companies without owner approval.

Provide the exact callback URI only after the backend route is implemented and tested.

---

# 8. MICROSOFT AUTHENTICATION AND PERSISTENT EDITING

The current operator's Firebase admin API reads returned HTTP 403. Do not interpret this as proof that Microsoft sign-in is disabled.

Verify the existing Firebase/Entra configuration using approved read access or owner-provided console evidence.

Requirements:
- Verified Microsoft work identity
- Exact authorized tenant
- Provider-linked identity checks
- Current enabled employee state
- No authorization by email string alone
- No Google-to-Microsoft privilege escalation
- No unapproved user bootstrap
- No shared Auth-user deletion or modification for testing

Staging data access must remain server controlled.

Once the required security reviews are independently approved:
1. Seed an isolated synthetic tenant without overwriting existing data.
2. Sign in as an approved Morris test employee.
3. Create or edit a synthetic project.
4. Save and refresh.
5. Reauthenticate in another session.
6. Verify the saved data persists.
7. Test concurrent edits and revision conflicts.
8. Verify audit history.
9. Verify unauthorized client edits fail.
10. Verify only published data appears in the client view.

Do not set verification flags merely to make startup succeed.

The approved named-database IAM condition and deny-all browser rules must remain enforced.

---

# 9. RECONCILIATION AND DATA OWNERSHIP

Clearly separate fields by owner.

**QBO-owned:**
- External project identity
- Verified project metadata

**Time-owned:**
- Source timesheet identity
- Source dates and duration
- Source revisions/corrections
- Approval state where verifiable

**Morris-owned:**
- Internal status
- Progress
- Plans
- Descriptions
- Notes
- Time allocations
- Publication decisions

**Calculated:**
- Monthly hours
- Lifetime hours
- Unallocated hours
- Project progress summaries
- Forecast calculations

Never let synchronization overwrite Morris-owned data.

Preserve historical revisions and maintain deterministic reconciliation.

Test duplicates, missing mappings, partial failures, stale updates, changed project names, deleted source records, and interrupted syncs.

If a project is removed or inaccessible in QuickBooks, mark its source status for review rather than automatically deleting Morris data.

---

# 10. DASHBOARD FUNCTIONAL REQUIREMENTS

Build around real projects, not agreement hierarchies.

**Morris internal workspace:**
- Project list
- Project detail
- Status and progress editing
- Project plan and targets
- Time review
- Unallocated-hours review
- Allocation editing
- Publication controls
- Audit history
- Integration health/status
- Last successful sync
- Errors requiring manual review

**Zagimē client dashboard:**
- Approved projects
- Published progress
- Approved descriptions/updates
- Authorized aggregated hours
- Client-safe project summaries

A client cannot infer internal-only records through counts, search, API parameters or raw payloads.

No live client data should appear in legacy browser-local demo interfaces.

Retain a clearly labelled synthetic preview until real integration authorization is complete.

---

# 11. DESIGN REQUIREMENTS

Do not spend the initial implementation phase redesigning hypothetical reports.

After project data and persistent editing work, redesign using the existing approved Zagimē/Morris visual references.

The final interface must be:
- Premium and professional
- Responsive for desktop and mobile
- Clean, modern and spacious
- Consistent with the established Nordic Minimal/Dots direction
- Easy for Morris employees to edit
- Easy for Zagimē leadership to understand
- Accessible by keyboard and screen reader
- Clear about source freshness and verification
- Free of legacy agreement-related navigation

Prioritize usability and actual data quality over decorative animations.

---

# 12. REQUIRED AUTOMATED TESTS

Tests must cover:

**Frontend**
- Real-browser JavaScript execution
- Static assets and MIME types
- Secure route rendering
- Browser navigation
- Blank-screen regression
- Accessible loading/error states

**Security**
- Tenant isolation
- Named database selection
- No default database fallback
- Deny-all browser access
- Server-side authorization
- Role/identity checks
- Client publication boundaries

**Persistence**
- Create/edit/reload
- Idempotency
- Revision conflict
- Audit integrity
- No-op writes
- Source ownership protection

**Accounting**
- Zagimē-only project filtering
- No unrelated customer/project import
- Pagination
- Stable IDs
- Corrections and deletions
- Restart/checkpoint recovery
- No QuickBooks writes

**Time**
- Only verified relevant time
- Pending/approved/unknown states
- Integer duration precision
- Deletions
- Amendments
- Unallocated hours
- Reconciliation
- No QuickBooks writes

**OAuth**
- Exact redirect URI
- State validation and replay rejection
- Token rotation
- Invalid/expired grants
- Tenant/product binding
- Log redaction

Tests must use synthetic fixtures, mocks and authorized sandbox resources. Do not substitute synthetic test success for proof that live Intuit endpoints or permissions work.

---

# 13. IMPLEMENTATION ORDER — REQUIRED

Implement in the following order. Do not open one enormous PR that combines unrelated infrastructure, data migrations, OAuth and UI changes.

**PR A — Immediate frontend repair**
- Fix blank screen and asset handling.
- Add real-browser tests.
- Prove inactive deployment behavior remains safe.
- Supply exact commands to update the existing Cloud Run service.
- No automatic deployment.

**PR B — Project-only database and persistent editing**
- Remove mandatory agreement dependency from active workflows.
- Introduce project-centric contracts and safe migration strategy.
- Preserve existing data and audit history.
- Add complete emulator/security tests.
- Prove synthetic persistence in the approved environment before claiming completion.

**PR C — QuickBooks Accounting projects**
- Verify Projects API entitlement.
- Implement project-only adapter and strict tenant/project filtering.
- Implement secure OAuth framework and checkpoint/reconciliation behavior.
- Prove sandbox project read where authorized.
- No live connection without approval.

**PR D — QuickBooks Time**
- Verify supported API and operational time capabilities.
- Implement separate read-only adapter.
- Map only verified Zagimē time records.
- Test corrections, pending hours, deletions and allocation reconciliation.
- No live connection without approval.

**PR E — Data-driven redesign**
- Replace legacy agreement-centric UI.
- Deliver editable Morris workspace and published Zagimē client experience.
- Use verified operational data and appropriate loading/empty/error states.

After each PR, report the exact HEAD SHA, changed files, tests, remaining blockers and merge/deployment instructions.

Do not assume a prior PR is merged. Refresh `main` and inspect current branch status before starting subsequent work.

---

# 14. COMPLETION AND HONEST REPORTING

Every phase must conclude with:
1. Implemented code changes
2. Exact changed files
3. Automated tests and results
4. Security impact
5. Database/migration impact
6. External dependencies or approvals
7. Exact commit SHA and PR link
8. Exact deployment commands when approved
9. Verified functionality versus functionality still untested

Use these classifications:
- **IMPLEMENTED AND TESTED**
- **IMPLEMENTED BUT NOT DEPLOYED**
- **DEPLOYED AND VERIFIED**
- **BLOCKED BY EXTERNAL ENTITLEMENT OR APPROVAL**
- **NOT IMPLEMENTED**

Do not declare functionality complete because interfaces, fixtures, mocks or documentation exist.

Do not claim successful QuickBooks integration without actual authorized source responses.

Do not claim remote persistence without a successful cross-session remote database test.

Do not claim production readiness without approved authentication, security, integration and operational verification.

**START NOW:** Inspect latest main and the existing frontend repair work. Complete PR A first. Then prepare PR B using this exact business contract. Preserve the full contract for the later connector phases.

No vague plans, no speculative infrastructure, no unapproved cloud changes and no silent requirement substitutions.
