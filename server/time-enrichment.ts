import { isDeepStrictEqual } from "node:util";
import { FieldPath, type DocumentReference, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { sourceRecordId } from "./contracts";
import { key } from "./firestore-store";
import { timeMapping, timeRun, timeTenantRevision, type TimeMappingRecord } from "./time-catalog";
import { timeDetailsBatch, timeId, workDate, type TimeClient, type TimeRow } from "./time-client";
import { readTimeDetails, timeDetailsRef, type StoredTimeDetails } from "./time-details";

const scanLimit = 100;
const attempts = { maxAttempts: 3 };
const invalidCursor = () => Error("Invalid Time details cursor");
const digest = /^[a-f0-9]{64}$/;
type Options = { month: string; after?: string; apply?: boolean };
type Scope = { root: DocumentReference; account: string; catalog: string };
type Source = {
  ref: DocumentReference;
  id: string;
  externalId: string;
  jobcode: string;
  projectId: string;
  sourceRevision: string;
  sourceModifiedAt: string;
  date: string;
  seconds: number;
  deleted: boolean;
};

export function timeSourceRevision(row: TimeRow) {
  return key(row.modifiedAt, row.date, String(row.seconds), row.jobcodeId, String(row.deleted));
}

function selectSource(doc: QueryDocumentSnapshot, account: string): Source | undefined {
  const envelope = doc.data();
  const record = envelope.record;
  if (envelope.schemaVersion !== 2 || envelope.source !== "quickbooks-time" || envelope.sourceCompanyId !== account ||
    record?.tenantId !== doc.ref.parent.parent!.id || typeof envelope.deleted !== "boolean") return undefined;
  const externalId = timeId(envelope.externalId);
  if (record.id !== doc.id || doc.id !== sourceRecordId("quickbooks-time", account, externalId) ||
    !Number.isSafeInteger(record.seconds) || record.seconds < 0 || typeof record.revision !== "string" ||
    !digest.test(record.revision) || typeof envelope.modifiedAt !== "string" ||
    !Number.isFinite(Date.parse(envelope.modifiedAt)) || !/^[a-zA-Z0-9_-]{1,128}$/.test(envelope.scopeProjectId))
    throw Error("Invalid imported Time identity");
  return { ref: doc.ref, id: doc.id, externalId, jobcode: timeId(record.sourceWorkOrderId), projectId: envelope.scopeProjectId,
    sourceRevision: record.revision, sourceModifiedAt: envelope.modifiedAt, date: workDate(record.date),
    seconds: record.seconds, deleted: envelope.deleted };
}

function mapped(mapping: TimeMappingRecord | undefined, scope: Scope, source: Source) {
  return mapping?.catalog === scope.catalog && mapping.account === scope.account && mapping.jobcodeId === source.jobcode &&
    mapping.scopeProjectId === source.projectId && mapping.sourceJob?.id === source.jobcode && mapping.sourceJob.missing === false;
}

const uniqueJobs = (sources: Source[]) => [...new Set(sources.map(source => source.jobcode))];
const liveSources = (scanned: QueryDocumentSnapshot[], account: string) =>
  scanned.flatMap(doc => selectSource(doc, account) ?? []);

export async function enrichTimeDetails(scope: Scope, client: TimeClient, jobsByDescendants: ReadonlyMap<string, ReadonlySet<string>>, options: Options,
  signal: AbortSignal, now: () => number) {
  const { root, account, catalog } = scope;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.month)) throw Error("Invalid Time details month");
  const context = key(root.id, account, catalog, options.month);
  let query = root.collection("rawTime").where("schemaVersion", "==", 2)
    .where("record.date", ">=", options.month + "-01").where("record.date", "<=", options.month + "-31")
    .orderBy("record.date").orderBy(FieldPath.documentId());
  if (options.after) {
    try {
      if (options.after.length > 400 || !/^[a-zA-Z0-9_-]+$/.test(options.after)) throw invalidCursor();
      const cursor = JSON.parse(Buffer.from(options.after, "base64url").toString());
      if (cursor.context !== context || !workDate(cursor.date).startsWith(options.month + "-") ||
        typeof cursor.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(cursor.id))
        throw invalidCursor();
      query = query.startAfter(cursor.date, cursor.id);
    } catch { throw invalidCursor(); }
  }
  const catalogRef = timeRun(root, catalog);
  const db = root.firestore;
  const { scanned, more, eligible, deleted } = await db.runTransaction(async tx => {
    await timeTenantRevision(tx, root);
    const bound = (await tx.get(catalogRef)).data();
    if (bound?.customerBound !== true) throw Error("Time customer setup required");
    if ((bound.expires ?? 0) > now()) throw Error("Time sync busy");
    const snapshot = await tx.get(query.limit(scanLimit + 1));
    const scanned = snapshot.docs.slice(0, scanLimit);
    const sources = liveSources(scanned, account);
    const deleted = sources.filter(source => source.deleted).length;
    const candidates = sources.filter(source => !source.deleted && jobsByDescendants.has(source.jobcode));
    const jobs = uniqueJobs(candidates);
    const refs = jobs.map(job => timeMapping(root, account, job));
    const docs = refs.length ? await tx.getAll(...refs) : [];
    const mappings = new Map(jobs.map((job, index) => [job, docs[index].data() as TimeMappingRecord | undefined]));
    return { scanned, more: snapshot.size > scanLimit, deleted,
      eligible: candidates.filter(source => mapped(mappings.get(source.jobcode), scope, source)) };
  }, attempts);

  const vendor = new Map<string, TimeRow>();
  for (const job of uniqueJobs(eligible)) {
    const ids = eligible.filter(source => source.jobcode === job).map(source => source.externalId);
    for (let index = 0; index < ids.length; index += timeDetailsBatch) {
      signal.throwIfAborted();
      const batch = ids.slice(index, index + timeDetailsBatch);
      for (const row of await client.detailsById(job, batch, account, jobsByDescendants.get(job))) {
        if (vendor.has(row.id)) throw Error("Duplicate Time details");
        vendor.set(row.id, row);
      }
    }
  }
  const result = await db.runTransaction(async tx => {
    await timeTenantRevision(tx, root);
    const bound = (await tx.get(catalogRef)).data();
    if (bound?.customerBound !== true) throw Error("Time customer setup required");
    if ((bound.expires ?? 0) > now()) throw Error("Time sync busy");
    const jobs = uniqueJobs(eligible);
    const refs = eligible.map(source => timeDetailsRef(source.ref, source.sourceRevision));
    const [current, previous, refreshed] = await Promise.all([
      eligible.length ? tx.getAll(...eligible.map(source => source.ref)) : [],
      refs.length ? tx.getAll(...refs) : [],
      jobs.length ? tx.getAll(...jobs.map(job => timeMapping(root, account, job))) : [],
    ]);
    const mappings = new Map(jobs.map((job, index) => [job, refreshed[index].data() as TimeMappingRecord | undefined]));
    const counts = { eligible: eligible.length, unchanged: 0, unavailable: 0, notCurrent: 0, conflicts: 0, wouldWrite: 0 };
    const observedAt = new Date(now()).toISOString();
    eligible.forEach((source, index) => {
      const envelope = current[index].data();
      const row = vendor.get(source.externalId);
      if (envelope?.sourceCompanyId !== account || envelope.source !== "quickbooks-time" ||
        envelope.externalId !== source.externalId || envelope.scopeProjectId !== source.projectId || envelope.deleted !== false ||
        envelope.modifiedAt !== source.sourceModifiedAt || envelope.record?.id !== source.id || envelope.record?.tenantId !== root.id ||
        envelope.record?.sourceWorkOrderId !== source.jobcode || envelope.record?.revision !== source.sourceRevision ||
        envelope.record?.date !== source.date || envelope.record?.seconds !== source.seconds || !mapped(mappings.get(source.jobcode), scope, source) ||
        (row && (row.deleted || row.jobcodeId !== source.jobcode || row.date !== source.date || row.seconds !== source.seconds ||
          row.modifiedAt !== source.sourceModifiedAt || timeSourceRevision(row) !== source.sourceRevision))) {
        counts.notCurrent++;
        return;
      }
      if (!row?.details) { counts.unavailable++; return; }
      const old = readTimeDetails(previous[index].data(), source.sourceRevision, source.sourceModifiedAt);
      if ((previous[index].exists && !old) ||
        (old?.personId && row.details.personId && old.personId !== row.details.personId) ||
        (old?.notes && row.details.notes && old.notes !== row.details.notes)) {
        counts.conflicts++;
        return;
      }
      const details = { ...row.details, ...old };
      if (isDeepStrictEqual(old, details)) { counts.unchanged++; return; }
      counts.wouldWrite++;
      if (!options.apply) return;
      signal.throwIfAborted();
      const value: StoredTimeDetails = { provider: "quickbooks-time", sourceRevision: source.sourceRevision,
        sourceModifiedAt: source.sourceModifiedAt, observedAt, retrievedVia: "exact-id-lookup", ...details };
      tx.set(refs[index], value);
    });
    return counts;
  }, attempts);
  const last = scanned.at(-1);
  const nextCursor = more && last ? Buffer.from(JSON.stringify({ context, date: last.get("record.date"), id: last.id })).toString("base64url") : undefined;
  return {
    month: options.month, applied: Boolean(options.apply), scanned: scanned.length, deleted, outsideScope: scanned.length - eligible.length - deleted,
    ...result, written: options.apply ? result.wouldWrite : 0, ...(nextCursor && { nextCursor }),
  };
}
