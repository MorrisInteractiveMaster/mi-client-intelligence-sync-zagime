# QuickBooks Online invoices · owner activation and recovery

The invoice integration starts disabled. It reads the **Invoice** entity for one approved company and explicit CustomerRef IDs, and makes no accounting writes. QuickBooks Time retains its separate 06:00 America/Regina job, credentials, worker, and data. Automatic invoice sync needs **one new HTTP Cloud Scheduler job and one dedicated caller service account**. It uses the existing dashboard and named Firestore database. No new worker, service, database, or Time change is required.

## Verify identifiers before any production sync

1. Sign in privately to QuickBooks Online under the Morris company. Compare the company ID shown under **Settings → Account and settings → Billing & subscription** (or where Intuit exposes the company ID for your subscription) with the realm shown in the Intuit developer portal for that exact app and company. Record the owner-verified numeric realm. The OAuth callback independently requires an exact realm match.
2. Open several known Zagimē invoices **in the QuickBooks UI**. Confirm the recipient, work descriptions and accounting ownership. Inspect the selected customer card's numeric ID if visible, then verify against the Invoice's `CustomerRef.value` using Intuit's production API Explorer with an owner-authorized session. Use bounded exact invoice numbers in the Invoice entity only, for example `SELECT * FROM Invoice WHERE DocNumber = '209841' MAXRESULTS 10`. Check invoice number, date, total and customer against the same QuickBooks invoice. Never use a display name as proof of scope or send records or credentials into chat.
3. Repeat for representative invoices under each relevant child job or project. Add child `CustomerRef.value` only if its recipient is verified to belong to this client. Capture `ProjectRef.value` independently where present. A QBO company ID, QBO CustomerRef, QBO ProjectRef, internal platform project ID and QuickBooks **Time** jobcode ID are distinct identifiers. Do not reuse Time jobcode IDs in the QBO configuration.
4. In Morris **Project Management**, open each matching Parent Project and Delivery Project. Copy the exact internal project ID from its authorized route. Confirm the work order and parentage with the project owner. Map verified QBO project IDs and exact work-order aliases to those internal IDs. Independently verify the company's home currency in QuickBooks and the currency on representative invoices. The home currency is used only when the Invoice omits CurrencyRef. [Invoice reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice) · [Invoice query syntax](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html)

An example mapping uses synthetic internal IDs: `[{"projectId":"reviewed-parent-id","workOrder":"WO1267"},{"projectId":"reviewed-delivery-id","workOrder":"WO1267.1","qboProjectId":"451"}]`. Only an explicit project or job reference or a complete work-order mention in an invoice line may match. An invoice linked to several projects appears in any corresponding filter and contributes once to totals. All linked projects must be published and accessible to a client. An unmapped invoice remains private until the owner explicitly selects approved client profiles. Compare the profile ID suffix with the authorized access inventory before approving. Staff-only memos, connection settings and source IDs stay out of the client response.

## Real Intuit sandbox acceptance

Use the approved staging dashboard and named staging database, a separate Intuit sandbox company and development app, separate Secret Manager versions, and synthetic invoices only. Set `QBO_INVOICES_SANDBOX=true`, the sandbox realm and exact synthetic CustomerRef IDs. Register the staging origin plus `/qbo-invoice-callback.html` in the development app. Keep staging and production app credentials, encryption keys and customer scopes separate.

1. In the sandbox UI, create synthetic invoices with paid, partial, unpaid, due-today, past-due and no-mapping conditions. Create another customer that must never appear. Link one invoice to multiple approved project references and leave one for a private project.
2. Connect from the authenticated owner workspace, deliberately select the wrong company once and verify rejection, then connect to the correct company. Verify the full scope, amount/currency, freshness timestamp, unpaid versus overdue and authorized filter results. Approve one linked invoice and one targeted unmapped invoice, then check permitted and non-permitted signed-in client accounts.
3. In Intuit, settle an invoice, apply a credit, void one, delete another and correct a due date. Resync. Verify the balance clears its badge, voided/deleted rows disappear after a complete sync, and the correction needs renewed approval. Check stale warning after a failed refresh using isolated staging conditions. Reconnect and verify token rotation by syncing twice. If scheduling is in scope, use a distinct staging caller and trigger only its staging job.
4. Disconnect in staging and verify balances become unavailable and the callback, dashboard and unrelated billing records remain safe. Record evidence for the release decision. The automated suite uses synthetic provider responses, so a real Intuit sandbox run is a separate acceptance gate. [Intuit OAuth setup](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)

## 1 · Read-only production preflight

Use an approved Cloud Shell with tracing off. Work from the reviewed, clean merged commit. Values supplied below are identifiers or public dashboard build settings. Do not put the Intuit credentials or encryption key in shell commands, files, environment exports, logs, chat or build arguments. Each phase function returns on error so the interactive terminal stays open.

```bash
set +x
Q_PROJECT=morris-client-dash-zagime
Q_REGION=northamerica-northeast1
Q_SERVICE=mi-client-prod-dashboard
Q_TENANT=zagime-production
Q_DATABASE=mi-client-production
Q_JOB=mi-client-prod-qbo-invoices-daily
Q_CALLER=mi-client-qbo-invoice-trigger
Q_PATH=/api/internal/qbo-invoices/sync
qg() {
  CLOUDSDK_CORE_LOG_HTTP=false CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true \
    gcloud --quiet --verbosity=error "$@"
}
qtraffic() {
  jq -er '[.status.traffic[] | select((.percent // 0)>0)] |
    select((map(.percent)|add)==100 and all(.[];.revisionName!=null)) |
    group_by(.revisionName)|map("\(.[0].revisionName)=\(map(.percent)|add)")|join(",")' "$1"
}
qpreflight() {
  Q_EVIDENCE=$(umask 077; mktemp -d) || return 1
  [[ $(qg firestore databases describe --project="$Q_PROJECT" --database="$Q_DATABASE" --format='value(uid)') == b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd ]] || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/before.json" || return 1
  Q_RUNTIME=$(jq -er '.spec.template.spec.serviceAccountName' "$Q_EVIDENCE/before.json") || return 1
  Q_ORIGIN=$(jq -er '.status.url | select(test("^https://[a-z0-9.-]+$"))' "$Q_EVIDENCE/before.json") || return 1
  jq -e --arg origin "$Q_ORIGIN" '.spec.template.spec.containers[0].env | any(.name=="ALLOWED_ORIGIN" and .value==$origin)' "$Q_EVIDENCE/before.json" >/dev/null || return 1
  Q_PRIOR=$(qtraffic "$Q_EVIDENCE/before.json") || return 1
  qg scheduler jobs describe mi-client-prod-time-daily --project="$Q_PROJECT" --location="$Q_REGION" --format=json > "$Q_EVIDENCE/time-schedule.json" || return 1
  jq -e '.state=="ENABLED" and .schedule=="0 6 * * *" and .timeZone=="America/Regina" and (.httpTarget.uri|endswith("/jobs/mi-client-prod-time-sync:run"))' "$Q_EVIDENCE/time-schedule.json" >/dev/null || return 1
  qg run jobs describe mi-client-prod-time-sync --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/time-worker.json" || return 1
  curl -fsS --max-time 20 "$Q_ORIGIN/health" >/dev/null || return 1
  printf 'Preflight recorded in %s\nPrior traffic %s\nOAuth redirect %s/qbo-invoice-callback.html\n' "$Q_EVIDENCE" "$Q_PRIOR" "$Q_ORIGIN"
}
if qpreflight; then printf 'Review the private preflight record.\n'; else printf 'STOP: production preflight failed.\n' >&2; fi
```

Confirm the working dashboard takes unauthenticated HTTPS requests at Cloud Run's perimeter and enforces app-level Firebase authorization for private routes. This procedure targets that existing service model. If the existing runtime differs from the captured configuration or uses a different approved origin, stop and review the routing and OAuth configuration rather than changing production access.

## 2 · Owner-approved secret versions and identifier settings

The suggested QBO-specific Secret Manager names are below. Review existing versions and reuse explicitly verified versions when available. If a describe command fails for access or availability, stop and resolve it first. Create only missing secrets through the authorized change. Use the existing project's Montréal user-managed replication. The commands attach Secret Accessor only on these three secrets to the existing dashboard identity. The scheduler caller receives no secret, storage, Firestore, or project role.

```bash
Q_ID_SECRET=mi-qbo-invoices-client-id
Q_CLIENT_SECRET=mi-qbo-invoices-client-secret
Q_KEY_SECRET=mi-qbo-invoices-token-key

# Run once for each verified missing secret name.
qcreate_secret() {
  qg secrets create "$1" --project="$Q_PROJECT" --replication-policy=user-managed --locations="$Q_REGION"
}
# qcreate_secret "$Q_ID_SECRET"
# qcreate_secret "$Q_CLIENT_SECRET"
# qcreate_secret "$Q_KEY_SECRET"

# For a new client credential version, run the following function twice.
qadd_private_version() {
  local input version
  read -rs -p "Enter the approved value for $1: " input || return 1
  printf '\n' >&2
  [[ -n "$input" ]] || return 1
  version=$(printf '%s' "$input" | qg secrets versions add "$1" --project="$Q_PROJECT" --data-file=- --format='value(name)') || return 1
  unset input
  printf '%s\n' "${version##*/}"
}
# Q_ID_V=$(qadd_private_version "$Q_ID_SECRET")
# Q_CLIENT_V=$(qadd_private_version "$Q_CLIENT_SECRET")

# Run only when creating a new connection with no existing encrypted refresh token.
# Preserve the existing pinned key for an already connected environment.
qnew_key_version() {
  local version
  version=$(openssl rand -base64 32 | tr -d '\r\n' | qg secrets versions add "$Q_KEY_SECRET" --project="$Q_PROJECT" --data-file=- --format='value(name)') || return 1
  printf '%s\n' "${version##*/}"
}
# Q_KEY_V=$(qnew_key_version)

# For reused secrets, set Q_ID_V, Q_CLIENT_V and Q_KEY_V to independently verified numeric versions.
qverify_bindings() {
  local pair name version
  for pair in "$Q_ID_SECRET:${Q_ID_V:-}" "$Q_CLIENT_SECRET:${Q_CLIENT_V:-}" "$Q_KEY_SECRET:${Q_KEY_V:-}"; do
    name=${pair%:*}; version=${pair##*:}
    [[ "$version" =~ ^[1-9][0-9]*$ ]] || return 1
    [[ $(qg secrets versions describe "$version" --secret="$name" --project="$Q_PROJECT" --format='value(state)') == ENABLED ]] || return 1
    qg secrets get-iam-policy "$name" --project="$Q_PROJECT" --format=json > "$Q_EVIDENCE/$name-iam.json" || return 1
  done
}
# Apply only missing reviewed grants.
qbind_secret() {
  qg secrets add-iam-policy-binding "$1" --project="$Q_PROJECT" --member="serviceAccount:$Q_RUNTIME" --role=roles/secretmanager.secretAccessor
}
# qbind_secret "$Q_ID_SECRET"
# qbind_secret "$Q_CLIENT_SECRET"
# qbind_secret "$Q_KEY_SECRET"
if qverify_bindings; then printf 'Pinned versions are enabled. Review the per-secret IAM records.\n'; else printf 'STOP: secret version or IAM check failed.\n' >&2; fi

read -r -p 'Verified QBO realm: ' Q_REALM
read -r -p 'Verified CustomerRef IDs, comma separated: ' Q_CUSTOMERS
read -r -p 'Verified ISO home currency: ' Q_CURRENCY
read -r -p 'Reviewed project mapping JSON (use [] if none): ' Q_MAP
qverified_settings() {
  [[ "$Q_REALM" =~ ^[0-9]{1,32}$ && "$Q_CUSTOMERS" =~ ^[0-9]{1,32}(,[0-9]{1,32})*$ && "$Q_CURRENCY" =~ ^[A-Z]{3}$ ]] || return 1
  Q_MAP=$(jq -ce 'select(type=="array" and length<=100)' <<< "$Q_MAP") || return 1
  [[ "$Q_MAP" != *"~"* ]] || return 1
}
if qverified_settings; then printf 'Review the verified scope before building.\n'; else printf 'STOP: invalid QBO settings.\n' >&2; fi
```

Runtime variables are `QBO_INVOICES_ENABLED`, `QBO_INVOICES_TENANT`, `QBO_INVOICES_REALM`, `QBO_INVOICES_CUSTOMER_IDS`, `QBO_INVOICES_CURRENCY`, `QBO_INVOICES_PROJECT_MAP`, `QBO_INVOICES_SANDBOX`, `QBO_INVOICES_CLIENT_ID`, `QBO_INVOICES_CLIENT_SECRET`, and `QBO_INVOICES_TOKEN_KEY`. The service encrypts and stores the automatically rotating refresh token in named Firestore. Its access token is held in memory. Do not generate or supply either token manually.

## 3 · Approved build and zero-traffic verification

Set `REVIEWED_SHA`, `SOURCE_BUCKET` and the four existing public build variables documented in the dedicated build runbook. No QBO values are build arguments. Use the existing dedicated build account. [Build settings and approvals](production-build-iam.md#3-verify-the-equivalent-build-before-removing-editor)

```bash
qbuild() {
  git fetch origin main || return 1
  [[ "${REVIEWED_SHA:-}" =~ ^[a-f0-9]{40}$ && -n "${SOURCE_BUCKET:-}" ]] || return 1
  [[ $(git rev-parse HEAD) == "$REVIEWED_SHA" && -z $(git status --porcelain) ]] || return 1
  git merge-base --is-ancestor "$REVIEWED_SHA" origin/main || return 1
  python3 scripts/production-build.py submit --approved-build \
    --repository "$PWD" --revision "$REVIEWED_SHA" --source-bucket "$SOURCE_BUCKET"
}
# After owner build approval:
# if qbuild; then printf 'Wait for SUCCESS, then record its build ID.\n'; fi
read -r -p 'Successful approved regional build ID: ' Q_BUILD

qcandidate() {
  Q_READY=0
  qverified_settings && qverify_bindings || return 1
  Q_IMAGE=$(python3 scripts/production-build.py verify --build-id "$Q_BUILD" --revision "$REVIEWED_SHA" --source-bucket "$SOURCE_BUCKET") || return 1
  [[ "$Q_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/live.json" || return 1
  [[ $(qtraffic "$Q_EVIDENCE/live.json") == "$Q_PRIOR" ]] || return 1
  Q_TAG="qbo-${REVIEWED_SHA:0:8}-$(date -u +%H%M%S)"
  local config="^~^QBO_INVOICES_ENABLED=true~QBO_INVOICES_TENANT=$Q_TENANT~QBO_INVOICES_REALM=$Q_REALM~QBO_INVOICES_CUSTOMER_IDS=$Q_CUSTOMERS~QBO_INVOICES_CURRENCY=$Q_CURRENCY~QBO_INVOICES_PROJECT_MAP=$Q_MAP~QBO_INVOICES_SANDBOX=false~QBO_INVOICES_SCHEDULE_ENABLED=false"
  local secrets="QBO_INVOICES_CLIENT_ID=$Q_ID_SECRET:$Q_ID_V,QBO_INVOICES_CLIENT_SECRET=$Q_CLIENT_SECRET:$Q_CLIENT_V,QBO_INVOICES_TOKEN_KEY=$Q_KEY_SECRET:$Q_KEY_V"
  qg run deploy "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --image="$Q_IMAGE" \
    --no-traffic --tag="$Q_TAG" --update-env-vars="$config" --update-secrets="$secrets" || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/candidate.json" || return 1
  [[ $(qtraffic "$Q_EVIDENCE/candidate.json") == "$Q_PRIOR" ]] || return 1
  Q_REV=$(jq -er --arg tag "$Q_TAG" '.status.traffic[]|select(.tag==$tag)|.revisionName' "$Q_EVIDENCE/candidate.json") || return 1
  Q_CANDIDATE=$(jq -er --arg tag "$Q_TAG" '.status.traffic[]|select(.tag==$tag)|.url' "$Q_EVIDENCE/candidate.json") || return 1
  qg run revisions describe "$Q_REV" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/revision.json" || return 1
  jq -e --arg account "$Q_RUNTIME" --arg image "$Q_IMAGE" '
    .spec.serviceAccountName==$account and .spec.containers[0].image==$image and
    any(.status.conditions[];.type=="Ready" and .status=="True")' "$Q_EVIDENCE/revision.json" >/dev/null || return 1
  diff <(jq -S '[.spec.template.spec.containers[0].env[]|select(.name|startswith("QBO_INVOICES_")|not)]|sort_by(.name)' "$Q_EVIDENCE/before.json") \
    <(jq -S '[.spec.containers[0].env[]|select(.name|startswith("QBO_INVOICES_")|not)]|sort_by(.name)' "$Q_EVIDENCE/revision.json") || return 1
  jq -e --arg id "$Q_ID_SECRET" --arg iv "$Q_ID_V" --arg secret "$Q_CLIENT_SECRET" --arg sv "$Q_CLIENT_V" --arg key "$Q_KEY_SECRET" --arg kv "$Q_KEY_V" '
    (.spec.containers[0].env|map({key:.name,value:.valueFrom.secretKeyRef})|from_entries) as $e |
    $e.QBO_INVOICES_CLIENT_ID=={name:$id,key:$iv} and $e.QBO_INVOICES_CLIENT_SECRET=={name:$secret,key:$sv} and
    $e.QBO_INVOICES_TOKEN_KEY=={name:$key,key:$kv}' "$Q_EVIDENCE/revision.json" >/dev/null || return 1
  curl -fsS --max-time 20 "$Q_CANDIDATE/health" | jq -e '.status=="ready"' >/dev/null || return 1
  [[ $(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$Q_CANDIDATE/api/v2/tenants/$Q_TENANT/invoices") == 401 ]] || return 1
  [[ $(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$Q_CANDIDATE$Q_PATH") == 404 ]] || return 1
  curl -fsS --max-time 20 "$Q_CANDIDATE/qbo-invoice-callback.html" >/dev/null || return 1
  Q_READY=1
  printf 'Reviewed candidate %s is at zero traffic.\n' "$Q_REV"
}
# After owner deployment approval:
# if qcandidate; then printf 'Review this revision before promotion.\n'; else printf 'STOP: candidate checks failed.\n' >&2; fi
```

Compare the complete candidate runtime shape with the captured production service privately, including timeout, networking and named database binding. Perform signed-in acceptance in approved staging. A Cloud Run tag may have a different origin from the production Firebase and OAuth origin. Do not weaken identity policy to connect from that tag.

## 4 · Owner promotion, connection, reconciliation and publication

```bash
qpromote() {
  [[ "${Q_READY:-0}" == 1 && "${1:-}" == "$Q_REV" ]] || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/promotion-before.json" || return 1
  [[ $(qtraffic "$Q_EVIDENCE/promotion-before.json") == "$Q_PRIOR" ]] || return 1
  qg run services update-traffic "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --to-revisions="$Q_REV=100" || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/promotion-after.json" || return 1
  [[ $(qtraffic "$Q_EVIDENCE/promotion-after.json") == "$Q_REV=100" ]] || return 1
  curl -fsS --max-time 20 "$Q_ORIGIN/health" | jq -e '.status=="ready"' >/dev/null
}
# After explicit promotion approval:
# if qpromote "$Q_REV"; then printf 'Perform signed-in verification at the canonical origin.\n'; fi
```

1. Open `$Q_ORIGIN/workspace/invoices` and sign in as the configured platform owner. Verify existing Morris and authorized client dashboard behavior before connecting. On first connection or reconnect, select the verified Intuit company and keep the owner tab open for the return. Register exactly `$Q_ORIGIN/qbo-invoice-callback.html` as the Intuit redirect. The separate Intuit Launch, Reconnect and Disconnect **landing links**, if requested by app settings, can point to `$Q_ORIGIN/workspace/invoices`. They are signed-in entry points. They do not perform a disconnect from a link. Reconnect and Disconnect are explicitly authorized in-page actions.
2. Implemented provider endpoints are authorization at `https://appcenter.intuit.com/connect/oauth2`, code exchange and refresh at `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`, revoke at `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`, and Invoice queries under `https://quickbooks.api.intuit.com/v3/company/<realm>/query` (sandbox host `sandbox-quickbooks.api.intuit.com`). The browser returns to the existing callback page. The authenticated app completes `POST /api/v2/tenants/<tenant>/invoices/callback`. The owner actions use `/invoices/connect`, `/invoices/sync`, `/invoices/disconnect`, and `/invoices/approval` under that same tenant API namespace. There is no public write callback or Intuit webhook. Restrict access to request logs because Intuit sends a short-lived single-use code in the OAuth callback query.
3. Click **Sync invoices**. Compare the complete snapshot total, sampled invoice amounts, due dates, project mappings and currency to QuickBooks at the same cutoff and same Invoice-only scope. The historical examples are 209841 for WO1268, **$27,639.26**, paid; 209840 for WO1267.1, **$2,100.00**, outstanding; and 209839 for WO1267, **$4,790.63**, outstanding. Historical account view totals were **$24,656.00 open** and **$17,765.37 overdue**. These values are reference checks, never seeds, and may differ by cutoff, aging or customer-account scope. Reconcile any variance with the actual invoice balances and due dates. Zero balance can reflect applied payments or credits. Invoice-only data cannot identify payment transaction dates. **Paid · issued this month** uses invoice dates. The amounts are stored as integer currency minor units; totals are separate per currency. A successful mirror removes deleted and voided invoices and material edits require reapproval. A failed or over-limit sync keeps the previous mirror. The limit is 500 queried invoices and a 700 KB complete mirror.
4. Review and approve each linked invoice for users with access to all its published projects. For an unmapped invoice, choose **Review client audience** and select only verified approved profiles. Balance-only changes remain visible after the next successful sync. Review revised dates, totals, currency, number, source customer or project linkage before reapproving. Confirm the signed-in client experience and that a verified zero balance clears its due/overdue alert.
5. Staff and clients see the last successful sync in Regina time. A later failure or 26 hours without success marks known balances stale. Disconnected or unavailable data does not establish a zero balance. Clients do not receive connection metadata. Use **Reconnect** when authorization is no longer valid. **Disconnect** revokes Intuit authorization and removes the mirror; private audit history persists.

## 5 · Optional automatic synchronization, 07:00 America/Regina

Perform this only after the first successful production reconciliation, with separate owner approval. Verify the existing Scheduler service agent binding and the configuring operator's existing permission to act as the dedicated caller. Never use the Time identity or alter the service agent's existing permissions. No service-wide public access change is required. [Cloud Scheduler HTTP authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth)

```bash
# Inspect first. Create the dedicated keyless identity once, only if absent.
# qg iam service-accounts create "$Q_CALLER" --project="$Q_PROJECT" --display-name='QBO invoice scheduled caller'
Q_EMAIL="$Q_CALLER@$Q_PROJECT.iam.gserviceaccount.com"
Q_SUBJECT=$(qg iam service-accounts describe "$Q_EMAIL" --project="$Q_PROJECT" --format='value(uniqueId)')
Q_AUDIENCE="$Q_ORIGIN$Q_PATH"
qstage_schedule() {
  [[ "$Q_SUBJECT" =~ ^[0-9]{15,32}$ ]] || return 1
  Q_SCHED_TAG="qbo-schedule-$(date -u +%H%M%S)"
  qg run deploy "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --image="$Q_IMAGE" \
    --no-traffic --tag="$Q_SCHED_TAG" \
    --update-env-vars="QBO_INVOICES_SCHEDULE_ENABLED=true,QBO_INVOICES_SCHEDULER_EMAIL=$Q_EMAIL,QBO_INVOICES_SCHEDULER_SUBJECT=$Q_SUBJECT" || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/scheduled-candidate.json" || return 1
  [[ $(qtraffic "$Q_EVIDENCE/scheduled-candidate.json") == "$Q_REV=100" ]] || return 1
  Q_SCHED_REV=$(jq -er --arg tag "$Q_SCHED_TAG" '.status.traffic[]|select(.tag==$tag)|.revisionName' "$Q_EVIDENCE/scheduled-candidate.json") || return 1
  local url
  url=$(jq -er --arg tag "$Q_SCHED_TAG" '.status.traffic[]|select(.tag==$tag)|.url' "$Q_EVIDENCE/scheduled-candidate.json") || return 1
  curl -fsS --max-time 20 "$url/health" | jq -e '.status=="ready"' >/dev/null || return 1
  [[ $(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$url$Q_PATH") == 401 ]]
}
# if qstage_schedule; then printf 'Inspect scheduler-enabled revision %s.\n' "$Q_SCHED_REV"; fi

# After verifying the scheduler-enabled revision against the serving invoice revision:
# qg run services update-traffic "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --to-revisions="$Q_SCHED_REV=100"

qcreate_schedule() {
  local serving
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/automation-serving.json" || return 1
  serving=$(qtraffic "$Q_EVIDENCE/automation-serving.json") || return 1
  [[ -n "${Q_SCHED_REV:-}" && "$serving" == "$Q_SCHED_REV=100" ]] || return 1
  qg scheduler jobs create http "$Q_JOB" --project="$Q_PROJECT" --location="$Q_REGION" \
    --schedule='0 7 * * *' --time-zone='America/Regina' --uri="$Q_AUDIENCE" --http-method=POST \
    --oidc-service-account-email="$Q_EMAIL" --oidc-token-audience="$Q_AUDIENCE" \
    --attempt-deadline=180s --max-retry-attempts=1 --min-backoff=60s --max-backoff=60s
}
# After explicit activation approval:
# if qcreate_schedule; then qg scheduler jobs describe "$Q_JOB" --project="$Q_PROJECT" --location="$Q_REGION"; fi
# Optionally run after approval and inspect the invoice timestamp and Scheduler result:
# qg scheduler jobs run "$Q_JOB" --project="$Q_PROJECT" --location="$Q_REGION"
```

Verify the existing dashboard request timeout allows the Scheduler's 180-second deadline. The app expects a bodyless POST, verifies the Google issuer, signature, exact endpoint audience, verified caller email and immutable caller subject, and runs only its configured tenant. Sync uses a shared Firestore lease for scheduled runs, manual runs and connection changes. Check that the first delivery is successful, the timestamp advances, approved balances refresh on both screens and the Time schedule is unmodified. Never grant callers Token Creator just to test this procedure. Use the Scheduler's normal authenticated invocation.

## 6 · Rollback

```bash
qrollback() {
  if [[ "${1:-}" == "scheduled" ]]; then
    qg scheduler jobs pause "$Q_JOB" --project="$Q_PROJECT" --location="$Q_REGION" || return 1
  fi
  [[ -n "${Q_PRIOR:-}" ]] || return 1
  qg run services update-traffic "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --to-revisions="$Q_PRIOR" || return 1
  qg run services describe "$Q_SERVICE" --project="$Q_PROJECT" --region="$Q_REGION" --format=json > "$Q_EVIDENCE/rolled-back.json" || return 1
  [[ $(qtraffic "$Q_EVIDENCE/rolled-back.json") == "$Q_PRIOR" ]] || return 1
  curl -fsS --max-time 20 "$Q_ORIGIN/health" | jq -e '.status=="ready"' >/dev/null
}
# If automation was activated, first inspect/pause that invoice-only job and allow its active invocation to finish.
# if qrollback scheduled; then printf 'Verify dashboard and Time at the prior revision.\n'; fi
# If no invoice job was created, invoke qrollback without an argument.
```

To stop scheduling while retaining manual invoices, pause the invoice job and route traffic to the previously verified manual-only invoice revision `$Q_REV`. Rolling back traffic does not reverse provider token rotations or delete mirror, approval, and audit records. If production invoice access must be removed, pause the job, use the authorized in-app **Disconnect** before rolling back, and verify revocation or revoke directly in Intuit if the portal cannot finish. Retain the verification and approval record. Keep the reviewed previous encryption key pinned for compatible recovery and never delete secrets or records as an automatic rollback step.

**Release note:** Scheduled, freshness-labeled Invoice-only balances and explicit unlinked-audience approval are added to the existing Morris and Zagimē invoice workspaces. The reporting toolbar, portfolio distribution and invoice layout have been tightened for desktop, tablet and mobile.
