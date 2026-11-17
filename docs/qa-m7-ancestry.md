# M7 IAM collector ancestry correction

Base: latest main 044b5d5c762d7e741a5f10bd295845f3074db3ea, PR #7 merged. Focused branch: codex/m7-iam-collector-ancestry-fix. No changes to application behaviour, databases, identity guards, IAM, activation flags or previous live-read evidence.

## Owner evidence and correction

The owner reports the actual ancestry is only `project morris-client-dash-zagime`. Direct role miClientStagingAuthRead contains firebaseauth.users.get; miClientStagingData contains datastore.databases.get, datastore.databases.getMetadata and datastore.entities.create/get/list/update. The condition is `resource.name=="projects/morris-client-dash-zagime/databases/mi-client-staging"`; the service-account resource policy has zero direct bindings. Previously reported staging GET 404/LIST 200 and production default GET/LIST 403 remain unchanged. These are owner-supplied facts, not new agent cloud checks.

The same validation now accepts the configured textual project ID in both CLI collection and policy assessment, or a numeric project ancestor matching authoritative projectNumber metadata. A project-only response does not invent an organization or require a project number when projectId is verified. Every listed folder/organization policy remains required. The CLI validates the entire response before emitting rows; malformed, unknown, mismatched, duplicate or incomplete ancestry stops collection with explicit inconclusive evidence. Invalid ancestor identifiers never become evidence-file paths or command arguments.

The exact live ancestry/roles/condition fixture now returns PROFILE_MATCH_REQUIRES_REVIEW with no false missing-policy/permission findings. activationAuthorized=false and collector exit 2 remain intentional. This is policy declaration triage, not proof of effective access, write isolation, complete indirect membership visibility or actual attached identity. Unresolved groups, unsupported conditions, denied policy reads and inherited broad grants still require review; no automatic grant or activation is introduced.

## Validation

- Clean npm ci --ignore-scripts passed; no dependencies changed (inherited 14 moderate audit findings).
- Complete Node suite: **122/122 passed**, zero failed/skipped.
- Auth/Firestore emulator security suite: **25/25 passed**, zero failed/skipped; demo-mi-security only.
- Typecheck, frontend build and all backend bundles passed.
- Node regressions include exact owner ancestry/IAM values; project-ID and matching numeric inheritance; missing folder/organization policy and broad inherited grants; wrong project/number, unknown types, malformed IDs, duplicates, missing parent/metadata; CLI output and all-or-nothing rejection.
- Linux CI runs Bash syntax checks and an offline full-collector harness with exact live custom role names/permissions/condition, project-ID-only, numeric and folder/organization hierarchies. It asserts both role reads and all inherited policy reads, review-required classifications, retained activation=false, and specific invalid-resource/API-disabled/denied-project/denied-folder/unknown-ancestor findings. Fixtures do not prove live IAM access. Bash execution uses CI because this Windows host has no Bash.
- UI unchanged; no browser screenshots required. No live collector execution, Docker build, cloud read repetition, runtime checker execution or deployment performed.

MERGED: No · DEPLOYED: No · SEEDED: No · API ACTIVATED: No · PRODUCTION WRITES: No
