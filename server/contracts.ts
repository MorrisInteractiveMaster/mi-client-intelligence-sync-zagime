import type {
  ReportingState,
  DeliveryProject,
  RawTime,
  SourceLink,
  DepartmentBudget,
  Agreement,
  CapRevision,
  Department,
  AllocationRevision,
  TeamMember,
  TeamAssignment,
  MilestoneEvent,
  Blocker,
  Publication,
  StatusEvent,
} from "../src/reporting/model";
export type Role = "administrator" | "editor" | "client";
export interface Membership {
  tenantId: string;
  subject: string;
  approved: boolean;
  enabled: boolean;
  role: Role;
  agreementIds: string[];
  projectIds: string[] | "all-authorized-agreements";
}
/** Identity verifier must verify signature, issuer/audience, expiry and current revocation before returning. */
export interface VerifiedIdentity {
  googleSubject?: string;
  /** Populated only by the server verifier; never copied from token custom claims. */
  corporatePolicy?: boolean;
  staffTenantId?: string;
  subject: string;
  issuer: string;
  audience: string;
  expiresAt: number;
  disabled: boolean;
  revoked: boolean;
}
export interface IdentityVerifier {
  verify(authorization: string): Promise<VerifiedIdentity>;
}
export const denyAllVerifier: IdentityVerifier = {
  async verify() {
    throw Error("No production identity verifier configured");
  },
};
export interface AuditEvent {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  entityId: string;
  at: string;
  revision: number;
}
export interface SyncCheckpoint {
  source: "qbo-accounting" | "quickbooks-time";
  sourceCompanyId: string;
  cursor: string;
  revision: number;
  updatedAt: string;
}
/** Firestore document contracts. Server-only paths; no raw state document is exposed to browsers. */
export interface TenantDocuments {
  agreements: Agreement;
  agreementCapRevisions: CapRevision & { agreementId: string };
  departments: Department;
  departmentBudgets: DepartmentBudget;
  projects: DeliveryProject;
  mappings: SourceMappingDocument;
  rawTime: SourceTimeDocument;
  allocationRevisions: AllocationRevision;
  team: TeamMember;
  teamAssignments: TeamAssignment;
  milestones: MilestoneEvent;
  blockers: Blocker;
  trainingSessions: DeliveryProject["trainingSessions"][number] & {
    projectId: string;
  };
  publications: Publication;
  statusHistory: StatusEvent;
  audits: AuditEvent;
  checkpoints: SyncCheckpoint;
  memberships: Membership;
}
export interface TenantRecord {
  revision: number;
  state: ReportingState;
  memberships: Membership[];
  audits: AuditEvent[];
  checkpoints: SyncCheckpoint[];
}
/** Production adapter must implement a serializable transaction with membership reads inside it. */
export interface TransactionPlan {
  subject: string;
  projectId?: string;
  agreementId?: string;
  departmentId?: string;
  idempotency?: { id: string; payloadHash: string; now: number };
}
export interface TenantStore {
  workspace?(
    tenantId: string,
    subject: string,
  ): Promise<import("../src/api/types").Workspace>;
  staffPage?(
    tenantId: string,
    subject: string,
    resource: "projects" | "sources" | "history" | "audits",
    query: import("../src/api/types").PageQuery,
  ): Promise<import("../src/api/types").StaffPage>;
  allocateReporting?(
    tenantId: string,
    subject: string,
    sourceId: string,
    expectedRevision: number,
    portions: import("../src/reporting/model").Allocation[],
    now: number,
  ): Promise<{ revision: number; changed: boolean }>;
  readPublished?(
    tenantId: string,
    subject: string,
    scope: import("../src/reporting/model").ReportingScope,
  ): Promise<
    ReturnType<typeof import("../src/reporting/model").clientProjection> & {
      revision: number;
    }
  >;
  transaction<T>(
    tenantId: string,
    work: (record: TenantRecord) => T | Promise<T>,
    plan?: TransactionPlan,
  ): Promise<T>;
}
export interface IdentityPolicy {
  issuer: string;
  audience: string;
  now: () => number;
}
export function safeId(value: string) {
  if (typeof value !== "string" || !/^[-a-zA-Z0-9_]{1,128}$/.test(value))
    throw Error("Invalid scoped identifier");
  return value;
}
export function tenantPath<K extends keyof TenantDocuments>(
  tenantId: string,
  collection: K,
  id: string,
) {
  safeId(tenantId);
  safeId(id);
  if (
    ![
      "agreements",
      "agreementCapRevisions",
      "departments",
      "departmentBudgets",
      "projects",
      "mappings",
      "rawTime",
      "allocationRevisions",
      "team",
      "teamAssignments",
      "milestones",
      "blockers",
      "trainingSessions",
      "publications",
      "statusHistory",
      "audits",
      "checkpoints",
      "memberships",
    ].includes(collection)
  )
    throw Error("Invalid collection");
  return `tenants/${tenantId}/${collection}/${id}`;
}
import { createHash } from "node:crypto";
export interface SourceTimeDocument {
  source: "qbo-accounting" | "quickbooks-time";
  sourceCompanyId: string;
  record: RawTime;
}
export interface SourceMappingDocument {
  sourceCompanyId: string;
  mapping: SourceLink;
}
export function sourceRecordId(
  source: SourceTimeDocument["source"],
  companyId: string,
  externalId: string,
) {
  if (!companyId || !externalId) throw Error("Missing source identity");
  return createHash("sha256")
    .update(JSON.stringify([source, companyId, externalId]))
    .digest("hex");
}
