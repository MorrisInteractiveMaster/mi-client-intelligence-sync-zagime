# M7 controlled remote synthetic smoke acceptance — NOT RUN

This is a prepared test plan, not permission to deploy, activate, seed or write. Read-only owner evidence is in m7-cloud-evidence.json. Write IAM isolation requires the corrected complete policy/role/inheritance review and approved runtime checks; the unsupported Troubleshooter matrix is not evidence. Actual attached identity remains a separate gate. Local emulator suites exercise the underlying M5 workflows; they do not certify cloud rollout.

## Preconditions

- Exact existing project/database/UID/service identity verified; complete authorized actual-policy review supports default create/update/delete denial and the intended least-privilege staging profile (no UNKNOWN treated as denial). No production writes are used as tests.
- Named deny-all browser rules release recorded, approved edge/origin/API image configuration, metadata identity check passed, explicit owner release/seed/write approval after architecture review.
- Approved existing synthetic Auth identities and named-database memberships: administrator, editor scoped to one project, client, and valid-identity user with no staging membership. No real client data, QBO records or production membership copying. Never disable/revoke shared Auth users just for this plan.
- A dedicated new synthetic-m7-smoke tenant with reviewed trusted fixtures only. The future seed preview must show no overwrite; applying fixtures/first-admin membership requires separate approval. Keep source snapshots, allocation history, revision and audit baselines in protected operator evidence outside Git.

## Ordered scenarios

| Step | Action after explicit remote-write approval | Expected result |
| --- | --- | --- |
| 1 | Access /health, then protected workspace without token | Non-sensitive health only; protected 401, no writes. |
| 2 | Sign in with a valid identity lacking staging membership (including a default-only member) | 403, no project/raw/history disclosure. |
| 3 | Approved staff signs in through protected UI | Correct named tenant/assigned hierarchy; client sees only published projection and cannot call staff reads/writes. |
| 4 | Create **M7 synthetic delivery**, fixed 10-hour plan, without work order | One private project, progress 0. Exactly one creation audit/revision; client cannot see it. |
| 5 | Deliberately lose/retry the same creation response using the same idempotency key and payload within its 24-hour window | Original result, one project/creation audit, no replay writes. Conflicting key reuse fails 409. After reload reconcile before a new key. |
| 6 | Edit name to **M7 synthetic revised**, plan 12 h, progress 25%, optional reference SYNTHETIC-M7 | Material edit audit/revision; raw source unchanged; identical save writes zero. No QuickBooks mapping/writeback. |
| 7 | For an approved 2-hour synthetic October source entry, report 1 h to revised project and 0.5 h to a second approved project | 0.5 h unallocated; latest allocation/head, +2N period/lifetime counters, one allocation revision/audit commit atomically. Raw 7200 seconds and description/IDs unchanged. |
| 8 | Review current and earlier allocation history; choose September/October separately | Earlier revisions retained; October adds 1 h/0.5 h once; September unchanged. Lifetime increases by the same deltas, no cap/plan double count. Stop if supplied fixture totals differ from reviewed baseline. |
| 9 | Editor attempts publication, other-project edit, unauthorized source/history; client attempts any write | Server 403, no audit/revision/raw change. Browser role flags do not elevate privileges. |
| 10 | Administrator explicitly publishes, then unpublishes the project | Client gains then loses only approved project projection; no raw/notes/history/source identity leak. One material publication audit per toggle. |
| 11 | Submit two material edits with one expected revision | One succeeds, one 409; refresh and review before retry, no silent overwrite. |
| 12 | Change **staging membership only** to disabled/unapproved via separately approved operator action, then refresh | Subsequent protected request denied and staff UI cleared. Shared Auth identities/providers/tokens unchanged. Any restoration requires explicit staging approval/audit. |
| 13 | Exercise invalid input, over-allocation, stale revision, HTTP 429 or controlled failure | Bounded error, no partial counters/audits/history; reconcile and refresh before manual retry. |
| 14 | Verify browser SDK denial on both DBs and review private audit/read/write evidence | Deny-all remains; all changed tenant records belong only to mi-client-staging. No actual production record read/write verification via privileged account. |

Record project/source IDs only in protected synthetic evidence, not public tokens/screenshots. Compare raw content hashes and immutable earlier revisions against baseline. Material project changes use four writes; idempotent creation uses five; allocation uses 4+2N writes for affected targets, no-op/replay zero. These are code-derived budgets, not cloud billing measurements; review actual usage separately.

## Stop, recovery and cleanup

Stop immediately on unexpected permissions, attached identity/UID mismatch, client disclosure, duplicate creation, source mutation, partial audit, counter mismatch or default access. Deny staging traffic/drain writers; retain evidence and notify the existing review process. Do not repair by granting IAM, switching to default, recreating resources, changing shared Auth or deleting business audits. Cleanup/retention of the dedicated synthetic tenant and its descendants is a separately approved named-only action. No automatic cleanup, provider/user mutation, OAuth or live QuickBooks synchronization is included.
