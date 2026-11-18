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
  workOrderReference?: string;
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
> & { lifetimeSeconds: number };
export interface ProjectWorkspace {
  role: "staff" | "client";
  revision: number;
  tenant: { id: string; name: string };
  integrations?: { accounting: "disabled"; time: "disabled" };
}
export interface ProjectReport {
  month: string;
  tenant: { id: string; name: string };
  totalSeconds: number;
  projects: (Omit<ProjectView, "published" | "tenantId"> & {
    seconds: number;
  })[];
}
export interface ProjectPage {
  revision: number;
  projects?: (ProjectView & { seconds: number })[];
  sources?: import("../api/types").StaffSource[];
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
    ...(p.workOrderReference?.trim()
      ? { workOrderReference: p.workOrderReference.trim() }
      : {}),
    plan: { basis: p.plan.basis, targetSeconds: p.plan.targetSeconds },
  };
}
export function projectView(
  p: Omit<ProjectView, "lifetimeSeconds">,
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
  return { ...safe, seconds: periodSeconds };
}
