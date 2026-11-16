# M4 residency decision and infrastructure assessment

**Current owner decision, 16 November 2026:** there is no strict Canada-only policy covering every identity, log or service-processing operation. Canadian storage for client project/reporting data remains preferred. Client-specific contracts and privacy obligations still require review. This decision supersedes M3's blanket Canada-only blocker analysis; it does not certify compliance.

## Existing infrastructure (owner-confirmed, not live-inspected during M4)

Project morris-client-dash-zagime; existing database (default), Standard, Firestore Native, northamerica-northeast1 (Montréal). Realtime updates enabled, scheduled backups disabled. Console reportedly displays deny-all browser rules. No replacement project or database is needed or authorized. The deployed rules release has not been independently read; no live access occurred. Before future live access an owner must verify the deployed release, contents and timestamp; the production runtime also requires FIRESTORE_RULES_VERIFIED=true as an explicit operator attestation, not as independent proof.

## Decisions and open approvals

| Area | M4 plan | Owner review |
| --- | --- | --- |
| Client project/reporting storage | Use the existing Montréal database and regional Firestore endpoint. No browser database access. | Validate actual database metadata, contractual requirements and service-account access before staging. No database creation. |
| Authentication | Firebase Admin verifies Firebase ID tokens, including signature and revocation/account state. Intended providers: Google and Microsoft; server membership remains authoritative. | Firebase Auth processes identity data in the US. Privacy approval is still required before enabling providers or users. The revised policy permits consideration; it is not itself an approval for a specific provider rollout. |
| Cloud Run | Reviewed build/container and service template, region northamerica-northeast1, internal ingress, max instances 1 initially. | Identity/IAM, image digest, ingress/origin, costs, rate-limit protection and deployment need separate approval. Live activation remains false in the template. |
| Logs | Existing global buckets are not automatic blockers under the revised decision. | Review PII/URLs, sinks, retention, access and applicable contracts. No logging configuration changed; requests/tokens/bodies are not logged by the API. |
| Secrets | Future QuickBooks OAuth material belongs in regional Secret Manager; no secrets are currently needed for Admin SDK ADC. | Cloud Run built-in injection still does not support regional secrets; future connector calls the regional API using attached identity. No secret/IAM mutation now. |
| Backups | Scheduled backups remain disabled; no automatic enablement in M4. | Owner selects backup/PITR/retention/recovery targets and cost if desired. Managed backups stay with the source database region; test a separately approved restore. |
| Hosting/CI/third parties | Synthetic demo remains; protected UI is disabled by default. CI validates synthetic code/emulators only. | Approve frontend origin, Auth domains, provider processing, Intuit terms and any client-specific geographic restrictions. Global services are reviewed case by case, not automatically rejected or blanket-approved. |

No legal/compliance assurance is claimed. No cloud resources, users, keys, roles, secrets, backups, logs, billing or external integrations were changed.

## Primary references checked for this work

- [Firebase privacy, including US Authentication processing](https://firebase.google.com/support/privacy)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens) and [revocation checks](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.baseauth)
- [Auth Emulator accepts unsigned test tokens](https://firebase.google.com/docs/emulator-suite/connect_auth)
- [Firestore locations](https://firebase.google.com/docs/firestore/locations) and [regional endpoints](https://firebase.google.com/docs/firestore/regional-endpoints)
- [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations) and [regional-secret limitation](https://docs.cloud.google.com/run/docs/configuring/services/secrets#regional-secrets)
- [Logging locations](https://docs.cloud.google.com/logging/docs/region-support), [managed backups](https://firebase.google.com/docs/firestore/backups)

M5 staging clarification: separately approved isolated synthetic project preferred, with Montréal Firestore/Cloud Run/Artifact Registry. The M4 internal-ingress browser assumption is replaced by the edge topology in docs/m5-staging-runbook.md; no infrastructure was provisioned. Existing production-intended database remains unchanged and must not receive staging fixtures.

Current owner target supersedes the M5 separate-project preference for this staging task: use existing project morris-client-dash-zagime with explicit named staging database mi-client-staging, verifying Montréal metadata and pinned UID before startup. This does not approve shared Auth user/provider changes or production access. See operator-setup-runbook.md.
