import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import {
  byOrder, newPortfolio, portfolioLimits,
  type Portfolio, type PortfolioRecord, type PortfolioSection, type PublishedPortfolio,
} from "../src/projects/portfolio";
import type { ProjectReport } from "../src/projects/model";

type Access = { root: DocumentReference; staff: boolean; meta: { revision: number } };
export const portfolioRef = (root: DocumentReference) => root.collection("workspaceSettings").doc("portfolio-v1");

export async function readPortfolio(tx: Transaction, root: DocumentReference): Promise<Portfolio> {
  const data = (await tx.get(portfolioRef(root))).data();
  return data ? data.portfolio as Portfolio : newPortfolio();
}

function invalid(): never { throw Error("Invalid portfolio record"); }
const record = (raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
  return raw as Record<string, unknown>;
};
const text = (value: unknown, max: number, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) invalid();
  return value.trim();
};
const id = (value: unknown, optional = false) => {
  const result = text(value, 128, !optional);
  if (result && !/^[a-zA-Z0-9_-]+$/.test(result)) invalid();
  return result;
};
const flag = (value: unknown) => typeof value === "boolean" ? value : invalid();
const number = (value: unknown, maximum: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : invalid();
const date = (value: unknown) => {
  const result = text(value, 10);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result))
    || new Date(result).toISOString().slice(0, 10) !== result)) invalid();
  return result;
};
const ids = (value: unknown, limit: number) => {
  if (!Array.isArray(value) || value.length > limit) invalid();
  return [...new Set(value.map(x => id(x)))];
};

const accepted = {
  areas: ["id", "name", "description", "order", "visible"],
  engagements: ["id", "name", "reference", "monthlySeconds", "areaPlans", "order", "visible"],
  directory: ["id", "name", "role", "responsibility", "internalContact", "publicContact", "areaId", "projectIds", "order", "active", "visible"],
  placements: ["id", "areaId", "engagementId", "leadId", "teamIds", "start", "target", "attention", "publishDates", "archived"],
  notes: ["id", "month", "narrative", "action", "visible"],
};
export function parsePortfolioRecord(section: PortfolioSection, raw: unknown): PortfolioRecord {
  const v = record(raw);
  if (Object.keys(v).some(k => !accepted[section].includes(k))) invalid();
  const common = { id: id(v.id) };
  const order = () => number(v.order, 1000);
  const visible = () => flag(v.visible);
  switch (section) {
    case "areas":
      return { ...common, name: text(v.name, 80, true), description: text(v.description, 500), order: order(), visible: visible() };
    case "engagements": {
      if (!Array.isArray(v.areaPlans) || v.areaPlans.length > portfolioLimits.areas) invalid();
      const areaPlans = v.areaPlans.map(item => {
        const p = record(item);
        if (Object.keys(p).some(k => k !== "areaId" && k !== "seconds")) invalid();
        return { areaId: id(p.areaId), seconds: number(p.seconds, 3_600_000_000) };
      });
      if (new Set(areaPlans.map(p => p.areaId)).size !== areaPlans.length) invalid();
      return { ...common, name: text(v.name, 120, true), reference: text(v.reference, 120),
        monthlySeconds: number(v.monthlySeconds, 3_600_000_000), areaPlans, order: order(), visible: visible() };
    }
    case "directory":
      return { ...common, name: text(v.name, 120, true), role: text(v.role, 120, true),
        responsibility: text(v.responsibility, 500), internalContact: text(v.internalContact, 200),
        publicContact: text(v.publicContact, 200), areaId: id(v.areaId, true), projectIds: ids(v.projectIds, 20),
        order: order(), active: flag(v.active), visible: visible() };
    case "placements": {
      const start = date(v.start), target = date(v.target);
      if (start && target && start > target) invalid();
      return { ...common, areaId: id(v.areaId, true), engagementId: id(v.engagementId, true),
        leadId: id(v.leadId, true), teamIds: ids(v.teamIds, 15), start, target,
        attention: text(v.attention, 500), publishDates: v.publishDates === undefined ? false : flag(v.publishDates), archived: flag(v.archived) };
    }
    case "notes": {
      const month = text(v.month, 7, true);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || common.id !== month) invalid();
      return { ...common, month, narrative: text(v.narrative, 2000), action: text(v.action, 500), visible: visible() };
    }
  }
}

export async function savePortfolioRecord(
  tx: Transaction, access: Access, section: PortfolioSection, raw: unknown, expectedRevision: number, actor: string, now: number,
) {
  if (!access.staff) throw Error("Forbidden");
  if (access.meta.revision !== expectedRevision) throw Error("Revision conflict");
  const item = parsePortfolioRecord(section, raw);
  const config = await readPortfolio(tx, access.root);
  const previous = (config[section] as PortfolioRecord[]).find(x => x.id === item.id);
  if (previous && isDeepStrictEqual(previous, item)) return { revision: expectedRevision, portfolio: config };
  function check(reference: string, values: { id: string }[]) {
    if (reference && !values.some(x => x.id === reference)) invalid();
  }
  const projects = new Set<string>();
  if ("areaId" in item) check(item.areaId, config.areas);
  if ("areaPlans" in item) item.areaPlans.forEach(p => check(p.areaId, config.areas));
  if ("projectIds" in item) item.projectIds.forEach(project => projects.add(project));
  if ("engagementId" in item) {
    projects.add(item.id);
    check(item.engagementId, config.engagements);
    [item.leadId, ...item.teamIds].forEach(person => check(person, config.directory));
  }
  if (projects.size) {
    const docs = await tx.getAll(...[...projects].map(project => access.root.collection("projects").doc(project)));
    if (docs.some(doc => doc.data()?.tenantId !== access.root.id || doc.data()?.id !== doc.id || doc.data()?.schemaVersion !== 2)) invalid();
  }
  const rows: PortfolioRecord[] = config[section];
  const next = previous ? rows.map(x => x.id === item.id ? item : x) : [...rows, item];
  if (next.length > portfolioLimits[section]) invalid();
  const portfolio = { ...config, [section]: next };
  const revision = expectedRevision + 1;
  if (!Number.isSafeInteger(revision)) invalid();
  const audit = randomUUID();
  tx.set(portfolioRef(access.root), { portfolio });
  tx.update(access.root, { revision });
  tx.create(access.root.collection("audits").doc(audit), {
    id: audit, tenantId: access.root.id, actor, action: "portfolio-" + section + "-saved",
    entityId: item.id, revision, at: new Date(now).toISOString(),
  });
  return { revision, portfolio };
}

export function publishedPortfolio(config: Portfolio, projects: ProjectReport["projects"], month: string, history: PublishedPortfolio["history"]): PublishedPortfolio {
  const ids = new Set(projects.map(p => p.id));
  const areas = config.areas.filter(a => a.visible).sort(byOrder);
  const engagements = config.engagements.filter(e => e.visible).sort(byOrder);
  const approvedContacts = config.directory.filter(p => p.active && p.visible).sort(byOrder);
  const safeArea = (id: string) => areas.some(x => x.id === id) ? id : "";
  const placements = config.placements.filter(p => ids.has(p.id)).map(p => ({
    id: p.id, areaId: safeArea(p.areaId), engagementId: engagements.some(e => e.id === p.engagementId) ? p.engagementId : "",
    start: p.publishDates ? p.start : "", target: p.publishDates ? p.target : "", archived: p.archived,
    ...(approvedContacts.some(contact => contact.id === p.leadId) ? { leadId: p.leadId } : {}),
  }));
  const used = new Set(placements.map(p => p.engagementId));
  const directory = approvedContacts.flatMap(p => {
    const linked = [...new Set([...p.projectIds.filter(id => ids.has(id)),
      ...config.placements.filter(x => ids.has(x.id) && (x.leadId === p.id || x.teamIds.includes(p.id))).map(x => x.id)])];
    if (!linked.length) return [];
    return [{ id: p.id, name: p.name, role: p.role, responsibility: p.responsibility,
      publicContact: p.publicContact, projectIds: linked, areaId: safeArea(p.areaId), order: p.order }];
  });
  const note = config.notes.find(n => n.month === month && n.visible);
  return {
    areas: areas.map(({id, name, description, order}) => ({id, name, description, order, visible: true})),
    engagements: engagements.filter(e => used.has(e.id)).map(({id, name}) => ({id, name})),
    placements, directory, narrative: note?.narrative ?? "", action: note?.action ?? "",
    history,
  };
}
