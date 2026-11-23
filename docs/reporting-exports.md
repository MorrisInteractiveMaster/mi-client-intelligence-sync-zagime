# CSV reporting

CSV downloads use the same reporting period and applied filters as the visible data. Set and apply filters before downloading. Time & Reporting supports selected months, custom ranges and all authorized history through its existing period control.

| Report | Download |
| --- | --- |
| Morris Overview | Selected-period totals and breakdowns for months, work orders, consultants and linked Morris profiles |
| Time & Reporting | Filtered entries across every page, plus downloads for months, work orders, consultants and linked profiles |
| Morris Projects | All results for the current search and status, including matches beyond the first page |
| Parent engagements and service areas | Authorized engagement and branch reports |
| Budgets & Health and Milestones | Current filtered hierarchy and cap figures, or shown milestones |
| Zagimē client portal | Approved projects, scoped engagement and service-area projects, visible milestones, and approved chart data |

Time entry exports use the existing staff-only scoped endpoint in bounded export pages of up to 500, with the same server filters, revision-aware cursors and tenant boundaries. The export checks every page for repeated rows, changes to the workspace revision and a discrepancy with the server's matched count. It fails visibly if the server cannot provide a complete export. Existing 5,000-row month and 12,000-row history limits still apply. For a larger history, export smaller date ranges. The 500-row page size keeps a request within a bounded payload and avoids needing hundreds of standard 25-row requests.

Client project and milestone downloads are rechecked against a fresh authenticated approved report. They use explicit columns and omit private notes, unpublished content, provider record IDs, employee mapping data and audit information. Chart data comes from already-authorized report aggregates. Draft client previews have no download controls. Staff source exports use the authority of the signed-in account and omit internal Morris notes and audit data.

Files use UTF-8 with a byte-order mark, ISO dates where the data is available, numeric hours and quoted text with doubled quotes. Spreadsheet-formula prefixes are neutralized in text cells. Each field's unit appears in the column heading.
