export interface SourcePage<T> {
  records: T[];
  nextCursor?: string;
  sourceCompanyId: string;
}
export interface AccountingProject {
  externalId: string;
  customerId: string;
  parentCustomerId?: string;
  active: boolean;
  revision: string;
}
export interface QuickBooksOnlineAccountingAdapter {
  readonly source: "qbo-accounting";
  readCustomers(cursor?: string): Promise<SourcePage<AccountingProject>>;
}
export interface TimeRecord {
  externalId: string;
  userId: string;
  jobcodeId: string;
  durationSeconds: number;
  date: string;
  modifiedAt: string;
  deleted: boolean;
  approval: "unknown" | "pending" | "approved";
}
export interface QuickBooksTimeAdapter {
  readonly source: "quickbooks-time";
  readTimesheets(cursor?: string): Promise<SourcePage<TimeRecord>>;
}
export const disabledAccounting: QuickBooksOnlineAccountingAdapter = {
  source: "qbo-accounting",
  async readCustomers() {
    throw Error("Live Accounting adapter disabled");
  },
};
export const disabledTime: QuickBooksTimeAdapter = {
  source: "quickbooks-time",
  async readTimesheets() {
    throw Error("Live Time adapter disabled");
  },
};
/** A token handle is a regional Secret Manager version reference, never a token string. */
export interface RegionalCredentialReference {
  projectId: string;
  location: "northamerica-northeast1";
  secretId: string;
  version: string;
}
export interface OAuthCoordinator {
  consumeSingleUseState(
    stateDigest: string,
    actorSubject: string,
  ): Promise<boolean>;
  rotateRefreshTokenUnderLease(
    reference: RegionalCredentialReference,
    expectedVersion: string,
  ): Promise<RegionalCredentialReference>;
}
