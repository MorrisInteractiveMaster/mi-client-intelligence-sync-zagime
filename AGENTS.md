# Repository execution rules
Read README.md, docs/m4-api-and-persistence.md, docs/canadian-residency.md, docs/operator-setup-runbook.md and docs/source-of-truth.md before changes.
M4 branch codex/m4-secure-firebase-api starts at verified merged M3 main d62dc9d8ac853423cf6d62a6775c68b4f1719a57; one draft PR. Preserve synthetic M2 workflows and M3 security tests.
No merge/deployment/cloud mutations, database/project creation, live Auth users, credentials or QuickBooks activation. Existing database (default) is Standard Native in northamerica-northeast1. Browser rules stay deny-all. Live activation stays disabled.
Updated owner decision: Canadian project/reporting storage preferred; no blanket Canada-only restriction on identities/log/service processing. Firebase Auth US processing needs privacy approval; client contracts still apply. Existing global logs are not automatic blockers.
Run clean npm ci --ignore-scripts, npm test, npm run typecheck, npm run build, npm run build:server and npm run test:security. Auth/Firestore emulators use demo-mi-security and loopback only; Node 24/Java 21+.
