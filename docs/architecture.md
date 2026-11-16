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

## Milestone 2
The normalized local reporting slice is in src/reporting. ReportingState separates raw source, manual allocations, plans and publication. project(state) produces the shared Nordic/Dots view. See docs/decisions.md for the explicit legacy-save compatibility boundary. No network persistence is implemented.

## M2 architecture-review corrections
ReportingProvider owns the v2 state and selected month across primary overview, portfolio, Projects, New project and Time Allocation routes. All these controls call the same persistence boundary. Legacy views retain v1 storage behind clearly marked legacy navigation/banners and explicit legacy project/time routes. They are regression demonstrations, not another editor for the M2 workspace.

project(state, {month, agreementId?}) is the internal calculation. It filters raw record dates before consuming latest allocation revisions, scopes portions to agreements and builds agreement-department totals. Fixed-plan projects additionally expose lifetimeSeconds. Caps use only the latest revision for the selected month; project plans are never added to caps. clientProjection is an explicit published-field view that excludes raw identities, correction cases, allocation history and unpublished project details. Dots uses the selected-month client projection.

Unallocated portfolio time includes only selected-month raw remainder. Over-allocated corrected records are held entirely for review. An agreement owns raw remainder only through an explicit umbrella source link; an unmapped remainder stays in the portfolio reconciliation bucket rather than being duplicated across agreements. Cross-agreement portions are counted in their destination agreement.

## M3 offline backend foundation
server/ provides provider-neutral verified identity/membership contracts, scoped backend create/edit/publication/read commands and a synthetic transactional memory store. It reuses the M2 model and publication calculation. Server paths are outside the app bundle; no frontend Firebase initialization. New persistent projects are unpublished regardless of demo defaults. Deny-all browser rules leave backend permissions independently mandatory. A production database adapter and real signature-verifying identity provider are future reviewed work. See docs/security-and-access.md and docs/canadian-residency.md.

## M4 current runtime path
M4 supersedes the M3 future-adapter status: server/firebase.ts verifies Firebase signatures/revocation; server/firestore-store.ts performs targeted transactions and bounded publication reads; server/http.ts exposes authenticated/validated/limited endpoints. Source records and allocation revisions live in separate documents; reporting allocation writes update summaries and audit atomically. Browser Firestore remains denied. Existing synthetic UI remains default; optional /#/secure is disabled until approved configuration. Details: docs/m4-api-and-persistence.md.
