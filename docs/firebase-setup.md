# Firebase handoff — no integration configured

User-reported, not independently verified: display name Morris Client dash Zagime; Blaze billing; web app display name Morris Client Intelligence Web - Zagime; empty (default) Firestore database.

UNVERIFIED: immutable project ID, Web App ID/config, Firestore edition/location/rules, billing-account ownership, enabled APIs, Authentication settings, Cloud Run region, IAM and service accounts. Hosting selection is unapproved. No values were guessed or committed.

Milestone 2 requires a reviewed architect continuation and verified configuration. Plan emulator-only synthetic tests before any live configuration. Required denial cases: unauthenticated, unapproved/disabled user, cross-client scope, client writes, role escalation and backend permission bypass. Admin SDK operations require their own authorization.
No Firebase SDK, emulator configuration, security rules or cloud directory scaffolding is added in Milestone 1; existing disabled adapters remain the boundary.
