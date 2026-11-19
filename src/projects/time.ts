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
  sourceProject?: TimeProjectMetadata;
}
export interface TimeStatus {
  month?: string;
  recordedSeconds?: number;
  unallocatedSeconds?: number;
  lifetimeRecordedSeconds?: number;
  state: "disconnected" | "unmapped" | "configured";
  canManage: boolean;
  mappings: TimeMapping[];
}
