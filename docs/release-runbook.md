# Review and release boundaries

## Bootstrap performed
1. Verified company repository was public and empty, with no branches/PRs; authenticated account had admin/push access.
2. Reviewed pinned source, reachable history patterns, synthetic data, asset provenance notes, dependency origins and deployment workflow.
3. Initialized main with documentation only: d52fd9f72066c69174ca992448376d89c1992983.
4. Created codex/company-prototype-integration-foundation from that baseline for the snapshot import.
5. Validate the feature branch and open one draft PR. Do not merge or deploy.

The sole active workflow runs dependency installation, tests, typecheck and build on PRs and branch pushes. It has contents:read permissions and no deployment steps, environment, tokens, cloud access or scheduled triggers.

## Review
Inspect docs/import-review.md and the PR diff. Reproduce tests with a clean install. Browser visual, keyboard and responsive acceptance remains required; historical QA is not current evidence. Check branding rights with the authorized owner before any public demonstration/release.

## Future release
Hosting, production identity, tenant authorization, cloud configuration, sandbox API entitlement and release owner approval must be established in separate reviewed milestones. A merged PR is not deployment approval. Do not restore the original automatic Pages workflow by following historical docs.
Rollback of this unmerged draft requires no data migration: there are no cloud writes. Preserve source repository and local browser saves.

## Current milestone status
PR #1 was merged before M2. M2 branches from main 45cde462f394eb467b11cb3fdb8e8a6fbbda9fa0 and uses one draft PR against main. No M2 merge or deployment authorized. The v2 local save is separate from legacy storage; preserve both for rollback.

## M2 re-review validation
Continue existing draft PR #2 on codex/m2-synthetic-reporting-nordic. Run clean npm ci --ignore-scripts, npm test, npm run typecheck and npm run build. Reproduce the primary-navigation project-manager journey and client filtering using scripts/qa-m2-corrections.cjs with a local Playwright module path as its argument and a local Vite server. Evidence is in docs/qa-m2-corrections. Verify source corrections by period and two-agreement shared-department tests. No merge, deployment or production changes are authorized.

## M3 release boundary
M2 PR #2 is merged. M3 uses a new draft branch from main 745df43b97750d3c30678e31b7ab5145e81ce03f. CI runs on PRs/main pushes with tests/build/local emulator only. No cloud credentials or deploy step. Every live mutation described in docs/operator-setup-runbook.md is REQUIRES OWNER APPROVAL and was not executed. Resolve Canadian identity/logging/ingress gates and review real backend persistence/token verification before staging, then separately approve production.

## M4 current release boundary
PR #3 is merged. M4 starts a new branch/PR from d62dc9d8ac853423cf6d62a6775c68b4f1719a57. Read docs/operator-setup-runbook.md (current M4 instructions) rather than executing historical M3 creation commands. The existing Montréal database must be reused. No deployment, users, IAM, secrets, logs/backups, billing or live QuickBooks changes are authorized in this milestone. Owner must verify the actual deployed deny-all rules release before future live startup and explicitly approve provider privacy, identities/IAM and synthetic staging. CI builds server and frontend and runs both emulators; no deploy stage.

M5 current handoff: docs/m5-staging-runbook.md separates immediate read-only checks, manual owner configuration, resource/deployment approval, emulator testing, remote staging smoke checks and blocked production. Merging never activates a live endpoint.
