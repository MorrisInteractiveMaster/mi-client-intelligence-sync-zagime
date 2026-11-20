import type { PublishedPortfolio } from "./portfolio";
import { calendarDate, milestoneStatuses, parseDelivery, type Delivery, type MilestoneStatus } from "./delivery";

export const MAX_PROJECT_TIMELINE_ITEMS = 8;
export const MAX_PROJECT_MILESTONES = 40;
export const MAX_PROJECT_UPDATE_TEXT = 500;

export interface ProjectMilestone {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  visible: boolean;
  status?: MilestoneStatus;
  weight?: number;
  ownerId?: string;
  body?: string;
  completedAt?: string;
}
export interface ProjectUpdate {
  id: string;
  title: string;
  date: string;
  body: string;
  visible: boolean;
}

/** Project-only persisted model. Legacy reporting/demo types remain separate. */
export interface Project {
  schemaVersion: 2;
  id: string;
  tenantId: string;
  source: null | {
    product: "qbo-projects";
    realmId: string;
    projectId: string;
    revision: string;
    modifiedAt: string | null;
    state: "active" | "removed" | "inaccessible";
  };
  name: string;
  status: "planned" | "active" | "paused" | "completed";
  progress: number;
  description: string;
  internalNotes: string;
  updates?: ProjectUpdate[];
  milestones?: ProjectMilestone[];
  workOrderReference?: string;
  delivery?: Delivery;
  plan: { basis: "monthly" | "fixed"; targetSeconds: number };
  published: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}
export type ManagedProject = Pick<
  Project,
  | "name"
  | "status"
  | "progress"
  | "description"
  | "internalNotes"
  | "plan"
  | "workOrderReference"
  | "updates"
  | "milestones"
  | "delivery"
>;
export type ProjectView = Pick<
  Project,
  | "schemaVersion"
  | "tenantId"
  | "id"
  | "name"
  | "status"
  | "progress"
  | "description"
  | "plan"
  | "published"
> & {
  lifetimeSeconds: number;
  updates?: (Omit<ProjectUpdate, "visible"> & { visible: true })[];
  milestones?: (Omit<ProjectMilestone, "visible"> & { visible: true })[];
};

export type StaffProjectSummary = ProjectView & {
  seconds: number;
  draft?: ProjectDraftMetadata;
  delivery?: Delivery;
  deliveryMilestones?: ProjectMilestone[];
  workOrderReference?: string;
  reportPreview?: {
    placement?: PublishedPortfolio["placements"][number];
    team: PublishedPortfolio["directory"];
  };
};
export interface ProjectDraftMetadata {
  revision: number;
  updatedAt: string;
}
export interface StaffProjectDetail {
  revision: number;
  project: Project;
  draft?: ProjectDraftMetadata;
}
export interface ProjectWorkspace {
  role: "staff" | "client";
  revision: number;
  tenant: { id: string; name: string };
  integrations?: { accounting: "disabled"; time: "disabled" };
  platformAdmin?: true;
}
export interface ProjectReport {
  month: string;
  tenant: { id: string; name: string };
  totalSeconds: number;
  sourceUpdatedAt?: string;
  presentationTitle?: string;
  portfolio?: PublishedPortfolio;
  hierarchy?: Record<string, {
    parentId?: string; kind?: Delivery["kind"]; type?: Delivery["type"]; completion?: number; start?: string; deadline?: string;
    monthlyCap?: number; lifetimeCap?: number; monthlyCapUsed?: number; lifetimeCapUsed?: number; managerIds?: string[];
  }>;
  projects: (Omit<
    ProjectView,
    "published" | "tenantId" | "updates" | "milestones"
  > & {
    seconds: number;
    updates?: Omit<ProjectUpdate, "visible">[];
    milestones?: Omit<ProjectMilestone, "visible">[];
  })[];
}
export interface ProjectPage {
  revision: number;
  projects?: StaffProjectSummary[];
  sources?: import("../api/types").StaffSource[];
  sourceSummary?: import("../api/types").SourceSummary;
  history?: import("../api/types").HistoryRow[];
  audits?: {
    id: string;
    action: string;
    entityId: string;
    actor: string;
    at: string;
    revision: number;
  }[];
  nextCursor?: string;
}
export const seconds = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 3_600_000_000;
function timeline(value: unknown, kind: "updates"): ProjectUpdate[];
function timeline(value: unknown, kind: "milestones"): ProjectMilestone[];
function timeline(value: unknown, kind: "updates" | "milestones") {
  if (!Array.isArray(value) || value.length > (kind === "updates" ? MAX_PROJECT_TIMELINE_ITEMS : MAX_PROJECT_MILESTONES))
    throw Error("Invalid project timeline");
  const ids = new Set<string>();
  return value.map((item) => {
    const update = kind === "updates";
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) =>
          ![
            "id",
            "title",
            "date",
            "visible",
            ...(update ? ["body"] : ["completed", "status", "weight", "ownerId", "body", "completedAt"]),
          ].includes(key),
      ) ||
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 120 ||
      typeof item.date !== "string" ||
      (!calendarDate(item.date) && (update || item.date !== "")) ||
      typeof item.visible !== "boolean"
    )
      throw Error("Invalid project timeline entry");
    ids.add(item.id);
    const common = {
      id: item.id,
      title: item.title.trim(),
      date: item.date,
      visible: item.visible,
    };
    if (update) {
      if (
        typeof item.body !== "string" ||
        !item.body.trim() ||
        item.body.length > MAX_PROJECT_UPDATE_TEXT
      )
        throw Error("Invalid project update");
      return { ...common, body: item.body.trim() };
    }
    if (typeof item.completed !== "boolean")
      throw Error("Invalid project milestone");
    if ((item.status !== undefined && (!milestoneStatuses.includes(item.status) || item.completed !== (item.status === "completed"))) ||
      (item.weight !== undefined && (!Number.isSafeInteger(item.weight) || item.weight < 1 || item.weight > 1000)) ||
      (item.body !== undefined && (typeof item.body !== "string" || item.body.length > MAX_PROJECT_UPDATE_TEXT)) ||
      (item.ownerId !== undefined && (typeof item.ownerId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.ownerId))) ||
      (item.completedAt !== undefined && (!item.completed || !calendarDate(item.completedAt))))
      throw Error("Invalid project milestone");
    return { ...common, completed: item.completed, ...Object.fromEntries(
      ["status", "weight", "ownerId", "body", "completedAt"].filter(key => item[key] !== undefined).map(key => [key, item[key]])) };
  });
}

function updateFields({
  id,
  title,
  date,
  body,
}: Omit<ProjectUpdate, "visible">) {
  return { id, title, date, body };
}

function milestoneFields({
  id,
  title,
  date,
  completed,
  status,
  body,
  completedAt,
}: Omit<ProjectMilestone, "visible">) {
  return { id, title, date, completed, ...(status && { status }), ...(body && { body }), ...(completedAt && { completedAt }) };
}

export function approvedProjectContent(p: Project, includeUndated = true) {
  return {
    updates: (p.updates ?? [])
      .filter((item) => item.visible === true)
      .map((item) => ({ ...updateFields(item), visible: true as const })),
    milestones: (p.milestones ?? [])
      .filter((item) => item.visible === true && (includeUndated || Boolean(item.date)))
      .map((item) => ({ ...milestoneFields(item), visible: true as const })),
  };
}

export function managedProject(input: unknown): ManagedProject {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid project");
  const p = input as ManagedProject;
  if (
    Object.keys(p).some(
      (k) =>
        ![
          "name",
          "status",
          "progress",
          "description",
          "internalNotes",
          "plan",
          "workOrderReference",
          "updates",
          "milestones",
          "delivery",
        ].includes(k),
    )
  )
    throw Error("Forbidden fields");
  if (
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.trim().length > 200 ||
    !["planned", "active", "paused", "completed"].includes(p.status) ||
    !Number.isFinite(p.progress) ||
    p.progress < 0 ||
    p.progress > 100 ||
    typeof p.description !== "string" ||
    p.description.length > 4000 ||
    typeof p.internalNotes !== "string" ||
    p.internalNotes.length > 4000 ||
    (p.workOrderReference !== undefined &&
      (typeof p.workOrderReference !== "string" ||
        p.workOrderReference.length > 120)) ||
    !p.plan ||
    typeof p.plan !== "object" ||
    Array.isArray(p.plan) ||
    Object.keys(p.plan).some((k) => !["basis", "targetSeconds"].includes(k)) ||
    !["monthly", "fixed"].includes(p.plan.basis) ||
    !seconds(p.plan.targetSeconds)
  )
    throw Error("Invalid project");
  return {
    name: p.name.trim(),
    status: p.status,
    progress: p.progress,
    description: p.description,
    internalNotes: p.internalNotes,
    ...(p.delivery === undefined ? {} : { delivery: parseDelivery(p.delivery) }),
    ...(p.updates === undefined
      ? {}
      : { updates: timeline(p.updates, "updates") }),
    ...(p.milestones === undefined
      ? {}
      : { milestones: timeline(p.milestones, "milestones") }),
    ...(p.workOrderReference?.trim()
      ? { workOrderReference: p.workOrderReference.trim() }
      : {}),
    plan: { basis: p.plan.basis, targetSeconds: p.plan.targetSeconds },
  };
}
export function projectView(
  p: Omit<ProjectView, "lifetimeSeconds" | "updates" | "milestones">,
  lifetimeSeconds: number,
): ProjectView {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 0)
    throw Error("Invalid reporting summary");
  return {
    schemaVersion: 2,
    tenantId: p.tenantId,
    id: p.id,
    name: p.name,
    status: p.status,
    progress: p.progress,
    description: p.description,
    plan: { basis: p.plan.basis, targetSeconds: p.plan.targetSeconds },
    published: p.published,
    lifetimeSeconds,
  };
}
/** Re-project stored views too: never spread private fields into a client response. */
export function publicProject(
  v: ProjectView,
  periodSeconds: number,
): ProjectReport["projects"][number] {
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds < 0)
    throw Error("Invalid reporting summary");
  const {
    published: _,
    tenantId: __,
    ...safe
  } = projectView(v, v.lifetimeSeconds);
  return {
    ...safe,
    seconds: periodSeconds,
    updates: (v.updates ?? [])
      .filter((item) => item.visible === true)
      .map(updateFields),
    milestones: (v.milestones ?? [])
      .filter((item) => item.visible === true)
      .map(milestoneFields),
  };
}
