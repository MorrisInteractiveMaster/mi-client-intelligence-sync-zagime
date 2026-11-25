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
  canReview?: boolean;
  recordedSeconds?: number;
  allocatedSeconds?: number;
  unallocatedSeconds?: number;
  lifetimeRecordedSeconds?: number;
  lifetimeAllocatedSeconds?: number;
  sourceProject?: TimeProjectMetadata;
  historicalProgress?: HistoricalClassificationProgress;
}

export interface HistoricalClassificationProgress {
  total: number;
  examined: number;
  classified: number;
  unchanged: number;
  conflicts: number;
  seconds: number;
  done: boolean;
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
  verifiedCustomerId?: string;
  dailyState?: "running" | "failed" | "complete";
  errorStage?: "discovery" | "entries" | "timers";
  lastDailySuccess?: string;
  running?: { observedAt: string; count: number; seconds: number };
  runningFailed?: boolean;
}
export type TimeMappingReview = {
  targetKind: "engagement" | "project";
  previousProjectId: string;
  recordedSeconds: number;
  allocatedSeconds: number;
  parentId?: string;
  areaId?: string;
  impactVersion?: string;
};

export interface TimeMappingImpact {
  version: string;
  workOrder: string;
  project: string;
  parent: string;
  department?: string;
  active: number;
  recordedSeconds: number;
  eligible: number;
  eligibleSeconds: number;
  classified: number;
  manual: number;
  split: number;
  conflict: number;
  excluded: number;
  hierarchy: number;
  unchanged: number;
}

export function parseTimeMappingReview(input: unknown): TimeMappingReview {
  if (typeof input !== "object" || !input || Array.isArray(input)) throw Error("Invalid Time request");
  const { targetKind, previousProjectId, recordedSeconds, allocatedSeconds, parentId, areaId, impactVersion } = input as TimeMappingReview;
  const identifier = (id: unknown): id is string => typeof id === "string" && /^[-a-zA-Z0-9_]{1,128}$/.test(id);
  if (Object.keys(input).some(field => !["targetKind", "previousProjectId", "recordedSeconds", "allocatedSeconds", "parentId", "areaId", "impactVersion"].includes(field)) ||
    (impactVersion !== undefined && (typeof impactVersion !== "string" || !/^[a-f0-9]{64}$/.test(impactVersion))) ||
    (targetKind !== "engagement" && targetKind !== "project") ||
    !identifier(previousProjectId) ||
    (targetKind === "project" ? !identifier(parentId) || !identifier(areaId) : parentId !== undefined || areaId !== undefined) ||
    !Number.isSafeInteger(recordedSeconds) || !Number.isSafeInteger(allocatedSeconds) ||
    allocatedSeconds < 0 || recordedSeconds < allocatedSeconds) throw Error("Invalid Time request");
  return { targetKind, previousProjectId, recordedSeconds, allocatedSeconds, ...(parentId && areaId ? { parentId, areaId } : {}),
    ...(impactVersion && { impactVersion }) };
}

export function workOrderQueue(mapping: TimeMapping) {
  if (mapping.sourceState === "inactive" || mapping.sourceState === "missing") return "inactive";
  if (mapping.failed || (mapping.mappingState === "registered" && !mapping.canReview)) return "review";
  if (mapping.mappingState === "registered") return "awaiting";
  return "mapped";
}
