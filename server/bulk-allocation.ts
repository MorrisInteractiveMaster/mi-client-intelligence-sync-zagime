import { MAX_BULK_ALLOCATION_ENTRIES, type BulkAllocationRequest, type BulkAllocationResponse, type BulkAllocationOutcome } from "../src/projects/bulk-allocation";
import { safeId } from "./contracts";
import { key, type FirestoreTenantStore } from "./firestore-store";
import { creationKey } from "./idempotency";

type BatchStatus = BulkAllocationOutcome["status"];
const expectedErrors = new Map<string, BatchStatus>([
  ["Source conflict", "source_changed"],
  ["Bulk allocation revision conflict", "allocation_changed"],
  ["Idempotency conflict", "request_changed"],
  ["Bulk entry not eligible", "not_eligible"],
  ["Forbidden", "unavailable"],
]);

function parseBulkRequest(value: unknown): BulkAllocationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(field => !["projectId", "entries", "approveAutomatic"].includes(field)))
    throw Error("Invalid bulk allocation request");
  const { projectId, entries, approveAutomatic } = value as BulkAllocationRequest;
  if (approveAutomatic !== undefined && approveAutomatic !== true) throw Error("Invalid bulk allocation request");
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_BULK_ALLOCATION_ENTRIES)
    throw Error("Invalid bulk allocation size");
  safeId(projectId);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).some(field => !["sourceId", "expectedSourceRevision", "expectedAllocationRevision"].includes(field)) ||
      typeof entry.expectedSourceRevision !== "string" || !entry.expectedSourceRevision || entry.expectedSourceRevision.length > 256 ||
      !Number.isSafeInteger(entry.expectedAllocationRevision) || entry.expectedAllocationRevision < 0 ||
      seen.has(entry.sourceId)) throw Error("Invalid bulk allocation entry");
    seen.add(safeId(entry.sourceId));
  }
  return { projectId, entries, ...(approveAutomatic && { approveAutomatic }) };
}

/** Independently commit each selected source. A conflict on one row never writes another row's data. */
export async function allocateTimeBatch(
  store: Pick<FirestoreTenantStore, "allocateBulkEntry">,
  tenant: string,
  subject: string,
  value: unknown,
  idempotencyKey: string,
  now: number,
  signal?: AbortSignal,
): Promise<BulkAllocationResponse> {
  const { projectId, entries, approveAutomatic } = parseBulkRequest(value);
  const batch = creationKey(idempotencyKey, subject, now, approveAutomatic ? { projectId, approveAutomatic } : projectId);
  const outcomes: BulkAllocationOutcome[] = [];
  for (const entry of entries) {
    if (signal?.aborted) break;
    let status: BatchStatus;
    try {
      const result = await store.allocateBulkEntry(tenant, subject, projectId, entry, {
        id: key("time-bulk-v2", batch.id, entry.sourceId),
        hash: key(batch.payloadHash, entry.expectedSourceRevision, String(entry.expectedAllocationRevision)),
      }, now, approveAutomatic);
      status = result.changed ? "saved" : "already_saved";
    } catch (error) {
      status = error instanceof Error ? expectedErrors.get(error.message) ?? "retryable" : "retryable";
    }
    outcomes.push({ sourceId: entry.sourceId, status });
  }
  return { outcomes };
}
