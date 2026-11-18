# Backend data and authorization contracts

Current PR B behavior: [project-only security/API/path contract](project-only-workspace.md). Active editing is verified Morris corporate policy; approved clients have explicit project IDs, publication-safe projections and no staff privileges. The executable refuses production/default and requires verified named staging. Source edits are not exposed. Two actual bounded-query indexes are now prepared in code; no index/rules deployment occurred. Historical agreement, individual staff-onboarding, future-HTTP and empty-index descriptions below do not describe the active v2 implementation. Live provider/write-isolation/remote-persistence gates remain unverified.

M8 staging supersedes individual staff onboarding below: the trusted Entra/Microsoft policy in server/morris-staff.ts grants request-local application editing/publication to currently enabled corporate Member accounts with the exact morrisinteractive.ca UPN domain. Firebase token verification/revocation, Microsoft signature/issuer/audience/expiry, linked provider OID and current delegated Graph caller/status checks all apply. No staff membership is persisted/read, and legacy administrator/editor records or custom claims cannot grant staging access. Clients still require current scoped client memberships and published projections. The application administrator role label is an internal capability reuse, not cloud/system administration. No deployment, credential, tenant-configuration or bootstrap HTTP route exists. Policy failures/Graph outages stop access, never fall back to domain matching or legacy staff permissions. See [M8 launch/identity requirements](m8-launch.md); live provider configuration remains unverified.

M4 supersedes the offline-only M3 status: FirebaseIdentityVerifier, FirestoreTenantStore and the secured HTTP interface are implemented and emulator-tested, with live activation disabled. See docs/m4-api-and-persistence.md for the current architecture. server/ is outside the browser bundle; tsconfig.server.json checks it separately. MemoryTenantStore is a transactional test double, not a production database adapter. It serializes mutations and rejects failed callbacks atomically. The implemented Firestore adapter uses real transactions; any subsequent adapter must also use transactions with membership and expected-revision reads inside the transaction; it must not store an unbounded whole-tenant snapshot document.

## Tenant document layout

Every path is tenants/{tenantId}/{collection}/{id}. tenantPath validates path segments. TenantDocuments defines the document payload types. Tenant ID is immutable from the URL's server-validated scope, not a mutable request body. A future mapper must validate all incoming persisted data at runtime before writing. M3 commands validate their supported payloads; the document contracts do not claim complete generic CRUD validation.

| Collection | Owner / content | Access path |
| --- | --- | --- |
| memberships | Server-administered opaque subject, approval, enabled flag, role, agreement/project scopes | Trusted server authorization lookup each operation; no browser CRUD |
| agreements / departments / departmentBudgets | Morris hierarchy, monthly cap revisions and allocations | Scoped authorized commands; budgets never add to caps |
| projects | Morris plan, progress, publication; stable IDs | New persistent projects default published=false; create/name/progress/publication commands implemented locally |
| mappings | Product/company envelope + optional agreement or granular project external link | Admin-reviewed explicit mapping; never names |
| rawTime | Product/company envelope + immutable source payload/revision | Future sync identity only; no generic browser/editor update |
| allocationRevisions | Morris splits/descriptions and append-only revisions | Future dedicated authorized allocation command; M2 validation preserves source and exact seconds |
| team / teamAssignments | Morris canonical identities and assignments | Future bounded authorized reads; private contact data kept outside client summaries |
| milestones / statusHistory / blockers / trainingSessions | Morris records using stable project IDs | Future scoped commands; no cloud handlers implemented |
| publications | Approved Morris text/project publication | Explicit privileged publication; client reads only allowlisted approved projection |
| audits | Verified actor, action, entity, timestamp, revision | Append-only with same transaction as material mutation; no audit edit/delete API |
| checkpoints | Per source product/company cursor, revision, time | Future sync worker; advance only with committed bounded batch |

Raw and mapping IDs must be namespaced by product + source company + external ID. sourceRecordId hashes that tuple; identical numeric IDs in Accounting and Time or other companies never collide. External sync must update only owned external fields and record corrections; M2 raw time, allocations, history and scoped projections remain the calculation baseline.

## Authorization boundary

ReportingBackend accepts a bearer header only. A real verifier must validate signature using trusted configured keys/algorithm, issuer, audience, expiry, disabled/revoked account state and session policy; never decode a token without verification. denyAllVerifier remains the offline default; explicit guarded M4 startup selects the Firebase Admin verifier. Retained M3 unit tests inject synthetic identities; M4 additionally tests Admin SDK RSA verification offline and Auth/Firestore emulators. No live provider configuration is verified.

Every method then checks current enabled/approved membership and tenant identity inside the transaction. Administrators can perform tenant-scoped privileged actions; editors can modify name/progress only within assigned agreement/project scopes. Clients read published information within their scope and cannot write. Membership/role changes and raw sync are intentionally not public commands. Client-supplied role/actor/tenant/source/publication fields are rejected by edit allowlists. Reads recheck access rather than trusting a previous session role. A future HTTP layer must extract the Authorization header, bound body sizes, implement CSRF/origin/session/rate controls as appropriate, and map failures to non-sensitive errors.

Create requires valid agreement/department/plan, generates an internal ID and forces unpublished status. Publication is a separate administrator operation with expected revision. Mutation and immutable audit append share the transaction. No-op edits/reads do not persist; conflicts and invalid requests do not publish state. MemoryTenantStore tests verify those semantics; emulator transactions with an eventual production adapter are a later gate.

## Rules and query inventory

firestore.rules denies every get/list/create/update/delete, including authenticated admins, roles in custom claims, nested/orphan collections and published documents. There are no allow exceptions, so no permissive validator/owner helper scaffolding is introduced. Emulator tests compile the actual rules and exercise adversarial paths. The Firebase Admin SDK bypasses these rules, so backend authorization is mandatory independently of rules.

There are zero application Firestore queries in M3; firestore.indexes.json intentionally has no speculative composite indexes or exemptions. Future approved query inventory: server membership exact-document lookup; scoped published summary exact-document read; paginated projects under tenant+agreement with page size <=50 and deterministic cursor; raw time by source/date only for server sync. Add/review specific composite indexes when those actual query shapes exist. No full database load, no navigation reload, no listeners or background jobs. Scope auth caches by subject+tenant+membership revision; invalidate on revocation; do not cache failure as success.

Synthetic read/write metrics: MemoryTenantStore counts committed mutations. Reads/no-op edits=0 writes; material command=1 synthetic transaction with one new audit. These are not Firestore document-cost measurements. Production implementation must instrument documents read/written, bytes, latency/retries and index fan-out without logging content or credentials.

Persisted cap history has an explicit agreementCapRevisions document contract (agreementId + month/revision payload), and training-session documents carry projectId. The M2 in-memory arrays are compatibility inputs to the local test adapter; future document mapping must separate growing history/audits into immutable paginated documents rather than copying those arrays into a tenant root document.
