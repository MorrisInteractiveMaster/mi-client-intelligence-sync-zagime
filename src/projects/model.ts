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
  blocker?: { message: string; internal?: string; blockedOn: string; resolvedOn?: string };
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
  status: "planned" | "active" | "paused" | "completed" | "closed" | "cancelled";
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
type PublicMilestone = Omit<ProjectMilestone, "visible" | "blocker"> & {
  blocker?: Omit<NonNullable<ProjectMilestone["blocker"]>, "internal">;
};

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
  milestones?: (PublicMilestone & { visible: true })[];
};

export type StaffProjectSummary = ProjectView & {
  seconds: number;
  workOrderEffort?: import("./effort").WorkOrderEffort;
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
  canPublish?: boolean;
}
export interface ProjectReport {
  month: string;
  reportingThroughMonth?: string;
  tenant: { id: string; name: string };
  totalSeconds: number;
  sourceUpdatedAt?: string;
  presentationTitle?: string;
  portfolio?: PublishedPortfolio;
  historyByProject?: Record<string, PublishedPortfolio["history"]>;
  hierarchy?: Record<string, {
    parentId?: string; kind?: Delivery["kind"]; type?: Delivery["type"]; completion?: number; start?: string; deadline?: string;
    monthlyCap?: number; lifetimeCap?: number; monthlyCapUsed?: number; lifetimeCapUsed?: number; managerIds?: string[];
    blocker?: { active: boolean; message: string; resolvedOn?: string };
    completedOn?: string;
  }>;
  projects: (Omit<
    ProjectView,
    "published" | "tenantId" | "updates" | "milestones"
  > & {
    seconds: number;
    workOrderEffort?: import("./effort").WorkOrderEffort;
    updates?: Omit<ProjectUpdate, "visible">[];
    milestones?: PublicMilestone[];
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
            ...(update ? ["body"] : ["completed", "status", "weight", "ownerId", "body", "completedAt", "blocker"]),
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
    const blocker = item.blocker === undefined ? undefined : milestoneBlocker(item.blocker, item.status);
    return { ...common, completed: item.completed, ...(blocker && { blocker }), ...Object.fromEntries(
      ["status", "weight", "ownerId", "body", "completedAt"].filter(key => item[key] !== undefined).map(key => [key, item[key]])) };
  });
}

function milestoneBlocker(value: unknown, status: unknown): ProjectMilestone["blocker"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid milestone blocker");
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(key => !["message", "internal", "blockedOn", "resolvedOn"].includes(key)) ||
    typeof b.message !== "string" || !b.message.trim() || b.message.length > MAX_PROJECT_UPDATE_TEXT ||
    b.internal !== undefined && (typeof b.internal !== "string" || b.internal.length > 2000) ||
    !calendarDate(b.blockedOn) ||
    (b.resolvedOn === undefined ? status !== "blocked" : status === "blocked" || !calendarDate(b.resolvedOn) || b.resolvedOn < b.blockedOn))
    throw Error("Invalid milestone blocker");
  return { message: b.message.trim(), blockedOn: b.blockedOn,
    ...(typeof b.internal === "string" && b.internal.trim() && { internal: b.internal.trim() }),
    ...(calendarDate(b.resolvedOn) && { resolvedOn: b.resolvedOn }) };
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
  blocker,
}: Omit<ProjectMilestone, "visible">) {
  return { id, title, date, completed, ...(status && { status }), ...(body && { body }), ...(completedAt && { completedAt }),
    ...(blocker && { blocker: { message: blocker.message, blockedOn: blocker.blockedOn,
      ...(blocker.resolvedOn && { resolvedOn: blocker.resolvedOn }) } }) };
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
    !["planned", "active", "paused", "completed", "closed", "cancelled"].includes(p.status) ||
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
