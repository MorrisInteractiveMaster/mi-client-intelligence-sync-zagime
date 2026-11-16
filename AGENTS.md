# Repository execution rules
Read README.md, docs/architecture.md, docs/source-of-truth.md, docs/security-and-access.md, docs/canadian-residency.md and docs/operator-setup-runbook.md before changes.
M3 branch: codex/m3-security-canadian-foundation; one draft PR against verified main 745df43b97750d3c30678e31b7ab5145e81ce03f. M2 is merged. Preserve its workflows, Nordic/Dots, all 73 existing tests and v1/v2 storage.
No merge, deployment, live Firebase/QuickBooks, cloud resources, IAM/billing changes or credentials. Canada is mandatory for production. Real identity verification and cloud persistence remain disabled. Firestore browser rules stay deny-all unless separately approved.
Run clean npm ci --ignore-scripts, npm test, npm run typecheck, npm run build and npm run test:security. Emulator uses demo-mi-security on loopback only; Node 24 and Java 21+. Never use the real project in tests.
