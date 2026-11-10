# Milestone 1 import review

## Provenance
Source: https://github.com/Devopriya-Tirtho/morris-client-intelligence
Pinned main commit: 835e70842cd7f5f0d0fc2e3b9d3f0b0d368b651c.
Source refinement PRs #1, #2 and #3 were verified merged.
Target: https://github.com/MorrisInteractiveMaster/mi-client-intelligence-sync-zagime
Documentation-only main baseline: d52fd9f72066c69174ca992448376d89c1992983.
Branch: codex/company-prototype-integration-foundation.

Reviewed snapshot adoption under the user's explicit source-transfer instruction. Original history remains in the source repository; it is not republished into the company repository. This keeps the new PR reviewable and avoids carrying historical workflows and unrelated uploads. No claim of open-source relicensing or assignment of third-party rights is made.

## Included and excluded
Application src/, active branding images, index.html, Vite/TypeScript config and lockfile are preserved byte-for-byte. Original README and QA moved into historical reference docs.
Excluded .github/workflows/pages.yml: it deploys on main pushes and manual dispatch.
Excluded public/branding/morris/logo.png: original README identifies it as an unrelated unused emblem. Configured MI Logo.png and zagime.jpeg remain unchanged.
Added company docs, environment guidance, stronger ignore patterns, explicit typecheck/runtime metadata and validation-only CI.

## Security and provenance review
Reviewed tracked file names across reachable history and scanned reachable commit contents for common GitHub/Google/AWS token formats, private-key headers and long assigned refresh tokens, returning paths only. No matches found. No tracked environment/credential/service-account file names or license files found. This limited pattern scan is not proof that every possible secret is absent; unreachable/deleted remote objects were not examined.
Current fixtures generate example.com addresses, fictional 555 numbers and synthetic source IDs. No real API responses or OAuth configuration were identified. No application network-fetch code was found.
No repository LICENSE was supplied; do not infer a general redistribution license from public visibility. Transfer is scoped to the user's company-adoption instruction.
Source README, QA and commit e12fa35 describe active brand images as supplied/approved. Separate branding-folder READMEs were stale. Independent ownership evidence was not available; authorized brand-owner confirmation remains a release prerequisite. No invented logos added.
Lockfile version 3 resolves packages from registry.npmjs.org only. License metadata includes MIT, ISC, Apache-2.0, BSD, OFL-1.1 and CC-BY-4.0; preserve applicable attribution/license notices. Recharts 2 is deprecated upstream; a major-version redesign is outside this baseline.

## Verification
See the PR for current executed results; historical QA claims are separate. Existing suite has 45 tests across domain, service and server-rendered views. Build includes TypeScript compilation. No lint configuration exists.
No Firebase emulator, real auth/tenant security, live API entitlement, live cloud behavior, browser visual acceptance or accessibility certification is claimed.

Preservation check: 47 of 55 original tracked files are byte-identical in the company checkout; the eight differences are the two documented exclusions, relocated README/QA, package.json typecheck script, .gitignore and the two branding READMEs. Dependency license text is bundled in public/third-party-notices.txt, including fonts and icon notices. Some platform-specific build binary packages carry no standalone notice file; their parent tooling notices are included.

Executed locally on 2026-11-10 using Node 24.12.0 / npm 11.6.2: source npm ci --ignore-scripts, 45/45 tests and production build passed; company clean npm ci --ignore-scripts, 45/45 tests, npm run typecheck and npm run build passed. npm reported zero known vulnerabilities. Application JS/CSS output filenames match the source build. Browser/emulator/live-security tests were not run. Source Git blob bytes were restored directly to avoid checkout line-ending conversions.
