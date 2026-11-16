# M7 corrected security verification — same PR #7

Starting PR head: 71977c67bec621af535d43d18d4cb2aba126a5ee. Branch codex/m7-staging-deployment-preparation is retained; no new PR. The owner's live INVALID_ARGUMENT / INVALID_RESOURCE_NAME result invalidates the old checker's operational claim. Earlier mocks verified argument handling only and did not establish API/resource support.

## Correction and evidence boundaries

The old PowerShell checker, matrix acceptance helper and matrix-consuming probe stop unsupported/inconclusive. No alternate Troubleshooter resource was guessed. The new Cloud Shell Bash collector uses documented Resource Manager project/ancestor getIamPolicy and IAM role-definition reads; it does not call Troubleshooter, write Firestore, grant IAM, impersonate, enable APIs or provision anything.

Every collector run exits 2 and keeps activationAuthorized=false. Even complete minimal direct-policy fixture data yields PROFILE_MATCH_REQUIRES_REVIEW, never an effective-permission PASS. Missing policies/roles, UNKNOWN, unsupported APIs/conditions, unresolved membership and incomplete ancestry remain INCONCLUSIVE; declared broad/unintended grants flag VIOLATION. Actual policy/role/inheritance/group/impersonation completeness and approved runtime evidence remain an authorized review responsibility. No live policy snapshots were available to the agent; actual service-account least privilege and write isolation are not certified here.

## Validation

- Clean npm ci --ignore-scripts; full Node suite **116/116 passed**, no failures/skips.
- Auth/Firestore emulator suite **25/25 passed**, no failures/skips; legacy/M5/M6/M7 security behaviour retained.
- Typecheck, frontend build, backend bundles passed. Production dependency audit: zero; unchanged 14 moderate development-tool findings, no high/critical. No lint configured.
- Linux CI runs Bash syntax validation and an explicitly offline collector harness covering minimal profile, owner-observed invalid-resource-name, API disabled and missing permission. All fixture scenarios require nonzero review status; they are not actual Google IAM tests. This Windows environment has no Bash; Linux CI is the Bash execution evidence.
- New Node regressions cover actual error text classification; unsupported APIs/missing visibility; missing required create/update/role/ancestor/condition-version evidence; inherited broad data grants and Auth mutations; unresolved groups/custom conditions/impersonation routes; missing artifact JSON; no active retired Troubleshooter command; and no operational success from complete fixtures.
- The existing owner's live read evidence file, attached-identity code, UID/target validation, runtime verification, disabled manifest, default rules and lockfile are unchanged. No browser UI changes/screenshots. Docker build and remote rollout/checker execution were not performed.

## Current owner handoff

docs/m7-operator-next-steps.md is now Cloud Shell Bash only. Read-only inventory comes first; no service/job is assumed. It specifies supported collection APIs, exact minimal Firestore/Auth profile, complete review needed for deny-by-absence reasoning without default writes, preserved read evidence, and explicit separate image/job-creation/execution/cleanup approvals for a dedicated staging-only checker if no suitable runner exists. No checker is created automatically. Unknown or failed checks cannot trigger new grants or API activation.

MERGED: No · DEPLOYED: No · CLOUD SEEDED: No · API ACTIVATED: No · LIVE WRITE ISOLATION CERTIFIED: No

## Final condition-equivalence correction

Continues the same draft PR #7 from 694d8d5fa148783210e3c6db3a4ba3037b88e0e9. The owner's exact `resource.name=="projects/morris-client-dash-zagime/databases/mi-client-staging"` now receives PROFILE_MATCH_REQUIRES_REVIEW in the complete narrow-profile fixture. Supported single/double quoting and token whitespace produce the same classification. The matcher recognizes only a complete equality with the exact literal; it never evaluates CEL or rewrites string contents. Additional Boolean operators, prefix matches, alternate databases/projects, malformed/escaped literals, comments and broader permissions remain rejected or inconclusive. activationAuthorized=false and collector exit 2 are unchanged; no live effective authorization is claimed.

Clean installation, all **118/118** Node tests, **25/25** Auth/Firestore emulator tests, typecheck, frontend build and backend build passed. The offline Bash collector fixture now contains the owner's exact no-space condition; Linux CI executes the Bash syntax and integration checks. No dependencies, runtime identity/database/UID guards, production configuration, activation flags or cloud evidence were changed. No live IAM, deployment, seeding, API activation or production operation occurred.
