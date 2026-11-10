# Repository execution rules
Read README.md, docs/import-review.md, docs/architecture.md, docs/source-of-truth.md and docs/release-runbook.md before changes.
Continue the existing feature branch and draft PR. Preserve source provenance, established domain calculations, synthetic fixtures, branded UI and existing tests.
Milestone 1 is source adoption only. Do not implement later milestones without a reviewed continuation.
No merge, deployment, IAM/billing changes, live integrations, real data or production writes. Never add credentials or private records to this public repository.
Use the lockfile and run npm ci --ignore-scripts, npm test, npm run typecheck and npm run build.
Future workers must use stable source IDs and preserve Morris-managed fields; client role switching is not security.
Document test limits accurately. The historical prototype documentation does not authorize deployment.
