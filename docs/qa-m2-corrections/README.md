# M2 architecture correction QA

Reviewed starting HEAD: c422db9c1e4271f55c7021676b243125086d2697. Existing PR #2; no new PR.

Executed locally: clean npm ci --ignore-scripts (zero known vulnerabilities), full 73-test suite, typecheck and production build. All 45 original regression tests are unchanged. Eight added correction tests cover two agreements sharing Health, September/October separation, cross-project splits and partial remainder, agreement-scoped source remainders, corrected-source review/audit and stale replay, fixed training lifetime across months, umbrella/specific links and client publication filtering. One prior M2 assertion now explicitly calls clientProjection to preserve its client-only expectation under the clarified API.

Chrome acceptance script: scripts/qa-m2-corrections.cjs. Invoke with an installed Playwright module location as its argument; Vite must run at 127.0.0.1:5173. The isolated browser tooling is outside the app dependency tree.

Passed: create project without source reference → primary Projects list → primary Time Allocation → allocate 5+2 hours → primary dashboard summary 7 hours, with 1 hour unallocated. Raw duration stays 8h. Month switch to September shows zero; selected month survives route navigation. The shared provider preserves edits without reloading a second model. Screenshots record the actual result.

Client-mode test seeds an unpublished project, private notes and corrected raw time requiring review. None of the private names/notes, raw source IDs, allocation form, unallocated source totals or correction alerts appears in the client dashboard. Switching to Morris mode exposes the review alert. The role switch remains an insecure synthetic demonstration, not production enforcement.

Client screenshots at 1440, 1366, 768 and 390px show no document horizontal overflow. Dots play/pause and Escape close pass. Legacy route shows an explicit separate-v1-data banner. No page errors. See results.json and PNGs.

No cloud/emulator/live API tests or production-residency verification were performed. Full screen-reader/contrast certification remains outside this check. Original Nordic/Dots provenance and previous reduced-motion evidence are retained.
