# Firebase setup status — M3

Latest owner handoff, 16 November 2026 (user-confirmed values, not independently verified by live API):

- Project ID: morris-client-dash-zagime
- Web App ID: 1:892989290947:web:d5189c017d20b65cc0a576
- Auth domain: morris-client-dash-zagime.firebaseapp.com
- Firestore: **NOT CREATED**
- Cloud Storage: **NOT CREATED**
- QBO Accounting / QuickBooks Time applications: user reports connected, grants/entitlements unverified
- Mandatory production residency: Canada

This supersedes the early M1 report of an empty database. No live inventory was performed in M3. The Web App ID/auth domain are documented identifiers, not working frontend configuration. No API key, OAuth secret or credentials are present. Project metadata, billing owner, IAM, enabled APIs, auth settings and actual inventory need authorized operator verification.

The only runnable configuration is local firebase.json for loopback Firestore emulation with project demo-mi-security. No .firebaserc real-project alias or deployment script is added. Rules deny every browser access, even authenticated admins. CI validates without authentication to Google Cloud and without deploying.

Firebase Authentication's documented US-only processing conflicts with strict Canadian identity-data residency. Regional Firestore does not fix that. See [Canadian assessment](canadian-residency.md), [authorization contracts](security-and-access.md) and [ordered owner setup runbook](operator-setup-runbook.md). Every live-changing step is labeled REQUIRES OWNER APPROVAL and none was executed.
