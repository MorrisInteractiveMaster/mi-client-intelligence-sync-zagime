export type TimeProjectMetadata =
  | { state: "unavailable" | "no-match" }
  | {
      state: "verified";
      id: string;
      parentJobcodeId: string | null;
      name: string;
      status: "not_started" | "in_progress" | "complete";
      active: boolean;
    };

export interface TimeMapping {
  jobcodeId: string;
  projectId: string;
  lastSuccess?: string;
  through?: string;
  failed?: boolean;
  sourceName?: string;
  sourceState?: "active" | "inactive" | "missing";
  mappingState?: "registered" | "linked";
  canRelink?: boolean;
  recordedSeconds?: number;
  allocatedSeconds?: number;
  unallocatedSeconds?: number;
  lifetimeRecordedSeconds?: number;
  sourceProject?: TimeProjectMetadata;
}
export interface TimeStatus {
  month?: string;
  recordedSeconds?: number;
  allocatedSeconds?: number;
  unallocatedSeconds?: number;
  lifetimeUnallocatedSeconds?: number;
  lifetimeRecordedSeconds?: number;
  state: "disconnected" | "unmapped" | "configured";
  canManage: boolean;
  mappings: TimeMapping[];
  customerScoped?: boolean;
  customerVerified?: boolean;
  dailyState?: "running" | "failed" | "complete";
  errorStage?: "discovery" | "entries" | "timers";
  lastDailySuccess?: string;
  running?: { observedAt: string; count: number; seconds: number };
  runningFailed?: boolean;
}
