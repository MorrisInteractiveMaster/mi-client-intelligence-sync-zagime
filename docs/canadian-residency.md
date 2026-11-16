# Canadian residency assessment — M3

Checked 16 November 2026 against primary documentation. This is a verified service-capability plan, not verification of the user's live project or legal certification. No cloud commands were executed. Canada is mandatory for production.

## Proposed boundary and decision

Browser → Canadian application/API → Canadian Firestore and regional secrets. Keep direct browser Firestore access denied. The current synthetic application is unchanged; it is not wired to this backend. Workload preference is northamerica-northeast1 (Montréal). Tenant membership/roles are server-controlled. Identity verification is an injected boundary whose shipped default denies every token.

| Component | Evidence and proposed configuration | Assessment / gate |
| --- | --- | --- |
| Firestore Standard Native | Montréal and Toronto supported; choose Montréal, not a US multi-region. Regional endpoint firestore.northamerica-northeast1.rep.googleapis.com for future server SDK/REST. | Regional customer-data storage/processing capability verified; account setup and endpoint enforcement not verified. |
| Cloud Run API/jobs | Montréal is supported. Co-locate API, OAuth callback, future workers and future scheduler. | Canadian workload placement possible; global service management metadata and ingress transit need owner/vendor review. No service/job created. |
| Regional Secret Manager | Montréal regional service available. Regional endpoint secretmanager.northamerica-northeast1.rep.googleapis.com. Credentials and rotated tokens remain secret versions. | Regional API accesses required; default/global secrets are not interchangeable. Cloud Run's built-in mounts/env-secret integration does not support regional secrets. Use server SDK/REST with ADC against regional endpoint; no secret in environment or Firestore. Validate this access path in a later synthetic staging test. |
| Authentication | Firebase Auth processes identity data exclusively in US data centers. Auth domain and registered web app do not establish residency. | **BLOCKED for strict Canada-only user information. Do not enable Firebase Auth or mint custom Firebase tokens as a workaround.** |
| Identity alternative | Candidate: independently hosted OIDC provider (e.g. Keycloak) in Canadian infrastructure, with Canadian identity/session database, MFA, backups and logs; or a provider contractually warranting Canada-only processing. | Architecture proposal only. Vendor/operations review required. No social federation to US/global providers until approved. A Canadian private hosting provider is the alternative if Google control-plane metadata/support cannot satisfy the defined boundary. |
| Firestore backup/PITR | Managed backups stay in database location; deletion of database does not delete its backups. | Propose daily backup/14-day retention and PITR; owner approves cost, retention and recovery objectives. Never export into unapproved Storage or another region. |
| Logging/audits | Regional buckets store/index/search logs locally; Log Router receives regionally and sinks may send elsewhere. Existing _Required/_Default commonly default global and cannot change location. | **Existing-project log residency is UNVERIFIED and may block use of this project.** Inventory before workloads; regional application bucket alone does not relocate mandatory audit logs. If existing required logs are global, pause: owner must decide on a correctly governed new project or obtain an explicit residency exception. No copying logs out of Canada for analytics/support. |
| Hosting/delivery | Firebase Hosting/global CDN has no Canada-only guarantee established here. | Do not approve global hosting by assumption. Candidate: serve compiled static assets from Canadian Cloud Run behind approved Canadian regional/private ingress without CDN. DNS, TLS, internet transit, request logging and user location require explicit boundary review. No hosting selected or deployed. |
| Build/artifacts | Proposed Canadian regional Artifact Registry and regional Cloud Build where approved. GitHub Actions only handles public source/synthetic fixtures. | No private records or production tokens in public GitHub, actions, artifacts, screenshots or build logs. Global CI is not a production data processor. |
| Intuit | Applications reportedly connected, not independently verified. | Intuit source hosting, OAuth and onward-processing residency remain unverified external dependencies. No live authorization/API calls until owner resolves that boundary. |

## Retention and deletion proposal (approval required)

Business owner must approve schedules before real data: propose raw time/reporting history 24 months, application logs 30 days, business audit 7 years only if justified by policy, backup 14 days, PITR within supported configured window. These are design suggestions, not legal requirements or enabled TTLs. Membership access revocation is immediate on subsequent backend requests. Deletion requires a preview per tenant, dependency inventory, legal-hold check, explicit authorization, bounded transactions, audit and verification. Do not delete audits casually; minimize identity data in audit (opaque subject), and retain separately controlled deletion evidence. Backups expire independently; restored data must reapply deletion/revocation tombstones before access is enabled. Restore into a locked Canadian test database only after approval; record tested RPO/RTO before production.

## Unresolved production blockers

Define whether the mandate covers customer content only or also account/control-plane metadata, support access, telemetry and all network transit. Resolve authentication, existing mandatory log bucket locations, ingress/TLS/network path and Intuit terms. No collection location alone proves end-to-end compliance. A registered Firebase web app does not resolve these gates. No production claim is made.

## Primary sources

- [Firebase privacy — Authentication US-only and global services](https://firebase.google.com/support/privacy)
- [Firestore locations](https://firebase.google.com/docs/firestore/locations) and [regional endpoints](https://firebase.google.com/docs/firestore/regional-endpoints)
- [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations)
- [Regional Secret Manager residency](https://docs.cloud.google.com/secret-manager/regional-secrets/data-residency), [supported locations](https://docs.cloud.google.com/secret-manager/docs/locations), [endpoint setup](https://docs.cloud.google.com/secret-manager/regional-secrets/config-sm-rs)
- [Cloud Run regional-secret limitation](https://docs.cloud.google.com/run/docs/configuring/services/secrets#regional-secrets)
- [Firestore backups](https://firebase.google.com/docs/firestore/backups)
- [Logging regionality and immutable bucket locations](https://docs.cloud.google.com/logging/docs/region-support)
