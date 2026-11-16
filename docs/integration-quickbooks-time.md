# QuickBooks Time preparation

User reports the Time app is connected; registration, account permissions, entitlement and usable grants are not independently verified. disabledTime throws before network access. No live data or token exchange.

The published QuickBooks Time reference exposes Timesheets, Timesheets Deleted, Users and Jobcodes. Timesheets have integer-second duration, stable IDs, user/jobcode IDs and modification timestamps; regular and manual forms differ. A locked timesheet is not proof of approval. User submitted_to/approved_to fields may support timeframe interpretation, subject to real entitlement and permissions. Current not-yet-approved/ongoing visibility remains unverified for this account. Normalize unknown approval explicitly; do not invent approved=true or equate Accounting TimeActivity with Time timesheets.

The published OAuth flow uses separate authorize/grant/refresh endpoints and says scope is not required/supported for that flow. Do not copy com.intuit.quickbooks.accounting into it or invent a Time read scope. Registration may differ; confirm current app flow with Intuit in the sandbox gate. Privileges depend on the authorized account/user and actual API permissions. No guessed redirect URL is registered.

Use explicit product/company/user/jobcode ID mappings to internal tenant/team/agreement/project IDs. Keep raw source payload separate from Morris allocation/history. Read changed records with documented modified-since/pagination and a separate deletion feed; handle timezone/plain-date semantics, on-the-clock duration, amendments and out-of-order timestamps with a tested deterministic revision policy. Bounded windows, pages, retries and limits must be confirmed for the app before implementation; do not assume QBO CDC applies.

The same server callback state/replay, regional secret-only storage, serialized refresh/version update and reconnect design described in the Accounting note applies, but token lifetimes/response fields must be validated independently. Separate adapters, credential references and checkpoints by product/company. No network client, sync job or API calls are implemented.

Primary source: [QuickBooks Time API reference](https://tsheetsteam.github.io/api_docs/) — Authentication, Timesheets, Timesheets Deleted and Users sections. Account-level operational visibility is a production blocker, not a capability proven by this document.

Time rate budget proposal: one in-flight request per connection, initially one request/second, at most three bounded retries honoring Retry-After. This is a conservative local design, not a verified account quota; stop on repeated permission/auth failures and verify current Time throttles separately before a sandbox implementation.
