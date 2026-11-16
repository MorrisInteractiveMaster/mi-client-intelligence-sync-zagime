# M4 verification and production limits

Base main d62dc9d8ac853423cf6d62a6775c68b4f1719a57; PR #3 verified merged. New branch codex/m4-secure-firebase-api. All tests/data in this milestone are local/synthetic. No live user, database, rule, IAM, secret, billing, log, backup or integration change occurred.

## Validation evidence

Final command results are recorded in the draft PR: clean npm ci --ignore-scripts, full legacy/M2/M3 plus new unit tests, combined frontend/server typecheck, frontend build, build:server and Auth+Firestore emulator suite. Existing Firestore deny-all tests are retained. The local Windows preview was stopped before clean installation to release its Rollup file lock; the successful rerun is the reported result.

Production signature test uses the real Admin SDK verifier with an offline RSA fixture key and synthetic account-response hook. It accepts a valid RS256 token, rejects a tampered signature/wrong audience/expired token, and checks disabled/revoked account responses. No Google certificate fetch/account read occurred. Auth Emulator tokens are unsigned; emulator tests are separate integration evidence, not proof of production provider rollout.

Emulator integration covers: actual synthetic sign-in, current membership/tenant denial, client read-only restrictions, editor field/project restrictions, private-by-default creation, explicit admin publication, atomic audits, concurrent revision updates, no-op/invalid-write suppression, raw time and immutable allocation-history preservation, monthly/lifetime counters, allocation updates, disabled/revoked users, re-enable/recovery, bounded/origin-checked HTTP requests and controlled failure. Corrupting a synthetic summary causes allocation rollback without partial audit/history/revision changes; trusted repair restores successful reads.

Browser regression script for M2 is rerun against the unchanged default demo, with new screenshots in this folder. /#/secure stays unavailable in the default build and makes no Auth or API requests. Actual protected provider popups/remote hosted login and remote persistence were not tested. No live deployed-rules release was independently verified; future owner verification is required before live access.

## Remaining production gates

- Owner approval of Firebase Auth US identity processing, Google/Microsoft provider settings/domains and approved memberships.
- Independent live database/rules-release verification, attached ADC/IAM identity, approved ingress/origin and synthetic staging.
- Collection read slices capped at 100; larger portfolios/history need pagination or materialized aggregate redesign. No silent partial totals.
- Per-instance socket-IP rate limiting; behind proxies users may share buckets. Initial max one Cloud Run instance is a reviewed limit, not distributed rate limiting.
- New project POST is not automatically retried/idempotent. Reconcile ambiguous create outcomes before manual resubmission; an idempotency-key design is recommended before production write UX.
- Protected React workspace is a publication-reading integration preview; protected administration is HTTP-only. Demo edits remain local and never write Firestore.
- Future raw import/correction workers must atomically maintain head/applied allocations and derived counters; no worker or live QuickBooks connector is enabled.
- Docker image build/deployment and production privacy/compliance/provider configuration are not certified by these local tests.

Dependencies: production audit is clear at verification; inherited 14 moderate development-tooling findings remain (no high/critical). See the retained M3 dependency review; no audit suppression/forced downgrade was used. No new real credentials are stored in the repository. The existing Montréal database is reused by prepared code and no replacement resource is provisioned.

Final local results: clean installation succeeded; unit/regression tests 97/97; Auth + Firestore emulator tests 13/13; typecheck, frontend build and server build passed. Browser checks passed at 1440, 1366, 768 and 390 pixels, including the manager allocation journey. Production dependency audit: zero vulnerabilities.
