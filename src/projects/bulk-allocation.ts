export const MAX_BULK_ALLOCATION_ENTRIES = 25;

export interface BulkAllocationEntry {
  sourceId: string;
  expectedSourceRevision: string;
  expectedAllocationRevision: number;
}

export interface BulkAllocationRequest {
  projectId: string;
  entries: BulkAllocationEntry[];
  approveAutomatic?: true;
}

export interface BulkAllocationOutcome {
  sourceId: string;
  status: "saved" | "already_saved" | "source_changed" | "allocation_changed" |
    "request_changed" | "not_eligible" | "unavailable" | "retryable";
}

export interface BulkAllocationResponse {
  outcomes: BulkAllocationOutcome[];
}
