import { createHash } from "node:crypto";
import { FieldPath, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import type { Project } from "../src/projects/model";
import type { TimeMappingImpact } from "../src/projects/time";
import { sourceRecordId } from "./contracts";
import { automaticTimeRef } from "./automatic-time";
import { readPortfolio } from "./portfolio";
import type { TimeMappingRecord } from "./time-catalog";

const scopeLimit = 12000;
export async function timeMappingImpact(tx: Transaction, root: DocumentReference, mapping: TimeMappingRecord, target: Project): Promise<TimeMappingImpact> {
  const delivery = target.delivery;
  const parentId = delivery?.kind === "engagement" ? target.id : delivery?.parentId;
  const [parent, portfolio] = await Promise.all([
    parentId && parentId !== target.id ? tx.get(root.collection("projects").doc(parentId)) : undefined,
    readPortfolio(tx, root),
  ]);
  const department = portfolio.areas.find(area => area.id === delivery?.areaId);
  const valid = delivery?.kind === "engagement" ? !delivery.parentId : delivery?.kind === "project" &&
    parent?.exists && parent.get("tenantId") === root.id && parent.get("schemaVersion") === 2 &&
    parent.get("delivery.kind") === "engagement" && !parent.get("delivery.parentId") && Boolean(department);
  const approvedTarget = valid && target.status !== "closed" && target.status !== "cancelled";
  const result: TimeMappingImpact = {
    version: "", workOrder: mapping.sourceJob?.name ?? mapping.jobcodeId, project: target.name,
    parent: parent?.get("name") ?? (parentId === target.id ? target.name : ""),
    ...(department && { department: department.name }),
    active: 0, recordedSeconds: 0, eligible: 0, eligibleSeconds: 0, classified: 0, manual: 0,
    split: 0, conflict: 0, excluded: 0, hierarchy: 0, unchanged: 0,
  };
  const fingerprint = createHash("sha256");
  fingerprint.update(JSON.stringify([root.id, mapping, target.id, target.status, target.name, delivery?.kind, parentId, result.parent, department?.id, department?.name, approvedTarget]));
  const query = root.collection("rawTime").where("record.sourceWorkOrderId", "==", mapping.jobcodeId).orderBy(FieldPath.documentId());
  let after: string | undefined;
  let scanned = 0;
  do {
    const page = await tx.get((after ? query.startAfter(after) : query).limit(180));
    scanned += page.size;
    if (scanned > scopeLimit) throw Error("Source period too large");
    const scoped = page.docs.filter(doc => doc.get("sourceCompanyId") === mapping.account && doc.get("source") === "quickbooks-time" &&
      doc.get("scopeProjectId") === mapping.scopeProjectId && doc.get("record.tenantId") === root.id);
    const refs = scoped.flatMap(doc => [root.collection("allocationHeads").doc(doc.id), automaticTimeRef(root, doc.id)]);
    const state = refs.length ? await tx.getAll(...refs) : [];
    for (const [index, doc] of scoped.entries()) {
      const head = state[index * 2].data();
      const auto = state[index * 2 + 1].data();
      const raw = doc.get("record");
      const external = doc.get("externalId");
      fingerprint.update(JSON.stringify([doc.id, raw.revision, raw.seconds, raw.date, doc.get("deleted"), head?.revision, head?.sourceRevision,
        head?.needsReview, head?.portions, auto?.projectId, auto?.sourceRevision, auto?.seconds]));
      if (doc.get("deleted") === true || doc.get("schemaVersion") !== 2 || typeof external !== "string" ||
        doc.id !== sourceRecordId("quickbooks-time", mapping.account, external) || !Number.isSafeInteger(raw.seconds) ||
        raw.seconds < 0 || typeof raw.revision !== "string") {
        result.excluded++;
        continue;
      }
      result.active++;
      result.recordedSeconds += raw.seconds;
      if (head?.needsReview || head?.sourceRevision && head.sourceRevision !== raw.revision ||
        auto && (auto.projectId !== target.id || auto.sourceRevision !== raw.revision || auto.seconds !== raw.seconds)) result.conflict++;
      else if (head?.portions?.length > 1) result.split++;
      else if (head) result.manual++;
      else if (auto) result.classified++;
      else if (!approvedTarget) result.hierarchy++;
      else if (raw.seconds === 0 || delivery?.kind === "engagement") result.unchanged++;
      else {
        result.eligible++;
        result.eligibleSeconds += raw.seconds;
      }
    }
    after = page.size === 180 ? page.docs.at(-1)?.id : undefined;
  } while (after);
  result.unchanged += result.classified + result.manual + result.split + result.conflict + result.excluded + result.hierarchy;
  if (!Number.isSafeInteger(result.recordedSeconds) || !Number.isSafeInteger(result.eligibleSeconds)) throw Error("Invalid reporting summary");
  return { ...result, version: fingerprint.digest("hex") };
}
