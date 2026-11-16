# Current M7 corrected security handoff — existing PR #7

The old named-Firestore Policy Troubleshooter workflow has a confirmed live INVALID_ARGUMENT / INVALID_RESOURCE_NAME failure. It is retired, not patched with a guessed resource string. Unknown/unsupported/incomplete results never prove denial.

Use [corrected Cloud Shell Bash steps](m7-operator-next-steps.md) for read-only service/job inventory FIRST, supported project/ancestor IAM policy collection, actual custom/predefined role expansion, explicit inheritance/group/impersonation review, safe write-denial reasoning without default writes, and checker-only creation requirements if no approved runner exists. No job/service is assumed.

~~~bash
gcloud run services list --project=morris-client-dash-zagime --region=northamerica-northeast1 --format=json
gcloud run jobs list --project=morris-client-dash-zagime --region=northamerica-northeast1 --format=json
bash scripts/verify-staging-iam.sh
~~~

The collector always exits nonzero pending review, even for a narrow direct-policy profile. It does not emit effective GRANTED/NOT_GRANTED or authorize activation. Actual live bindings/roles/inheritance remain unverified by the agent without an authenticated Cloud SDK connection. Require complete authorized review and approved runtime checks; do not confuse offline fixture success with operational cloud verification.

Preserved owner evidence in m7-cloud-evidence.json: staging GET 404/LIST 200, default GET/LIST 403; UID 6d09ea71-f495-44a5-94a6-732ed1c47d88, existing mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com, temporary Token Creator binding removed. No timestamp or attached runtime proof is invented. Do not repeat IAM grants or restore Token Creator.

All identity, explicit named database, UID, fail-closed and activation-disabled guards remain. No provider/user/IAM/resource changes, deploy, API activation, cloud seed, default write or QuickBooks connection is authorized/executed. Use the [controlled synthetic plan](m7-synthetic-smoke-tests.md) only after separate future approvals. If no approved runner exists, follow the explicit proposal/approval process in the Bash runbook; do not create one automatically. Rollback keeps staging stopped unless a compatible reviewed named/identity image is approved, retaining production configuration and audit history.
