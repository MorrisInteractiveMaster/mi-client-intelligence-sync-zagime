import type { ProjectReport } from "../projects/model";
import { calendarDate } from "../projects/delivery";
import { reportDay, today } from "./dashboard-format";

type PublishedProject = ProjectReport["projects"][number];
type PublishedPlacement = NonNullable<ProjectReport["portfolio"]>["placements"][number];
type PublishedDelivery = NonNullable<ProjectReport["hierarchy"]>[string];

export type ClientProject = ReturnType<typeof projectMeasures>;

export function projectMeasures(project: PublishedProject, delivery: PublishedDelivery | undefined,
  placement: PublishedPlacement | undefined, date: string) {
  const { status } = project;
  const start = delivery?.start || placement?.start || undefined;
  const deadline = delivery?.deadline || placement?.target || undefined;
  const completion = delivery?.completion ?? (!delivery && project.progress > 0 ? project.progress : undefined);
  const archived = Boolean(placement?.archived);
  const current = !archived && status !== "completed" && status !== "cancelled" && status !== "closed";
  const schedulePhase = start ? (start > date ? "upcoming" : "current") : delivery?.schedulePhase;
  const schedulable = current && (status === "planned" || status === "active");
  const upcoming = schedulable && schedulePhase === "upcoming";
  const completed = status === "completed";
  const active = schedulable && !upcoming && (status === "active" || schedulePhase === "current");
  const blockedMilestone = project.milestones?.find(item => item.status === "blocked" && !item.blocker?.resolvedOn);
  const blocked = current && Boolean(delivery?.blocker?.active || blockedMilestone);
  const near = current && completion !== undefined && completion >= 70 && completion < 100;
  const overdueMilestone = project.milestones?.filter(item => item.date && item.date < date && !item.completed && item.status !== "waived")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const overdue = current && !upcoming ? [deadline, overdueMilestone?.date].filter((day): day is string => !!day && day < date).sort()[0] : undefined;
  const risk = blocked ? delivery?.blocker?.active ? delivery.blocker.message || "An active blocker has been recorded."
    : blockedMilestone!.blocker?.message || "Milestone “" + blockedMilestone!.title + "” is blocked." : overdue
    ? overdue === deadline ? "Expected completion was " + reportDay(overdue) + "." :
      "Milestone “" + overdueMilestone!.title + "” was due " + reportDay(overdue) + "." : undefined;
  const warningDate = new Date(date + "T00:00:00Z");
  warningDate.setUTCDate(warningDate.getUTCDate() + 14);
  const dueSoon = Boolean(current && !upcoming && deadline && deadline >= date && deadline <= warningDate.toISOString().slice(0, 10));
  return { project, start, deadline, completion, active, archived, upcoming, completed, blocked, near, overdue, risk, dueSoon };
}

export type ProjectFilter = "all" | "active" | "planned" | "upcoming" | "completed" | "paused" | "archived" |
  "near" | "blocked" | "stalled" | "hours" | "other" | "unaffiliated";
export const clientProjectFilters: Record<ProjectFilter, string> = {
  all: "All delivery projects", active: "In progress", planned: "Planned", upcoming: "Upcoming", completed: "Completed",
  paused: "On hold", archived: "Archived", near: "Nearing completion", blocked: "Active blockers", stalled: "Blocked or overdue",
  hours: "With attributable hours", other: "Other project statuses", unaffiliated: "Independent delivery projects",
};

export function forProjectFilter(project: ClientProject, filter: string, seconds: number) {
  if (filter === "all") return true;
  if (filter === "stalled") return Boolean(project.risk);
  if (filter === "hours") return seconds > 0;
  if (filter === "other") return !project.active && !project.upcoming && !project.completed;
  if (filter === "planned" || filter === "paused")
    return !project.archived && !project.upcoming && !project.active && project.project.status === filter;
  if (filter === "active" || filter === "upcoming" || filter === "completed" ||
    filter === "archived" || filter === "near" || filter === "blocked") return project[filter];
  return true;
}

export function projectCounts(projects: ClientProject[]) {
  return {
    all: projects.length,
    active: projects.filter(item => item.active).length,
    completed: projects.filter(item => item.completed).length,
    upcoming: projects.filter(item => item.upcoming).length,
    blocked: projects.filter(item => item.blocked).length,
    near: projects.filter(item => item.near).length,
  };
}

export function clientDelivery(report: ProjectReport, date = today()) {
  const placements = new Map(report.portfolio?.placements.map(item => [item.id, item]));
  const hierarchy = report.hierarchy ?? {};
  const byId = new Map(report.projects.map(project => [project.id, project]));
  const departments = new Map(report.portfolio?.areas.map(item => [item.id, item]));
  const parents = new Map(report.projects.filter(project => hierarchy[project.id]?.kind === "engagement")
    .map(project => [project.id, { id: project.id, name: project.name }]));
  for (const group of report.portfolio?.engagements ?? []) if (!parents.has(group.id)) parents.set(group.id, group);

  function ancestry(projectId: string) {
    const ids = new Set<string>();
    let parent = hierarchy[projectId]?.parentId;
    while (parent && byId.has(parent) && !ids.has(parent) && ids.size < 24 && parent !== projectId) {
      ids.add(parent);
      parent = hierarchy[parent]?.parentId;
    }
    return ids;
  }

  const projectRows = report.projects.map(project => {
    const placement = placements.get(project.id);
    const delivery = hierarchy[project.id];
    const parentIds = ancestry(project.id);
    const parent = [...parentIds].map(id => parents.get(id)).find(item => item !== undefined) ??
      (placement?.engagementId ? parents.get(placement.engagementId) : undefined);
    const department = placement?.areaId ? departments.get(placement.areaId) : undefined;
    return { ...projectMeasures(project, delivery, placement, date), placement, delivery, parent, parentIds, department };
  });
  const projects = projectRows.filter(item => item.delivery?.kind !== "engagement" && item.delivery?.kind !== "service-area");
  const parentRows = [...parents.values()].map(parent => {
    const deliveryProjects = projects.filter(item => item.parent?.id === parent.id);
    const members = projectRows.filter(item => item.project.id === parent.id || item.parentIds.has(parent.id) || item.parent?.id === parent.id);
    return { ...parent, project: byId.get(parent.id), delivery: hierarchy[parent.id], projects: deliveryProjects,
      counts: projectCounts(deliveryProjects), seconds: members.reduce((total, member) => total + member.project.seconds, 0) };
  }).sort((a, b) => a.name.localeCompare(b.name, "en-CA"));
  const departmentRows = [...departments.values()].map(department => {
    const deliveryProjects = projects.filter(item => item.department?.id === department.id);
    const effortProjects = projectRows.filter(item => item.department?.id === department.id);
    return { ...department, projects: deliveryProjects, effortProjects, counts: projectCounts(deliveryProjects),
      seconds: effortProjects.reduce((total, item) => total + item.project.seconds, 0) };
  }).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "en-CA"));
  const progress = projects.filter(item => item.completion !== undefined)
    .sort((a, b) => b.completion! - a.completion! || a.project.name.localeCompare(b.project.name, "en-CA"));
  const risks = projects.filter(item => item.risk).sort((a, b) => Number(b.blocked) - Number(a.blocked) ||
    (a.overdue ?? "9999").localeCompare(b.overdue ?? "9999") || a.project.name.localeCompare(b.project.name, "en-CA"));
  const unaffiliated = projects.filter(item => !item.parent);
  const ungroupedSeconds = projectRows.filter(item => !item.department).reduce((total, item) => total + item.project.seconds, 0);
  return { projects, projectRows, parentRows, departmentRows, progress, risks, unaffiliated, ungroupedSeconds, counts: projectCounts(projects) };
}

export function projectCompletionHistory(
  projects: readonly (ClientProject & { delivery?: PublishedDelivery })[], through = today(),
) {
  const matches = new Map<string, PublishedProject[]>();
  for (const { project, delivery } of projects) {
    const completedOn = delivery?.completedOn;
    if (!calendarDate(completedOn) || completedOn > through || (project.status !== "completed" && project.status !== "closed")) continue;
    const month = completedOn.slice(0, 7);
    const records = matches.get(month) ?? [];
    records.push(project);
    matches.set(month, records);
  }
  return [...matches].sort(([a], [b]) => a.localeCompare(b)).map(([month, records]) => ({
    id: month, month, projects: records.sort((a, b) => a.name.localeCompare(b.name, "en-CA")),
  }));
}
