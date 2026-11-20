# Employee mapping

An approved platform administrator can link a verified QuickBooks Time employee to their active Morris WordPress profile in **Control Panel → Employee Mapping**. The Time entry supplies the employee ID, recorded hours and available original name. The WordPress profile supplies the public professional title and photograph. A link has no effect on client publication.

1. Sync the public profiles from **Control Panel → WordPress Team** if the directory is empty or out of date. Keep manually maintained contacts in the Morris Team Directory.
2. Search or select the verified QuickBooks Time employee. **Scan more imported time** checks the next page of stored entries for verified identities. Older entries without provider details may need the owner-approved [historical enrichment](delivery-operations.md#3-optional-historical-details-enrichment).
3. Select the matching WordPress profile by name and profile ID. Compare both identities and the verification date before selecting **Confirm employee link**. Each WordPress profile can be linked to one QuickBooks Time identity per tenant.
4. To change a link, select a different active WordPress profile for the same employee and confirm. To undo it, choose **Remove link** and confirm removal. If the selected Time entry was corrected or the mapping changed during review, select **Reload employees** and review the latest details.

## Compatibility and rollback

The verified corporate identity and configured `MORRIS_PLATFORM_ADMIN_UID` gate both reads and writes. This action uses only existing WordPress profiles and previously imported Time entries. A valid source witness requires the current revision-bound Time details, stable source ID, approved account and work-order mapping, and a verified customer enrollment. Source fields, private notes and contact configuration stay in their existing records.

The tenant-local settings document `workspaceSettings/time-employee-mappings-v1` stores one active link per verified Time account and employee and per WordPress post ID. A revision check and a durable audit event accompany each change. Previous WordPress post IDs remain in the audit. The browser never connects directly to Firestore. No backfill, new index or runtime IAM grant is required. An older dashboard image ignores these associations. Keep the settings and audit records when rolling back and verify that the weekly and monthly source totals continue to match the stored Time ledger.

Employee candidates are loaded from verified imported rows in bounded pages. If a historical employee has no current matching source-details revision, the application can continue to show recorded hours, and an administrator needs verified evidence before linking a profile. [Morris WordPress team source](https://morrisinteractive.ca/wp-json/wp/v2/team) · [QuickBooks Time reference](https://tsheetsteam.github.io/api_docs/#the-timesheet-object)
