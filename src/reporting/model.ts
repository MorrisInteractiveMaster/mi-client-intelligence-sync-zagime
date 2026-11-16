export interface Tenant {
  id: string;
  name: string;
}
export interface CapRevision {
  month: string;
  minutes: number;
  revision: number;
  note: string;
}
export interface Agreement {
  id: string;
  tenantId: string;
  name: string;
  caps: CapRevision[];
}
export interface Department {
  id: string;
  name: string;
  archived?: boolean;
}
export interface DepartmentBudget {
  agreementId: string;
  departmentId: string;
  month: string;
  minutes: number;
}
export interface DeliveryProject {
  id: string;
  agreementId: string;
  departmentId: string;
  name: string;
  plan: { basis: "monthly" | "fixed"; minutes: number };
  progress: number;
  published: boolean;
  internalNotes: string;
  trainingSessions: { id: string; date: string; minutes: number }[];
}
export interface SourceLink {
  projectId?: string;
  agreementId?: string;
  verified?: boolean;
  source: "synthetic-qbo";
  externalId: string;
  label: string;
}
export interface RawTime {
  id: string;
  tenantId: string;
  sourcePersonId: string;
  sourceWorkOrderId: string;
  date: string;
  seconds: number;
  description: string;
  revision: string;
}
export interface Allocation {
  projectId: string;
  seconds: number;
  description: string;
}
export interface AllocationRevision {
  sourceId: string;
  revision: number;
  portions: Allocation[];
  at: string;
}
export interface TeamMember {
  id: string;
  name: string;
  externalIds: string[];
}
export interface TeamAssignment {
  projectId: string;
  memberId: string;
}
export interface MilestoneEvent {
  projectId: string;
  id: string;
  due: string;
  note: string;
  done: boolean;
  at: string;
}
export interface Blocker {
  id: string;
  projectId: string;
  description: string;
  resolved: boolean;
}
export interface Publication {
  projectId: string;
  text: string;
  published: boolean;
}
export interface Audit {
  id: string;
  action: string;
  at: string;
}
export interface StatusEvent {
  projectId: string;
  status: "Upcoming" | "On track" | "Attention" | "Delayed" | "Completed";
  at: string;
  note: string;
}
export interface ReportingState {
  version: 2;
  tenant: Tenant;
  agreements: Agreement[];
  departments: Department[];
  budgets: DepartmentBudget[];
  projects: DeliveryProject[];
  links: SourceLink[];
  raw: RawTime[];
  allocations: AllocationRevision[];
  team: TeamMember[];
  assignments: TeamAssignment[];
  milestones: MilestoneEvent[];
  blockers: Blocker[];
  publications: Publication[];
  audits: Audit[];
  statuses?: StatusEvent[];
  sourceCorrections?: { sourceId: string; previous: RawTime; next: RawTime }[];
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function latestAllocation(s: ReportingState, id: string) {
  return s.allocations
    .filter((a) => a.sourceId === id)
    .sort((a, b) => b.revision - a.revision)[0];
}
export function validate(s: ReportingState) {
  if (s.version !== 2 || !s.tenant.id || !s.tenant.name)
    throw Error("Invalid reporting version or tenant");
  const unique = (values: string[]) => {
    if (new Set(values).size !== values.length)
      throw Error("Duplicate mapping or revision");
  };
  const hasProject = (id: string) => s.projects.some((p) => p.id === id);
  unique(
    s.budgets.map((b) => b.agreementId + ":" + b.departmentId + ":" + b.month),
  );
  unique(s.allocations.map((a) => a.sourceId + ":" + a.revision));
  unique(s.links.map((l) => l.source + ":" + l.externalId));
  unique(s.team.flatMap((t) => t.externalIds));
  for (const a of s.agreements)
    unique(a.caps.map((c) => c.month + ":" + c.revision));
  for (const b of s.budgets)
    if (
      !s.agreements
        .find((a) => a.id === b.agreementId)
        ?.caps.some((c) => c.month === b.month)
    )
      throw Error("Missing monthly agreement cap");
  for (const l of s.links)
    if (
      !l.projectId === !l.agreementId ||
      (l.projectId
        ? !hasProject(l.projectId)
        : !s.agreements.some((a) => a.id === l.agreementId)) ||
      !l.externalId.trim()
    )
      throw Error("Invalid source link");
  for (const a of s.assignments)
    if (!hasProject(a.projectId) || !s.team.some((t) => t.id === a.memberId))
      throw Error("Invalid team assignment");
  for (const m of s.milestones)
    if (
      !hasProject(m.projectId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(m.due) ||
      typeof m.done !== "boolean"
    )
      throw Error("Invalid milestone");
  for (const b of s.blockers)
    if (
      !hasProject(b.projectId) ||
      !b.description.trim() ||
      typeof b.resolved !== "boolean"
    )
      throw Error("Invalid blocker");
  for (const p of s.publications)
    if (!hasProject(p.projectId) || typeof p.published !== "boolean")
      throw Error("Invalid publication");
  for (const e of s.statuses ?? [])
    if (
      !hasProject(e.projectId) ||
      !["Upcoming", "On track", "Attention", "Delayed", "Completed"].includes(
        e.status,
      )
    )
      throw Error("Invalid status");
  for (const p of s.projects) {
    if (
      !["monthly", "fixed"].includes(p.plan.basis) ||
      typeof p.published !== "boolean"
    )
      throw Error("Invalid project plan");
    if (p.trainingSessions.length && p.plan.basis !== "fixed")
      throw Error("Training requires a fixed-total plan");
    unique(p.trainingSessions.map((t) => t.id));
  }

  for (const list of [s.agreements, s.departments, s.projects, s.raw, s.team])
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw Error("Duplicate identity");
  for (const a of s.agreements) {
    if (a.tenantId !== s.tenant.id) throw Error("Tenant mismatch");
    for (const c of a.caps)
      if (!integer(c.minutes) || !integer(c.revision))
        throw Error("Invalid cap");
  }
  for (const b of s.budgets) {
    if (
      !s.departments.some((d) => d.id === b.departmentId) ||
      !s.agreements.some((a) => a.id === b.agreementId) ||
      !integer(b.minutes)
    )
      throw Error("Invalid department budget");
  }
  for (const a of s.agreements)
    for (const month of new Set(a.caps.map((c) => c.month))) {
      const cap = a.caps
        .filter((c) => c.month === month)
        .sort((x, y) => y.revision - x.revision)[0];
      if (
        s.budgets
          .filter((b) => b.agreementId === a.id && b.month === month)
          .reduce((n, b) => n + b.minutes, 0) > cap.minutes
      )
        throw Error("Department budgets exceed agreement");
    }
  for (const p of s.projects) {
    if (
      !p.name.trim() ||
      !s.budgets.some(
        (b) =>
          b.agreementId === p.agreementId && b.departmentId === p.departmentId,
      ) ||
      !integer(p.plan.minutes) ||
      !Number.isFinite(p.progress) ||
      p.progress < 0 ||
      p.progress > 100
    )
      throw Error("Invalid project");
    for (const t of p.trainingSessions)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !integer(t.minutes))
        throw Error("Invalid session");
  }
  for (const r of s.raw)
    if (!integer(r.seconds) || r.tenantId !== s.tenant.id)
      throw Error("Invalid source");
  for (const a of s.allocations) {
    if (
      !s.raw.some((r) => r.id === a.sourceId) ||
      !integer(a.revision) ||
      a.portions.some(
        (p) =>
          !integer(p.seconds) || !s.projects.some((x) => x.id === p.projectId),
      )
    )
      throw Error("Invalid allocation");
  }
}
export function allocate(
  s: ReportingState,
  sourceId: string,
  portions: Allocation[],
  at: string,
): ReportingState {
  const raw = s.raw.find((r) => r.id === sourceId);
  if (!raw) throw Error("Unknown source");
  if (
    portions.some((p) => !integer(p.seconds)) ||
    portions.reduce((n, p) => n + p.seconds, 0) > raw.seconds
  )
    throw Error("Allocated time exceeds source duration");
  checkedAllocationSeconds(portions, raw.seconds);
  const previous = latestAllocation(s, sourceId);
  if (JSON.stringify(previous?.portions ?? []) === JSON.stringify(portions))
    return s;
  const next = structuredClone(s);
  next.allocations.push({
    sourceId,
    revision: (previous?.revision ?? 0) + 1,
    portions: structuredClone(portions),
    at,
  });
  next.audits.push({
    id: `allocation-${sourceId}-${(previous?.revision ?? 0) + 1}`,
    action: "Reporting allocation changed",
    at,
  });
  validate(next);
  return next;
}
export function reconcile(s: ReportingState, raw: RawTime): ReportingState {
  const old = s.raw.find((r) => r.id === raw.id);
  if (old) {
    if (JSON.stringify(old) === JSON.stringify(raw)) return s;
    if (!/^\d+$/.test(old.revision) || !/^\d+$/.test(raw.revision))
      throw Error("Source revisions must be comparable numeric strings");
    if (BigInt(raw.revision) <= BigInt(old.revision))
      throw Error("Stale or conflicting source revision");
  }
  const next = structuredClone(s);
  const i = next.raw.findIndex((r) => r.id === raw.id);
  if (i < 0) next.raw.push(structuredClone(raw));
  else {
    next.raw[i] = structuredClone(raw);
    (next.sourceCorrections ??= []).push({
      sourceId: raw.id,
      previous: structuredClone(old!),
      next: structuredClone(raw),
    });
  }
  validate(next);
  return next;
}
export const DEMO_MONTH = "2026-10";
export interface ReportingScope {
  month: string;
  agreementId?: string;
}
/** Period-filtered allocation portions; source IDs are unique and never expanded into raw clones. */
export function project(
  s: ReportingState,
  scope: ReportingScope = { month: DEMO_MONTH },
) {
  validate(s);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.month))
    throw Error("Invalid reporting month");
  if (
    scope.agreementId &&
    !s.agreements.some((a) => a.id === scope.agreementId)
  )
    throw Error("Unknown agreement");
  const belongs = (id: string) =>
    !scope.agreementId ||
    s.projects.find((p) => p.id === id)?.agreementId === scope.agreementId;
  const conflict = (r: RawTime) =>
    (latestAllocation(s, r.id)?.portions.reduce((n, p) => n + p.seconds, 0) ??
      0) > r.seconds;
  const rows = s.raw.filter((r) => r.date.slice(0, 7) === scope.month);
  const relevant = (r: RawTime) =>
    !scope.agreementId ||
    (latestAllocation(s, r.id)?.portions.some((p) => belongs(p.projectId)) ??
      false) ||
    s.links.some(
      (l) =>
        l.agreementId === scope.agreementId &&
        l.externalId === r.sourceWorkOrderId,
    );
  const conflicts = rows
    .filter((r) => relevant(r) && conflict(r))
    .map((r) => r.id);
  const portions = rows
    .filter((r) => !conflict(r))
    .flatMap((r) => latestAllocation(s, r.id)?.portions ?? [])
    .filter((p) => belongs(p.projectId));
  const lifetime = s.raw
    .filter((r) => !conflict(r))
    .flatMap((r) => latestAllocation(s, r.id)?.portions ?? []);
  const projects = s.projects
    .filter((p) => belongs(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      agreementId: p.agreementId,
      departmentId: p.departmentId,
      progress: p.progress,
      plan: { ...p.plan },
      published: p.published,
      seconds: portions
        .filter((x) => x.projectId === p.id)
        .reduce((n, x) => n + x.seconds, 0),
      lifetimeSeconds: lifetime
        .filter((x) => x.projectId === p.id)
        .reduce((n, x) => n + x.seconds, 0),
    }));
  const agreements = s.agreements
    .filter((a) => !scope.agreementId || a.id === scope.agreementId)
    .map((a) => {
      const cap =
        a.caps
          .filter((c) => c.month === scope.month)
          .sort((x, y) => y.revision - x.revision)[0]?.minutes ?? 0;
      const departments = s.budgets
        .filter((b) => b.agreementId === a.id && b.month === scope.month)
        .map((b) => ({
          id: b.departmentId,
          name: s.departments.find((d) => d.id === b.departmentId)!.name,
          agreementId: a.id,
          minutes: b.minutes,
          seconds: projects
            .filter(
              (p) =>
                p.agreementId === a.id && p.departmentId === b.departmentId,
            )
            .reduce((n, p) => n + p.seconds, 0),
        }));
      return {
        id: a.id,
        name: a.name,
        capMinutes: cap,
        reserveMinutes: cap - departments.reduce((n, b) => n + b.minutes, 0),
        seconds: projects
          .filter((p) => p.agreementId === a.id)
          .reduce((n, p) => n + p.seconds, 0),
        departments,
      };
    });
  // Remainders are owned by their source record. Agreement scoping attributes a remainder only through an explicit agreement source link.
  const unallocatedSeconds = rows
    .filter(
      (r) =>
        !scope.agreementId ||
        s.links.some(
          (l) =>
            l.agreementId === scope.agreementId &&
            l.externalId === r.sourceWorkOrderId,
        ),
    )
    .reduce(
      (n, r) =>
        n +
        (conflict(r)
          ? r.seconds
          : r.seconds -
            (latestAllocation(s, r.id)?.portions.reduce(
              (n, p) => n + p.seconds,
              0,
            ) ?? 0)),
      0,
    );
  return {
    month: scope.month,
    tenant: { ...s.tenant },
    agreements,
    projects,
    totalSeconds: projects.reduce((n, p) => n + p.seconds, 0),
    unallocatedSeconds,
    conflicts,
    departments: agreements.flatMap((a) => a.departments),
  };
}
/** Explicit publication allowlist: internal source/reconciliation fields never leave this view. */
export function clientProjection(
  s: ReportingState,
  scope: ReportingScope = { month: DEMO_MONTH },
) {
  const internal = project(s, scope);
  const projects = internal.projects
    .filter((p) => p.published)
    .map(({ published, ...p }) => p);
  const agreements = internal.agreements.map((a) => ({
    ...a,
    seconds: projects
      .filter((p) => p.agreementId === a.id)
      .reduce((n, p) => n + p.seconds, 0),
    departments: a.departments.map((d) => ({
      ...d,
      seconds: projects
        .filter((p) => p.agreementId === a.id && p.departmentId === d.id)
        .reduce((n, p) => n + p.seconds, 0),
    })),
  }));
  return {
    month: scope.month,
    tenant: internal.tenant,
    projects,
    agreements,
    totalSeconds: projects.reduce((n, p) => n + p.seconds, 0),
    departments: agreements.flatMap((a) => a.departments),
  };
}
export const hours = (seconds: number) =>
  (seconds / 3600).toLocaleString("en-CA", { maximumFractionDigits: 4 });
export function persist(
  storage: Pick<Storage, "setItem">,
  previous: ReportingState,
  next: ReportingState,
) {
  validate(next);
  if (JSON.stringify(previous) === JSON.stringify(next)) return false;
  storage.setItem("mi-reporting-v2", JSON.stringify(next));
  return true;
}
export function demo(): ReportingState {
  return {
    version: 2,
    tenant: { id: "synthetic-zagime", name: "Zagimē Anishinabēk" },
    agreements: [
      {
        id: "agreement-demo",
        tenantId: "synthetic-zagime",
        name: "Illustrative agreement · WO1267",
        caps: [
          {
            month: "2026-10",
            minutes: 14400,
            revision: 1,
            note: "Synthetic example only",
          },
        ],
      },
    ],
    departments: ["HR", "Health", "CFW"].map((name) => ({
      id: name.toLowerCase(),
      name,
    })),
    budgets: ["hr", "health", "cfw"].map((departmentId) => ({
      agreementId: "agreement-demo",
      departmentId,
      month: "2026-10",
      minutes: 4800,
    })),
    projects: [30, 20, 30].map((h, i) => ({
      id: `delivery-${i}`,
      agreementId: "agreement-demo",
      departmentId: "health",
      name: ["Health planning", "Community workshop", "Delivery review"][i],
      plan: { basis: "fixed", minutes: h * 60 },
      progress: 0,
      published: true,
      internalNotes: "Synthetic internal note",
      trainingSessions: [],
    })),
    raw: [
      {
        id: "raw-demo",
        tenantId: "synthetic-zagime",
        sourcePersonId: "person-demo",
        sourceWorkOrderId: "external-demo",
        date: "2026-10-15",
        seconds: 28800,
        description: "Original synthetic source description",
        revision: "0",
      },
    ],
    allocations: [],
    links: [],
    team: [],
    assignments: [],
    milestones: [],
    blockers: [],
    publications: [],
    audits: [],
  };
}

/** View-only adapter. No new calculations are owned by the animation component. */
export function recapInput(
  s: ReportingState,
  scope: ReportingScope = { month: DEMO_MONTH },
) {
  const v = clientProjection(s, scope);
  const date = new Date(scope.month + "-01T00:00:00Z");
  const long = date.toLocaleString("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10);
  return {
    client: v.tenant.name,
    partner: "Morris Interactive",
    asOf: end,
    months: [date.toLocaleString("en-CA", { month: "short", timeZone: "UTC" })],
    monthsLong: [long],
    projects: v.agreements.map((a) => ({
      name: a.name,
      wo: a.id,
      parent: null,
      status: "On track",
      cap: a.capMinutes / 60,
      end,
      months: [a.seconds / 3600],
    })),
  };
}
export function attachSource(s: ReportingState, link: SourceLink) {
  const next = structuredClone(s);
  next.links = next.links.filter(
    (l) =>
      !(
        l.source === link.source &&
        (link.projectId
          ? l.projectId === link.projectId
          : l.agreementId === link.agreementId)
      ),
  );
  next.links.push(structuredClone(link));
  validate(next);
  return next;
}

/** Shared exact-duration invariant for reporting edits. */
export function checkedAllocationSeconds(
  portions: Allocation[],
  sourceSeconds: number,
) {
  if (
    !Number.isSafeInteger(sourceSeconds) ||
    sourceSeconds < 0 ||
    portions.some((p) => !Number.isSafeInteger(p.seconds) || p.seconds < 0)
  )
    throw Error("Invalid allocation duration");
  const total = portions.reduce((n, p) => n + p.seconds, 0);
  if (!Number.isSafeInteger(total) || total > sourceSeconds)
    throw Error("Allocated time exceeds source duration");
  return total;
}
