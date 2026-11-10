# Current architecture
Verified against source 835e70842cd7f5f0d0fc2e3b9d3f0b0d368b651c.

React 19 + TypeScript + Vite SPA uses HashRouter and relative assets. Components/pages consume PortalContext, which calls PortalService through PortalRepository. LocalPortalRepository persists version-1 synthetic snapshots under morris-zagime-prototype-v1; MemoryPortalRepository isolates tests. No Firebase SDK, backend or external API calls are configured.

PortalService loads one snapshot per service instance and returns cloned/projected views. Cosmetic navigation uses cached state. Commands serialize within that instance, validate, save, then publish; failed persistence leaves prior state intact. This is not cross-tab or multi-user concurrency control. Unchanged commands still save the snapshot: zero-write no-op behavior is a future gap, not a verified capability.

Domain functions calculate parent/descendant totals using entry membership; portfolio totals sum entries once. Child planned caps are not added to root contract caps. Monthly caps remain Morris-owned. Upcoming attachment preserves internal project identity. Reporting dates are frozen at 2026-10-23; this is deliberate demo behavior.

Client projection hides unpublished narratives, hidden project subtrees and internal notes; hidden people do not remove project hours. Every fixture remains in the browser bundle. Projection and demo roles provide no production security.

Future adapter classes throw before accessing any service. Existing contracts are retained as placeholders; they do not establish actual QBO or QuickBooks Time API fields or entitlements.

## Performance baseline and gaps
Existing tests verify one repository load across repeated service reads, isolated clones, queued updates and storage failure recovery. Baseline and imported code have zero Firestore reads/writes and zero external integration calls because no integration exists; this is not a cloud benchmark. No background jobs or infrastructure are introduced.
Future work needs bounded authorized summaries, paginated lazy details, auth-scoped caches, source revisions/checkpoints, no-op detection, idempotency, conflict resolution, immutable material-change audits and measured cost limits.
