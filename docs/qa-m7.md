CORRECTED SECURITY REVIEW: the PowerShell checker below was only mock-tested and failed live with INVALID_RESOURCE_NAME. It is retired. Historical offline success is not operational evidence. Current regression/collection evidence is in qa-m7-correction.md; actual IAM and attached-runtime certification remain pending authorized inspection.

# M7 deployment-preparation verification

Base main 691f5aa3babe140420425794f0b016c33986c954; PR #6 verified merged. Branch codex/m7-staging-deployment-preparation. Supplied cloud evidence is recorded with explicit owner provenance in m7-cloud-evidence.json. Completed read probes and Token Creator grants were not repeated.

Passed locally: clean npm ci --ignore-scripts, **109/109 unit/regression tests**, **25/25 Auth/Firestore emulator security tests**, frontend/server typecheck, frontend production build, and API/operator/probe/identity-check bundles. Original M5/M6 functionality and named/default denial tests retained. Production dependency audit: zero vulnerabilities; inherited development-tooling findings remain 14 moderate, no high/critical. Lint is not configured. Docker is unavailable; image build/remote deployment was not executed. Frontend/design unchanged, so browser screenshots were not regenerated.

New coverage verifies the fixed metadata endpoint/Google headers, no request body/credentials/Firestore operation in identity-only checking, rejection of incorrect/missing/untrusted/unavailable attachment, no private-error leakage, configured company identity pin, and failure before credential acquisition/DB handle exposure for a wrong identity. Runtime identity/metadata verification is shared by API and operators; emulators skip cloud metadata access.

PowerShell checker was run with an explicitly asserted in-process fake gcloud function: write-only mode made exactly six decision calls, emitted data-write-permissions evidence, and rejected UNKNOWN_INFO_DENIED and unexpected default grants. These are offline checker tests, not cloud policy results. No real gcloud command or IAM grant was issued.

**Still pending owner execution/review:** actual default create/update/delete denial and required staging write grants, actual runtime metadata attachment, published deny-all release, image/service/origin/edge/privacy/cost approvals and controlled remote synthetic smoke acceptance. No authenticated Cloud SDK/runtime connection is available to the agent. M7's cloud GET/LIST outcomes and removed temporary binding are owner-verified facts; no execution timestamp or attached-runtime proof was supplied. No full write/compliance/production certification is claimed.

All manifest activation flags stay false. Existing database UID/account values are non-secret owner-supplied configuration, not newly created resources or authentication user identifiers. No cloud resource, IAM, database record, Auth provider/user, credential, billing, log, backup, DNS/hosting or QuickBooks change occurred. No remote seed or API activation occurred.

MERGED: No · DEPLOYED: No · SEEDED (cloud): No · API ACTIVATED: No · PRODUCTION VERIFIED: No
