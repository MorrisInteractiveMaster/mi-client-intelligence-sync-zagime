# Historical M5 staging handoff — superseded

The owner now requests same-project staging using morris-client-dash-zagime / mi-client-staging in Montréal. M5 functionality remains; the former mandatory isolated-project restriction is superseded only behind explicit named-database and verification guards.

Use the current [operator runbook](operator-setup-runbook.md) and [database isolation architecture](same-project-staging.md). Do not use historical instructions to seed the production (default) database, create a replacement project or change shared Auth identities/providers.
