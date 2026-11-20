import { FieldPath, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { sourceStatus, sourceStatuses, type PageQuery, type SourceFilters, type SourceSummary, type StaffSource } from "../src/api/types";
import { calendarDate } from "../src/projects/delivery";
import type { ProjectPage } from "../src/projects/model";
import type { Allocation } from "../src/reporting/model";
import { safeId } from "./contracts";
import { key } from "./firestore-store";
import { readPortfolio } from "./portfolio";
import { readTimeDetails, timeDetailsRef } from "./time-details";

// Exact, consistent counts at the current tenant size. Oversized months fail
// explicitly rather than presenting truncated matches as complete.
export const sourceMonthLimit = 5000;
export const sourceFilterKeys = ["search", "workOrder", "consultant", "area", "project", "from", "through", "status"] as const;
const filterId = /^[A-Za-z0-9_-]{1,128}$/;
const normalized = (text: string) => text.normalize("NFKC").trim().toLowerCase();

export function sourceFilters(query: PageQuery) {
  const f = query.sourceFilters ?? {};
  for (const value of [f.workOrder, f.consultant, f.area, f.project]) {
    if (value !== undefined && !filterId.test(value)) throw Error("Invalid source filter");
  }
  for (const date of [f.from, f.through]) {
    if (date !== undefined && (!calendarDate(date) || !date.startsWith(query.month + "-"))) throw Error("Invalid source date filter");
  }
  if (f.from && f.through && f.from > f.through) throw Error("Invalid source date filter");
  if (f.status !== undefined && f.status !== "queue" && !sourceStatuses.includes(f.status)) throw Error("Invalid source status");
  return { ...f, search: normalized(query.search ?? "") };
}

async function fetchByPath(tx: Transaction, refs: DocumentReference[]): Promise<Map<string, DocumentData | undefined>> {
  const unique = [...new Map(refs.map(ref => [ref.path, ref])).values()];
  const values = new Map<string, DocumentData | undefined>();
  for (let offset = 0; offset < unique.length; offset += 250) {
    for (const doc of await tx.getAll(...unique.slice(offset, offset + 250))) values.set(doc.ref.path, doc.data());
  }
  return values;
}

type SourceNames = { title: string; areaId?: string };
function summarize(rows: StaffSource[], filters: SourceFilters & { search: string }, projects: Map<string, SourceNames>) {
  const counts: SourceSummary["counts"] = { total: 0, allocated: 0, partial: 0, unallocated: 0, review: 0, deleted: 0, remaining: 0 };
  const workOrders = new Map<string, string>();
  const consultants = new Map<string, string>();
  const matches: StaffSource[] = [];
  for (const row of rows) {
    const workOrder = row.sourceWorkOrderId;
    const person = row.sourcePersonId;
    if (filterId.test(workOrder) && (row.workOrderName || !workOrders.has(workOrder))) workOrders.set(workOrder, row.workOrderName || workOrder);
    if (person && filterId.test(person) && (row.consultantName || !consultants.has(person))) consultants.set(person, row.consultantName || person);
    if (filters.workOrder && filters.workOrder !== workOrder || filters.consultant && filters.consultant !== person ||
      filters.from && row.date < filters.from || filters.through && row.date > filters.through ||
      filters.area && row.annotations?.areaId !== filters.area && !row.portions.some(p => projects.get(p.projectId)?.areaId === filters.area) ||
      filters.project && !row.portions.some(p => p.projectId === filters.project)) continue;
    const searchable = [workOrder, row.workOrderName, person, row.consultantName, row.description, row.annotations?.reportingDescription,
      row.annotations?.parentId && projects.get(row.annotations.parentId)?.title, ...row.portions.map(p => projects.get(p.projectId)?.title)];
    if (filters.search && !searchable.some(value => value && normalized(value).includes(filters.search))) continue;
    const status = sourceStatus(row);
    counts.total++;
    counts[status]++;
    const remaining = !row.deleted && row.unallocatedSeconds > 0;
    if (remaining) counts.remaining++;
    if (!filters.status || (filters.status === "queue" ? remaining : status === filters.status)) matches.push(row);
  }
  const options = (values: Map<string, string>) => [...values].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { matches, summary: { monthTotal: rows.length, matched: matches.length, counts, workOrders: options(workOrders), consultants: options(consultants) } };
}

export async function readSourcePage(tx: Transaction, root: DocumentReference, subject: string, revision: number, query: PageQuery): Promise<ProjectPage> {
  const filters = sourceFilters(query);
  const snapshot = await tx.get(root.collection("rawTime").where("schemaVersion", "==", 2)
    .where("record.date", ">=", query.month + "-01").where("record.date", "<=", query.month + "-31")
    .orderBy("record.date").orderBy(FieldPath.documentId()).limit(sourceMonthLimit + 1));
  if (snapshot.size > sourceMonthLimit) throw Error("Source month too large");
  if (!snapshot.size) {
    if (query.cursor) throw Error("Revision conflict");
    return { revision, sources: [], sourceSummary: summarize([], filters, new Map()).summary };
  }
  const heads = await fetchByPath(tx, snapshot.docs.map(doc => root.collection("allocationHeads").doc(doc.id)));
  const projectRefs = new Map<string, DocumentReference>();
  for (const doc of snapshot.docs) {
    const head = heads.get(root.collection("allocationHeads").doc(doc.id).path);
    const ids = [doc.data().scopeProjectId, ...(head?.portions ?? []).map((part: Allocation) => part.projectId)];
    if (head?.annotations?.parentId) ids.push(head.annotations.parentId);
    for (const id of ids) projectRefs.set(safeId(id), root.collection("projects").doc(id));
  }
  const mappingRefs = new Map<string, DocumentReference>();
  const detailsRefs = new Map<string, DocumentReference>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.source !== "quickbooks-time") continue;
    if (data.sourceCompanyId && data.record?.sourceWorkOrderId) mappingRefs.set(doc.id, root.collection("timeMappings").doc(key(data.sourceCompanyId, data.record.sourceWorkOrderId)));
    if (!data.deleted && typeof data.record?.revision === "string" && data.record.revision) detailsRefs.set(doc.id, timeDetailsRef(doc.ref, data.record.revision));
  }
  const [projects, mappings, details, portfolio] = await Promise.all([
    fetchByPath(tx, [...projectRefs.values()]), fetchByPath(tx, [...mappingRefs.values()]),
    fetchByPath(tx, [...detailsRefs.values()]), readPortfolio(tx, root),
  ]);
  const placement = new Map(portfolio.placements.map(item => [item.id, item.areaId]));
  const projectNames = new Map<string, SourceNames>();
  for (const [id, ref] of projectRefs) {
    const project = projects.get(ref.path);
    if (project?.tenantId === root.id && project?.schemaVersion === 2) {
      projectNames.set(id, { title: String(project.name ?? ""), areaId: project.delivery?.areaId ?? placement.get(id) });
    }
  }
  const rows = snapshot.docs.map(doc => {
    const data = doc.data();
    const mapRef = mappingRefs.get(doc.id);
    const scopedProject = projectRefs.get(data.scopeProjectId);
    const detailRef = detailsRefs.get(doc.id);
    if (!scopedProject || !projectNames.has(data.scopeProjectId)) throw Error("Invalid scoped source");
    return projectSource(doc, heads.get(root.collection("allocationHeads").doc(doc.id).path), root.id,
      mapRef ? mappings.get(mapRef.path)?.sourceJob?.name : projects.get(scopedProject.path)?.workOrderReference,
      detailRef ? details.get(detailRef.path) : undefined);
  });
  const { matches, summary } = summarize(rows, filters, projectNames);
  // Include the matching row identities so a sidecar-only enrichment can
  // invalidate an open search if its result membership changes.
  const context = key(root.id, subject, "sources", query.month, String(revision),
    JSON.stringify(sourceFilterKeys.map(field => filters[field] ?? "")), JSON.stringify(matches.map(row => row.id)));
  let offset = 0;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
      const position = matches.findIndex(row => row.id === cursor.after);
      if (cursor.context !== context || position < 0) throw Error();
      offset = position + 1;
    } catch { throw Error("Revision conflict"); }
  }
  const sources = matches.slice(offset, offset + query.limit);
  return { revision, sources, sourceSummary: summary,
    ...(offset + sources.length < matches.length ? {
      nextCursor: Buffer.from(JSON.stringify({ context, after: sources.at(-1)!.id })).toString("base64url"),
    } : {}) };
}

function projectSource(doc: DocumentSnapshot, head: DocumentData | undefined, tenant: string, workOrderName: unknown, enrichment?: DocumentData): StaffSource {
  const data = doc.data()!;
  const row = data.record;
  if (row?.tenantId !== tenant || !Number.isSafeInteger(row.seconds) || row.seconds < 0) throw Error("Invalid scoped source");
  const portions: Allocation[] = head?.portions ?? [];
  const applied: Allocation[] = head?.appliedPortions ?? portions;
  const provider = data.source === "quickbooks-time";
  const sourceDetails = provider && !data.deleted ? readTimeDetails(enrichment, row.revision, data.modifiedAt) : undefined;
  const personId = sourceDetails?.personId ?? row.sourcePersonId;
  const description = provider && row.description === "QuickBooks Time" ? "" : row.description ?? "";
  return {
    id: doc.id, date: row.date, seconds: row.seconds,
    description: sourceDetails?.notes ?? description,
    sourceWorkOrderId: row.sourceWorkOrderId,
    ...(personId ? { sourcePersonId: personId } : {}),
    ...(sourceDetails?.consultantName ? { consultantName: sourceDetails.consultantName } : {}),
    ...(typeof workOrderName === "string" && workOrderName ? { workOrderName } : {}),
    ...(head?.annotations ? { annotations: head.annotations } : {}),
    sourceRevision: row.revision,
    approval: ["pending", "submitted", "approved", "rejected"].includes(data.approval) ? data.approval : "unknown",
    allocationRevision: head?.revision ?? 0,
    ...(provider ? { provider: "quickbooks-time", modifiedAt: data.modifiedAt, deleted: data.deleted === true, needsReview: head?.needsReview === true } : {}),
    portions,
    unallocatedSeconds: data.deleted === true ? 0 : Math.max(0, row.seconds - applied.reduce((total, p) => total + p.seconds, 0)),
    conflict: data.deleted === true || (head?.sourceRevision !== undefined && head.sourceRevision !== row.revision),
  };
}
