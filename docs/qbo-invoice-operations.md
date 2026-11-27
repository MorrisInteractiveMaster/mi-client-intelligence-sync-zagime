# QuickBooks Online invoice visibility

This release adds an **Invoices** destination to the Morris workspace and the published client portal. Staff can review all synced invoices in the authorized workspace. The platform owner approves or withdraws client visibility per invoice. Clients see only approved records. An invoice linked to several projects requires access to every linked project, and each must still be published. A separately approved invoice with no project links is available to all approved members of that workspace.

The integration reads the Intuit **Invoice** entity using the verified realm and exact customer or job IDs. It ignores links to other accounting entities and never queries them. It uses the invoice's own balance, transaction date, due date and currency. The portal separates payment status from urgency, so a partially paid invoice can also be overdue. Dates use America/Regina. Due Soon includes today and the next seven calendar days. Money uses integer minor units, with totals grouped by currency. “Paid · issued this month” counts cleared invoices by issue date because the Invoice record does not establish when payment occurred. [Intuit Invoice reference](https://developer.intuit.com/docs/api/accounting/invoice) · [Intuit query syntax](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html)

## Before connecting

1. Validate the reviewed dashboard image in named staging using a separate Intuit sandbox app and synthetic data. Follow the [dashboard release runbook](delivery-operations.md) for the existing service, tenant, and named database. There is no Time worker or Scheduler update for this release.
2. In the production Intuit app, register the exact callback `https://<approved-dashboard-host>/qbo-invoice-callback.html`. Enable the Intuit accounting scope. Intuit grants that scope for accounting APIs generally. This application uses it only for invoice reads. Verify the app, realm, customer IDs and approved consent before connecting. [Intuit OAuth setup](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
3. Independently verify the numeric realm and each CustomerRef ID against the intended client. Include child job or customer references only if their invoices belong to the same authorized tenant. Do not infer IDs from a customer display name. Confirm the Home Currency used when an invoice omits its CurrencyRef. Review all permitted mappings before enabling.
4. Bind the settings below to the dashboard revision through the existing owner-approved release process. Bind secrets to the dashboard service identity using explicit Secret Manager versions and grant access only to the required secrets. Use the existing named database and service. Keep the feature disabled until the owner approves activation.

| Runtime setting | Value or purpose |
| --- | --- |
| `QBO_INVOICES_ENABLED` | `true` to enable. Omit or set `false` to disable. |
| `QBO_INVOICES_TENANT` | Exact verified platform tenant ID. One invoice connection per deployed dashboard. |
| `QBO_INVOICES_REALM` | Exact verified numeric company realm ID. |
| `QBO_INVOICES_CUSTOMER_IDS` | Explicit comma-separated approved numeric QuickBooks customer or job IDs. |
| `QBO_INVOICES_CURRENCY` | Verified ISO home currency fallback, for example `CAD` if independently confirmed. |
| `QBO_INVOICES_PROJECT_MAP` | Reviewed JSON array of internal platform project IDs and exact external references. Defaults to an empty array. |
| `QBO_INVOICES_SANDBOX` | `true` on staging. Omit or set `false` on production. Never mix credentials and realms across environments. |
| `QBO_INVOICES_CLIENT_ID` | Intuit application client ID. Suggested Secret Manager name `mi-qbo-invoices-client-id`. |
| `QBO_INVOICES_CLIENT_SECRET` | Intuit application client secret. Suggested Secret Manager name `mi-qbo-invoices-client-secret`. |
| `QBO_INVOICES_TOKEN_KEY` | Base64-encoded 32-byte random key. Suggested Secret Manager name `mi-qbo-invoices-token-key`. |
| `ALLOWED_ORIGIN` | Existing exact HTTPS dashboard origin. The callback URL is derived from this setting. |

Use an independent encryption key per environment. Generate it in the approved secret-management workflow and avoid displaying it or retaining it in shell history. The service stores only the encrypted rotating refresh token in the tenant's private Firestore connection record. Short-lived access tokens are used in memory. Use separate production and sandbox secrets. Review access-log retention and access because Intuit sends a single-use authorization code in the callback query. The callback page strips those values immediately and has a no-referrer policy.

Example mapping with synthetic project IDs:

```json
[
  { "projectId": "regular-consulting", "workOrder": "WO1267" },
  { "projectId": "policy-review", "workOrder": "WO1267.1", "qboProjectId": "451" },
  { "projectId": "financial-consulting", "workOrder": "WO1268" }
]
```

A reviewed mapping can match an explicit project reference, an invoice CustomerRef that represents a mapped job, or a complete work-order reference in an invoice line description. Invalid or overlapping alias configurations are rejected. The platform displays the authorized project names and retains multiple links. Unrecognized references remain unlinked. Review them before publishing. An invoice may appear under several project filters while counting only once in the overall register.

## Connect and operate

1. Sign in as the dashboard's authorized platform owner and open **Invoices** in the Morris workspace. Click **Connect QuickBooks Online** and allow the authorization pop-up. Keep the staff tab open. The pop-up returns to the dashboard origin, and the original signed-in tab verifies the response. Confirm the selected Intuit company before authorizing.
2. Click **Sync invoices**. A sync reads only the reviewed scope, refreshes the token on the server, and replaces the mirror after all pages have loaded. Verify invoice count, sample invoice numbers, currency, due dates, balances, project links and the displayed last-sync date. This is an on-demand sync. Repeat it before billing reviews and whenever balances or invoice details change.
3. Review each invoice and choose **Approve for client**. Verify that approved staff-only notes and customer identifiers are absent from the client register. Verify a client user can see only approved invoices in their scope and the relevant badge. Use **Withdraw approval** to remove a record. An invoice without a project has a separate warning before approval. If the source changes invoice number, issue date, due date, total, currency, customer or project links, review and approve the changed record again. Ordinary balance changes remain visible on an approved invoice.
4. If sync fails, check the approved realm/customer scope and connection, then retry. The last complete snapshot remains visible, with its actual last-sync date. The current cap is 500 queried invoices across the approved customer IDs and a 700 KB mirror. Exceeding either cap leaves the previous snapshot intact. A cleanup or expansion requires review. Never silently expand to an invoice query across the entire realm.
5. To intentionally remove the integration, use **Disconnect** while signed in as the owner. The service revokes the Intuit token, removes the mirror and retains the invoice audit history. If revocation fails, the UI reports a failure. If immediate suppression is needed, disable `QBO_INVOICES_ENABLED` using the approved dashboard rollback process and revoke access through Intuit. Keep the client connect screen and secret versions independent from QuickBooks Time.

For rollback, restore the reviewed prior dashboard revision or deploy a reviewed candidate with `QBO_INVOICES_ENABLED=false`. Image rollback disables invoice access when the running code does not include this feature. It does not remove persisted invoice or authorization records. Use the authorized disconnect workflow before rollback when removal is required. Rotating the encryption key requires reconnecting. Verify the existing dashboard report and scheduled QuickBooks Time import separately.

## Release note

Added a scoped invoice register with staff approval, project and invoice-month filters, overlapping payment/urgency filters, outstanding balances and navigation badges. Empty client portfolios now keep a compact reporting state. QuickBooks Time imports, allocations, worker, Scheduler and project publication settings have no release changes.
