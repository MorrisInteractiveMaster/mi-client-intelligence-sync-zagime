import { key } from "./firestore-store";
import { safeId } from "./contracts";
import { timeCatalogLimit } from "./time-client";
import type { TimeMappingRecord } from "./time-catalog";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";

export type ReportingAnchors = Map<string, string[]>;

/** Read-time reporting destinations. The original ledger anchors remain intact. */
export async function reportingAnchors(tx: Transaction, root: DocumentReference, ids: readonly string[]): Promise<ReportingAnchors> {
  if (!ids.length) return new Map();
  const mappings = await tx.get(root.collection("timeMappings").where("reviewedAttribution", "==", true).limit(timeCatalogLimit + 1));
  if (mappings.size > timeCatalogLimit) throw Error("Time catalog capacity exceeded");
  const owners = new Map<string, string>();
  for (const doc of mappings.docs) {
    const m = doc.data() as TimeMappingRecord;
    const identity = key(m.account, m.jobcodeId);
    const anchor = "time-" + identity;
    if (doc.id !== identity || !m.catalog || m.scopeProjectId !== anchor || owners.has(anchor))
      throw Error("Invalid reporting summary");
    owners.set(anchor, safeId(m.projectId));
  }
  const result = new Map(ids.map(id => [id, owners.has(id) ? [] as string[] : [id]]));
  for (const [anchor, owner] of owners) result.get(owner)?.push(anchor);
  return result;
}
