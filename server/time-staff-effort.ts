import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { key } from "./firestore-store";

/** Pending automatic figures are a breakdown of staff-attributed effort, never an extra ledger credit. */
export async function readPendingMappedEffort(tx: Transaction, root: DocumentReference, ids: string[], month: string) {
  const result = new Map<string, { monthly: number; lifetime: number }>();
  for (let offset = 0; offset < ids.length; offset += 25) {
    const projects = ids.slice(offset, offset + 25);
    const pending = await tx.get(root.collection("automaticTimeAllocations").where("projectId", "in", projects).limit(12001));
    if (pending.size > 12000) throw Error("Source period too large");
    const mappings = new Map<string, DocumentReference>();
    for (const doc of pending.docs) {
      const row = doc.data();
      if (typeof row.account !== "string" || typeof row.jobcodeId !== "string") continue;
      const id = key(row.account, row.jobcodeId);
      mappings.set(id, root.collection("timeMappings").doc(id));
    }
    const mappingsById = new Map<string, FirebaseFirestore.DocumentData | undefined>();
    const mappingRefs = [...mappings.values()];
    for (let start = 0; start < mappingRefs.length; start += 200) {
      for (const doc of await tx.getAll(...mappingRefs.slice(start, start + 200))) mappingsById.set(doc.id, doc.data());
    }
    for (let start = 0; start < pending.size; start += 160) {
      const batch = pending.docs.slice(start, start + 160);
      const sources = await tx.getAll(...batch.map(doc => root.collection("rawTime").doc(doc.id)));
      for (const [index, doc] of batch.entries()) {
        const item = doc.data();
        const source = sources[index];
        if (typeof item.account !== "string" || typeof item.jobcodeId !== "string") continue;
        const mapping = mappingsById.get(key(item.account, item.jobcodeId));
        if (item.provenance !== "reviewed-quickbooks-time-mapping" || mapping?.account !== item.account ||
          mapping.jobcodeId !== item.jobcodeId || mapping.projectId !== item.projectId || !mapping.reviewedAttribution ||
          source.get("source") !== "quickbooks-time" || source.get("sourceCompanyId") !== item.account ||
          source.get("scopeProjectId") !== mapping.scopeProjectId || source.get("record.tenantId") !== root.id ||
          source.get("record.sourceWorkOrderId") !== item.jobcodeId || source.get("deleted") !== false ||
          source.get("record.revision") !== item.sourceRevision || source.get("record.seconds") !== item.seconds ||
          !Number.isSafeInteger(item.seconds) || item.seconds <= 0) continue;
        const sums = result.get(item.projectId) ?? { monthly: 0, lifetime: 0 };
        sums.lifetime += item.seconds;
        if (source.get("record.date")?.slice(0, 7) === month) sums.monthly += item.seconds;
        if (!Number.isSafeInteger(sums.lifetime)) throw Error("Invalid reporting summary");
        result.set(item.projectId, sums);
      }
    }
  }
  return result;
}
