> Historical M3 evidence. Its blanket Canada-only blocker assumptions and NOT CREATED infrastructure snapshot are superseded by the M4 owner decision and existing database. See docs/canadian-residency.md and docs/firebase-setup.md for current status.

# M3 verification and limitations

Base main: 745df43b97750d3c30678e31b7ab5145e81ce03f, PR #2 verified merged. New branch codex/m3-security-canadian-foundation. No app behavior or v1/v2 data is modified.

Local toolchain: Node 24.12.0, npm 11.6.2, temporary Eclipse Temurin JRE 21 outside repository, firebase-tools 15.36.0, rules-unit-testing 6.0.0, Firebase test SDK 13.3.0. Java is required only for local emulators. No credential file, token, cloud resource or secret value is created. Firebase dependencies are dev-only and not imported by the frontend.

Validation commands/results are reported in the draft PR. Security tests use the actual Firestore Standard emulator and deny-all rules, including authenticated/unauthenticated read/list/create/update/delete, cross-tenant, unpublished/published, role escalation and nested/orphan paths. Expected PERMISSION_DENIED output is success evidence in these tests. Backend tests separately exercise the authorization bypass boundary that Firestore rules cannot protect for an Admin SDK.

The shipped identity verifier denies all; test identities are synthetic. No real authentication flow, HTTP endpoint, live Firestore adapter, cloud transaction, staging deployment, operational-time visibility or residency compliance was verified. Existing M2 browser and calculation tests remain; no UI change required a new visual baseline. Production rollout remains blocked on architecture/identity/logging decisions and owner approval.

Dependency review: original install of new dev tooling surfaced a high grpc advisory. A pinned compatible @grpc/grpc-js 1.14.7 override removes high findings; safe npm audit fixes applied. Remaining **14 moderate development-tooling findings**, zero high/critical; **production dependency audit zero findings**. Remaining chains include glob/minimatch, uuid, OpenTelemetry and Google tooling transitives. npm's suggested force-fix downgrades firebase-tools/rules SDK major versions and was not applied. No audit suppression or forced incompatible overrides. Restrict tools to trusted local/CI synthetic inputs; review upstream patches before broader use. This is an acknowledged tooling risk, not a zero-vulnerability claim.

Rules review: no exceptions or role-based allows were opened. Adversarial attempts cannot reach an allow: ownership spoofing, field injection, missing/oversized payloads, role escalation, cross-tenant, unauthenticated, nested/orphan and list/write paths all remain denied. The emulator compiles the rules. No deploy/dry-run against the real project was used. These are prototype rules for review, not certification of future permissive rules.

Final local results: clean install passed; **90/90 unit/regression/backend tests** (73 retained M2 + 17 new server tests); **5/5 Firestore emulator test groups**; combined typechecks and production build passed. Browser app source is unchanged and generated frontend JS/CSS filenames match the merged M2 build. Runtime dependency audit reports zero findings; complete dev-inclusive audit remains 14 moderate, zero high/critical.
