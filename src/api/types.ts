import type { Allocation, DeliveryProject } from "../reporting/model";
export interface Workspace {
  corporateStaff?: true;
  role: "administrator" | "editor" | "client";
  canCreate: boolean;
  revision: number;
  tenant: { id: string; name: string };
  agreements: { id: string; name: string }[];
  departments: { id: string; name: string; agreementId: string }[];
}
export interface PageQuery {
  search?: string;
  month: string;
  limit: number;
  cursor?: string;
  agreementId?: string;
  sourceId?: string;
  sourceFilters?: SourceFilters;
}
export interface StaffProject
  extends Omit<DeliveryProject, "internalNotes" | "trainingSessions"> {
  seconds: number;
  lifetimeSeconds: number;
}
export interface StaffSource {
  provider?: "quickbooks-time";
  modifiedAt?: string;
  deleted?: boolean;
  needsReview?: boolean;
  approval?: "unknown" | "pending" | "submitted" | "approved" | "rejected";
  id: string;
  date: string;
  seconds: number;
  description: string;
  sourceWorkOrderId: string;
  workOrderName?: string;
  sourcePersonId?: string;
  consultantName?: string;
  annotations?: AllocationAnnotations;
  sourceRevision: string;
  allocationRevision: number;
  portions: Allocation[];
  unallocatedSeconds: number;
  conflict: boolean;
}
export const sourceStatuses = ["allocated", "partial", "unallocated", "review", "deleted"] as const;
export type SourceStatus = typeof sourceStatuses[number];
export interface SourceFilters {
  workOrder?: string;
  consultant?: string;
  area?: string;
  project?: string;
  from?: string;
  through?: string;
  status?: SourceStatus | "queue";
}
export interface SourceSummary {
  monthTotal: number;
  matched: number;
  counts: Record<SourceStatus, number> & { total: number; remaining: number };
  workOrders: { id: string; label: string }[];
  consultants: { id: string; label: string }[];
}
export function sourceStatus(source: Pick<StaffSource, "deleted" | "needsReview" | "conflict" | "unallocatedSeconds" | "seconds">): SourceStatus {
  if (source.deleted) return "deleted";
  if (source.needsReview || source.conflict) return "review";
  if (!source.unallocatedSeconds) return "allocated";
  return source.unallocatedSeconds === source.seconds ? "unallocated" : "partial";
}
export interface HistoryRow {
  revision: number;
  at: string;
  actor?: string;
  portions: Allocation[];
  annotations?: AllocationAnnotations;
  sourceRevision?: string;
}
export interface AllocationAnnotations {
  reportingDescription: string;
  internalNote: string;
  parentId?: string;
  areaId?: string;
}
export interface StaffPage {
  audits?: { id: string; action: string; entityId: string; actor: string; at: string; revision: number }[];
  revision: number;
  projects?: StaffProject[];
  sources?: StaffSource[];
  history?: HistoryRow[];
  nextCursor?: string;
}
