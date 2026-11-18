# Existing staging blank-screen repair

Base main/reviewed deployed source: 1ef561b733bf3cc44925c08ab0cc8f153cab0801. Owner-reported revision: mi-client-staging-dashboard-00001-b4d. Existing URL: https://mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app. No deployment, Cloud Build submission, IAM/provider/rules change or live API activation was performed in this repair.

## Reproduced cause and focused changes

A real headless Edge visit to the deployed HTTPS /#/secure returned empty body/root content. Module requests carried Origin equal to the page origin, but received 403 application/json. The same live charts URL returned 200 text/javascript without Origin, and 403 with same-origin Origin. CSS was rejected by strict MIME checking. This directly reproduces the server/http.ts ordering error: the protected origin gate ran before public static serving while allowedOrigin was unset/nonmatching. The operator's Firebase administrative-config 403 is a separate issue and was not worked around with new permissions.

Public GET/HEAD files now reach serveFrontend before the protected API origin gate. Assets were already public without an Origin header; this fixes browser delivery, not data authorization. Cross-origin file responses carry no permissive Access-Control-Allow-Origin. API origin checks/authentication remain unchanged; inactive API requests without an unauthorized Origin remain 503, unauthorized origins remain 403. Unknown/missing static assets return 404 text/plain, not an inactive API JSON/503.

Production-browser testing then exposed two additional existing asset issues: branding JPEGs were missing from the MIME allowlist, and Vite's small inlined font data URLs violated font-src 'self'. JPEG/JPG now use image/jpeg; assetsInlineLimit=0 emits the same fonts as same-origin files. The CSP string is unchanged. No data: font allowance, unsafe-eval, authentication relaxation or design change was added.

Static HTML/startup messaging covers module-load failure, and a React boundary covers render failure, using generic recovery text without stack traces or private details. The favicon points to an existing public Morris image. Existing synthetic dashboard/features and HashRouter are retained.

## Browser and security verification

scripts/smoke-preview.cjs runs Playwright against the production server/container, not Vite dev. It checks /, /#/welcome, /#/secure and /?utm_source=chatgpt.com#/secure at 1440/390 pixels, visible route-specific content and sign-in controls, hash navigation, fonts, JS/CSS/image MIME/status, CSP events, console/page errors, asset failures and inactive API 503. Deliberate module and React DOM failures must show safe messages. Local built-frontend verification passed with zero uncaught errors, failed assets or CSP violations. No credentials/sign-in clicks are used.

CI builds a baseline container from the exact reviewed source above and verifies its blank-root/Origin-403 failure when that source is the PR base. It builds the repaired production Dockerfile and runs the positive browser suite. Runtime containers use an internal Docker network without external egress; browser external requests are blocked and Firestore attempts fail the test. The server's existing preview branch precedes Firebase initialization, and proxy-backed unit tests assert zero backend access. CI uploads screenshots and network/error/MIME JSON as production-container-browser-evidence. These are locally built containers from reviewed source, not a claim to have pulled/verified an undisclosed deployed image digest. Docker is unavailable on the Windows host; Linux CI provides Docker execution evidence.

The UI smoke uses unconfigured public Auth values in CI; visible sign-in controls/error states are checked, not real OAuth entitlement. Provider/config permissions and data activation remain separate. Full app, TypeScript, backend/security/emulator tests remain required. /health is the known working Cloud Run check; the owner-reported edge 404 for /healthz is not fixed by changing IAM or enabling services.

## Exact existing-service update — owner execution only after review

No command below was executed by this agent. No new Cloud Build is required/authorized here. An independently approved image-publication process must first place the reviewed, browser-tested Docker image in the same existing registry repository, retaining the existing verified public frontend build values. No OAuth secrets go into build arguments. Do not use the old create/deploy bootstrap phase or create a replacement service.

Read-only preflight; verify the current revision, attached account and traffic before proceeding. If they differ from the owner evidence, stop and review instead of overwriting another rollout:

```bash
PROJECT='morris-client-dash-zagime'
REGION='northamerica-northeast1'
SERVICE='mi-client-staging-dashboard'
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.serviceAccountName,spec.template.spec.containers.image)'
```

Require runtime account mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com and existing named staging configuration. Do not change IAM/ingress/provider configuration. Record the previous traffic map privately. Only after explicit approval to update this existing service, replace the placeholder with the reviewed immutable image from the existing regional repository:

```bash
FIXED_IMAGE='OWNER_APPROVED_EXISTING_REGISTRY_IMAGE_AT_SHA256_DIGEST'
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$FIXED_IMAGE" --no-traffic --tag=render-check \
  --update-env-vars='BACKEND_MODE=staging,STAGING_PREVIEW_ONLY=true,FIRESTORE_DATABASE_ID=mi-client-staging,ENABLE_LIVE_FIREBASE=false,ENABLE_SYNTHETIC_STAGING=false,STAGING_IAM_VERIFIED=false,FIRESTORE_RULES_VERIFIED=false'
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic)'
```

This creates only a new revision of the existing service, leaves normal traffic on the previous revision and provides the render-check tag URL for inspection. No IAM, database, provider or API activation change is included. Copy its actual reported URL/revision; do not invent a digest or revision suffix. Verify the candidate in a real browser before traffic approval:

```bash
CANDIDATE_URL='OWNER_VERIFIED_RENDER_CHECK_TAG_URL'
curl --fail --silent "$CANDIDATE_URL/health"
curl --silent -o /dev/null -w '%{http_code}\n' "$CANDIDATE_URL/api/tenants/synthetic-zagime/workspace" # 503
node scripts/smoke-preview.cjs "$CANDIDATE_URL" --live-read-only
```

Install pinned npm dependencies and the Playwright Chromium browser on the test workstation first. The smoke permits only loopback, this exact existing staging hostname or its render-check tag hostname, uses public GETs and never signs in. Remote failure means stop; do not enable the API or add permissions to force a pass. After separate approval to promote a verified candidate:

```bash
FIXED_REVISION='OWNER_VERIFIED_NEW_READY_REVISION'
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" --to-revisions="$FIXED_REVISION=100"
node scripts/smoke-preview.cjs https://mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app --live-read-only
```

If verification fails, leave traffic on the old revision; if already promoted, separately approve restoration of the recorded previous map (owner-reported single revision shown below). This restores the former blank-screen behavior, not a data migration. No database rollback or deletion is involved:

```bash
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" --to-revisions=mi-client-staging-dashboard-00001-b4d=100
```

Retain evidence and remove the candidate tag only after separate cleanup approval. All live/preview flags remain disabled for Firebase operations. Production (default), real QuickBooks data and named Firestore rules are untouched.

Command references: [update existing service](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update), [explicit revision traffic](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update-traffic).
