# Secure named staging in the existing Firebase project

Verified starting main: `ad4c2cfddc0d3d879c093885e6d2d910d4baf4a2` (PR #5 merged). Branch: `codex/same-project-named-staging`. This owner-directed change supersedes M5's unconditional same-project staging refusal. It does not approve production access or any cloud mutation.

| Boundary | Production | Synthetic staging |
| --- | --- | --- |
| Firebase project | morris-client-dash-zagime | Same project |
| Firestore database | (default) | Explicit mi-client-staging |
| Region | northamerica-northeast1 | Must verify northamerica-northeast1 |
| Auth identities | Shared Firebase Authentication | Same identity namespace, separate approved memberships |
| Tenant records, roles, audits, bootstrap markers, allocation history | Production database only | Named staging database only |
| Data IAM | Existing policies unchanged | New dedicated identities and database-conditional grants require separate owner approval |

Names/region are owner-provided targets; no live metadata, UID, policies or deployed rules were inspected in this coding task. Staging Standard/Native edition and its actual UUID4 must be verified, never guessed. A missing/mismatched database blocks startup; code never creates one.

## Fail-closed runtime

`databaseTarget` centralizes mode/project/database validation. Live staging requires matching explicit `STAGING_FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID=mi-client-staging`, actual `STAGING_DATABASE_UID`, `ENABLE_SYNTHETIC_STAGING=true`, `ENABLE_LIVE_FIREBASE=true`, `FIRESTORE_RULES_VERIFIED=true` and `STAGING_IAM_VERIFIED=true`. All flags remain off/unset in committed examples. Credential key-file/emulator environment variables are refused in live modes. Production rejects named-database settings and leftover staging activation settings; its database remains `(default)`.

Staging can use the company project only under these guards. The same explicit named-database requirements also apply if a separately approved alternative project is used later; no project has been invented or provisioned.

`firebaseRuntime` does not create a Firestore client for live staging until `await runtime.verify()` passes. Its `db` getter throws before verification. Verification makes one bounded, read-only regional metadata GET and checks exact resource name, immutable UID, location, Standard edition and Firestore Native mode. A permission error, missing DB, wrong metadata, redirect, timeout or failed credentials rejects the cached verification promise. No automatic retry or default fallback. API startup waits before constructing the backend/listening; operators wait before account lookups or data operations. A changed/recreated staging UID requires new independent approval/configuration.

Metadata verification is not independent rules/IAM certification. `STAGING_IAM_VERIFIED` and `FIRESTORE_RULES_VERIFIED` are explicit operator attestations after the runbook gates. The runtime never probes production as an automatic health/startup operation. The separate, explicitly invoked read-only IAM probe is the only new code intentionally attempting production reads; it expects denial and never writes anything.

The selected SDK client is registered as a verified runtime handle. Every exported bootstrap/seed/retention function independently refuses `(default)`, unregistered handles and non-staging live modes before any RPC. Emulator operators also require the explicit named DB and guarded demo hosts. Legacy regression tests may use demo `(default)` only; this is never a live staging fallback. Cleanup procedures are pinned to the named DB and cannot delete shared Auth users as an implicit cleanup action.

## Shared identity, separate authority

Token issuer/audience remain the existing Firebase project, including signature, expiry, disabled-user and revocation checks. No provider, user or token configuration changes occur. The same UID can have different roles, or no membership at all, in each database. Every API transaction reads current approved/enabled membership from the selected named DB. There is no production membership lookup, copy, fallback or browser role authority. First staging admin bootstrap creates only a staging membership/marker/audit after independently verified provider identity approval. It never creates an Auth user or production membership.

Shared Auth is a real shared operational boundary: disabling/deleting a user, revoking refresh tokens or changing providers affects other environments using that identity. Staging rollback normally disables only its database-local membership/edge service, never a shared Auth account. Privacy/provider/client-contract approvals and existing production restrictions remain in force.

All M5 dashboard, idempotency, publication, plan/progress/work-order metadata, split-allocation and immutable-source/audit contracts remain unchanged. Only server database routing and operator guards change; no frontend database selector is exposed. There are no production migrations or data copies.

## Database-specific IAM and proof

Firestore server SDK bypasses browser deny-all rules. A dedicated staging identity needs a custom data role limited by the exact IAM condition:

```text
resource.name == "projects/morris-client-dash-zagime/databases/mi-client-staging"
```

Review artifacts: deployment/staging-data-role.json (get/list/create/update + transactions/metadata, no delete) and staging-data-binding.example.json (nondeployable identity/role placeholders). Separate Auth verifier role grants only firebaseauth.users.get at project scope; that identity-read permission cannot be scoped by a Firestore database condition. Maintenance delete permission, if approved, belongs only to a separate staging-conditional operator role. No unconditioned data role, broad Owner/Editor role or JSON key is appropriate.

IAM grants are additive. Review organization/folder/project/group/impersonation grants and every identity attached to staging; an extra broad grant defeats the database condition. A conditional binding alone does not prove denial. [Firestore database IAM guidance](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions) notes that Console behaviour is not a valid test of database conditions; use SDK/REST and IAM evidence.

scripts/verify-staging-iam.ps1 inspects actual permissions through Policy Troubleshooter, requiring positive named grants and definite NOT_GRANTED for all default database read/list/create/update/delete/transaction/metadata permissions. Missing, duplicate or unknown results fail closed. Unit tests validate this evidence contract and the proposed artifacts; they do not emulate Google IAM or certify an actual principal.

The separately built probe:staging-iam command requires a current protected evidence file, explicit approval flag, expected attached service identity and named configuration. It compares metadata-server identity, verifies named metadata, then makes four GET-only requests using the same ADC: staging random missing document (404), staging empty random collection (200), default random missing document (403 PERMISSION_DENIED), default random collection (403 PERMISSION_DENIED). No tenant/customer record path or write is used. Metadata, missing data, transport failures or default 404/200 are not accepted as denial. Write denial comes from the independent IAM matrix, not a dangerous production write experiment.

**No live IAM proof was executed in this task.** Actual identity/default denial, inherited grants and deployed staging deny-all release remain mandatory owner deployment gates. Never present emulator results or offline fixtures as that proof.

## Local evidence and costs

The pinned Firebase CLI ignores multi-database rules arrays when launching its emulator. firebase.emulators.json therefore supplies one named-database configuration with the existing unchanged deny-all rules file. Tests explicitly confirm both named and default browser denial. firebase.json production/default configuration is unchanged; firebase.staging.json contains only the named staging deploy target for a separately approved future rules operation.

M5 fixtures now run in the named emulator DB. New integration tests use the same emulator Auth project and UID namespace, demonstrate default-only administrator denial in staging, preserve a default sentinel through actual staged bootstrap/create/publish/allocation/maintenance, reject direct operator use of default, and deny named/default browser reads/writes. Original default M3/M4 and M5 suites still run.

Live staging adds one metadata read per process startup (and one credential acquisition as needed), no per-tab/operation metadata queries or new listeners/jobs. All M5 bounded reads/no-op/idempotency behaviour remains. Read-only IAM probes run only on explicit operator invocation. No background paid resource, schedule or infrastructure was created.
