import { randomUUID } from "node:crypto";
import { FieldPath, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import type { EmployeeMappingChange, EmployeeMappingLink, EmployeeMappingReceipt, EmployeeMappingsPage, EmployeeProfile, TimeEmployeeCandidate } from "../src/projects/employee-mapping";
import type { Portfolio } from "../src/projects/portfolio";
import { calendarDate } from "../src/projects/delivery";
import { safeId, sourceRecordId } from "./contracts";
import { key } from "./firestore-store";
import { readPortfolio } from "./portfolio";
import { timeMapping, timeRun } from "./time-catalog";
import { readTimeDetails, timeDetailsRef, timePersonId } from "./time-details";

const employeeLimit = 160;
const scanSize = 150;
const digest = /^[a-f0-9]{64}$/;
type StoredLink = EmployeeMappingLink & { account: string };
type State = { revision: number; links: StoredLink[] };
type Source = {
  ref: DocumentReference;
  account: string;
  jobcode: string;
  scope: string;
  sourceRevision: string;
  modifiedAt: string;
  workDate: string;
};
type ApprovedCandidate = { account: string; person: TimeEmployeeCandidate };
type AdminAccess = { root: DocumentReference; meta: { revision: number }; platformAdmin: boolean };

export const timeEmployeeKey = (account: string, userId: string) => key("quickbooks-time-employee", account, userId);
const stateRef = (root: DocumentReference) => root.collection("workspaceSettings").doc("time-employee-mappings-v1");

async function readState(tx: Transaction, root: DocumentReference): Promise<State> {
  const saved = (await tx.get(stateRef(root))).data();
  if (!saved) return { revision: 0, links: [] };
  if (saved.schemaVersion !== 1 || saved.tenantId !== root.id || !Number.isSafeInteger(saved.revision) || saved.revision < 1 ||
    !Array.isArray(saved.links) || saved.links.length > employeeLimit)
    throw Error("Invalid reporting summary");
  const seenSources = new Set<string>();
  for (const link of saved.links as StoredLink[]) {
    if (!link || !timePersonId(link.account) || !timePersonId(link.userId) ||
      link.employeeKey !== timeEmployeeKey(link.account, link.userId) || !Number.isSafeInteger(link.profileId) ||
      link.profileId < 1 || typeof link.updatedAt !== "string" || seenSources.has(link.employeeKey))
      throw Error("Invalid reporting summary");
    seenSources.add(link.employeeKey);
  }
  return { revision: saved.revision, links: saved.links };
}

function availableProfiles(portfolio: Portfolio) {
  const profiles = new Map<number, EmployeeProfile>();
  for (const entry of portfolio.directory) {
    const profile = entry.profile;
    if (!entry.active || !profile) continue;
    if (profiles.has(profile.id)) throw Error("Invalid reporting summary");
    profiles.set(profile.id, {
      id: profile.id, name: profile.name, url: profile.url,
      ...(profile.title && { title: profile.title }),
      ...(profile.photo && { photo: profile.photo, alt: profile.alt ?? "" }),
    });
  }
  return profiles;
}

function verifiedSource(doc: DocumentSnapshot, tenant: string): Source | undefined {
  const raw = doc.data();
  if (!raw || raw.schemaVersion !== 2 || raw.source !== "quickbooks-time" || raw.deleted !== false) return;
  const row = raw.record;
  const account = timePersonId(raw.sourceCompanyId), jobcode = timePersonId(row?.sourceWorkOrderId), externalId = timePersonId(raw.externalId);
  if (!row || row.tenantId !== tenant || row.id !== doc.id || !account || !jobcode || !externalId ||
    sourceRecordId("quickbooks-time", account, externalId) !== doc.id ||
    typeof raw.scopeProjectId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.scopeProjectId) ||
    typeof row.revision !== "string" || !digest.test(row.revision) ||
    typeof raw.modifiedAt !== "string" || !Number.isFinite(Date.parse(raw.modifiedAt)) ||
    !calendarDate(row.date) || !Number.isSafeInteger(row.seconds) || row.seconds < 0) return;
  return { ref: doc.ref, account, jobcode, scope: raw.scopeProjectId, sourceRevision: row.revision,
    modifiedAt: raw.modifiedAt, workDate: row.date };
}

async function documentData(tx: Transaction, refs: DocumentReference[]) {
  const unique = [...new Map(refs.map(ref => [ref.path, ref])).values()];
  return new Map((unique.length ? await tx.getAll(...unique) : []).map(doc => [doc.ref.path, doc.data()]));
}

async function candidates(tx: Transaction, root: DocumentReference, docs: DocumentSnapshot[]) {
  const sources = docs.flatMap(doc => verifiedSource(doc, root.id) ?? []);
  const detailRef = (entry: Source) => timeDetailsRef(entry.ref, entry.sourceRevision);
  const mappingRef = (entry: Source) => timeMapping(root, entry.account, entry.jobcode);
  const [details, mappings] = await Promise.all([
    documentData(tx, sources.map(detailRef)),
    documentData(tx, sources.map(mappingRef)),
  ]);
  const runs = await documentData(tx, [...mappings.values()].flatMap(mapping =>
    typeof mapping?.catalog === "string" && digest.test(mapping.catalog) ? [timeRun(root, mapping.catalog)] : []));
  const result = new Map<string, ApprovedCandidate>();
  for (const entry of sources) {
    const mapping = mappings.get(mappingRef(entry).path);
    if (!mapping || typeof mapping.catalog !== "string" || !digest.test(mapping.catalog) ||
      mapping.account !== entry.account || mapping.jobcodeId !== entry.jobcode ||
      mapping.scopeProjectId !== entry.scope || mapping.sourceJob?.id !== entry.jobcode ||
      mapping.sourceJob.missing !== false || runs.get(timeRun(root, mapping.catalog).path)?.customerBound !== true)
      continue;
    const detail = readTimeDetails(details.get(detailRef(entry).path), entry.sourceRevision, entry.modifiedAt);
    if (!detail?.personId) continue;
    const employeeKey = timeEmployeeKey(entry.account, detail.personId);
    const previous = result.get(employeeKey);
    if (previous && (previous.person.providerName && !detail.consultantName ||
      Boolean(previous.person.providerName) === Boolean(detail.consultantName) && previous.person.workDate >= entry.workDate)) continue;
    result.set(employeeKey, {
      account: entry.account,
      person: { employeeKey, userId: detail.personId, ...(detail.consultantName && { providerName: detail.consultantName }),
        sourceId: entry.ref.id, sourceRevision: entry.sourceRevision, workDate: entry.workDate,
        workOrder: typeof mapping.sourceJob.name === "string" && mapping.sourceJob.name ? mapping.sourceJob.name : entry.jobcode },
    });
  }
  return result;
}

export async function employeeMappingsPage(tx: Transaction, access: AdminAccess, subject: string, cursor?: string): Promise<EmployeeMappingsPage> {
  if (!access.platformAdmin) throw Error("Forbidden");
  const { root } = access;
  const cursorScope = key("employee-candidates", root.id, subject);
  let query = root.collection("rawTime").where("schemaVersion", "==", 2).orderBy(FieldPath.documentId());
  if (cursor) {
    let data: unknown;
    try { data = JSON.parse(Buffer.from(cursor, "base64url").toString()); }
    catch { throw Error("Invalid employee mapping page"); }
    const token = data as { scope?: unknown; id?: unknown };
    if (!token || token.scope !== cursorScope || typeof token.id !== "string")
      throw Error("Invalid employee mapping page");
    query = query.startAfter(safeId(token.id));
  }
  const [saved, portfolio, snapshot] = await Promise.all([readState(tx, root), readPortfolio(tx, root), tx.get(query.limit(scanSize + 1))]);
  const docs = snapshot.docs.slice(0, scanSize);
  const people = await candidates(tx, root, docs);
  return {
    revision: saved.revision,
    candidates: [...people.values()].map(({ person }) => person),
    profiles: [...availableProfiles(portfolio).values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    links: saved.links.map(linkSummary),
    ...(snapshot.size > scanSize ? {
      nextCursor: Buffer.from(JSON.stringify({ scope: cursorScope, id: docs.at(-1)!.id })).toString("base64url"),
    } : {}),
  };
}

export function employeeMappingChange(raw: Record<string, unknown>): EmployeeMappingChange {
  const { expectedRevision, employeeKey, action } = raw;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
    typeof employeeKey !== "string" || !digest.test(employeeKey)) throw Error("Invalid employee mapping change");
  const common = { expectedRevision, employeeKey };
  if (action === "unlink" && Object.keys(raw).length === 3) return { ...common, action };
  const { sourceId, sourceRevision, profileId } = raw;
  if (action !== "link" || Object.keys(raw).length !== 6 || typeof sourceId !== "string" || !digest.test(sourceId) ||
    typeof sourceRevision !== "string" || !digest.test(sourceRevision) ||
    typeof profileId !== "number" || !Number.isSafeInteger(profileId) || profileId < 1) throw Error("Invalid employee mapping change");
  return { ...common, action, sourceId, sourceRevision, profileId };
}

const linkSummary = ({ employeeKey, userId, profileId, updatedAt }: StoredLink): EmployeeMappingLink => ({ employeeKey, userId, profileId, updatedAt });

export async function saveEmployeeMapping(tx: Transaction, access: AdminAccess, subject: string, input: EmployeeMappingChange, now: number): Promise<EmployeeMappingReceipt> {
  if (!access.platformAdmin) throw Error("Forbidden");
  const { root, meta } = access;
  const state = await readState(tx, root);
  if (state.revision !== input.expectedRevision) throw Error("Revision conflict");
  const existing = state.links.find(link => link.employeeKey === input.employeeKey);
  if (input.action === "unlink" && !existing) return { revision: state.revision, changed: false };
  const at = new Date(now).toISOString();
  let link: StoredLink | undefined;
  if (input.action === "link") {
    const [portfolio, source] = await Promise.all([readPortfolio(tx, root), tx.get(root.collection("rawTime").doc(input.sourceId))]);
    if (!availableProfiles(portfolio).has(input.profileId)) throw Error("Invalid active WordPress profile");
    const employee = (await candidates(tx, root, [source])).get(input.employeeKey);
    if (!employee || employee.person.sourceRevision !== input.sourceRevision) throw Error("Source conflict");
    if (existing?.profileId === input.profileId) return { revision: state.revision, changed: false, link: linkSummary(existing) };
    link = { employeeKey: input.employeeKey, userId: employee.person.userId, account: employee.account, profileId: input.profileId, updatedAt: at };
  }
  const links = [...state.links.filter(old => old.employeeKey !== input.employeeKey), ...(link ? [link] : [])];
  const revision = state.revision + 1, tenantRevision = meta.revision + 1;
  if (links.length > employeeLimit || !Number.isSafeInteger(revision) || !Number.isSafeInteger(tenantRevision))
    throw Error("Invalid employee mapping capacity");
  const event = root.collection("audits").doc(randomUUID());
  tx.set(stateRef(root), { schemaVersion: 1, tenantId: root.id, revision, links });
  tx.create(event, {
    id: event.id, tenantId: root.id, actor: subject, action: !link ? "time-employee-unlinked" : existing ? "time-employee-relinked" : "time-employee-linked",
    entityId: input.employeeKey, at, revision: tenantRevision, mappingRevision: revision,
    previousProfileId: existing?.profileId ?? null, nextProfileId: link?.profileId ?? null,
    ...(input.action === "link" && { sourceId: input.sourceId, sourceRevision: input.sourceRevision }),
  });
  tx.update(root, { revision: tenantRevision });
  return { revision, changed: true, ...(link && { link: linkSummary(link) }) };
}

export async function readEmployeeProfiles(tx: Transaction, root: DocumentReference, portfolio: Portfolio) {
  const { links } = await readState(tx, root);
  const profiles = availableProfiles(portfolio);
  return new Map(links.flatMap(link => {
    const profile = profiles.get(link.profileId);
    return profile ? [[link.employeeKey, profile] as const] : [];
  }));
}
