export const MAX_DELIVERY_PROJECTS = 600;
export const MAX_PROJECT_DEPTH = 24;
export const engagementTypes = ["hourly", "fixed-fee", "training", "workshop"] as const;
export const deliveryKinds = ["engagement", "service-area", "project"] as const;
export const deliveryKindNames = { engagement: "Parent Project", "service-area": "Department", project: "Delivery Project" };
export const milestoneStatuses = ["not-started", "in-progress", "blocked", "completed", "waived"] as const;
export type MilestoneStatus = typeof milestoneStatuses[number];
export interface Delivery {
  parentId?: string;
  areaId?: string;
  groupId?: string;
  workOrderIds?: string[];
  /** Older projects retain their historical structure until staff deliberately convert them. */
  structure?: 2 | 3;
  kind: typeof deliveryKinds[number];
  type: typeof engagementTypes[number];
  monthlyCap?: number;
  lifetimeCap?: number;
  countAgainstParentCap?: boolean;
  allowDirectAllocation?: boolean;
  manualCompletion?: number;
  completedOn?: string;
  start?: string;
  deadline?: string;
  publishSummary?: boolean;
  publishStartStatus?: boolean;
  blocker?: { active: boolean; message: string; internal: string; resolvedOn?: string };
  managerIds: string[];
  teamIds: string[];
  training?: { days: number; dates: string[]; preparation?: string; followUp?: string; completion?: string; venue?: string; facilitatorIds: string[] };
}

export const deliveryDefaults: Delivery = { kind: "project", type: "hourly", managerIds: [], teamIds: [] };
const reginaCalendar = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Regina", year: "numeric", month: "2-digit", day: "2-digit" });
export const deliveryDate = (date = new Date()) => reginaCalendar.format(date);
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
const invalid = (): never => { throw Error("Invalid delivery settings"); };
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function optionalId(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !identifier.test(value)) return invalid();
  return value;
}
function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length) return invalid();
  return value.map(id => optionalId(id) ?? invalid());
}
export function calendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parseDelivery(input: unknown): Delivery {
  const v = object(input, ["parentId", "areaId", "groupId", "structure", "kind", "type", "monthlyCap", "lifetimeCap", "manualCompletion", "completedOn", "start", "deadline", "publishSummary", "publishStartStatus", "managerIds", "teamIds", "training", "workOrderIds", "countAgainstParentCap", "allowDirectAllocation", "blocker"]);
  let blocker: Delivery["blocker"];
  if (v.blocker !== undefined) {
    const state = object(v.blocker, ["active", "message", "internal", "resolvedOn"]);
    if (typeof state.active !== "boolean" || typeof state.message !== "string" || state.message.length > 500 ||
      typeof state.internal !== "string" || state.internal.length > 2000 ||
      state.resolvedOn !== undefined && (state.active || !calendarDate(state.resolvedOn))) return invalid();
    blocker = { active: state.active, message: state.message.trim(), internal: state.internal.trim(),
      ...(calendarDate(state.resolvedOn) && { resolvedOn: state.resolvedOn }) };
  }
  if (!deliveryKinds.some(kind => kind === v.kind) || (v.structure !== undefined && v.structure !== 2 && v.structure !== 3)) return invalid();
  if (v.kind === "service-area" && v.structure !== 2) return invalid();
  if ((v.countAgainstParentCap !== undefined && (v.kind !== "project" || typeof v.countAgainstParentCap !== "boolean")) ||
      (v.allowDirectAllocation !== undefined && (v.kind !== "engagement" || typeof v.allowDirectAllocation !== "boolean"))) return invalid();
  if (!engagementTypes.some(type => type === v.type)) return invalid();
  const number = (value: unknown, limit: number) => {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > limit) return invalid();
    return value;
  };
  const date = (value: unknown) => value === undefined || calendarDate(value) ? value : invalid();
  let start = date(v.start), deadline = date(v.deadline);
  if (v.publishSummary !== undefined && typeof v.publishSummary !== "boolean") return invalid();
  if (v.publishStartStatus !== undefined && typeof v.publishStartStatus !== "boolean") return invalid();
  const workOrderIds = v.workOrderIds === undefined ? undefined : uniqueIds(v.workOrderIds);
  if (workOrderIds && (workOrderIds.length > 10 || workOrderIds.some(id => !/^\d{1,32}$/.test(id)))) return invalid();
  const compact = <K extends string, T>(key: K, value?: T) => value === undefined ? {} : { [key]: value } as Record<K, T>;
  let training: Delivery["training"];
  if (v.training !== undefined) {
    const t = object(v.training, ["days", "dates", "preparation", "followUp", "completion", "venue", "facilitatorIds"]);
    const days = number(t.days, 60);
    if ((v.type !== "training" && v.type !== "workshop") || !days || !Array.isArray(t.dates) || t.dates.length > days || t.dates.some(d => !calendarDate(d)) || new Set(t.dates).size !== t.dates.length) return invalid();
    if (t.venue !== undefined && (typeof t.venue !== "string" || t.venue.length > 200)) return invalid();
    training = { days, dates: [...t.dates].sort(), facilitatorIds: uniqueIds(t.facilitatorIds),
      ...compact("venue", typeof t.venue === "string" ? t.venue.trim() || undefined : undefined),
      ...compact("preparation", date(t.preparation)), ...compact("followUp", date(t.followUp)), ...compact("completion", date(t.completion)) };
  }
  const managerIds = uniqueIds(v.managerIds);
  if (v.structure === 3) {
    if (!managerIds.length) return invalid();
    if ((v.kind === "engagement" && (v.parentId !== undefined || v.areaId !== undefined)) ||
        (v.kind === "project" && (v.parentId === undefined || v.areaId === undefined))) return invalid();
    if (v.type !== "hourly" && v.monthlyCap !== undefined) return invalid();
    if (v.type === "training" || v.type === "workshop") {
      if (!training || training.dates.length !== training.days || !training.facilitatorIds.length) return invalid();
      start = training.dates[0];
      deadline = training.dates.at(-1);
    }
  }
  if (start && deadline && start > deadline) return invalid();
  return { kind: v.kind as Delivery["kind"], type: v.type as Delivery["type"], managerIds, teamIds: uniqueIds(v.teamIds),
    ...compact("structure", v.structure),
    ...compact("parentId", optionalId(v.parentId)), ...compact("areaId", optionalId(v.areaId)), ...compact("groupId", optionalId(v.groupId)),
    ...compact("workOrderIds", workOrderIds),
    ...compact("monthlyCap", number(v.monthlyCap, 3_600_000_000)), ...compact("lifetimeCap", number(v.lifetimeCap, 3_600_000_000)),
    ...compact("manualCompletion", number(v.manualCompletion, 100)), ...compact("completedOn", date(v.completedOn)),
    ...compact("start", start), ...compact("deadline", deadline),
    ...compact("publishSummary", v.publishSummary), ...compact("publishStartStatus", v.publishStartStatus),
    ...compact("training", training), ...compact("blocker", blocker),
    ...compact("countAgainstParentCap", v.countAgainstParentCap), ...compact("allowDirectAllocation", v.allowDirectAllocation) };
}

export function checkHierarchy(nodes: Map<string, string | undefined>) {
  for (const id of nodes.keys()) {
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (path.has(current) || !nodes.has(current) || path.size >= MAX_PROJECT_DEPTH) throw Error("Invalid project hierarchy");
      path.add(current);
      current = nodes.get(current);
    }
  }
}

/** Validate explicit new structures while continuing to read existing classifications and placements. */
export function checkDeliveryStructure(nodes: Map<string, Delivery | undefined>) {
  checkHierarchy(new Map([...nodes].map(([id, value]) => [id, value?.parentId])));
  for (const node of nodes.values()) {
    const parent = node?.parentId && nodes.get(node.parentId);
    if (!node) continue;
    if (parent && parent.structure === 3 && parent.kind === "project") throw Error("Invalid project hierarchy");
    if (node.structure === 3) {
      if (node.kind === "engagement" && !node.parentId && !node.areaId) continue;
      if (node.kind === "project" && node.areaId && parent && parent.kind === "engagement" && !parent.parentId) continue;
      throw Error("Invalid project hierarchy");
    }
    if (node.structure !== 2) {
      // An existing project may retain its legacy shape. It cannot make a strict delivery leaf a parent.
      if (parent && parent.structure === 2 && parent.kind === "project") throw Error("Invalid project hierarchy");
      let ancestor = parent || undefined;
      for (let depth = 2; ancestor; depth++, ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : undefined) {
        if (ancestor.structure === 2 && depth > 3) throw Error("Invalid project hierarchy");
      }
      continue;
    }
    if (node.kind === "engagement" && !node.parentId && !node.areaId) continue;
    if (node.kind === "service-area" && node.areaId && parent && parent.kind === "engagement" && !parent.parentId) continue;
    if (node.kind === "project" && parent && (
      parent.kind === "engagement" && !parent.parentId && !node.areaId ||
      parent.kind === "service-area" && parent.structure === 2 && parent.areaId === node.areaId
    )) continue;
    throw Error("Invalid project hierarchy");
  }
}

export function canAllocateToDelivery(delivery?: Delivery) {
  return delivery?.kind !== "service-area" && (delivery?.kind !== "engagement" || delivery.allowDirectAllocation !== false);
}

export type DeliveryMilestone = { completed: boolean; status?: MilestoneStatus; weight?: number; date: string };
export function measureDelivery(
  project: { delivery?: Delivery; progress: number; status: string; milestones?: DeliveryMilestone[] },
  allocated: { monthly: number; lifetime: number },
  today: string,
) {
  const applicable = (project.milestones ?? []).filter(m => m.status !== "waived");
  const weight = applicable.reduce((sum, m) => sum + (m.weight ?? 1), 0);
  const done = applicable.reduce((sum, m) => sum + (m.completed ? m.weight ?? 1 : 0), 0);
  const settings = project.delivery;
  const milestoneCompletion = weight ? Math.round(done * 100 / weight) : undefined;
  const completion = settings?.manualCompletion ?? milestoneCompletion ?? (settings ? undefined : project.progress || undefined);
  const monthlyRemaining = settings?.monthlyCap === undefined ? undefined : settings.monthlyCap - allocated.monthly;
  const lifetimeRemaining = settings?.lifetimeCap === undefined ? undefined : settings.lifetimeCap - allocated.lifetime;
  const upcoming = [settings?.deadline, ...applicable.filter(m => !m.completed).map(m => m.date)].filter((date): date is string => Boolean(date)).sort()[0];
  const schedule = upcoming ? Math.round((Date.parse(upcoming) - Date.parse(today)) / 86_400_000) : undefined;
  const health = project.status === "completed" ? "Completed"
    : schedule !== undefined && schedule < 0 ? "Overdue"
      : (monthlyRemaining ?? 0) < 0 || (lifetimeRemaining ?? 0) < 0 ? "Over budget"
        : settings?.blocker?.active || applicable.some(m => m.status === "blocked") || schedule !== undefined && schedule <= 7 ? "Attention needed"
          : completion !== undefined || schedule !== undefined || monthlyRemaining !== undefined || lifetimeRemaining !== undefined ? "On track" : "Not configured";
  return { completion, milestoneCompletion, monthlyRemaining, lifetimeRemaining, upcoming, health };
}

export function rollup<T extends { id: string; seconds: number; lifetimeSeconds: number; delivery?: Delivery }>(projects: T[]) {
  const direct = new Map(projects.map(project => [project.id, project]));
  const totals = new Map(projects.map(p => [p.id, { monthly: p.seconds, lifetime: p.lifetimeSeconds, descendants: 0 }]));
  for (const project of projects) {
    const visited = new Set([project.id]);
    let parent = project.delivery?.parentId;
    while (parent && !visited.has(parent) && visited.size < MAX_PROJECT_DEPTH) {
      const total = totals.get(parent);
      if (!total) break;
      visited.add(parent);
      total.monthly += project.seconds;
      total.lifetime += project.lifetimeSeconds;
      total.descendants++;
      parent = direct.get(parent)?.delivery?.parentId;
    }
  }
  return totals;
}

/** Projects can opt out of their engagement's budget without changing effort or service-area totals. */
export function capRollup<T extends { id: string; seconds: number; lifetimeSeconds: number; delivery?: Delivery }>(projects: T[]) {
  const totals = rollup(projects);
  const byId = new Map(projects.map(project => [project.id, project]));
  for (const project of projects) {
    if (project.delivery?.countAgainstParentCap !== false) continue;
    const seen = new Set([project.id]);
    let parentId = project.delivery.parentId;
    while (parentId && !seen.has(parentId) && seen.size < MAX_PROJECT_DEPTH) {
      const parent = byId.get(parentId);
      if (!parent) break;
      seen.add(parentId);
      if (parent.delivery?.kind === "engagement") {
        const total = totals.get(parentId)!;
        total.monthly -= project.seconds;
        total.lifetime -= project.lifetimeSeconds;
      }
      parentId = parent.delivery?.parentId;
    }
  }
  return totals;
}
