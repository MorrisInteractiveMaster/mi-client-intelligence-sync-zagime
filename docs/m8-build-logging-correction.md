# M8 Cloud Build logging correction — 18 November 2026

The owner reports two builds failed before Docker execution; the latest is 6a72c6b4-aa2d-4934-a8ad-f0f009ca6edd, error code 9 without actionable detail. Effective logging was LEGACY because the config omitted an explicit mode. The owner verified the existing mi-client-build account, Cloud Build service-agent role, logging.logWriter and source/log bucket grants. These are owner-supplied facts, not independently retrieved cloud evidence in this PR. No cloud calls/submissions or IAM changes were made here.

## Exact correction and documented rationale

deployment/cloudbuild-m8.yaml adds only:

```yaml
options:
  logging: GCS_ONLY
```

Steps, Docker arguments, substitutions, images and 900-second timeout are preserved. Google's [user-managed build-account instructions](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts#set_up_build_logs) prescribe GCS_ONLY plus a user-created log bucket for this storage choice. Its [configuration schema](https://docs.cloud.google.com/build/docs/build-config-file-schema#logging) says omitted logging defaults to LEGACY, sending logs to both Cloud Logging and Cloud Storage. Explicit GCS_ONLY selects the existing GCS destination; it does not require removing logging.logWriter or changing any IAM role.

The submission script still passes --service-account, --gcs-source-staging-dir, --gcs-log-dir and the same existing regional Artifact Registry image destination. The service-account guard now matches the owner's verified dedicated account exactly: projects/morris-client-dash-zagime/serviceAccounts/mi-client-build@morris-client-dash-zagime.iam.gserviceaccount.com. Source/log bucket names and repository remain existing owner-verified environment settings; none are guessed, replaced or created. Existing bucket describes and API prechecks remain. The CLI's explicit --gcs-log-dir supplies the Build logsBucket field; no new logsBucket value is hardcoded in YAML. See [submit flags](https://docs.cloud.google.com/sdk/gcloud/reference/builds/submit).

scripts/validate-m8-build.cjs parses the actual YAML, rejects malformed/duplicate keys and requires options.logging === GCS_ONLY. The build phase runs it before any SDK call. yaml 2.9.1 is pinned as a direct dev dependency (already present in the lockfile) so offline validation does not depend on an accidental transitive import. Run npm ci --ignore-scripts first. The validator performs no network/submission and suppresses configuration content in errors. CI also runs it and its regression cases. The Bash harness uses a fake SDK and isolated copied config to prove LEGACY blocks all SDK calls and valid builds retain the intended identity, buckets and image arguments. These are offline assertions, not live Cloud Build success evidence.

## Failure not yet proven resolved

Local validation: clean installation, 3 configuration regressions, 125 application regressions, 26 emulator/security tests and typecheck passed; frontend/backend builds are checked as well. A parsed before/after comparison confirms all non-logging build fields are unchanged. Bash syntax and the fake-SDK submission guard are exercised in Linux CI. Existing locked package versions are unchanged; current audit reports 14 moderate/6 high development-tree advisories, zero runtime advisories. Dependency remediation is outside this focused logging repair.

Code 9 and a pre-Docker failure do not establish a unique cause. This change aligns a known configuration omission with documented setup; it is not a demonstrated root-cause fix. No paid Cloud Build was authorized/run in this task. Local YAML/shell/application/container tests cannot certify service-side validation, bucket policies or execution identity. If the next approved build still fails, retain its ID and failureInfo/statusDetail privately and investigate without broadening IAM, changing providers or creating replacement resources.

## Verify the next separately approved build

First run only the offline checks below; they do not submit a build:

```bash
npm ci --ignore-scripts
node scripts/validate-m8-build.cjs
node --test scripts/validate-m8-build.test.cjs
bash -n scripts/m8-staging.sh scripts/test-m8-staging.sh
bash scripts/test-m8-staging.sh # fake gcloud only
```

After independent owner approval, use the existing reviewed build phase in m8-launch.md with the same existing regional source/log buckets, Artifact Registry repository, public substitutions and dedicated account. Do not use default bucket fallback or add roles. This PR does not authorize or execute that submission. Record the new ID from that approved operation; use these read-only Cloud Shell Bash checks:

```bash
NEW_BUILD_ID='OWNER_VERIFIED_NEXT_APPROVED_BUILD_ID'
gcloud builds describe "$NEW_BUILD_ID" \
  --project=morris-client-dash-zagime --region=northamerica-northeast1 \
  --format='json(id,status,statusDetail,failureInfo,serviceAccount,options.logging,logsBucket,source.storageSource,steps.name,steps.status,steps.timing,results.images,timing)'
```

Verify options.logging is GCS_ONLY; serviceAccount identifies mi-client-build; logsBucket/source.storageSource.bucket match the existing approved buckets; Docker step timing/status proves execution actually began; final status is SUCCESS; and results.images contains the intended regional image/digest. Inspect the returned existing GCS log location privately for the new build's logs. Do not publish raw logs, substitutions or credentials. Passing submission alone, a missing error message or a generated build ID is insufficient. Do not proceed to deployment/activation as part of this check.

## Revert

If independent review requires rollback, prepare a separate reviewed PR using git revert of this focused correction commit (record its final SHA from the PR). This reverses the logging setting, guard and associated submission changes together without changing cloud resources. Removing only logging intentionally makes the guard refuse submission; do not bypass it or use NONE to force success. A full revert restores the prior LEGACY risk and must not be submitted live without another review. No rollback, merge, build, deployment, Firebase/Firestore or production-default operation was performed here.
