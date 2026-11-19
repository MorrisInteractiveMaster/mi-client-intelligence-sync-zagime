# QuickBooks Time integration

The project-only workspace has a disabled-by-default read connector for legacy QuickBooks Time. This PR uses synthetic provider responses and named Firestore emulators. The owner previously reported a successful live `/current_user` request. The deployed account's jobcode, timesheet, deletion and approval permissions still require review.

- The connector uses GET `current_user`, `jobcodes`, `projects`, `timesheets` and `timesheets_deleted` on `https://rest.tsheets.com/api/v1`. It checks the credential user's ID and Time account slug and verifies regular leaf jobcodes with exact `ids` and an active/archived child check. The vendor's timesheet jobcode filters include descendants, so parent jobcodes are refused and every returned row must match the requested leaf exactly. Timesheet reads disable supplemental data. The deletion reference does not document a supplemental-data toggle, so the connector discards that response section in memory. No worker names, notes, payroll fields or employee identifiers are persisted. Exact project matches may persist their source name and status on the staff-only mapping. [Time API reference](https://tsheetsteam.github.io/api_docs/)
- Changes use the live and deleted feeds with `modified_since`, `modified_before`, numeric `page`, 50-row pages and the `more` flag. Each click processes up to seven days of modification history and five pages per feed, with one minute of lag and overlap. The configured floor concerns modification timestamps, so an older work date can enter through a later correction. Requests use a five-second timeout, a 2 MiB response bound, one request per second per instance and up to three attempts on throttling/transient failure. Long Retry-After delays stop the run so the operator can retry later.
- Only completed regular/manual time enters totals. The API can query on-clock rows, but the connector waits for completed time. `locked` is not a verified approval signal. All imported hours remain unknown approval pending a separate account-level verification of supported approval data. Reports show recorded and unallocated totals for the selected work month across imported records.
- Explicitly scoped deletions and corrections preserve immutable normalized versions. The source ID includes product/account/external ID. Source changes that alter duration, jobcode or work date reverse the prior applied split atomically and keep Morris allocation intent and revision history. A staff member can then review and save a new split for an active record. The connector writes no project-managed fields. Only applied aggregates from published, authorized projects reach clients.
- A filtered incremental feed cannot prove a row was moved to an unapproved jobcode, or recognize a tombstone whose original jobcode the vendor omits. The connector does not infer deletions from absence. Keep that limitation in the owner review and stop using the totals if such a move is known until scoped reconciliation is reviewed. The API exposes numbered pages rather than a snapshot cursor. Overlap and idempotent replay mitigate retries, but do not guarantee detection of late backdated vendor changes outside the overlap. This release does not automate historical backfill or polling.
- Intuit describes phased migration of Classic Time to QuickBooks Online. Confirm the legacy API and grant still work for the approved account before rollout. The migration notice establishes no API shutdown date for this account. The separate Accounting connector remains disabled. [Intuit migration notice](https://quickbooks.intuit.com/learn-support/en-us/help-article/time-tracking/classic-quickbooks-time-moving-quickbooks-online/L5tnv0Sms_US_en_US)

## Project search and the standard Accounting API

Search by project name, work-order reference or internal ID. The secured list checks 25 authorized projects at a time and offers a continuation when more remain. **View hours** shows monthly recorded and unallocated hours, lifetime recorded hours, mapped Time jobcodes and source freshness for the selected project. The project card shows monthly and lifetime hours applied through Morris allocations. Clients search only their published project results. Project Time totals are maintained at `timeProjectTotals/{internalProjectId}/periods/{monthOrLifetime}` in the same transactions as tenant totals.

The prior synthetic prototype reads Accounting `TimeActivity` fixtures and joins `CustomerRef.value` to a work-order lookup, then totals `Hours` and `Minutes`. That establishes the prototype's method. The exact previous live method is still unverified. The only live request documented in the handoff is legacy Time `GET /current_user`.

Intuit documents standard Accounting entity GET-by-ID and queries. Its SDK documents `TimeActivity.Id`, `CustomerRef`, `TxnDate`, `Hours` and `Minutes`. A response field alone does not establish that it can be used as an Accounting query filter. A read using an explicitly approved `TimeActivity` ID is a standard candidate for an authorized sandbox check. To use Accounting for search or sync, first establish the exact supported project filter and association for the realm from a sanitized prior request or scoped sandbox proof. [Intuit REST operations](https://static.developer.intuit.com/output_html/qbo/docs/learn/rest-api-features.html) · [TimeActivity SDK reference](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/TimeActivity.html)

The Time jobcode path requires no premium Projects API or tier upgrade. The Accounting investigation provides no authority for Customer discovery, unscoped TimeActivity queries or financial reads. A future Accounting adapter needs separate realm and credential binding, explicit reference mappings, and a rule to prevent double counting exported Time entries.

## Owner-reviewed staging activation

The connector remains off unless `ENABLE_QUICKBOOKS_TIME=true` is explicitly set. Merge alone does not turn it on. Follow [the project-only staging runbook](project-only-operator-runbook.md) for named-database, staff identity and client publication checks. Use the existing Cloud Run service and the existing `mi-client-staging` database in Montréal. No step targets `(default)`.

1. Record owner approval for one Zagimē regular leaf jobcode, its internal project ID, the narrow UTC modification floor and which workers' relevant time may be processed. Assign one existing verified Morris staff Firebase UID as connector operator. Confirm Intuit grants this credential the authorized leaf, completed-timesheet and deletion reads. Confirm how vendor dates and approval states are represented for that exact account. Approval stays unknown until there is source evidence for a stronger classification.
2. Independently verify the exact credential against the vendor's account and grant records. The legacy grant response documents `company_id`, `user_id` and `client_url`; `current_user` confirms the active user ID and account slug but does not document `company_id`. For a pre-issued credential, require independent account evidence linking that exact credential to the numeric company ID, user, slug and approved jobcode. Hold activation if that evidence is unavailable. The operator records approval without copying the credential or raw grants into a ticket.
3. In an approved secret-handling environment, put only a JSON object with keys `companyId`, `userId`, `clientUrl`, `tenant`, `jobcodeIds` (array), `expiresAt` (UTC ISO timestamp with milliseconds), and `accessToken` in a Montréal regional Secret Manager version. Use string IDs. Record the SHA-256 of the exact JSON bytes and the resulting numeric version in the restricted deployment review. The backend validates the digest, expiry and binding before its first Intuit request. No refresh token is needed for this pilot. Token renewal requires a separately approved replacement version and digest. The owner must separately approve `secretmanager.versions.access` scoped to that secret for the existing attached runtime identity. Cloud Run cannot mount regional secrets natively, so the application uses the documented regional access API with the attached identity. Do not fall back to a global secret, file or environment token. [Regional secret access](https://docs.cloud.google.com/secret-manager/regional-secrets/access-secret-version-rs) · [Cloud Run secret limitations](https://docs.cloud.google.com/run/docs/configuring/services/secrets#regional-secrets)
4. Establish the rollout baseline with these read-only Cloud Shell Bash commands. Verify the existing service account, current traffic split, and approved regional image digest. Record the currently serving, tested rollback revision for the commands below. Confirm there is one serving revision before applying the 100% traffic commands. Otherwise record and restore the exact approved split.

```bash
PROJECT=morris-client-dash-zagime
REGION=northamerica-northeast1
SERVICE=mi-client-staging-dashboard
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.url,status.traffic,spec.template.spec.serviceAccountName,spec.template.spec.timeoutSeconds,spec.template.spec.containers[0].image)'
gcloud firestore databases describe --project="$PROJECT" --database=mi-client-staging \
  --format='yaml(name,uid,locationId,type)'
```

5. Separately approve deployment of the reviewed image with Time explicitly off. Use a pinned digest from the existing registry and preserve all existing auth, origin, scaling, runtime identity and database settings. Verify `/health`, the sign-in page, staff editing, a client session and named staging persistence with existing synthetic fixtures before enabling Time. The Cloud Run timeout is 210 seconds. Node's 10-second header/body receipt limits are unchanged. The application stops starting source work after 150 seconds or a disconnected browser. It waits for any in-flight Firestore transaction to settle and never clears another run's lease. A failed run retains the previous watermark; a crashed lease expires after 240 seconds. Single transaction attempts leave retries to the operator. [Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) · [Node request receipt timeout](https://nodejs.org/api/http.html#serverrequesttimeout)

```bash
# Set IMAGE_DIGEST to the approved immutable image URI for the reviewed commit.
: "${IMAGE_DIGEST:?Set the approved regional image digest}"
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$IMAGE_DIGEST" --timeout=210s --no-traffic \
  --update-env-vars=ENABLE_QUICKBOOKS_TIME=false
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.latestReadyRevisionName,status.traffic,spec.template.spec.timeoutSeconds)'
# After approval, set REVIEWED_REVISION to the above ready revision.
: "${REVIEWED_REVISION:?Set the approved ready revision}"
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$REVIEWED_REVISION=100"
```

6. Separately approve activation after verifying the rollout and signing off all account and data-scope gates. Set the shell variables below to approved values in the restricted operator session. These values are identifiers, a version and a hash. The access token stays in Secret Manager. The command preserves the existing named-database and staff authorization settings. Verify the retained tenant matches the approved credential and project mapping. Stage the revision without traffic, verify that its revision is ready and that the prior revision still serves traffic, then separately approve promoting the activation revision.

```bash
: "${TIME_OPERATOR_UID:?Set the approved Firebase UID}"
: "${TIME_ACCOUNT_ID:?Set the approved Time company ID}"
: "${TIME_CLIENT_URL:?Set the approved Time account slug}"
: "${TIME_USER_ID:?Set the approved credential user ID}"
: "${TIME_JOBCODE:?Set the single approved leaf ID}"
: "${TIME_FROM:?Set the approved UTC modification floor YYYY-MM-DD}"
: "${TIME_SECRET_ID:?Set the reviewed Montreal regional secret ID}"
: "${TIME_SECRET_VERSION:?Set the approved numeric version}"
: "${TIME_SHA256:?Set the approved SHA-256 of the version payload}"

gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --timeout=210s --no-traffic \
  --update-env-vars="ENABLE_QUICKBOOKS_TIME=true,QUICKBOOKS_TIME_ADMIN_UID=$TIME_OPERATOR_UID,QUICKBOOKS_TIME_ACCOUNT_ID=$TIME_ACCOUNT_ID,QUICKBOOKS_TIME_CLIENT_URL=$TIME_CLIENT_URL,QUICKBOOKS_TIME_CREDENTIAL_USER_ID=$TIME_USER_ID,QUICKBOOKS_TIME_APPROVED_JOBCODES=$TIME_JOBCODE,QUICKBOOKS_TIME_MODIFIED_FROM=$TIME_FROM,QUICKBOOKS_TIME_SECRET_ID=$TIME_SECRET_ID,QUICKBOOKS_TIME_SECRET_VERSION=$TIME_SECRET_VERSION,QUICKBOOKS_TIME_CREDENTIAL_SHA256=$TIME_SHA256"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.latestReadyRevisionName,status.traffic,spec.template.spec.serviceAccountName,spec.template.spec.timeoutSeconds)'
# After separate approval, set ACTIVATION_REVISION to the verified ready revision.
: "${ACTIVATION_REVISION:?Set the approved activation revision}"
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$ACTIVATION_REVISION=100"
```

7. As the designated connector operator, select the approved internal project, enter the one approved jobcode and choose **Approve Time mapping**. The server checks the attached credential, active Time identity and exact leaf scope. Review the metadata state. A 403 or 404 from the project metadata endpoint is shown as unavailable, and an empty exact result is shown separately. These states permit the separately verified jobcode-only association. Unexpected rows, pagination of an exact association, and a changed Time project ID fail closed before timesheet reads. Click **Sync jobcode** once. Compare the resulting checkpoint, source counts, work dates, integer seconds, allocation totals and authorization boundaries against the approved reference. Keep this evidence in the restricted operator record. If the source has no scoped data or returns unusable deletion information, hold further rollout.
8. If anything diverges, route all traffic back to the reviewed connector-disabled revision and independently verify that the Time workspace reports disconnected. This preserves projects and historical revisions. Allow up to four minutes for an abandoned lease to expire. Source rows already committed require reviewed reconciliation if their reporting impact needs to change.

```bash
: "${REVIEWED_REVISION:?Set the verified connector-disabled rollback revision}"
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$REVIEWED_REVISION=100"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.url,status.traffic)'
```

Per tenant, the connector uses `timeMappings/{accountJobHash}`, `syncCheckpoints/{providerAccountJobHash}`, `timeMonthlyTotals/{month}` and existing `rawTime/{sourceId}` with immutable `versions/{revision}`. Staff-only Time metadata lives on the mapping. It never replaces Morris project names, status, notes or publication. The same verified named database safeguards cover every request. Sync reserves a fenced lease, validates both feeds before any source write, then applies each row transactionally. A later row failure leaves the previous watermark intact, and replay skips already committed versions. Existing query indexes suffice.
