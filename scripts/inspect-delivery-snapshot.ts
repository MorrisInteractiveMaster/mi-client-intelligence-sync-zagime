import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { checkHierarchy, MAX_DELIVERY_PROJECTS, parseDelivery } from "../src/projects/delivery";

interface Snapshot {
  projects: { id: string; schemaVersion: number; delivery?: unknown }[];
  rawTime: { record: { id: string; seconds: number; sourceWorkOrderId: string; revision: string }; deleted?: boolean }[];
  timeMappings: { account: string; jobcodeId: string; projectId: string; scopeProjectId?: string }[];
  allocationHeads: { sourceId: string; portions: { projectId: string; seconds: number }[]; appliedPortions?: { projectId: string; seconds: number }[]; needsReview?: boolean }[];
}
export function inspectDeliverySnapshot(value: unknown) {
  if (!value || typeof value !== "object") throw Error("Invalid private snapshot");
  const snapshot = value as Snapshot;
  for (const key of ["projects", "rawTime", "timeMappings", "allocationHeads"] as const) {
    if (!Array.isArray(snapshot[key])) throw Error("Invalid snapshot collection " + key);
  }
  const graph = new Map(snapshot.projects.filter(p => p.schemaVersion === 2).map(p => [p.id, p.delivery ? parseDelivery(p.delivery).parentId : undefined]));
  if (graph.size !== snapshot.projects.length || graph.size > MAX_DELIVERY_PROJECTS) throw Error("Review legacy schema, duplicate IDs or hierarchy capacity");
  checkHierarchy(graph);
  const raw = new Map(snapshot.rawTime.map(envelope => [envelope.record.id, envelope]));
  if (raw.size !== snapshot.rawTime.length) throw Error("Duplicate raw time identity");
  const orders = new Set(snapshot.timeMappings.map(m => JSON.stringify([m.account, m.jobcodeId])));
  if (orders.size !== snapshot.timeMappings.length) throw Error("Duplicate work-order identity");
  const active = snapshot.rawTime.filter(envelope => !envelope.deleted);
  if (active.some(envelope => !Number.isSafeInteger(envelope.record.seconds) || envelope.record.seconds < 0 || !envelope.record.revision))
    throw Error("Invalid recorded duration or source revision");
  let allocatedSeconds = 0;
  for (const head of snapshot.allocationHeads) {
    const source = raw.get(head.sourceId);
    const parts = head.appliedPortions ?? head.portions;
    if (!source || !Array.isArray(parts) || new Set(parts.map(p => p.projectId)).size !== parts.length ||
      parts.some(p => !graph.has(p.projectId) || !Number.isSafeInteger(p.seconds) || p.seconds <= 0))
      throw Error("Review source and project allocation references");
    const seconds = parts.reduce((sum, p) => sum + p.seconds, 0);
    if (seconds > (source.deleted ? 0 : source.record.seconds)) throw Error("Review allocation against corrected source duration");
    allocatedSeconds += seconds;
  }
  const recordedSeconds = active.reduce((sum, envelope) => sum + envelope.record.seconds, 0);
  if (!Number.isSafeInteger(recordedSeconds) || !Number.isSafeInteger(allocatedSeconds) || allocatedSeconds > recordedSeconds)
    throw Error("Invalid snapshot totals");
  const orderIds = [...orders].sort();
  const reviewedJobs = ["132160684", "135372950", "132160686", "136571342"];
  const attribution = reviewedJobs.map(jobcodeId => {
    const matches = snapshot.timeMappings.filter(mapping => mapping.jobcodeId === jobcodeId);
    const project = matches.length === 1 ? matches[0].scopeProjectId ?? matches[0].projectId : undefined;
    return { jobcodeId, project, state: project && graph.has(project) ? "existing scope" : "owner review required" };
  });
  const rawRows = [...raw].sort(([a], [b]) => a.localeCompare(b)).map(([id, envelope]) => [
    id, envelope.record.sourceWorkOrderId, envelope.record.revision, envelope.record.seconds, Boolean(envelope.deleted),
  ]);
  return {
    readOnly: true, projects: graph.size, projectsWithDelivery: snapshot.projects.filter(p => p.delivery).length,
    workOrders: orders.size, sourceEntries: raw.size, recordedSeconds, allocatedSeconds,
    unallocatedSeconds: recordedSeconds - allocatedSeconds,
    correctionsForReview: snapshot.allocationHeads.filter(head => head.needsReview).length, attribution,
    sourceIdentityDigest: createHash("sha256").update(JSON.stringify([orderIds, rawRows])).digest("hex"),
  };
}

if (process.argv[1]?.endsWith("inspect-delivery-snapshot.ts")) {
  const [path, ...rest] = process.argv.slice(2);
  if (!path || rest.length || (await stat(path)).size > 32_000_000) throw Error("Supply one approved private JSON snapshot below 32 MB");
  console.log(JSON.stringify(inspectDeliverySnapshot(JSON.parse(await readFile(path, "utf8")))));
}
