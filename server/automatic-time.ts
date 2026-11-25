import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import type { Project } from "../src/projects/model";
import { readPortfolio } from "./portfolio";
import type { TimeMappingRecord } from "./time-catalog";

export interface AutomaticTimeAllocation {
  projectId: string;
  parentId: string;
  areaId: string;
  account: string;
  jobcodeId: string;
  sourceRevision: string;
  seconds: number;
  provenance: "reviewed-quickbooks-time-mapping";
  reportingDescription?: string;
}

// Kept outside the approved reporting ledger. A mapped draft cannot change a
// client report, even when the destination project is already published.
export const automaticTimeRef = (root: DocumentReference, sourceId: string) =>
  root.collection("automaticTimeAllocations").doc(sourceId);

export async function automaticDestination(tx: Transaction, root: DocumentReference, mapping: TimeMappingRecord) {
  if (mapping.reviewedAttribution !== true || mapping.sourceJob?.missing !== false ||
    !mapping.sourceJob.active || mapping.sourceJob.id !== mapping.jobcodeId) return;
  const project = (await tx.get(root.collection("projects").doc(mapping.projectId))).data() as Project | undefined;
  if (project?.tenantId !== root.id || project.id !== mapping.projectId || project.schemaVersion !== 2 ||
    project.status === "closed" || project.status === "cancelled" || project.delivery?.kind !== "project") return;
  const { parentId, areaId } = project.delivery;
  if (!parentId || !areaId || parentId === project.id) return;
  const [parent, portfolio] = await Promise.all([
    tx.get(root.collection("projects").doc(parentId)),
    readPortfolio(tx, root),
  ]);
  if (parent.get("tenantId") !== root.id || parent.get("id") !== parentId || parent.get("schemaVersion") !== 2 ||
    parent.get("delivery.kind") !== "engagement" || parent.get("delivery.parentId") ||
    !portfolio.areas.some(area => area.id === areaId)) return;
  return { projectId: project.id, parentId, areaId, account: mapping.account, jobcodeId: mapping.jobcodeId };
}

export function automaticAllocation(
  destination: Awaited<ReturnType<typeof automaticDestination>>,
  sourceRevision: string,
  seconds: number,
  hasManualHistory: boolean,
  notes?: string,
): AutomaticTimeAllocation | undefined {
  if (!destination || hasManualHistory || !Number.isSafeInteger(seconds) || seconds <= 0) return;
  return { ...destination, sourceRevision, seconds, provenance: "reviewed-quickbooks-time-mapping",
    ...(notes ? { reportingDescription: notes } : {}) };
}
