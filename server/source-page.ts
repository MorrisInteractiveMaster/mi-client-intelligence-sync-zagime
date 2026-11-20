import { FieldPath, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { sourceStatus, sourceStatuses, type PageQuery, type SourceFilters, type SourceHours, type SourceHoursGroup, type SourceSummary, type StaffSource } from "../src/api/types";
import { calendarDate } from "../src/projects/delivery";
import { timeBucket, timeSortOrders, timeWindow, type TimeGrouping, type TimeWindow } from "../src/projects/time-history";
import type { ProjectPage } from "../src/projects/model";
import type { Allocation } from "../src/reporting/model";
import { safeId } from "./contracts";
import { key } from "./firestore-store";
import { readPortfolio } from "./portfolio";
import { readTimeDetails, timeDetailsRef } from "./time-details";
import { readEmployeeProfiles, timeEmployeeKey } from "./employee-mapping";

// Exact, consistent counts at the current tenant size. Oversized months fail
// explicitly rather than presenting truncated matches as complete.
export const sourceMonthLimit = 5000;
export const sourceHistoryLimit = 12000;
export const sourceFilterKeys = ["search", "workOrder", "consultant", "area", "project", "from", "through", "status",
  "period", "start", "end", "order", "group", "entry"] as const;
const filterId = /^[A-Za-z0-9_-]{1,128}$/;
const normalized = (text: string) => text.normalize("NFKC").trim().toLowerCase();

export function sourceFilters(query: PageQuery) {
  const f = query.sourceFilters ?? {};
  const window = timeWindow(query.month, f.period, f.start, f.end);
  for (const value of [f.workOrder, f.consultant, f.area, f.project, f.entry]) {
    if (value !== undefined && !filterId.test(value)) throw Error("Invalid source filter");
  }
  for (const date of [f.from, f.through]) {
    if (date !== undefined && (!calendarDate(date) || !includesDate(window, date))) throw Error("Invalid source date filter");
  }
  if (f.from && f.through && f.from > f.through) throw Error("Invalid source date filter");
  if (f.status !== undefined && f.status !== "queue" && !sourceStatuses.includes(f.status)) throw Error("Invalid source status");
  if (f.order !== undefined && !timeSortOrders.includes(f.order)) throw Error("Invalid source order");
  if (f.group !== undefined && !["month", "quarter", "year"].includes(f.group)) throw Error("Invalid source group");
  return { filters: { ...f, search: normalized(query.search ?? "") }, window };
}

function includesDate(window: TimeWindow, date: string) {
  return (!window.start || date >= window.start) && (!window.end || date <= window.end);
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
const emptyHours = (): SourceHours => ({ recordedSeconds: 0, allocatedSeconds: 0, unallocatedSeconds: 0 });
function addHours(total: SourceHours, row: StaffSource) {
  total.recordedSeconds += row.seconds;
  total.allocatedSeconds += row.seconds - row.unallocatedSeconds;
  total.unallocatedSeconds += row.unallocatedSeconds;
  if (!Number.isSafeInteger(total.recordedSeconds)) throw Error("Invalid scoped source hours");
}
function addGroup(groups: Map<string | null, SourceHoursGroup>, id: string | null, label: string, row: StaffSource) {
  const group = groups.get(id) ?? { id, label, ...emptyHours() };
  if (label !== id) group.label = label;
  addHours(group, row);
  groups.set(id, group);
}
function summarize(rows: StaffSource[], filters: SourceFilters & { search: string }, projects: Map<string, SourceNames>, period: TimeWindow) {
  const counts: SourceSummary["counts"] = { total: 0, allocated: 0, partial: 0, unallocated: 0, review: 0, deleted: 0, remaining: 0 };
  const workOrders = new Map<string, string>();
  const consultants = new Map<string, string>();
  const matches: StaffSource[] = [];
  const hours = emptyHours();
  const byConsultant = new Map<string | null, SourceHoursGroup>();
  const byWorkOrder = new Map<string | null, SourceHoursGroup>();
  const byPeriod = new Map<string | null, SourceHoursGroup>();
  const grouping: TimeGrouping = filters.group ?? "month";
  for (const row of rows) {
    const workOrder = row.sourceWorkOrderId;
    const person = row.sourcePersonId;
    if (filterId.test(workOrder) && (row.workOrderName || !workOrders.has(workOrder))) workOrders.set(workOrder, row.workOrderName || workOrder);
    if (person && filterId.test(person) && (row.consultantName || !consultants.has(person))) consultants.set(person, row.consultantName || person);
    if (filters.workOrder && filters.workOrder !== workOrder ||
      filters.consultant && (filters.consultant === "unavailable" ? Boolean(person) : filters.consultant !== person) ||
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
    if (filters.status && (filters.status === "queue" ? !remaining : status !== filters.status)) continue;
    matches.push(row);
    // Corrected current rows may have temporarily unapplied ledger portions.
    // Deleted rows are shown for review but do not contribute recorded seconds.
    if (row.deleted) continue;
    addHours(hours, row);
    addGroup(byConsultant, person || null, row.consultantName || person || "Unavailable", row);
    const consultant = byConsultant.get(person || null)!;
    if (row.wordpressProfile) consultant.wordpressProfile = row.wordpressProfile;
    addGroup(byWorkOrder, workOrder || null, row.workOrderName || workOrder || "Unavailable", row);
    const bucket = timeBucket(row.date, grouping);
    addGroup(byPeriod, bucket.id, bucket.label, row);
  }
  if (filters.order === "newest") matches.reverse();
  const options = (values: Map<string, string>) => [...values].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const breakdown = (groups: Map<string | null, SourceHoursGroup>) => [...groups.values()]
    .sort((a, b) => b.recordedSeconds - a.recordedSeconds || a.label.localeCompare(b.label) || (a.id ?? "").localeCompare(b.id ?? ""));
  const summary: SourceSummary = { monthTotal: rows.length, matched: matches.length, counts, period,
    workOrders: options(workOrders), consultants: options(consultants),
    hours: { ...hours, byConsultant: breakdown(byConsultant), byWorkOrder: breakdown(byWorkOrder), byPeriod: [...byPeriod.values()] },
  };
  return { matches, summary };
}

export async function readSourcePage(tx: Transaction, root: DocumentReference, subject: string, revision: number, query: PageQuery): Promise<ProjectPage> {
  const { filters, window } = sourceFilters(query);
  const raws = root.collection("rawTime");
  let indexed = raws.where("schemaVersion", "==", 2).orderBy("record.date").orderBy(FieldPath.documentId());
  if (window.start) indexed = indexed.where("record.date", ">=", window.start);
  if (window.end) indexed = indexed.where("record.date", "<=", window.end);
  const range = { ...window, start: filters.from ?? window.start, end: filters.through ?? window.end };
  const maximum = window.kind === "month" ? sourceMonthLimit : sourceHistoryLimit;
  let docs: DocumentSnapshot[];
  let periodCount: number;
  if (filters.entry) {
    const doc = await tx.get(raws.doc(filters.entry));
    const date = doc.get("record.date");
    docs = doc.exists && doc.get("schemaVersion") === 2 && calendarDate(date) && includesDate(range, date) ? [doc] : [];
    periodCount = docs.length;
  } else {
    let narrowed = indexed;
    if (filters.from) narrowed = narrowed.where("record.date", ">=", filters.from);
    if (filters.through) narrowed = narrowed.where("record.date", "<=", filters.through);
    const [selected, fullPeriodCount] = await Promise.all([
      tx.get(narrowed.limit(maximum + 1)),
      filters.from || filters.through ? tx.get(indexed.count()) : undefined,
    ]);
    docs = selected.docs;
    periodCount = fullPeriodCount?.data().count ?? docs.length;
  }
  if (docs.length > maximum) throw Error(window.kind === "month" ? "Source month too large" : "Source period too large");
  if (!docs.length) {
    if (query.cursor) throw Error("Revision conflict");
    const { summary } = summarize([], filters, new Map(), window);
    return { revision, sources: [], sourceSummary: { ...summary, monthTotal: periodCount } };
  }
  const heads = await fetchByPath(tx, docs.map(doc => root.collection("allocationHeads").doc(doc.id)));
  const projectRefs = new Map<string, DocumentReference>();
  for (const doc of docs) {
    const head = heads.get(root.collection("allocationHeads").doc(doc.id).path);
    const ids = [doc.get("scopeProjectId"), ...(head?.portions ?? []).map((part: Allocation) => part.projectId)];
    if (head?.annotations?.parentId) ids.push(head.annotations.parentId);
    for (const id of ids) projectRefs.set(safeId(id), root.collection("projects").doc(id));
  }
  const mappingRefs = new Map<string, DocumentReference>();
  const detailsRefs = new Map<string, DocumentReference>();
  for (const doc of docs) {
    const data = doc.data()!;
    if (data.source !== "quickbooks-time") continue;
    if (data.sourceCompanyId && data.record?.sourceWorkOrderId) mappingRefs.set(doc.id, root.collection("timeMappings").doc(key(data.sourceCompanyId, data.record.sourceWorkOrderId)));
    if (!data.deleted && typeof data.record?.revision === "string" && data.record.revision) detailsRefs.set(doc.id, timeDetailsRef(doc.ref, data.record.revision));
  }
  const [projects, mappings, details, portfolio] = await Promise.all([
    fetchByPath(tx, [...projectRefs.values()]), fetchByPath(tx, [...mappingRefs.values()]),
    fetchByPath(tx, [...detailsRefs.values()]), readPortfolio(tx, root),
  ]);
  const profiles = await readEmployeeProfiles(tx, root, portfolio);
  const placement = new Map(portfolio.placements.map(item => [item.id, item.areaId]));
  const projectNames = new Map<string, SourceNames>();
  for (const [id, ref] of projectRefs) {
    const project = projects.get(ref.path);
    if (project?.tenantId === root.id && project?.schemaVersion === 2) {
      projectNames.set(id, { title: String(project.name ?? ""), areaId: project.delivery?.areaId ?? placement.get(id) });
    }
  }
  const rows = docs.map(doc => {
    const data = doc.data()!;
    const mapRef = mappingRefs.get(doc.id);
    const scopedProject = projectRefs.get(data.scopeProjectId);
    const detailRef = detailsRefs.get(doc.id);
    if (!scopedProject || !projectNames.has(data.scopeProjectId)) throw Error("Invalid scoped source");
    const sourceDetails = detailRef ? readTimeDetails(details.get(detailRef.path), data.record.revision, data.modifiedAt) : undefined;
    const profile = sourceDetails?.personId && data.sourceCompanyId
      ? profiles.get(timeEmployeeKey(data.sourceCompanyId, sourceDetails.personId)) : undefined;
    return projectSource(doc, heads.get(root.collection("allocationHeads").doc(doc.id).path), root.id,
      mapRef ? mappings.get(mapRef.path)?.sourceJob?.name : projects.get(scopedProject.path)?.workOrderReference,
      sourceDetails, profile);
  });
  const { matches, summary } = summarize(rows, filters, projectNames, window);
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
  return { revision, sources, sourceSummary: { ...summary, monthTotal: periodCount },
    ...(offset + sources.length < matches.length ? {
      nextCursor: Buffer.from(JSON.stringify({ context, after: sources.at(-1)!.id })).toString("base64url"),
    } : {}) };
}

function projectSource(doc: DocumentSnapshot, head: DocumentData | undefined, tenant: string, workOrderName: unknown,
  sourceDetails?: ReturnType<typeof readTimeDetails>, wordpressProfile?: StaffSource["wordpressProfile"]): StaffSource {
  const data = doc.data()!;
  const row = data.record;
  if (row?.tenantId !== tenant || !calendarDate(row.date) || !Number.isSafeInteger(row.seconds) || row.seconds < 0)
    throw Error("Invalid scoped source");
  const portions: Allocation[] = head?.portions ?? [];
  const applied: Allocation[] = head?.appliedPortions ?? portions;
  const provider = data.source === "quickbooks-time";
  const personId = sourceDetails?.personId ?? row.sourcePersonId;
  const description = provider && row.description === "QuickBooks Time" ? "" : row.description ?? "";
  return {
    id: doc.id, date: row.date, seconds: row.seconds,
    description: sourceDetails?.notes ?? description,
    sourceWorkOrderId: row.sourceWorkOrderId,
    ...(personId ? { sourcePersonId: personId } : {}),
    ...(sourceDetails?.consultantName ? { consultantName: sourceDetails.consultantName } : {}),
    ...(wordpressProfile ? { wordpressProfile } : {}),
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
