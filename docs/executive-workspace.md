# Executive workspace

The protected Zagimē workspace uses Nordic Minimal surfaces, the official whole wordmarks, and native Dots motion. It uses the existing project API, Microsoft and Firebase identity, named production database and client membership rules. QuickBooks Time remains the approved source. The package and whiteboards supplied the design direction and reporting structure. Their example projects, people and hours are not production records.

## Using the dashboard

- **Leadership summary** shows approved allocations, active and completed work, six months of delivery history, milestones, and published executive notes. History follows the signed-in client’s current project permissions. Zero allocated hours means no eligible allocation was found for that period. A verified successful customer-wide source refresh appears when available.
- **Service areas** show related projects, reporting groups and approved contacts. **Projects** supports name and status filters, including archived work. Open a project’s updates and milestones to see its approved timeline.
- **MI Directory** shows the approved profile and contact fields of active people associated with at least one of the client’s visible projects. Internal contact fields stay in Morris administration.
- **At a Glance** opens a silent nine-chapter presentation built from the same published response. The chapter picker, previous/next, restart, play/pause, arrows and Escape work without audio. Fullscreen is available where the browser supports it. Reduced-motion mode disables animated transitions.

## Morris workflow

1. Use **Projects** to create or edit work, plan hours, write updates and set milestones. **Preview approved content** shows the same card an authorized client sees after publication, including its hours, approved dates, team and timeline.
2. Use **Portfolio management** to configure service areas and reporting groups. Area order and approved display are independent of Time work-order identity. Enter the group’s monthly capacity and distribute capacity across areas. Review differences between the group target and the distributed capacity. The allocation does not change the target.
3. Use **Project organization** to attach a project to a group and area, manage dates, set a lead and team, record a Morris-only attention item, or archive it in the reporting hierarchy. A reporting group is a management relationship. It does not alter a raw source ID, work order, allocation, or publication setting.
4. Use **MI Directory** to maintain approved details. Keep private contact information separate from the approved client contact field. Associate team members with projects through **Project organization**. Visibility and active state both apply to contacts.
5. Use **Executive notes** to author and explicitly approve narrative or a decision for the selected month. A published executive note is shared across approved tenant memberships for that month. Keep project-restricted details in that project’s approved updates.
6. Use **Hours & allocations**, **Integrations**, and **Audit history** for the existing protected workflows. Recorded time remains immutable and only allocation changes affect delivered hours. The staff integration panel remains the location for source freshness, exceptions and approved operator controls.

Monthly group capacity, monthly project targets, fixed project targets and actual allocated hours are separate. Staff rollups count each assigned project once per group/area and sum existing reporting periods. The supplied whiteboard hours are never applied automatically.

## Persistence and privacy

The additive document `tenants/{tenant}/workspaceSettings/portfolio-v1` stores the configuration. Missing configuration starts with the six approved area labels and empty groups, placements, notes and directory. Reads do not seed Firestore. On the first approved staff edit, the server stores the bounded configuration. Edits require the current tenant revision and write an audit record atomically. Existing revisions can ignore this document. No migration or index change is required.

The staff endpoint is `GET /api/v2/tenants/{tenant}/portfolio?month=YYYY-MM` and `PATCH /api/v2/tenants/{tenant}/portfolio`. It uses the same staff identity and tenant boundary as project editing. The report returns a separate allowlisted projection containing only approved information. Hidden associations, internal references, contact details, attention notes, and unpublished projects do not appear there. Existing Time, publication, allocation and project membership operations remain in place.

## Review and production rollout

Run the unit, build and emulator suites from the reviewed branch. The protected workspace browser fixture captures screenshots under `test-results/project-only-browser`, which CI uploads with its browser evidence. The fixtures use synthetic identities and projects against loopback Auth and Firestore emulators.

After separate image-push approval, check out the reviewed commit and build the production-profile image. Use the approved public browser configuration from the existing deployment. The [production runbook](production-launch-runbook.md#3-build-and-initialize-then-deploy-privately) describes those inputs. This release uses the existing tenant, registry and service.

```bash
set -euo pipefail
PROJECT=morris-client-dash-zagime
REGION=northamerica-northeast1
SERVICE=mi-client-prod-dashboard
TENANT=zagime-production
IMAGE_REPO="$REGION-docker.pkg.dev/$PROJECT/mi-client-build/mi-client-production"
: "${REVIEWED_SHA:?Set the approved Git commit}"
: "${VITE_FIREBASE_API_KEY:?Set the approved public Web API key}"
: "${VITE_FIREBASE_APP_ID:?Set the approved public Web App ID}"
: "${VITE_FIREBASE_AUTH_DOMAIN:?Set the approved Firebase auth domain}"
: "${MORRIS_ENTRA_TENANT_ID:?Set the approved Entra tenant ID}"
test "$(git rev-parse HEAD)" = "$REVIEWED_SHA"
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build --platform linux/amd64 -f deployment/Dockerfile \
  -t "$IMAGE_REPO:$REVIEWED_SHA" \
  --build-arg VITE_DASHBOARD_DEPLOYMENT=production \
  --build-arg "VITE_SECURE_TENANT_ID=$TENANT" \
  --build-arg "VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY" \
  --build-arg "VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID" \
  --build-arg "VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg "VITE_MORRIS_ENTRA_TENANT_ID=$MORRIS_ENTRA_TENANT_ID" .
docker push "$IMAGE_REPO:$REVIEWED_SHA"
docker inspect --format='{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE_REPO:$REVIEWED_SHA"
```

Review the immutable registry digest and the current serving revision. Preserve existing runtime flags, including the approved Time activation state.

```bash
: "${APPROVED_DESIGN_IMAGE:?Set the reviewed immutable production image}"
[[ "$APPROVED_DESIGN_IMAGE" =~ ^northamerica-northeast1-docker\.pkg\.dev/morris-client-dash-zagime/mi-client-build/[a-z0-9-]+@sha256:[a-f0-9]{64}$ ]]
BASELINE="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json |
  jq -er '[.status.traffic[] | select((.percent // 0)>0)] | select(length == 1 and .[0].percent == 100) | .[0].revisionName')"
test -n "$BASELINE"
LATEST_CREATED="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.latestCreatedRevisionName)')"
test "$LATEST_CREATED" = "$BASELINE"
gcloud run revisions describe "$BASELINE" --project="$PROJECT" --region="$REGION" --format='value(status.imageDigest)'
```

**Stop for candidate deployment approval.** Make the approved image change only.

```bash
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --image="$APPROVED_DESIGN_IMAGE" --no-traffic --tag=design-candidate
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='yaml(status.latestReadyRevisionName,status.traffic)'
```

Verify the candidate image digest and that the baseline still serves all normal traffic. Privately compare the candidate's service account, runtime database and tenant, origin and identity configuration, environment flags, and secret volume bindings with the baseline. On the tagged URL, check health, sign-in screen and anonymous API denial. Its origin differs from the authorized production sign-in origin. Verify authenticated staff and client behavior on the main origin in the separately approved cutover window.

**Stop for traffic approval.** Use the reviewed candidate revision name. Verify staff persistence and client privacy at the main origin after the change.

```bash
: "${REVIEWED_CANDIDATE:?Set the approved zero-traffic revision name}"
[[ "$REVIEWED_CANDIDATE" == "$SERVICE"-* ]]
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" --to-revisions="$REVIEWED_CANDIDATE=100"
```

If any launch check fails, restore the recorded revision and remove the candidate tag after rollback approval. The additive settings and business records are retained.

```bash
gcloud run services update-traffic "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --to-revisions="$BASELINE=100" --remove-tags=design-candidate
```
