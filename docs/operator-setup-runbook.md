# Owner setup runbook — M3 (NOT EXECUTED)

Target project: **morris-client-dash-zagime**. Every cloud-changing step below is **REQUIRES OWNER APPROVAL**, even if an earlier step was approved. This document is an operator plan, not permission to execute it. No command below was run in this milestone. Do not paste the entire document into a terminal. Confirm each gated operation and its rollback before proceeding. No secrets, tokens or real records belong in terminal history, GitHub or screenshots.

## 1. Inventory and stop/go decision (read-only)

Use a reviewed local Google Cloud CLI installation and an authorized operator account. Do not use globally hosted Cloud Shell for sensitive credential handling under the Canada-only policy.

```powershell
gcloud auth list
gcloud projects describe morris-client-dash-zagime
gcloud billing projects describe morris-client-dash-zagime
gcloud services list --enabled --project=morris-client-dash-zagime
gcloud firestore databases list --project=morris-client-dash-zagime
gcloud logging buckets list --project=morris-client-dash-zagime --location=global
gcloud logging buckets list --project=morris-client-dash-zagime --location=northamerica-northeast1
```

Console: project selector → exact ID → Billing → verify owning organization/account, operator authority, Blaze linkage and budgets. Firebase → Project settings → Your apps: compare Web App ID 1:892989290947:web:d5189c017d20b65cc0a576 and auth domain morris-client-dash-zagime.firebaseapp.com to the user-reported values; no API key is required here. Check Firestore/Storage inventory rather than assuming previous snapshots are current. The latest user handoff supersedes the earlier report of an existing empty database: **Firestore and Storage are reported NOT CREATED**. Stop if inventory differs; do not replace an existing database.

Review docs/canadian-residency.md. Verify Montréal support in linked service docs. Inspect Logging → Logs Storage and all sinks, including organization/folder sinks and immutable _Required buckets. Existing global mandatory logs are a gate: routing new application logs does not relocate them. Resolve Firebase Auth's US processing and any global identity/control-plane exceptions with the owner before data-bearing infrastructure. If the current project cannot meet policy, stop for owner decision; do not create a replacement project automatically.

**REQUIRES OWNER APPROVAL:** billing linkage/budget changes, organization restrictions, regional endpoint policies, log-location defaults, sink modifications, or a replacement project. Record separate reviewed recovery procedures; no changes in this runbook's read-only stage.

## 2. Enable approved prerequisite APIs

**REQUIRES OWNER APPROVAL — API activation changes cloud configuration.** Only after residency/ownership gates are resolved:

```powershell
gcloud services enable firestore.googleapis.com run.googleapis.com secretmanager.googleapis.com logging.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --project=morris-client-dash-zagime
```

Enable Scheduler or additional identity/database APIs only in a later approved task that needs them; this foundation has no schedules or functions. Verify the enabled list afterward. Rollback must check all existing dependants before disabling APIs; never disable a shared production API as a generic undo.

## 3. Create a locked Canadian Firestore Standard database

**REQUIRES OWNER APPROVAL — paid resource creation, irreversible location decision and security configuration.** Recheck database absence. Console → Firestore → Create database → **Standard**, Native mode, database (default), **regional northamerica-northeast1 (Montréal)**. In Firebase's database wizard choose **production/locked mode**, never test mode. Review final location before confirming. No Cloud Storage bucket is needed; do not create one.

Equivalent reviewed CLI creation (owner selects one method, not both):

```powershell
gcloud firestore databases create --project=morris-client-dash-zagime --database='(default)' --location=northamerica-northeast1 --type=firestore-native --edition=standard --delete-protection
```

Read-only verification:

```powershell
gcloud firestore databases describe --project=morris-client-dash-zagime --database='(default)'
```

Before any data, verify browser rules are deny-all. **REQUIRES OWNER APPROVAL — publishing reviewed rules** (a future separate operation, not performed here):

```powershell
npx firebase deploy --only firestore:rules --project=morris-client-dash-zagime
```

This uses the reviewed firestore.rules file; keep all indexes and browser access closed until separately reviewed. Test denial without writing real records. Prefer a separately approved Canadian synthetic staging environment for first remote tests; do not point the current demo/emulator tests at this project.

Rollback: no automatic deletion. A created database with deletion protection requires another reviewed owner action to delete; preserve configuration and audit evidence. No data migration/restore is authorized by creation approval.

## 4. Backend service identities

**REQUIRES OWNER APPROVAL — IAM/service-account changes.** Console → IAM & Admin → Service Accounts → create separate candidates mi-api, mi-qbo-sync, mi-time-sync (only when that worker is approved), and a separately governed release identity. Do not create downloadable JSON keys. Future Cloud Run services use attached service identity/ADC; future CI uses reviewed Workload Identity Federation, never a long-lived service-account key in GitHub.

Candidate API data role: roles/datastore.user scoped to the intended project/database where supported. It is a privileged database role and is not tenant/project-record authorization; application membership/scope checks remain mandatory. Never grant Owner/Editor to runtime accounts. Sync identities must be isolated from interactive API credentials and reviewed for their precise read/write permissions. Firestore IAM cannot be assumed to enforce per-collection ownership, so worker code must preserve Morris-owned fields independently.

Console IAM → grant only reviewed minimal roles; Secret Manager → each specific regional secret → Permissions → runtime accessor only for approved identities. Token rotation identity additionally needs approved secret-version-add permission; it must not broadly administer all secrets. No IAM changes are implemented here.

## 5. Regional secrets, logging and recovery controls

**REQUIRES OWNER APPROVAL — regional secret creation.** Console → Secret Manager → **Regional secrets** → Create regional secret → Region **northamerica-northeast1**, use separate IDs per source/company and purpose. Do not use the default global secret page or automatic replication. Never upload a real value during this milestone; a later approved task can create a synthetic staging secret first.

For a future authorized CLI operator, use a separate local gcloud configuration/profile to avoid changing other projects' defaults. Configure the regional endpoint, then create an empty container:

```powershell
gcloud config set api_endpoint_overrides/secretmanager https://secretmanager.northamerica-northeast1.rep.googleapis.com/
gcloud secrets create qbo-oauth-staging --location=northamerica-northeast1 --project=morris-client-dash-zagime
```

Both the profile/endpoint setup and cloud mutation require the operator's reviewed scope; the create is **REQUIRES OWNER APPROVAL**. No real secret-version upload command is provided. Never pass secret values on the command line. Future credential handling must use the approved secret UI or secure input, without screen recording/logging. Resource name: projects/morris-client-dash-zagime/locations/northamerica-northeast1/secrets/SECRET_ID/versions/VERSION. Cloud Run does not support built-in regional-secret injection: the future application must call the regional Secret Manager API from Montréal using ADC, and prove that path in synthetic staging. Do not silently substitute a global secret.

**REQUIRES OWNER APPROVAL — log configuration:** Logging → Logs Storage → Create bucket in Montréal with approved retention; review routing and organization defaults before workloads. Do not enable global analytics/Gemini log-query storage or payload logging. Verify _Required/_Default location gates from step 1 remain satisfied.

**REQUIRES OWNER APPROVAL — backup/PITR/retention:** Firestore database → Disaster recovery/Backups → select approved daily schedule/retention; enable PITR if approved. Verify backup location equals Montréal. Approve RPO/RTO and deletion/legal-hold policy before schedules or TTL. Do not export to Storage or another region. Test restore later into a separately approved locked Canadian destination; database deletion does not remove backups. These are design gates, not active settings.

## 6. Approve authentication and delivery architecture

**REQUIRES OWNER APPROVAL — identity provider, accounts, MFA, session storage, ingress, TLS, hosting and backend deployment.** Do not enable Firebase Authentication under strict Canada-only identity processing. Select a Canadian-hosted OIDC alternative (including Canadian identity DB/backups/logs) or obtain a separately documented policy exception before using any global identity provider. Define trusted issuer, audience, key rotation, signature algorithms, short session lifetimes, revocation, CSRF/origin controls and account approval. Never make prototype roles into credentials.

Future persistence: keep deny-all browser Firestore rules and put a Canadian authenticated backend between the browser and Firestore. No production HTTP handler, real token verifier or database adapter exists yet. Approve and implement these as a separate continuation with synthetic staging tests. Only then bootstrap the first approved tenant administrator through a controlled server-side procedure; no self-assignment of roles.

Proposed delivery: static React build served from Canadian runtime with approved regional/private ingress, no global CDN by assumption. Keep future backend/jobs/artifact storage/build processing Canadian. Region selection alone does not certify internet transit, control-plane metadata or Intuit processing. No Cloud Run deployment command or OAuth callback registration is authorized here.

## 7. Test safely, then obtain release review

Local commands (no cloud approval needed; uses demo-mi-security only):

```powershell
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run test:security
```

Node 24 and Java 21+ must be on PATH. The security runner uses loopback Firestore, a demo project and synthetic records; it never uses the real project ID. Do not run firebase login/use/deploy or copy real configuration into these tests. Unit tests simulate verified identities and independently test backend permissions; they do not verify a real provider's JWT signatures.

**REQUIRES OWNER APPROVAL — future staging provisioning/data writes, sandbox OAuth or remote smoke tests.** Define exact synthetic test accounts, private-default project, allowed editor changes, publication read, client denial, cross-tenant/disabled denial, audit and no-op expectations. Inspect regional logs and secret access without values. Do not connect Morris's live QuickBooks company. Pass architecture/security review before any production release, scheduled job, real data or traffic change. A merged code PR alone is not deployment authority.

Sources and capability gates: docs/canadian-residency.md; [Firestore create command](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/create); [regional secret creation](https://docs.cloud.google.com/secret-manager/regional-secrets/create-regional-secret).
