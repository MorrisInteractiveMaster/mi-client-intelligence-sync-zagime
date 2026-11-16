# M5 local synthetic verification

Base main: `615ae61a510ed496d79364751ef662a081a88187`; PR #4 merged. Branch: `codex/m5-secure-morris-administration`. No live Firebase, infrastructure, user or credential changes.

## Checks

- Clean `npm ci --ignore-scripts` succeeded. Node 24; local Java 21 for emulators.
- Full legacy/M2/M3/M4 + M5 unit suite: 99 passed, zero failures/skips.
- Auth + Firestore emulator security suite: 22 passed, zero failures/skips. Original deny-all browser tests retained.
- Frontend/server typecheck, frontend build and both API/operator backend bundles passed.
- Production dependency audit: zero vulnerabilities. Unchanged development-tooling audit: 14 moderate; no high/critical. No forced dependency changes or audit suppression.
- Lint is not configured. Docker is not installed; container image build and all remote staging/production checks were not performed.

## Actual Chrome → Firebase emulators → HTTP → Firestore workflow

Reproducible runner: `scripts/qa-m5.ts`, command/environment setup in docs/m5-staging-runbook.md. Playwright was installed outside the application dependency tree and used local Chrome. No HTTP response fixtures substitute for protected data. The one deliberately dropped response is fetched/committed against the real emulator backend before simulating network loss.

Passed: synthetic Auth sign-in; assigned project page; private creation without work order; dropped create response → identical-key retry → exactly one project; plan/name/progress/reporting work-order edit; explicit publication; raw-time allocation; unallocated remainder; allocation history; month change; editor controls; membership revocation clears staff UI; client publication-only view and zero staff-data requests; disabled default makes zero protected Auth/API requests; separate synthetic demo remains available. Cosmetic staff tab changes produced zero additional API calls. No browser page errors. Layout overflow checks passed at 1440, 1366, 768 and 390 pixels, with additional mobile form/split screenshots.

See results.json and staff-*.png, create-mobile.png, allocation-history.png, allocation-mobile.png, editor.png, client.png, disabled-default.png and synthetic-demo.png. All names/hours/work-order values are synthetic or illustrative. Screenshots contain no real user records/tokens. Dots and default demo source/design were preserved, and existing presentation/regression tests pass.

Emulator tests additionally cover paginated candidate scans, bounded/invalid requests, cross-tenant/role denial, source/history exclusion for clients, project-specific editor restrictions, replay after membership revocation, conflicting/expired key rejection, concurrent create/edit transactions, raw immutability, exact month/lifetime allocation deltas, no-op suppression, source-revision conflict/recovery, immutable actor audits, first-admin provider verification/dry-run/concurrency/permanent revocation lock, bounded auditable retention cleanup and synthetic seeder refusal to overwrite existing tenants.

## Limits

Emulator tokens are unsigned; retained M4 offline RSA tests use the real Admin verifier for signature/audience/expiry/disabled/revoked checks. This is local evidence, not live provider/ingress/IAM/region/rules-release certification. Staging topology is proposed and requires separate owner approval. The existing production-intended Montréal database was untouched. Report/hierarchy pilot bounds, tenant-root contention, proxy-shared application limiter and in-memory-only retry drafts remain production review items. Future QuickBooks source correction workers and safe scale-up remain disabled/unimplemented. See docs/m5-administration.md and docs/m5-staging-runbook.md.

MERGED: No · DEPLOYED: No · PRODUCTION DATA CONNECTED: No · PRODUCTION VERIFIED: No
