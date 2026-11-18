export interface TimeMapping {
  jobcodeId: string;
  projectId: string;
  lastSuccess?: string;
  through?: string;
  failed?: boolean;
}
export interface TimeStatus {
  month?: string;
  recordedSeconds?: number;
  unallocatedSeconds?: number;
  state: "disconnected" | "unmapped" | "configured";
  canManage: boolean;
  mappings: TimeMapping[];
}
