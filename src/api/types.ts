import type { Allocation, DeliveryProject } from "../reporting/model";
export interface Workspace {
  role: "administrator" | "editor" | "client";
  canCreate: boolean;
  revision: number;
  tenant: { id: string; name: string };
  agreements: { id: string; name: string }[];
  departments: { id: string; name: string; agreementId: string }[];
}
export interface PageQuery {
  month: string;
  limit: number;
  cursor?: string;
  agreementId?: string;
  sourceId?: string;
}
export interface StaffProject
  extends Omit<DeliveryProject, "internalNotes" | "trainingSessions"> {
  seconds: number;
  lifetimeSeconds: number;
}
export interface StaffSource {
  id: string;
  date: string;
  seconds: number;
  description: string;
  sourceWorkOrderId: string;
  sourceRevision: string;
  allocationRevision: number;
  portions: Allocation[];
  unallocatedSeconds: number;
  conflict: boolean;
}
export interface HistoryRow {
  revision: number;
  at: string;
  actor?: string;
  portions: Allocation[];
}
export interface StaffPage {
  revision: number;
  projects?: StaffProject[];
  sources?: StaffSource[];
  history?: HistoryRow[];
  nextCursor?: string;
}
