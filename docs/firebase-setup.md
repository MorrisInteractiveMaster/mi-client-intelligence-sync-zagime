Current same-project staging: [named database safeguards](same-project-staging.md) and [operator runbook](operator-setup-runbook.md) supersede prior isolated-project/default-database staging assumptions below. Production (default) remains untouched; all staging operators require mi-client-staging.

# Firebase setup — M4 current handoff

Owner-confirmed project: morris-client-dash-zagime; web app 1:892989290947:web:d5189c017d20b65cc0a576; auth domain morris-client-dash-zagime.firebaseapp.com.

Existing database: (default), Standard/Native, northamerica-northeast1. Realtime updates enabled; scheduled backups disabled. **Do not create another database or replacement project.** This supersedes M3's NOT CREATED report.

The Console reportedly shows deny-all browser rules. M4 did not inspect/deploy a live release or perform any live access. Owner must verify release ID/timestamp/content before future live access. The backend's live startup requires ENABLE_LIVE_FIREBASE=true and FIRESTORE_RULES_VERIFIED=true plus absence of emulator/key-file environment variables; neither flag is enabled here. A rules-verification flag records operator attestation, not automated proof of the deployed release.

Firebase Authentication integration is implemented using firebase-admin; actual provider enablement and US identity processing need owner privacy approval. Google/Microsoft are the intended providers. Account identity alone never creates membership or administrative access. Registration/provider login may establish an Auth user but has zero data access until a trusted operator approves a tenant membership. No public membership-management API exists.

Local test configuration uses only demo-mi-security with Auth 127.0.0.1:9099 and Firestore 127.0.0.1:8080. No real API key or ADC credentials are needed. Auth Emulator tokens are unsigned and must never be accepted in production; runtime guards reject emulator variables in production. See docs/operator-setup-runbook.md for the ordered handoff.

M5: protected hosted configuration is explicit per environment rather than hardcoded production project/app IDs. No staging project/app ID is known. Staging runtime refuses the production-intended project and requires independently enabled guards. Browser Firestore rules remain unchanged deny-all. See docs/m5-staging-runbook.md.
