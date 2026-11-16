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
